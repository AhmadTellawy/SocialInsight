import assert from 'node:assert/strict';
import test, { after } from 'node:test';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'post-controller-runtime-test-secret';

const prisma = require('../prisma').default as typeof import('../prisma').default;
const { createComment, getComments, getParticipants, likeComment, likePost } = require('./postController') as typeof import('./postController');

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
        postFindFirst: prisma.post.findFirst,
        postUpdateMany: prisma.post.updateMany,
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
        (prisma as any).$transaction = async (callback: any) => callback({
            post: {
                findFirst: async () => ({ id: 'post-1', authorId: null }),
                updateMany: async () => ({ count: 1 })
            },
            userLike: {
                findUnique: async (args: any) => {
                    findWhere = args.where.userId_postId;
                    return { userId: 'trusted-user', postId: 'post-1' };
                },
                delete: async (args: any) => {
                    deleteWhere = args.where.userId_postId;
                    return {};
                }
            }
        });

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
        (prisma.post as any).findFirst = originals.postFindFirst;
        (prisma.post as any).updateMany = originals.postUpdateMany;
        (prisma.userLike as any).findUnique = originals.likeFindUnique;
        (prisma.userLike as any).delete = originals.likeDelete;
        (prisma as any).$transaction = originals.transaction;
    }
});

test('post likes denied by the published audience guard perform no write', async () => {
    const originals = { postFindUnique: prisma.post.findUnique, transaction: prisma.$transaction };
    let writes = 0;
    try {
        (prisma.post as any).findUnique = async () => ({ id: 'post-1', sharedFromId: null, sharedCaption: null });
        (prisma as any).$transaction = async (callback: any) => callback({
            post: { findFirst: async () => null },
            userLike: {
                findUnique: async () => { writes += 1; return null; },
                create: async () => { writes += 1; return {}; },
                delete: async () => { writes += 1; return {}; }
            }
        });
        const { response, state } = responseState();
        await likePost({ params: { id: 'post-1' }, user: { userId: 'blocked-user' }, body: {} } as any, response);
        assert.equal(state.statusCode, 403);
        assert.equal(writes, 0);
    } finally {
        (prisma.post as any).findUnique = originals.postFindUnique;
        (prisma as any).$transaction = originals.transaction;
    }
});

test('participants omit anonymous and guest rows without exposing count or timing oracles', async () => {
    const originals = {
        postFindUnique: prisma.post.findUnique,
        postFindFirst: prisma.post.findFirst,
        responseFindMany: prisma.response.findMany
    };
    let participantQuery: any;
    try {
        (prisma.post as any).findUnique = async () => ({ id: 'post-1', sharedFromId: null, sharedCaption: null });
        (prisma.post as any).findFirst = async () => ({
            id: 'post-1', authorId: 'author-1', forceAnonymous: false,
            resultsWho: 'Public', resultsTiming: 'AnyTime', expiresAt: new Date('2026-12-01T00:00:00.000Z')
        });
        (prisma.response as any).findMany = async (args: any) => {
            participantQuery = args;
            return [{
                id: 'response-internal', timestamp: new Date(), isAnonymous: false,
                user: { id: 'person-1', name: 'Person', handle: 'person', avatar: null, avatarMediaId: null, avatarMedia: null, verifiedBadge: false, isPrivate: false }
            }];
        };
        const { response, state } = responseState();
        await getParticipants({ params: { id: 'post-1' }, query: {}, user: { userId: 'viewer-1' } } as any, response);
        assert.equal(state.statusCode, 200);
        assert.equal(participantQuery.where.isAnonymous, false);
        assert.deepEqual(participantQuery.where.userId, { not: null });
        assert.equal(state.headers['X-Participant-Count'], undefined);
        assert.equal(state.headers['X-Anonymous-Participant-Count'], undefined);
        assert.equal(JSON.stringify(state.body).includes('response-internal'), false);
        assert.equal('timestamp' in state.body[0], false);
        assert.deepEqual(state.body.map((participant: any) => participant.id), ['person-1']);
    } finally {
        (prisma.post as any).findUnique = originals.postFindUnique;
        (prisma.post as any).findFirst = originals.postFindFirst;
        (prisma.response as any).findMany = originals.responseFindMany;
    }
});

test('comment creation denied by the published audience guard never opens a write transaction', async () => {
    const originals = { postFindUnique: prisma.post.findUnique, postFindFirst: prisma.post.findFirst, transaction: prisma.$transaction };
    let transactions = 0;
    try {
        (prisma.post as any).findUnique = async () => ({ id: 'post-1', sharedFromId: null, sharedCaption: null });
        (prisma.post as any).findFirst = async () => null;
        (prisma as any).$transaction = async () => { transactions += 1; throw new Error('unexpected write transaction'); };
        const { response, state } = responseState();
        await createComment({ params: { id: 'post-1' }, user: { userId: 'blocked-user' }, body: { text: 'blocked' } } as any, response);
        assert.equal(state.statusCode, 403);
        assert.equal(transactions, 0);
    } finally {
        (prisma.post as any).findUnique = originals.postFindUnique;
        (prisma.post as any).findFirst = originals.postFindFirst;
        (prisma as any).$transaction = originals.transaction;
    }
});

test('comment likes denied by the source post guard perform no write or counter update', async () => {
    const originalTransaction = prisma.$transaction;
    let writes = 0;
    try {
        (prisma as any).$transaction = async (callback: any) => callback({
            comment: {
                findFirst: async () => null,
                update: async () => { writes += 1; },
                updateMany: async () => { writes += 1; }
            },
            commentLike: {
                findUnique: async () => { writes += 1; return null; },
                create: async () => { writes += 1; },
                delete: async () => { writes += 1; }
            }
        });
        const { response, state } = responseState();
        await likeComment({ params: { id: 'comment-1' }, user: { userId: 'blocked-user' } } as any, response);
        assert.equal(state.statusCode, 403);
        assert.equal(writes, 0);
    } finally {
        (prisma as any).$transaction = originalTransaction;
    }
});
