import assert from 'node:assert/strict';
import test, { after } from 'node:test';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'user-controller-runtime-test-secret';

const prisma = require('../prisma').default as typeof import('../prisma').default;
const {
    getNotifications,
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
    const originalMembershipFindMany = prisma.groupMember.findMany;
    const originalMembershipGroupBy = prisma.groupMember.groupBy;
    const originalGroupFindMany = prisma.group.findMany;
    let membershipQuery: any;

    try {
        (prisma.groupMember as any).findMany = async (args: any) => {
            membershipQuery = args;
            return [
                {
                    groupId: 'group-1',
                    role: 'Member',
                    status: 'JOINED',
                    group: { ...groupRecord('group-1', 'One'), _count: { members: 8, targetedPosts: 5 } }
                },
                {
                    groupId: 'group-2',
                    role: 'Admin',
                    status: 'JOINED',
                    group: { ...groupRecord('group-2', 'Two'), _count: { members: 3, targetedPosts: 2 } }
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
        (prisma.groupMember as any).findMany = originalMembershipFindMany;
        (prisma.groupMember as any).groupBy = originalMembershipGroupBy;
        (prisma.group as any).findMany = originalGroupFindMany;
    }
});

test('getNotifications caps pages and exposes an array-compatible next cursor', async () => {
    const originalFindMany = prisma.notification.findMany;
    const capturedCalls: any[] = [];

    try {
        (prisma.notification as any).findMany = async (args: any) => {
            capturedCalls.push(args);
            return Array.from({ length: args.take }, (_, index) => ({
                id: `notification-${String(index).padStart(3, '0')}`,
                type: 'like',
                message: 'liked your post',
                targetId: 'post-1',
                targetType: 'post',
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
        await getSuggestedUsers({ params: { id: 'viewer-1' } } as any, response);

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
