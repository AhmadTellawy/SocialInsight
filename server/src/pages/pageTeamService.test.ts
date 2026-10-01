import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../prisma';
import { leavePageTeam } from './pageTeamService';

function fixture(options: { member?: boolean; revokeOnLock?: boolean; inactive?: boolean; auditFails?: boolean } = {}) {
  const events: string[] = [];
  let stored = { member: options.member ?? true, invitation: 'PENDING', transfer: 'PENDING', audits: 0 };
  const transaction = async (action: any, config: any) => {
    assert.equal(config.isolationLevel, 'Serializable');
    let pending = { ...stored };
    const key = { pageId_userId: { pageId: 'page', userId: 'member' } };
    const page = { id: 'page', ownerId: 'owner', purgedAt: null, safetyHiddenAt: null };
    const tx: any = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        const sql = strings.join('?');
        if (sql.includes('"Page"')) {
          assert.ok(sql.endsWith('FOR UPDATE')); events.push('page-lock');
          // Models a team removal committed before this request acquired the Page lock.
          if (options.revokeOnLock) stored.member = pending.member = false;
          return [page];
        } else {
          assert.ok(sql.endsWith('FOR SHARE')); events.push('actor-lock'); events.push('actor-read');
          return [{ id: 'member', status: options.inactive ? 'SUSPENDED' : 'ACTIVE', emailVerifiedAt: null }];
        }
      },
      user: { findUnique: async () => { throw new Error('Actor lock must return its current row without a second fetch'); } },
      page: {
        findUnique: async () => { throw new Error('Page lock must return its current row without a second fetch'); },
        findUniqueOrThrow: async () => { events.push('safety'); return { ...page, owner: { status: 'ACTIVE' } }; },
      },
      pageMembership: {
        findUnique: async ({ where }: any) => { assert.deepEqual(where, key); events.push('membership-read'); return pending.member ? { userId: 'member' } : null; },
        delete: async ({ where }: any) => { assert.deepEqual(where, key); assert.ok(pending.member); events.push('membership-delete'); pending.member = false; },
      },
      pageInvitation: { updateMany: async ({ where, data }: any) => {
        assert.deepEqual(where, { pageId: 'page', senderId: 'member', status: 'PENDING', role: { in: ['ADMIN', 'EDITOR', 'ANALYST'] } });
        assert.equal(data.status, 'WITHDRAWN'); assert.ok(data.decidedAt instanceof Date);
        events.push('invitation-withdraw'); pending.invitation = data.status;
      } },
      pageOwnershipTransfer: { updateMany: async ({ where, data }: any) => {
        assert.deepEqual(where, { pageId: 'page', recipientId: 'member', status: 'PENDING' });
        assert.equal(data.status, 'WITHDRAWN'); events.push('transfer-withdraw'); pending.transfer = data.status;
      } },
      pageAuditEvent: { create: async ({ data }: any) => {
        assert.equal(data.action, 'MEMBER_LEFT'); assert.equal(data.actorId, 'member'); assert.equal(data.pageId, 'page');
        events.push('audit'); if (options.auditFails) throw new Error('audit unavailable'); pending.audits++;
      } },
    };
    const result = await action(tx); stored = pending; return result;
  };
  return { transaction, events, state: () => ({ ...stored }) };
}

test('Team outsider is denied before membership, invitation, transfer, audit or safety writes', async () => {
  const original = prisma.$transaction, f = fixture({ member: false });
  try {
    (prisma as any).$transaction = f.transaction; const before = f.state();
    await assert.rejects(leavePageTeam('page', 'member'), { code: 'PAGE_PERMISSION_DENIED', status: 403 });
    assert.deepEqual(f.state(), before);
    assert.deepEqual(f.events, ['page-lock', 'actor-lock', 'actor-read', 'membership-read']);
  } finally { prisma.$transaction = original; }
});

test('Current team member leaves once, withdraws own pending grants and creates one audit', async () => {
  const original = prisma.$transaction, f = fixture();
  try {
    (prisma as any).$transaction = f.transaction;
    assert.deepEqual(await leavePageTeam('page', 'member'), { left: true });
    assert.deepEqual(f.state(), { member: false, invitation: 'WITHDRAWN', transfer: 'WITHDRAWN', audits: 1 });
    assert.deepEqual(f.events, ['page-lock', 'actor-lock', 'actor-read', 'membership-read', 'membership-delete', 'invitation-withdraw', 'transfer-withdraw', 'audit', 'safety']);
    const after = f.state(); f.events.length = 0;
    await assert.rejects(leavePageTeam('page', 'member'), { code: 'PAGE_PERMISSION_DENIED', status: 403 });
    assert.deepEqual(f.state(), after); assert.deepEqual(f.events, ['page-lock', 'actor-lock', 'actor-read', 'membership-read']);
  } finally { prisma.$transaction = original; }
});

test('Membership removed before Page lock acquisition cannot create a false leave audit', async () => {
  const original = prisma.$transaction, f = fixture({ revokeOnLock: true });
  try {
    (prisma as any).$transaction = f.transaction;
    await assert.rejects(leavePageTeam('page', 'member'), { code: 'PAGE_PERMISSION_DENIED', status: 403 });
    assert.deepEqual(f.state(), { member: false, invitation: 'PENDING', transfer: 'PENDING', audits: 0 });
    assert.deepEqual(f.events, ['page-lock', 'actor-lock', 'actor-read', 'membership-read']);
  } finally { prisma.$transaction = original; }
});

test('Owner transfer requirement and inactive actor denial remain before membership writes', async () => {
  const original = prisma.$transaction;
  try {
    for (const inactive of [false, true]) {
      const f = fixture({ inactive }); (prisma as any).$transaction = f.transaction; const before = f.state();
      await assert.rejects(leavePageTeam('page', inactive ? 'member' : 'owner'), {
        code: inactive ? 'PAGE_ACTIVE_ACCOUNT_REQUIRED' : 'PAGE_OWNER_MUST_TRANSFER', status: inactive ? 401 : 409,
      });
      assert.deepEqual(f.state(), before); assert.deepEqual(f.events, ['page-lock', 'actor-lock', 'actor-read']);
    }
  } finally { prisma.$transaction = original; }
});

test('Audit failure rolls back membership removal and pending invitation and transfer withdrawal', async () => {
  const original = prisma.$transaction, f = fixture({ auditFails: true });
  try {
    (prisma as any).$transaction = f.transaction; const before = f.state();
    await assert.rejects(leavePageTeam('page', 'member'), /audit unavailable/);
    assert.deepEqual(f.state(), before); assert.equal(f.events.includes('safety'), false);
  } finally { prisma.$transaction = original; }
});
