import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';

process.env.JWT_SECRET = 'post-update-isolated-test-secret';
const prisma = require('../prisma').default;
const media = require('../services/mediaService');
const mentions = require('../services/mentionLifecycleService');
const hashtags = require('../services/hashtagService');
const tags = require('../services/peopleTagService');
const notifications = require('../services/notificationService');
const { updatePost } = require('./postController');

after(async () => { await prisma.$disconnect(); });

// Invoke the original controller, with all I/O replaced; no database or storage calls.
const runUpdate = async (body: any, overrides: any = {}, groups: Record<string, any> = {}) => {
    const existing = {
        id: 'post-1', authorId: 'author-1', title: 'Question', description: '',
        status: 'PENDING_APPROVAL', createdAt: new Date(), responseCount: 0,
        isDeleted: false, groupId: 'group-1', targetedGroups: [{ id: 'group-1' }],
        targetAudience: 'Groups', media: [], questions: [], sections: [],
        type: 'Survey', ...overrides
    };
    const state: { code: number; body?: any; saved?: any; memberIds: string[] } = { code: 200, memberIds: [] };
    const response: any = {
        status(code: number) { state.code = code; return response; },
        json(value: any) { state.body = value; return response; }
    };
    // Prisma delegates are proxies without ordinary method descriptors.
    const restorePrisma: Array<() => void> = [];
    const stubPrisma = (target: any, key: string, replacement: any) => {
        const original = target[key];
        target[key] = replacement;
        restorePrisma.push(() => { target[key] = original; });
    };
    try {
        stubPrisma(prisma.post, 'findUnique', async () => existing);
        stubPrisma(prisma.group, 'findUnique', async ({ where }: any) => {
            const fixture = groups[where.id];
            return fixture === null ? null : { postingPermissions: 'ApprovalNeeded', isDeleted: false, ...fixture };
        });
        stubPrisma(prisma.groupMember, 'findUnique', async ({ where }: any) => {
            state.memberIds.push(where.userId_groupId.userId);
            const fixture = groups[where.userId_groupId.groupId];
            return fixture?.membership === null ? null : { status: 'JOINED', role: 'Member', ...fixture?.membership };
        });
        stubPrisma(prisma.groupMember, 'findMany', async () => []);
        stubPrisma(prisma, '$transaction', async (callback: any) => callback({ post: { update: async ({ data }: any) => {
            state.saved = data;
            return { ...existing, ...data, targetedGroups: existing.targetedGroups };
        } }, option: { findMany: async () => [] }, section: { findMany: async () => [] } }));
        for (const name of ['prepareMediaAttachments', 'prepareMediaScopeChange']) mock.method(media, name, async () => []);
        for (const name of ['commitPreparedMedia', 'commitMediaScopeChange', 'finalizeMediaScopeChange', 'scheduleMediaDeletion', 'rollbackPreparedMedia', 'rollbackMediaScopeChange']) mock.method(media, name, async () => {});
        mock.method(media, 'resolvePostMediaScope', async () => 'PRIVATE');
        mock.method(media, 'validatePostMediaSet', async () => null);
        mock.method(media, 'serializeUserMediaRecord', (value: any) => value);
        mock.method(mentions, 'reconcilePostMentions', async () => ({ notificationIds: [] }));
        mock.method(hashtags, 'reconcilePostHashtags', async () => {});
        mock.method(tags, 'getCurrentPeopleTagUserIds', async () => []);
        mock.method(tags, 'reconcilePeopleTags', async () => ({ notificationIds: [] }));
        mock.method(notifications, 'dispatchNotificationIds', async () => {});
        await updatePost({ params: { id: 'post-1' }, body, user: { userId: 'author-1' } }, response);
        return state;
    } finally {
        mock.restoreAll();
        restorePrisma.reverse().forEach(restore => restore());
    }
};

for (const status of ['PENDING_APPROVAL', 'REJECTED', 'unknown', '', null, 1]) {
    test(`author cannot submit privileged or invalid status ${JSON.stringify(status)}`, async () => {
        const result = await runUpdate({ status });
        assert.equal(result.code, 400);
        assert.equal(result.saved, undefined);
    });
}

for (const audience of ['Groups', 'ProfileAndGroups']) {
    for (const status of ['PENDING_APPROVAL', 'DRAFT', 'REJECTED', 'PUBLISHED']) {
        test(`${audience}: member ${status} publish request requires approval`, async () => {
            const result = await runUpdate({ status: 'PUBLISHED' }, { status, targetAudience: audience });
            assert.equal(result.code, 200);
            assert.equal(result.saved.status, 'PENDING_APPROVAL');
            assert.equal(result.saved.approvedById, null);
            assert.deepEqual(result.memberIds, ['author-1']);
        });
    }
    test(`${audience}: published content-only edit requires fresh approval`, async () => {
        const result = await runUpdate({ title: 'Changed' }, { status: 'PUBLISHED', targetAudience: audience });
        assert.equal(result.code, 200);
        assert.equal(result.saved.status, 'PENDING_APPROVAL');
    });
}

test('pending content-only edit remains pending and uses authenticated membership', async () => {
    const result = await runUpdate({ title: 'Changed', userId: 'admin-1' });
    assert.equal(result.code, 200);
    assert.equal(result.saved.status, 'PENDING_APPROVAL');
    assert.deepEqual(result.memberIds, ['author-1']);
});

for (const role of ['Admin', 'Owner']) {
    test(`group ${role} author may publish a draft`, async () => {
        const result = await runUpdate({ status: 'PUBLISHED' }, { status: 'DRAFT' }, { 'group-1': { membership: { role } } });
        assert.equal(result.code, 200);
        assert.equal(result.saved.status, 'PUBLISHED');
    });
}

test('ordinary group member may publish where approval is not required', async () => {
    const result = await runUpdate({ status: 'PUBLISHED' }, { status: 'DRAFT' }, { 'group-1': { postingPermissions: 'AllMembers' } });
    assert.equal(result.code, 200);
    assert.equal(result.saved.status, 'PUBLISHED');
});

test('personal post author may publish without group checks', async () => {
    const result = await runUpdate({ status: 'PUBLISHED' }, { status: 'DRAFT', groupId: null, targetedGroups: [], targetAudience: 'Public' });
    assert.equal(result.code, 200);
    assert.equal(result.saved.status, 'PUBLISHED');
    assert.deepEqual(result.memberIds, []);
});

for (const fixture of [null, { isDeleted: true }, { membership: null }, { membership: { status: 'PENDING' } }, { postingPermissions: 'AdminsOnly' }]) {
    test(`published edit fails closed for unavailable or unauthorized group ${JSON.stringify(fixture)}`, async () => {
        const result = await runUpdate({ title: 'Changed' }, { status: 'PUBLISHED' }, { 'group-1': fixture });
        assert.equal(result.code, 403);
        assert.equal(result.saved, undefined);
    });
}

test('changing published targets to approval group queues approval without explicit status', async () => {
    const result = await runUpdate({ targetGroups: ['group-2'] }, { status: 'PUBLISHED' });
    assert.equal(result.code, 200);
    assert.equal(result.saved.status, 'PENDING_APPROVAL');
    assert.equal(result.saved.groupId, 'group-2');
});

test('approval-required multi-group targeting remains disallowed', async () => {
    const result = await runUpdate({ status: 'PUBLISHED', targetGroups: ['group-1', 'group-2'] });
    assert.equal(result.code, 400);
    assert.equal(result.saved, undefined);
});

test('effective groups include both the legacy primary group and targeted relations', async () => {
    const result = await runUpdate({ title: 'Changed' }, {
        status: 'PUBLISHED', targetedGroups: [{ id: 'group-2' }]
    });
    assert.equal(result.code, 400);
    assert.equal(result.saved, undefined);
    assert.equal(result.memberIds.length, 2);
});

test('question changes stay blocked after responses exist', async () => {
    const result = await runUpdate({ options: [] }, { responseCount: 1 });
    assert.equal(result.code, 409);
    assert.equal(result.saved, undefined);
});

test('saving a draft does not submit it for approval', async () => {
    const result = await runUpdate({ status: 'DRAFT' });
    assert.equal(result.code, 200);
    assert.equal(result.saved.status, 'DRAFT');
});

test('rejected content-only edits do not resubmit the post', async () => {
    const result = await runUpdate({ title: 'Changed' }, { status: 'REJECTED' });
    assert.equal(result.code, 200);
    assert.equal(result.saved.status, undefined);
});

test('non-author cannot update a post', async () => {
    const result = await runUpdate({ status: 'PUBLISHED' }, { authorId: 'another-user' });
    assert.equal(result.code, 403);
    assert.equal(result.saved, undefined);
});

test('published post older than five minutes cannot be demoted then edited', async () => {
    const result = await runUpdate({ status: 'DRAFT' }, { status: 'PUBLISHED', createdAt: new Date(Date.now() - 301_000) });
    assert.equal(result.code, 403);
    assert.equal(result.saved, undefined);
});

for (const targetGroups of [null, 'group-2', [null], [''], ['group-1', 'group-1']]) {
    test(`malformed targets cannot silently detach moderation ${JSON.stringify(targetGroups)}`, async () => {
        const result = await runUpdate({ targetGroups, status: 'PUBLISHED' });
        assert.equal(result.code, 400);
        assert.equal(result.saved, undefined);
    });
}
