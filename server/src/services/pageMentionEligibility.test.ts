import assert from 'node:assert/strict';
import test from 'node:test';
import { canMention, MentionPolicyDependencies } from './mentionPolicyService';

const input = { postId: 'post', actorUserId: 'staff', targetUserId: 'viewer' };
const dependencies = (overrides: Partial<MentionPolicyDependencies> = {}): MentionPolicyDependencies => ({
  loadTargetStatus: async () => 'ACTIVE',
  loadSourceContext: async () => ({ postId: 'post', authorId: 'staff', pageId: 'page', status: 'PUBLISHED', isDeleted: false, groupIds: [] }),
  hasBlockRelationship: async () => true,
  hasPageBlockRelationship: async () => false,
  canViewPost: async () => true,
  canViewPagePost: async () => true,
  canViewAuthorContent: async () => false,
  hasJoinedGroupMembership: async () => false,
  loadCommentPageId: async () => null,
  ...overrides
});

test('Page mention eligibility ignores staff privacy but honors Page blocks and audience', async () => {
  assert.deepEqual(await canMention(input, dependencies()), { allowed: true });
  assert.deepEqual(await canMention(input, dependencies({ hasPageBlockRelationship: async () => true })), { allowed: false, reason: 'blocked' });
  assert.deepEqual(await canMention(input, dependencies({ canViewPagePost: async () => false })), { allowed: false, reason: 'source_forbidden' });
});

test('personal and official comments resolve their own current publisher identity', async () => {
  const commentInput = { ...input, commentId: 'comment' };
  assert.deepEqual(await canMention(commentInput, dependencies()), { allowed: false, reason: 'blocked' });
  assert.deepEqual(await canMention(commentInput, dependencies({ loadCommentPageId: async () => 'page' })), { allowed: true });
  assert.deepEqual(await canMention({ ...commentInput, targetUserId: 'staff' }, dependencies()), { allowed: false, reason: 'self' });
});
