import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'post-controller-runtime-test-secret';

const prisma = require('../prisma').default as typeof import('../prisma').default;
const pagePost = require('../pages/pagePostService') as typeof import('../pages/pagePostService');
const pageReplay = require('../pages/pagePostReplay') as typeof import('../pages/pagePostReplay');
const { createPost, getComments, likePost, likeComment, savePost, hidePost, reportPost, getPageManagedPostResults, deletePost } = require('./postController') as typeof import('./postController');
const { getParticipants } = require('./postController') as typeof import('./postController');

test('participants keep anonymous identities out of both list and total, with one visibility read', async () => {
    const originals = { transaction: prisma.$transaction, queryRaw: prisma.$queryRaw, findMany: prisma.response.findMany, count: prisma.response.count };
    let visibilityReads = 0;
    let listWhere: any;
    let countWhere: any;
    try {
        (prisma as any).$transaction = async (work: any, options: any) => {
            assert.equal(options.isolationLevel, 'RepeatableRead'); return work(prisma);
        };
        (prisma as any).$queryRaw = async () => { visibilityReads++; return [{ id: 'p', authorId: 'owner', resultsWho: 'Public', resultsTiming: 'AnyTime', forceAnonymous: false }]; };
        (prisma.response as any).findMany = async ({ where }: any) => { listWhere = where; return []; };
        (prisma.response as any).count = async ({ where }: any) => { countWhere = where; return 0; };
        const { response, state } = responseState();
        await getParticipants({ params: { id: 'p' }, query: {}, headers: {}, cookies: {} } as any, response);
        assert.equal(state.statusCode, 200); assert.equal(state.headers['X-Total-Count'], '0');
        assert.deepEqual(listWhere, countWhere); assert.equal(listWhere.isAnonymous, false);
        assert.deepEqual(listWhere.userId, { not: null }); assert.equal(visibilityReads, 1);
    } finally {
        (prisma as any).$transaction = originals.transaction; (prisma as any).$queryRaw = originals.queryRaw;
        (prisma.response as any).findMany = originals.findMany; (prisma.response as any).count = originals.count;
    }
});

for (const mode of ['hidden', 'restricted-results', 'forced-anonymous']) test(`participants fail closed: ${mode}`, async () => {
    const originals = { transaction: prisma.$transaction, queryRaw: prisma.$queryRaw, findMany: prisma.response.findMany };
    try {
        (prisma as any).$transaction = async (work: any) => work(prisma);
        (prisma as any).$queryRaw = async () => mode === 'hidden' ? [] : [{ id: 'p', authorId: 'owner', resultsWho: mode === 'restricted-results' ? 'OnlyMe' : 'Public', resultsTiming: 'AnyTime', forceAnonymous: mode === 'forced-anonymous' }];
        (prisma.response as any).findMany = async () => { throw new Error('Identities must not be read'); };
        const { response, state } = responseState();
        await getParticipants({ params: { id: 'p' }, query: {}, headers: {}, cookies: {} } as any, response);
        assert.equal(state.statusCode, mode === 'hidden' ? 404 : mode === 'restricted-results' ? 403 : 200);
        if (mode === 'forced-anonymous') { assert.deepEqual(state.body, []); assert.equal(state.headers['X-Total-Count'], '0'); }
        else assert.equal(state.headers['X-Total-Count'], undefined);
    } finally { (prisma as any).$transaction = originals.transaction; (prisma as any).$queryRaw = originals.queryRaw; (prisma.response as any).findMany = originals.findMany; }
});

test('Page post preflight acquires its RLS-protected Page lock inside a transaction', async () => {
    const originalTransaction = prisma.$transaction;
    const originalQueryRaw = prisma.$queryRaw;
    const priorPagesEnabled = process.env.PAGES_ENABLED;
    const pageId = '00000000-0000-4000-8000-000000000101';
    const actorId = '00000000-0000-4000-8000-000000000102';
    let transactionCalls = 0;
    let baseQueries = 0;
    const txQueries: string[] = [];
    const tx: any = {
        $queryRaw: async (query: any) => {
            const sql = query.sql || (Array.isArray(query) ? query.join('?') : String(query));
            txQueries.push(sql);
            if (/pg_try_advisory_xact_lock/.test(sql)) return [{ locked: true }];
            if (/FROM "Page"/.test(sql)) return [{
                id: pageId, ownerId: actorId, purgedAt: null, deletionRequestedAt: null,
                platformState: 'NONE', publicationState: 'DRAFT'
            }];
            if (/FROM users/.test(sql)) return [{ id: actorId, status: 'ACTIVE', emailVerifiedAt: new Date() }];
            return [];
        },
        user: { findUnique: async () => ({ status: 'ACTIVE' }) },
        pageBlock: { findFirst: async () => null },
        pageAuditEvent: { findUnique: async () => { throw new Error('preflight-stop'); } }
    };
    try {
        process.env.PAGES_ENABLED = 'true';
        (prisma as any).$queryRaw = async () => { baseQueries += 1; return []; };
        (prisma as any).$transaction = async (work: (client: any) => Promise<unknown>) => {
            transactionCalls += 1;
            return work(tx);
        };
        const { response, state } = responseState();
        await createPost({
            body: { pageId, pageCreateKey: '00000000-0000-4000-8000-000000000103', status: 'DRAFT', type: 'Poll' },
            user: { userId: actorId, authMode: 'token' }
        } as any, response);
        assert.equal(state.statusCode, 500, JSON.stringify({ body: state.body, txQueries }));
        assert.equal(transactionCalls, 1);
        assert.equal(baseQueries, 0, 'The Page lock must not escape onto an unsigned pooled connection');
        assert.ok(txQueries.some(sql => /pg_advisory_xact_lock_shared/.test(sql)));
        assert.ok(txQueries.some(sql => /FROM "Page"/.test(sql)));
    } finally {
        (prisma as any).$transaction = originalTransaction;
        (prisma as any).$queryRaw = originalQueryRaw;
        if (priorPagesEnabled === undefined) delete process.env.PAGES_ENABLED;
        else process.env.PAGES_ENABLED = priorPagesEnabled;
    }
});

test('Page create replay hydrates publisher identity before its persistence transaction commits', async () => {
    const originalTransaction = prisma.$transaction;
    let inTransaction = false;
    let committed = false;
    let hydrationCalls = 0;
    const replay: any = {
        id: '00000000-0000-4000-8000-000000000201',
        pageId: '00000000-0000-4000-8000-000000000202', authorId: 'internal-actor',
        author: { id: 'internal-actor', name: 'Internal', handle: 'internal', avatar: '' },
        type: 'Post', status: 'DRAFT', title: 'Replay', description: '', image: null,
        likesCount: 0, sharesCount: 0, responseCount: 0, commentsCount: 0,
        allowAnonymous: false, forceAnonymous: false, randomPairing: false,
        demographics: [], targetedGroups: [], questions: [], sections: [], media: [],
        mentions: [], taggedUsers: [], responses: [], likes: [], shares: [], savedBy: [], sharedFrom: null
    };
    try {
        (prisma as any).$transaction = async (work: any) => {
            inTransaction = true;
            const result = await work({});
            inTransaction = false;
            committed = true;
            return result;
        };
        mock.method(pagePost, 'authorizePagePublisher', async () => ({} as any));
        mock.method(pageReplay, 'pagePostReplay', async () => replay);
        mock.method(pagePost, 'attachPagePublishers', async (posts: any[]) => {
            assert.equal(inTransaction, true, 'Page hydration must run under the persistence transaction');
            assert.equal(committed, false);
            hydrationCalls++;
            posts[0].authorId = posts[0].pageId;
            posts[0].author = { id: posts[0].pageId, kind: 'PAGE', name: 'Page', handle: 'page', avatar: '' };
            posts[0].pageCapabilities = [];
        });
        const { response, state } = responseState();
        await createPost({
            body: {
                pageId: replay.pageId,
                pageCreateKey: '00000000-0000-4000-8000-000000000203',
                status: 'DRAFT', type: 'Post'
            },
            user: { userId: 'actor', authMode: 'token' }
        } as any, response);
        assert.equal(state.statusCode, 200, JSON.stringify(state.body));
        assert.equal(hydrationCalls, 1);
        assert.equal(committed, true);
        assert.equal(replay.author.kind, 'PAGE');
    } finally {
        mock.restoreAll();
        (prisma as any).$transaction = originalTransaction;
    }
});

test('deleting a source post preserves another publisher share and tombstones only the source', async () => {
    const originalFind = prisma.post.findUnique;
    const originalTransaction = prisma.$transaction;
    const calls: string[] = [];
    let tombstone: any;
    const tx: any = {
        $queryRaw: async () => { calls.push('lock-source'); return [{ id: 'source' }]; },
        post: {
            count: async ({ where }: any) => { assert.deepEqual(where, { sharedFromId: 'source' }); calls.push('count-shares'); return 1; },
            update: async ({ where, data }: any) => { assert.deepEqual(where, { id: 'source' }); tombstone = data; calls.push('tombstone'); },
            delete: async () => { throw new Error('source with an external share must not be hard-deleted'); },
            deleteMany: async () => { throw new Error('external share must not be deleted'); }
        },
        notification: { deleteMany: async () => ({ count: 0 }) },
        savedPost: { deleteMany: async () => ({ count: 0 }) },
        hiddenPost: { deleteMany: async () => ({ count: 0 }) },
        userLike: { deleteMany: async () => ({ count: 0 }) },
        comment: { findMany: async () => [] },
        response: { findMany: async () => [] },
        question: { findMany: async () => [] },
        section: { deleteMany: async () => ({ count: 0 }) },
        postMedia: { deleteMany: async ({ where }: any) => { assert.deepEqual(where, { postId: 'source' }); calls.push('remove-source-media'); } }
    };
    try {
        (prisma.post as any).findUnique = async () => ({ id: 'source', authorId: 'owner', pageId: null,
            sharedFromId: null, media: [], questions: [] });
        (prisma as any).$transaction = async (work: (client: any) => Promise<unknown>) => work(tx);
        const { response, state } = responseState();
        await deletePost({ params: { id: 'source' }, user: { userId: 'owner' } } as any, response);
        assert.equal(state.statusCode, 200);
        assert.deepEqual(state.body.deletedPostIds, ['source']);
        assert.equal(tombstone.isDeleted, true);
        assert.equal(tombstone.title, '');
        assert.ok(calls.indexOf('lock-source') < calls.indexOf('count-shares'));
        assert.ok(calls.includes('remove-source-media'));
    } finally {
        (prisma.post as any).findUnique = originalFind;
        (prisma as any).$transaction = originalTransaction;
    }
});

after(async () => {
    await prisma.$disconnect();
});

const responseState = () => {
    const state: { statusCode: number; body: any; headers: Record<string, string> } = {
        statusCode: 200,
        body: undefined,
        headers: {}
    };
    const response: any = {
        status(code: number) {
            state.statusCode = code;
            return response;
        },
        json(body: any) {
            state.body = body;
            return response;
        },
        setHeader(name: string, value: string) {
            state.headers[name] = String(value);
            return response;
        }
    };
    return { response, state };
};

const commentRecord = (id: string, replies: any[] = []) => ({
    id,
    text: id,
    likes: 0,
    createdAt: new Date(`2026-08-31T12:00:${id.slice(-1).padStart(2, '0')}.000Z`),
    user: {
        id: `user-${id}`,
        name: id,
        handle: id,
        avatar: null,
        avatarMediaId: null,
        avatarMedia: null,
        verifiedBadge: false,
        isPrivate: false
    },
    mentions: [],
    likesList: [],
    replies
});

test('comments use a bounded cursor page and append a requested deep-link target once', async () => {
    const originalTransaction = prisma.$transaction;
    const originalQueryRaw = prisma.$queryRaw;
    const originalCommentCount = prisma.comment.count;
    const originalPostFindUnique = prisma.post.findUnique;
    const originalPostFindFirst = prisma.post.findFirst;
    const originalCommentFindMany = prisma.comment.findMany;
    const originalCommentFindFirst = prisma.comment.findFirst;
    let pageQuery: any;
    let focusQuery: any;

    try {
        (prisma as any).$transaction = async (work: any) => work(prisma);
        (prisma as any).$queryRaw = async () => [{ id: 'post-1', sharedFromId: null }];
        (prisma.comment as any).count = async () => 4;
        (prisma.post as any).findUnique = async () => ({ id: 'post-1', sharedFromId: null, sharedCaption: null });
        (prisma.post as any).findFirst = async () => ({ id: 'post-1' });
        (prisma.comment as any).findMany = async (args: any) => {
            pageQuery = args;
            return [commentRecord('comment-3'), commentRecord('comment-2'), commentRecord('comment-1')];
        };
        (prisma.comment as any).findFirst = async (args: any) => {
            focusQuery = args;
            return commentRecord('comment-0', [commentRecord('reply-9')]);
        };

        const { response, state } = responseState();
        await getComments({
            params: { id: 'post-1' },
            query: { limit: '2', focusId: 'reply-9' },
            user: { userId: 'viewer-1' }
        } as any, response);

        assert.equal(state.statusCode, 200);
        assert.equal(pageQuery.take, 3);
        assert.deepEqual(pageQuery.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
        assert.deepEqual(focusQuery.where.OR, [{ id: 'reply-9' }, { replies: { some: { id: 'reply-9' } } }]);
        assert.equal(state.headers['X-Next-Cursor'], 'comment-2');
        assert.equal(state.headers['X-Total-Count'], '4');
        assert.deepEqual(state.body.map((comment: any) => comment.id), ['comment-3', 'comment-2', 'comment-0']);
        assert.equal(state.body[2].replies[0].id, 'reply-9');
    } finally {
        (prisma as any).$transaction = originalTransaction;
        (prisma as any).$queryRaw = originalQueryRaw;
        (prisma.comment as any).count = originalCommentCount;
        (prisma.post as any).findUnique = originalPostFindUnique;
        (prisma.post as any).findFirst = originalPostFindFirst;
        (prisma.comment as any).findMany = originalCommentFindMany;
        (prisma.comment as any).findFirst = originalCommentFindFirst;
    }
});

test('post likes use the authenticated user and ignore a client-supplied userId', async () => {
    const originals = {
        postFindUnique: prisma.post.findUnique,
        postUpdate: prisma.post.update,
        likeFindUnique: prisma.userLike.findUnique,
        likeDelete: prisma.userLike.delete,
        transaction: prisma.$transaction
    };
    let findWhere: any;
    let deleteWhere: any;
    let postReads = 0;
    try {
        (prisma.post as any).findUnique = async () => {
            postReads += 1;
            return postReads === 1
                ? { id: 'post-1', sharedFromId: null, sharedCaption: null }
                : { authorId: null };
        };
        (prisma.userLike as any).findUnique = async (args: any) => {
            findWhere = args.where.userId_postId;
            return { userId: 'trusted-user', postId: 'post-1' };
        };
        (prisma.userLike as any).delete = async (args: any) => {
            deleteWhere = args.where.userId_postId;
            return {};
        };
        (prisma.post as any).update = async () => ({ authorId: null });
        (prisma as any).$transaction = async (operations: any) => typeof operations === 'function' ? operations(prisma) : Promise.all(operations);

        const { response, state } = responseState();
        await likePost({
            params: { id: 'post-1' },
            user: { userId: 'trusted-user' },
            body: { userId: 'attacker-user' }
        } as any, response);

        assert.equal(state.statusCode, 200);
        assert.deepEqual(findWhere, { userId: 'trusted-user', postId: 'post-1' });
        assert.deepEqual(deleteWhere, { userId: 'trusted-user', postId: 'post-1' });
        assert.deepEqual(state.body, { isLiked: false });
    } finally {
        (prisma.post as any).findUnique = originals.postFindUnique;
        (prisma.post as any).update = originals.postUpdate;
        (prisma.userLike as any).findUnique = originals.likeFindUnique;
        (prisma.userLike as any).delete = originals.likeDelete;
        (prisma as any).$transaction = originals.transaction;
    }
});

for (const [name, handler] of Object.entries({ likePost, likeComment, savePost, hidePost, reportPost })) {
    test(`${name} refuses a Page unpublished after the initial read and writes nothing`, async () => {
        const originals = {
            postFindUnique: prisma.post.findUnique,
            postFindFirst: prisma.post.findFirst,
            hiddenFindUnique: prisma.hiddenPost.findUnique,
            reportFindFirst: prisma.report.findFirst,
            transaction: prisma.$transaction,
            pagesEnabled: process.env.PAGES_ENABLED
        };
        let writes = 0;
        let pageLocks = 0;
        const target = { id: 'page-post', authorId: 'internal-actor', pageId: 'page-1', sharedFromId: null, sharedCaption: null, targetAudience: 'Public', title: 'Title', type: 'Poll', createdAt: new Date() };
        const write = async () => { writes += 1; throw new Error('Unexpected persistence'); };
        const tx: any = {
            $queryRaw: async (query: any) => {
                const sql = Array.isArray(query) ? query.join('') : query.sql;
                if (sql.includes('pg_try_advisory_xact_lock')) return [{ locked: true }];
                if (sql.includes('FROM "Page"')) { pageLocks += 1; return [{ id: 'page-1', publicationState: 'UNPUBLISHED', platformState: 'NONE', safetyHiddenAt: null, deletionRequestedAt: null, purgedAt: null }]; }
                if (sql.includes('FROM users')) return [{ id: 'viewer-1', status: 'ACTIVE', emailVerifiedAt: null }];
                return [];
            },
            post: { findUnique: async () => target, update: write },
            page: { findUnique: async () => ({ id: 'page-1', publicationState: 'UNPUBLISHED', platformState: 'NONE', safetyHiddenAt: null, deletionRequestedAt: null, purgedAt: null }) },
            user: { findUnique: async () => ({ id: 'viewer-1', status: 'ACTIVE' }) },
            comment: { findUnique: async () => ({ postId: target.id }), update: write },
            userLike: { create: write, delete: write },
            commentLike: { create: write, delete: write },
            savedPost: { upsert: write }, hiddenPost: { upsert: write }, report: { upsert: write }
        };
        try {
            process.env.PAGES_ENABLED = 'true';
            (prisma.post as any).findUnique = async () => target;
            (prisma.post as any).findFirst = async () => target;
            (prisma.hiddenPost as any).findUnique = async () => null;
            (prisma.report as any).findFirst = async () => null;
            (prisma as any).$transaction = async (action: any) => action(tx);
            const { response, state } = responseState();
            await handler({ params: { id: target.id }, user: { userId: 'viewer-1' }, body: { reason: 'SPAM' } } as any, response);
            assert.equal(state.statusCode, 404);
            assert.equal(state.body.code, 'PAGE_NOT_FOUND');
            assert.ok(pageLocks >= 1, 'The final check must lock the Page before persistence');
            assert.equal(writes, 0);
        } finally {
            (prisma.post as any).findUnique = originals.postFindUnique;
            (prisma.post as any).findFirst = originals.postFindFirst;
            (prisma.hiddenPost as any).findUnique = originals.hiddenFindUnique;
            (prisma.report as any).findFirst = originals.reportFindFirst;
            (prisma as any).$transaction = originals.transaction;
            if (originals.pagesEnabled === undefined) delete process.env.PAGES_ENABLED;
            else process.env.PAGES_ENABLED = originals.pagesEnabled;
        }
    });
}

for (const scenario of [
    { role: 'OWNER', expected: 200 }, { role: 'ADMIN', expected: 200 },
    { role: 'EDITOR', expected: 200 }, { role: 'ANALYST', expected: 200 },
    { role: null, expected: 403 }, { role: 'ANALYST', draft: true, expected: 404 },
    { role: 'ANALYST', externalSource: true, expected: 403 }
]) {
    test(`private unpublished Page results: ${scenario.role || 'revoked'}${scenario.draft ? ' draft' : ''}${scenario.externalSource ? ' external source' : ''}`, async () => {
        const pageId = '00000000-0000-4000-8000-000000000001';
        const postId = '00000000-0000-4000-8000-000000000002';
        const originals = { transaction: prisma.$transaction, enabled: process.env.PAGES_ENABLED };
        let reads = 0;
        const tx: any = {
            $queryRaw: async (query: any) => {
                const sql = Array.isArray(query) ? query.join('') : query.sql;
                if (sql.includes('pg_try_advisory_xact_lock')) return [{ locked: true }];
                if (sql.includes('FROM "Page"')) return [{ id: pageId, ownerId: scenario.role === 'OWNER' ? 'viewer' : 'owner', publicationState: 'UNPUBLISHED', purgedAt: null }];
              if (sql.includes('FROM users')) return [{ id: 'viewer', status: 'ACTIVE', emailVerifiedAt: null }];
                return [];
            },
            page: { findUnique: async () => ({ id: pageId, ownerId: scenario.role === 'OWNER' ? 'viewer' : 'owner', publicationState: 'UNPUBLISHED', purgedAt: null }) },
            user: { findUnique: async () => ({ id: 'viewer', status: 'ACTIVE' }) },
            pageMembership: { findUnique: async () => scenario.role ? { role: scenario.role } : null },
            pageBlock: { findFirst: async () => null },
            post: { findFirst: async (args: any) => {
                assert.equal(args.where.pageId, pageId);
                assert.equal(args.where.status, 'PUBLISHED');
                assert.equal(args.where.isDeleted, false);
                if (scenario.draft || args.where.id !== postId) return null;
                return { id: postId, sharedFromId: scenario.externalSource ? 'external-source' : null };
            } },
            question: { findMany: async () => [{ id: 'q', options: [] }] },
            response: { findMany: async () => {
                reads += 1;
                return [{ id: 'response', isAnonymous: true, answers: [{ questionId: 'q', optionId: 'o', textValue: null }], user: { id: 'private-person', name: 'Hidden person', birthday: new Date('1990-01-01'), country: 'JO', demographics: { gender: 'female' } } }];
            } }
        };
        try {
            process.env.PAGES_ENABLED = 'true';
            (prisma as any).$transaction = async (action: any) => action(tx);
            const { response, state } = responseState();
            await getPageManagedPostResults({ params: { id: pageId, postId }, user: { userId: 'viewer' } } as any, response);
            assert.equal(state.statusCode, scenario.expected);
            assert.equal(reads, scenario.expected === 200 ? 1 : 0);
            if (scenario.expected === 200) {
                assert.equal(state.headers['Cache-Control'], 'private, no-store');
                assert.equal(state.body.version, 2);
                assert.equal(state.body.sampleSize, 1);
                assert.equal(state.body.minimumCellSize, 5);
                assert.deepEqual(state.body.demographicBreakdowns.country.counts, {});
                assert.equal(state.body.demographicBreakdowns.country.suppressionReason, 'SMALL_SAMPLE');
                const json = JSON.stringify(state.body);
                for (const hidden of ['private-person', 'Hidden person', '1990-01-01', 'userId', 'birthday', 'isAnonymous', 'textValue']) assert.equal(json.includes(hidden), false);
            }
        } finally {
            (prisma as any).$transaction = originals.transaction;
            if (originals.enabled === undefined) delete process.env.PAGES_ENABLED;
            else process.env.PAGES_ENABLED = originals.enabled;
        }
    });
}

test('Page likes enqueue notification work in the same transaction as the like and count', async () => {
    const originals = { postFindUnique: prisma.post.findUnique, transaction: prisma.$transaction, enabled: process.env.PAGES_ENABLED };
    const sequence: string[] = [];
    const post = { id: 'page-post', pageId: 'page', authorId: 'historical-staff', sharedFromId: null, sharedCaption: null, isDeleted: false, status: 'PUBLISHED' };
    const page = { id: 'page', ownerId: 'owner', publicationState: 'PUBLISHED', platformState: 'NONE', safetyHiddenAt: null, deletionRequestedAt: null, purgedAt: null };
    const tx: any = {
        $queryRaw: async (query: any) => {
            const sql = Array.isArray(query) ? query.join('') : query.sql;
            if (sql.includes('pg_try_advisory_xact_lock')) return [{ locked: true }];
            if (sql.includes('AS visible') || sql.includes('AS "visible"')) return [{ visible: true }];
            if (sql.includes('FROM "Page"')) return [page];
            if (sql.includes('FROM users')) return [{ id: 'viewer', status: 'ACTIVE', emailVerifiedAt: null }];
            if (sql.includes('FROM "Post"') && sql.endsWith('FOR UPDATE')) return [{ ...post, expiresAt: null }];
            return [];
        },
        post: { findUnique: async () => post, count: async () => 1, update: async () => { sequence.push('counter'); return post; } },
        page: { findUnique: async () => page, count: async () => 1 },
        user: { findUnique: async () => ({ id: 'viewer', status: 'ACTIVE' }) },
        pageBlock: { findFirst: async () => null },
        userLike: { findUnique: async () => null, create: async () => { sequence.push('like'); return {}; } },
        pageEvent: { createMany: async (args: any) => { sequence.push('outbox'); assert.equal(args.data[0].kind, 'PAGE_ACTIVITY'); assert.equal(args.data[0].context.kind, 'like'); return { count: 1 }; } }
    };
    try {
        process.env.PAGES_ENABLED = 'true';
        (prisma.post as any).findUnique = async () => post;
        (prisma as any).$transaction = async (action: any) => { const result = await action(tx); sequence.push('commit'); return result; };
        const { response, state } = responseState();
        await likePost({ params: { id: post.id }, user: { userId: 'viewer' }, body: {} } as any, response);
        assert.equal(state.statusCode, 200);
        assert.deepEqual(state.body, { isLiked: true });
        assert.deepEqual(sequence, ['like', 'counter', 'outbox', 'commit']);
    } finally {
        (prisma.post as any).findUnique = originals.postFindUnique;
        (prisma as any).$transaction = originals.transaction;
        if (originals.enabled === undefined) delete process.env.PAGES_ENABLED;
        else process.env.PAGES_ENABLED = originals.enabled;
    }
});
