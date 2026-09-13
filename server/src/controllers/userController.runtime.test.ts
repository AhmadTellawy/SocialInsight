import assert from 'node:assert/strict';
import test, { after } from 'node:test';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'user-controller-runtime-test-secret';

const prisma = require('../prisma').default as typeof import('../prisma').default;
const {
    getNotifications,
    getUserAnalytics,
    getSuggestedUsers,
    getUserGroups,
    NOTIFICATION_PAGE_DEFAULT,
    NOTIFICATION_PAGE_MAX,
    SUGGESTION_INTERACTION_SAMPLE_LIMIT
} = require('./userController') as typeof import('./userController');

after(async () => {
    await prisma.$disconnect();
});

const createResponse = () => {
    const state: {
        statusCode: number;
        body: any;
        headers: Record<string, string>;
    } = {
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

const groupRecord = (id: string, name: string) => ({
    id,
    name,
    description: '',
    category: 'General',
    image: null,
    imageMediaId: null,
    imageMedia: null,
    isPublic: true,
    joinPolicy: 'OPEN',
    postingPermissions: 'AllMembers',
    memberCount: 0,
    rules: null,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z')
});

test('getUserGroups hydrates filtered counts in the membership relation load', async () => {
    const originalUserFindUnique = prisma.user.findUnique;
    const originalMembershipFindMany = prisma.groupMember.findMany;
    const originalMembershipGroupBy = prisma.groupMember.groupBy;
    const originalGroupFindMany = prisma.group.findMany;
    let membershipQuery: any;

    try {
        (prisma.user as any).findUnique = async () => ({ status: 'ACTIVE', groupPrivacy: 'Public', isPrivate: false, mediaPrivacyTarget: null });
        (prisma.groupMember as any).findMany = async (args: any) => {
            membershipQuery = args;
            return [
                {
                    groupId: 'group-1',
                    role: 'Member',
                    status: 'JOINED',
                    group: { ...groupRecord('group-1', 'One'), members: [{ role: 'Member', status: 'JOINED' }], _count: { members: 8, targetedPosts: 5 } }
                },
                {
                    groupId: 'group-2',
                    role: 'Admin',
                    status: 'JOINED',
                    group: { ...groupRecord('group-2', 'Two'), members: [{ role: 'Admin', status: 'JOINED' }], _count: { members: 3, targetedPosts: 2 } }
                }
            ];
        };
        (prisma.groupMember as any).groupBy = async () => {
            throw new Error('unexpected separate member aggregate query');
        };
        (prisma.group as any).findMany = async () => {
            throw new Error('unexpected separate post aggregate query');
        };

        const { response, state } = createResponse();
        await getUserGroups({ params: { id: 'viewer-1' }, user: { userId: 'viewer-1' } } as any, response);

        assert.equal(state.statusCode, 200);
        assert.equal(membershipQuery.include.group.include._count.select.members.where.status, 'JOINED');
        assert.equal(membershipQuery.include.group.include._count.select.targetedPosts.where.status, 'PUBLISHED');
        assert.equal(membershipQuery.include.group.include._count.select.targetedPosts.where.isDeleted, false);
        assert.deepEqual(state.body.map((group: any) => ({ id: group.id, memberCount: group.memberCount, postsCount: group.postsCount })), [
            { id: 'group-1', memberCount: 8, postsCount: 5 },
            { id: 'group-2', memberCount: 3, postsCount: 2 }
        ]);
        assert.equal(state.body.every((group: any) => !('_count' in group)), true);
    } finally {
        (prisma.user as any).findUnique = originalUserFindUnique;
        (prisma.groupMember as any).findMany = originalMembershipFindMany;
        (prisma.groupMember as any).groupBy = originalMembershipGroupBy;
        (prisma.group as any).findMany = originalGroupFindMany;
    }
});

test('getNotifications caps pages and exposes an array-compatible next cursor', async () => {
    const originalFindMany = prisma.notification.findMany;
    const originalUserFindMany = prisma.user.findMany;
    const capturedCalls: any[] = [];

    try {
        (prisma.user as any).findMany = async ({ where }: any) => where.id.in.map((id: string) => ({ id }));
        (prisma.notification as any).findMany = async (args: any) => {
            capturedCalls.push(args);
            return Array.from({ length: args.take }, (_, index) => ({
                id: `notification-${String(index).padStart(3, '0')}`,
                userId: 'viewer-1',
                actorId: null,
                type: 'like',
                message: 'liked your post',
                targetId: 'post-1',
                targetType: 'profile',
                payload: null,
                isRead: false,
                createdAt: new Date(1_700_000_000_000 - index),
                actor: null
            }));
        };

        const { response, state } = createResponse();
        await getNotifications({
            params: { id: 'viewer-1' },
            user: { userId: 'viewer-1' },
            query: { limit: '999', cursor: 'cursor-id' }
        } as any, response);

        assert.equal(capturedCalls[0].take, NOTIFICATION_PAGE_MAX + 1);
        assert.deepEqual(capturedCalls[0].cursor, { id: 'cursor-id' });
        assert.equal(capturedCalls[0].skip, 1);
        assert.equal(state.body.length, NOTIFICATION_PAGE_MAX);
        assert.equal(state.headers['X-Next-Cursor'], 'notification-099');
        assert.equal(Array.isArray(state.body), true);

        const defaultPage = createResponse();
        await getNotifications({
            params: { id: 'viewer-1' },
            user: { userId: 'viewer-1' },
            query: {}
        } as any, defaultPage.response);

        assert.equal(capturedCalls[1].take, NOTIFICATION_PAGE_DEFAULT + 1);
        assert.equal(defaultPage.state.body.length, NOTIFICATION_PAGE_DEFAULT);
        assert.equal(defaultPage.state.headers['X-Next-Cursor'], 'notification-049');
    } finally {
        (prisma.notification as any).findMany = originalFindMany;
        (prisma.user as any).findMany = originalUserFindMany;
    }
});

test('notification reads drop a post notification after its source becomes unavailable', async () => {
    const originals = {
        notificationFindMany: prisma.notification.findMany,
        userFindMany: prisma.user.findMany,
        userBlockFindFirst: prisma.userBlock.findFirst,
        postFindFirst: prisma.post.findFirst
    };
    let calls = 0;
    try {
        (prisma.notification as any).findMany = async () => calls++ === 0 ? [{
            id: 'notification-private', userId: 'viewer-1', actorId: 'actor-1', type: 'like',
            message: 'sensitive source message', targetId: 'post-private', targetType: 'post', payload: null,
            isRead: false, createdAt: new Date(), actor: { id: 'actor-1', name: 'Actor', avatar: null }
        }] : [];
        (prisma.user as any).findMany = async ({ where }: any) => where.id.in.map((id: string) => ({ id }));
        (prisma.userBlock as any).findFirst = async () => null;
        (prisma.post as any).findFirst = async () => null;
        const { response, state } = createResponse();
        await getNotifications({ params: { id: 'viewer-1' }, user: { userId: 'viewer-1' }, query: { limit: '10' } } as any, response);
        assert.equal(state.statusCode, 200);
        assert.deepEqual(state.body, []);
        assert.equal(JSON.stringify(state.body).includes('sensitive source message'), false);
    } finally {
        (prisma.notification as any).findMany = originals.notificationFindMany;
        (prisma.user as any).findMany = originals.userFindMany;
        (prisma.userBlock as any).findFirst = originals.userBlockFindFirst;
        (prisma.post as any).findFirst = originals.postFindFirst;
    }
});

test('notification reads return a continuation cursor after five fully denied scan pages', async () => {
    const originals = {
        notificationFindMany: prisma.notification.findMany,
        userFindMany: prisma.user.findMany,
        userBlockFindFirst: prisma.userBlock.findFirst,
        postFindFirst: prisma.post.findFirst
    };
    let calls = 0;
    try {
        (prisma.notification as any).findMany = async ({ take }: any) => {
            const page = calls++;
            return Array.from({ length: take }, (_, index) => ({
                id: `denied-${page}-${index}`,
                userId: 'viewer-1', actorId: 'actor-1', type: 'like',
                message: 'hidden', targetId: `private-${page}-${index}`, targetType: 'post', payload: null,
                isRead: false, createdAt: new Date(1_700_000_000_000 - page * 100 - index), actor: null
            }));
        };
        (prisma.user as any).findMany = async ({ where }: any) => where.id.in.map((id: string) => ({ id }));
        (prisma.userBlock as any).findFirst = async () => null;
        (prisma.post as any).findFirst = async () => null;

        const { response, state } = createResponse();
        await getNotifications({ params: { id: 'viewer-1' }, user: { userId: 'viewer-1' }, query: { limit: '2' } } as any, response);
        assert.equal(calls, 5);
        assert.deepEqual(state.body, []);
        assert.equal(state.headers['X-Next-Cursor'], 'denied-4-2');
    } finally {
        (prisma.notification as any).findMany = originals.notificationFindMany;
        (prisma.user as any).findMany = originals.userFindMany;
        (prisma.userBlock as any).findFirst = originals.userBlockFindFirst;
        (prisma.post as any).findFirst = originals.postFindFirst;
    }
});

test('notification reauthorization outage fails the whole read without returning a partial page', async () => {
    const originals = {
        notificationFindMany: prisma.notification.findMany,
        userFindMany: prisma.user.findMany
    };
    try {
        (prisma.notification as any).findMany = async () => [{
            id: 'notification-sensitive', userId: 'viewer-1', actorId: 'actor-1', type: 'like',
            message: 'must not escape', targetId: 'post-private', targetType: 'post', payload: null,
            isRead: false, createdAt: new Date(), actor: null
        }];
        (prisma.user as any).findMany = async () => { throw new Error('synthetic authorization store outage'); };
        const { response, state } = createResponse();
        await getNotifications({ params: { id: 'viewer-1' }, user: { userId: 'viewer-1' }, query: { limit: '10' } } as any, response);
        assert.equal(state.statusCode, 500);
        assert.equal(JSON.stringify(state.body).includes('must not escape'), false);
    } finally {
        (prisma.notification as any).findMany = originals.notificationFindMany;
        (prisma.user as any).findMany = originals.userFindMany;
    }
});

test('profile analytics rejects a different authenticated account before any analytics query', async () => {
    const originalQueryRaw = prisma.$queryRaw;
    let queried = false;
    try {
        (prisma as any).$queryRaw = async () => { queried = true; throw new Error('unexpected analytics query'); };
        const { response, state } = createResponse();
        await getUserAnalytics({ params: { id: 'owner-1' }, user: { userId: 'viewer-1' } } as any, response);
        assert.equal(state.statusCode, 403);
        assert.match(state.body.error, /only to the account owner/i);
        assert.equal(queried, false);
    } finally {
        (prisma as any).$queryRaw = originalQueryRaw;
    }
});

test('getSuggestedUsers samples recent interactions and excludes followed candidates in SQL', async () => {
    const originalQueryRaw = prisma.$queryRaw;
    const originalUserFindMany = prisma.user.findMany;
    const interactionCalls: any[] = [];
    const userCalls: any[] = [];

    try {
        (prisma as any).$queryRaw = async (query: any) => {
            interactionCalls.push(query);
            return [{ authorId: 'author-1' }];
        };
        (prisma.user as any).findMany = async (args: any) => {
            userCalls.push(args);
            const id = userCalls.length === 1 ? 'author-1' : 'popular-1';
            return [{ id, name: id, handle: id, avatar: null, avatarMediaId: null, avatarMedia: null }];
        };

        const { response, state } = createResponse();
        await getSuggestedUsers({
            params: { id: 'victim-user' },
            user: { userId: 'viewer-1' }
        } as any, response);

        assert.equal(interactionCalls.length, 1);
        assert.equal(interactionCalls[0].strings.join('').includes('UNION ALL'), true);
        assert.equal(interactionCalls[0].values.filter((value: unknown) => value === SUGGESTION_INTERACTION_SAMPLE_LIMIT).length, 3);
        assert.equal(userCalls[0].where.following.none.followerId, 'viewer-1');
        assert.equal(userCalls[1].where.following.none.followerId, 'viewer-1');
        assert.deepEqual(state.body.map((user: any) => user.suggestionReason), ['Recently interacted', 'Suggested for you']);
    } finally {
        (prisma as any).$queryRaw = originalQueryRaw;
        (prisma.user as any).findMany = originalUserFindMany;
    }
});
