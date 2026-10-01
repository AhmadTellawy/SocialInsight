import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../prisma';
import { processPageRetention } from './pageRetentionService';

test('closed invitation and its notifications expire after 180 days unless held', async () => {
  const previous: Array<[any, string, any]> = [];
  const replace = (model: any, name: string, value: any) => { previous.push([model, name, model[name]]); model[name] = value; };
  const old = new Date('2025-01-01T00:00:00.000Z');
  const now = new Date('2026-10-01T00:00:00.000Z');
  let held = false, deleted = 0, removedEvents = 0, removedNotifications = 0;
  const tx: any = {
    $queryRaw: async () => [{ id: 'page' }],
    page: { count: async () => held ? 1 : 0 },
    pageCase: { count: async () => 0 },
    pageInvitation: { deleteMany: async ({ where }: any) => { assert.equal(where.id, 'invite'); deleted++; return { count: 1 }; } },
    pageEvent: {
      findMany: async () => [{ id: 'event' }],
      deleteMany: async () => { removedEvents++; return { count: 1 }; }
    },
    notification: { deleteMany: async ({ where }: any) => {
      assert.deepEqual(where.dedupeKey.in, ['page-event:event']); removedNotifications++; return { count: 1 };
    } }
  };
  try {
    replace(prisma, '$transaction', async (action: any) => action(tx));
    replace(prisma, '$queryRaw', async () => []);
    replace(prisma.pageInvitation, 'findMany', async ({ where }: any) => where.status === 'PENDING' ? [] : [{ id: 'invite', pageId: 'page', decidedAt: old }]);
    replace(prisma.pageOwnershipTransfer, 'findMany', async () => []);
    replace(prisma.pageAuditEvent, 'findMany', async () => []);
    replace(prisma.pageEvent, 'findMany', async () => []);
    const result = await processPageRetention(10, now);
    assert.equal(result.invitationHistoryDeleted, 1);
    assert.deepEqual([deleted, removedEvents, removedNotifications], [1, 1, 1]);
    held = true;
    const heldResult = await processPageRetention(10, now);
    assert.equal(heldResult.invitationHistoryDeleted, 0);
    assert.deepEqual([deleted, removedEvents, removedNotifications], [1, 1, 1]);
  } finally { for (const [model, name, value] of previous.reverse()) model[name] = value; }
});
