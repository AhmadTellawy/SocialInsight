import assert from 'node:assert/strict';
import test, { after } from 'node:test';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'post-controller-runtime-test-secret';

const prisma = require('../prisma').default as typeof import('../prisma').default;
const { getComments, likePost } = require('./postController') as typeof import('./postController');

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
        (prisma as any).$transaction = async (operations: Promise<unknown>[]) => Promise.all(operations);

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
