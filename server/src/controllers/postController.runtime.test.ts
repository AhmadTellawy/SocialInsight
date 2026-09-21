import assert from 'node:assert/strict';
import test, { after } from 'node:test';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'post-controller-runtime-test-secret';

const prisma = require('../prisma').default as typeof import('../prisma').default;
const { getComments, likePost, likeComment, savePost, hidePost, reportPost, getPageManagedPostResults } = require('./postController') as typeof import('./postController');

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
    const originalPostFindUnique = prisma.post.findUnique;
    const originalPostFindFirst = prisma.post.findFirst;
    const originalCommentFindMany = prisma.comment.findMany;
    const originalCommentFindFirst = prisma.comment.findFirst;
    let pageQuery: any;
    let focusQuery: any;

    try {
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
        assert.deepEqual(state.body.map((comment: any) => comment.id), ['comment-3', 'comment-2', 'comment-0']);
        assert.equal(state.body[2].replies[0].id, 'reply-9');
    } finally {
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
                assert.deepEqual(state.body[0].answers, [{ questionId: 'q', optionId: 'o', textValue: null }]);
                assert.equal(state.body[0].isAnonymous, true);
                const json = JSON.stringify(state.body);
                for (const hidden of ['private-person', 'Hidden person', '1990-01-01', 'userId', 'birthday']) assert.equal(json.includes(hidden), false);
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
        pageEvent: { create: async (args: any) => { sequence.push('outbox'); assert.equal(args.data.kind, 'PAGE_ACTIVITY'); assert.equal(args.data.context.kind, 'like'); return {}; } }
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
