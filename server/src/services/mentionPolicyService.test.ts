import assert from 'node:assert/strict';
import test from 'node:test';
import {
    MentionPolicyDependencies,
    MentionSourceContext,
    canMention
} from './mentionPolicyService';

const publicSource: MentionSourceContext = {
    postId: 'post-1',
    authorId: 'author-1',
    status: 'PUBLISHED',
    isDeleted: false,
    groupIds: []
};

const dependencies = (overrides: Partial<MentionPolicyDependencies> = {}): MentionPolicyDependencies => ({
    loadTargetStatus: async () => 'ACTIVE',
    hasBlockRelationship: async () => false,
    loadSourceContext: async () => publicSource,
    canViewPost: async () => true,
    canViewAuthorContent: async () => true,
    hasJoinedGroupMembership: async () => true,
    ...overrides
});

const request = { actorUserId: 'actor-1', targetUserId: 'target-1', postId: 'post-1' };

test('allows an active eligible target who can access a public source', async () => {
    assert.deepEqual(await canMention(request, dependencies()), { allowed: true });
});

test('rejects self mentions, inactive accounts, and either-direction block relationships', async () => {
    assert.deepEqual(
        await canMention({ ...request, targetUserId: request.actorUserId }, dependencies()),
        { allowed: false, reason: 'self' }
    );
    assert.deepEqual(
        await canMention(request, dependencies({ loadTargetStatus: async () => 'DISABLED' })),
        { allowed: false, reason: 'inactive_account' }
    );
    assert.deepEqual(
        await canMention(request, dependencies({ hasBlockRelationship: async () => true })),
        { allowed: false, reason: 'blocked' }
    );
});

test('rejects deleted, unpublished, or inaccessible sources', async () => {
    assert.deepEqual(
        await canMention(request, dependencies({ loadSourceContext: async () => ({ ...publicSource, isDeleted: true }) })),
        { allowed: false, reason: 'source_unavailable' }
    );
    assert.deepEqual(
        await canMention(request, dependencies({ loadSourceContext: async () => ({ ...publicSource, status: 'DRAFT' }) })),
        { allowed: false, reason: 'source_unavailable' }
    );
    assert.deepEqual(
        await canMention(request, dependencies({ canViewPost: async () => false })),
        { allowed: false, reason: 'source_forbidden' }
    );
});

test('uses author privacy for non-group content, including follower eligibility', async () => {
    assert.deepEqual(
        await canMention(request, dependencies({ canViewAuthorContent: async () => false })),
        { allowed: false, reason: 'author_privacy' }
    );
    assert.deepEqual(
        await canMention(request, dependencies({ canViewAuthorContent: async () => true })),
        { allowed: true }
    );
});

test('requires joined membership for group content even when the group post is otherwise viewable', async () => {
    const groupSource = { ...publicSource, groupIds: ['group-1'] };
    assert.deepEqual(
        await canMention(request, dependencies({
            loadSourceContext: async () => groupSource,
            hasJoinedGroupMembership: async () => false
        })),
        { allowed: false, reason: 'group_membership_required' }
    );
    assert.deepEqual(
        await canMention(request, dependencies({
            loadSourceContext: async () => groupSource,
            hasJoinedGroupMembership: async () => true
        })),
        { allowed: true }
    );
});
