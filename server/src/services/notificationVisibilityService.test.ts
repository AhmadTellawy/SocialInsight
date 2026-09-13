import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateNotificationVisibility } from './notificationVisibilityService';

const activeDb = (overrides: Record<string, any> = {}) => ({
  user: { findMany: async ({ where }: any) => where.id.in.map((id: string) => ({ id })) },
  userBlock: { findFirst: async () => null },
  post: { findFirst: async () => ({ id: 'post-1' }) },
  comment: { count: async ({ where }: any) => where.id.in.length },
  group: { findFirst: async () => ({ id: 'group-1' }) },
  ...overrides
});

const postNotification = {
  userId: 'recipient-1', actorId: 'actor-1', type: 'response',
  targetType: 'post', targetId: 'post-1',
  payload: { postId: 'post-1', commentId: 'comment-1' }
};

test('notification delivery drops a source that is no longer visible', async () => {
  const db = activeDb({ post: { findFirst: async () => null } });
  assert.deepEqual(await evaluateNotificationVisibility(postNotification, db), {
    allowed: false,
    reason: 'source_unavailable'
  });
});

test('notification delivery drops inactive or blocked actors before source disclosure', async () => {
  const inactiveDb = activeDb({ user: { findMany: async () => [{ id: 'recipient-1' }] } });
  assert.equal((await evaluateNotificationVisibility(postNotification, inactiveDb)).reason, 'inactive_actor');
  const blockedDb = activeDb({ userBlock: { findFirst: async () => ({ id: 'block-1' }) } });
  assert.equal((await evaluateNotificationVisibility(postNotification, blockedDb)).reason, 'blocked_actor');
});

test('notification delivery verifies nested comment identifiers belong to the visible post', async () => {
  const db = activeDb({ comment: { count: async () => 0 } });
  assert.equal((await evaluateNotificationVisibility(postNotification, db)).reason, 'source_unavailable');
});

test('post and survey notifications fail closed when legacy rows have no source identifier', async () => {
  for (const targetType of ['post', 'survey']) {
    const decision = await evaluateNotificationVisibility({
      userId: 'recipient-1', actorId: 'actor-1', type: 'response', targetType, targetId: null, payload: {}
    }, activeDb());
    assert.deepEqual(decision, { allowed: false, reason: 'missing_source' });
  }
});

test('private group invitations remain visible only while the recipient has an invited or joined membership', async () => {
  let capturedWhere: any;
  const db = activeDb({ group: { findFirst: async ({ where }: any) => { capturedWhere = where; return { id: 'group-1' }; } } });
  const decision = await evaluateNotificationVisibility({
    userId: 'recipient-1', actorId: 'actor-1', type: 'group_invite', targetType: 'group', targetId: 'group-1'
  }, db);
  assert.equal(decision.allowed, true);
  assert.deepEqual(capturedWhere.OR[1].members.some.status.in, ['JOINED', 'INVITED']);
});
