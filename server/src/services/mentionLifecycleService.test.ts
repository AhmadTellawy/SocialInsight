import assert from 'node:assert/strict';
import test from 'node:test';
import { MentionState, MentionSurface } from '@prisma/client';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'mention-lifecycle-test-secret';

const { reconcilePostMentions } = require('./mentionLifecycleService') as typeof import('./mentionLifecycleService');

type StoredMention = {
  id: string;
  targetUserId: string;
  actorUserId: string;
  postId: string;
  sourceType: string;
  state: MentionState;
  notificationId: string | null;
  occurrences: Array<{
    surface: MentionSurface;
    startOffset: number;
    endOffset: number;
    rawText: string;
  }>;
};

const createHarness = () => {
  const users = [
    { id: 'target-a', handle: 'old_handle', status: 'ACTIVE' },
    { id: 'target-b', handle: 'second', status: 'ACTIVE' }
  ];
  const mentions: StoredMention[] = [];
  const notifications: Array<{ id: string; userId: string }> = [];
  let mentionSequence = 0;
  let notificationSequence = 0;
  const post = {
    authorId: 'actor',
    status: 'PUBLISHED',
    isDeleted: false,
    targetAudience: 'Public',
    author: { isPrivate: false, mediaPrivacyTarget: false },
    groupId: null,
    targetedGroups: []
  };

  const tx: any = {
    user: {
      findMany: async ({ where }: any) => users.filter((user) =>
        user.status === where.status && where.OR.some((condition: any) => {
          if (condition.id?.in) return condition.id.in.includes(user.id);
          return user.handle.toLowerCase() === condition.handle?.equals?.toLowerCase();
        })
      )
    },
    userBlock: { findMany: async () => [] },
    follow: { findMany: async () => [] },
    groupMember: { findMany: async () => [] },
    post: { findUnique: async () => ({ ...post }) },
    mention: {
      findMany: async () => mentions.map((mention) => ({
        ...mention,
        occurrences: mention.occurrences.map((occurrence) => ({ ...occurrence }))
      })),
      create: async ({ data }: any) => {
        const mention: StoredMention = {
          id: `mention-${++mentionSequence}`,
          targetUserId: data.targetUserId,
          actorUserId: data.actorUserId,
          postId: data.postId,
          sourceType: data.sourceType,
          state: data.state,
          notificationId: data.notificationId || null,
          occurrences: (data.occurrences?.create || []).map((occurrence: any) => ({ ...occurrence }))
        };
        mentions.push(mention);
        return { id: mention.id };
      },
      update: async ({ where, data }: any) => {
        const mention = mentions.find((candidate) => candidate.id === where.id)!;
        for (const key of ['actorUserId', 'sourceType', 'state', 'notificationId'] as const) {
          if (data[key] !== undefined) (mention as any)[key] = data[key];
        }
        return { ...mention };
      },
      delete: async ({ where }: any) => {
        const index = mentions.findIndex((candidate) => candidate.id === where.id);
        return mentions.splice(index, 1)[0];
      }
    },
    mentionOccurrence: {
      deleteMany: async ({ where }: any) => {
        const mention = mentions.find((candidate) => candidate.id === where.mentionId);
        if (mention) mention.occurrences = [];
        return { count: mention ? 1 : 0 };
      },
      createMany: async ({ data }: any) => {
        for (const occurrence of data) {
          const mention = mentions.find((candidate) => candidate.id === occurrence.mentionId)!;
          const { mentionId: _mentionId, ...stored } = occurrence;
          mention.occurrences.push(stored);
        }
        return { count: data.length };
      }
    },
    notification: {
      create: async ({ data }: any) => {
        const notification = { id: `notification-${++notificationSequence}`, userId: data.userId };
        notifications.push(notification);
        return { id: notification.id };
      },
      deleteMany: async ({ where }: any) => {
        const index = notifications.findIndex((notification) => notification.id === where.id);
        if (index >= 0) notifications.splice(index, 1);
        return { count: index >= 0 ? 1 : 0 };
      }
    }
  };

  const reconcile = (text: string, state: MentionState = MentionState.ACTIVE) => reconcilePostMentions(tx, {
    postId: 'post-1',
    actorUserId: 'actor',
    state,
    surfaces: [{ surface: MentionSurface.POST_TITLE, text }]
  });

  return { users, mentions, notifications, post, reconcile };
};

test('persistent mention identity survives handle changes and punctuation edits', async () => {
  const harness = createHarness();
  const created = await harness.reconcile('Thanks @old_handle');
  assert.equal(created.created, 1);
  assert.equal(harness.mentions[0].targetUserId, 'target-a');
  assert.equal(harness.notifications.length, 1);

  harness.users[0].handle = 'new_handle';
  const edited = await harness.reconcile('Thanks @old_handle!');

  assert.equal(edited.retained, 1);
  assert.equal(edited.created, 0);
  assert.equal(harness.mentions[0].targetUserId, 'target-a');
  assert.equal(harness.mentions[0].occurrences[0].rawText, '@old_handle');
  assert.equal(harness.notifications.length, 1);
});

test('mention reconciliation adds, removes, and retains targets without duplicate notifications', async () => {
  const harness = createHarness();
  await harness.reconcile('@old_handle');
  await harness.reconcile('@old_handle and @second');
  assert.deepEqual(harness.mentions.map(({ targetUserId }) => targetUserId).sort(), ['target-a', 'target-b']);
  assert.equal(harness.notifications.length, 2);

  const result = await harness.reconcile('@second only');
  assert.equal(result.removed, 1);
  assert.equal(result.retained, 1);
  assert.deepEqual(harness.mentions.map(({ targetUserId }) => targetUserId), ['target-b']);
  assert.deepEqual(harness.notifications.map(({ userId }) => userId), ['target-b']);
});

test('staged mentions notify once only after publication', async () => {
  const harness = createHarness();
  harness.post.status = 'PENDING_APPROVAL';
  const staged = await harness.reconcile('@old_handle', MentionState.STAGED);
  assert.equal(staged.created, 1);
  assert.equal(harness.notifications.length, 0);

  harness.post.status = 'PUBLISHED';
  const activated = await harness.reconcile('@old_handle', MentionState.ACTIVE);
  assert.equal(activated.retained, 1);
  assert.equal(harness.notifications.length, 1);

  await harness.reconcile('@old_handle', MentionState.ACTIVE);
  assert.equal(harness.notifications.length, 1);
});
