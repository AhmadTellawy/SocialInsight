import assert from 'node:assert/strict';
import test from 'node:test';
import { PeopleTagPermission, PeopleTagStatus } from '@prisma/client';
import {
  getVisiblePeopleTagsInclude,
  PeopleTagValidationError,
  reconcilePeopleTags
} from './peopleTagService';

test('people-tag reads hide rejected and removed tags from later edit payloads', () => {
  const serializedWhere = JSON.stringify(getVisiblePeopleTagsInclude('viewer-1').where);
  assert.match(serializedWhere, /"ACCEPTED"/);
  assert.match(serializedWhere, /"PENDING"/);
  assert.doesNotMatch(serializedWhere, /"REJECTED"|"REMOVED"/);
});

const createHarness = () => {
  const users: Array<{ id: string; peopleTagPermission: PeopleTagPermission; status: string }> = [
    { id: 'target', peopleTagPermission: PeopleTagPermission.EVERYONE, status: 'ACTIVE' }
  ];
  const tags: any[] = [];
  const notifications: Array<{ id: string; userId: string }> = [];
  const followsActor = new Set<string>();
  let blocked = false;
  let tagSequence = 0;
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
    post: { findUnique: async () => ({ ...post }) },
    user: {
      findMany: async ({ where }: any) => users.filter((user) =>
        where.id.in.includes(user.id) && user.status === where.status
      )
    },
    userBlock: {
      findMany: async () => blocked ? [{ blockerId: 'actor', blockedId: 'target' }] : []
    },
    follow: {
      findMany: async ({ where }: any) => Array.from(followsActor)
        .filter((id) => where.followerId.in.includes(id))
        .map((followerId) => ({ followerId }))
    },
    groupMember: { findMany: async () => [] },
    postTaggedUser: {
      findMany: async () => tags.map((tag) => ({ ...tag })),
      create: async ({ data }: any) => {
        const tag = {
          id: `tag-${++tagSequence}`,
          notificationId: null,
          acceptedAt: null,
          rejectedAt: null,
          removedAt: null,
          ...data
        };
        tags.push(tag);
        return { id: tag.id };
      },
      update: async ({ where, data }: any) => {
        const tag = tags.find((candidate) => candidate.id === where.id)!;
        Object.assign(tag, data);
        return { ...tag };
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

  const reconcile = (targetUserIds: string[], strict = true) => reconcilePeopleTags(tx, {
    postId: 'post-1',
    actorUserId: 'actor',
    targetUserIds,
    strict
  });

  return {
    users,
    tags,
    notifications,
    followsActor,
    post,
    reconcile,
    setBlocked: (value: boolean) => { blocked = value; }
  };
};

test('people tags persist independently and unchanged reconciliation does not notify twice', async () => {
  const harness = createHarness();
  const created = await harness.reconcile(['target', 'target']);
  assert.equal(created.created, 1);
  assert.equal(harness.tags.length, 1);
  assert.equal(harness.tags[0].status, PeopleTagStatus.PENDING);
  assert.equal(harness.notifications.length, 1);

  const retained = await harness.reconcile(['target']);
  assert.equal(retained.retained, 1);
  assert.equal(retained.created, 0);
  assert.equal(harness.notifications.length, 1);
});

test('people-tag privacy and blocks are enforced by the mutation service', async () => {
  const harness = createHarness();
  harness.users[0].peopleTagPermission = PeopleTagPermission.NO_ONE;
  await assert.rejects(
    () => harness.reconcile(['target']),
    (error: unknown) => error instanceof PeopleTagValidationError && error.code === 'PEOPLE_TAG_INELIGIBLE'
  );

  harness.users[0].peopleTagPermission = PeopleTagPermission.FOLLOWING;
  await assert.rejects(() => harness.reconcile(['target']), PeopleTagValidationError);
  harness.followsActor.add('target');
  await harness.reconcile(['target']);
  assert.equal(harness.tags.length, 1);

  const blockedHarness = createHarness();
  blockedHarness.setBlocked(true);
  await assert.rejects(() => blockedHarness.reconcile(['target']), PeopleTagValidationError);
  assert.equal(blockedHarness.tags.length, 0);
});

test('removing and re-adding a people tag updates only the relation and creates a fresh notification', async () => {
  const harness = createHarness();
  await harness.reconcile(['target']);
  const firstNotificationId = harness.notifications[0].id;

  const removed = await harness.reconcile([]);
  assert.equal(removed.removed, 1);
  assert.equal(harness.tags[0].status, PeopleTagStatus.REMOVED);
  assert.equal(harness.notifications.length, 0);

  await harness.reconcile(['target']);
  assert.equal(harness.tags.length, 1);
  assert.equal(harness.tags[0].status, PeopleTagStatus.PENDING);
  assert.equal(harness.notifications.length, 1);
  assert.notEqual(harness.notifications[0].id, firstNotificationId);
});
