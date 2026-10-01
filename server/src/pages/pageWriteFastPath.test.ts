import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../prisma';
import { updatePageInfo } from './pageService';

type Role = 'OWNER' | 'ADMIN' | 'EDITOR' | 'ANALYST' | null;

function managementFixture(input: { actorId: string; ownerId?: string; role?: Role; inactive?: boolean; auditFails?: boolean }) {
  const events: string[] = [];
  const stored = {
    id: 'page', ownerId: input.ownerId || 'owner', name: 'Before', handle: 'stable',
    cta: null, website: null, publicEmail: null, publicPhone: null,
    deletionRequestedAt: null, purgedAt: null, publicationState: 'PUBLISHED',
    platformState: 'NONE', safetyHiddenAt: null
  } as any;
  let committed = { ...stored }, committedAudits = 0, membershipReads = 0, userDelegateReads = 0;
  const transaction = async (work: any, options: any) => {
    assert.deepEqual(options, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 });
    let pending = { ...committed }, pendingAudits = committedAudits;
    const tx: any = {
      $queryRaw: async (query: any) => {
        const sql = Array.isArray(query) ? query.join('') : query.strings.join('');
        if (sql.includes('FROM "Page"')) {
          assert.ok(sql.endsWith('FOR UPDATE'));
          events.push('page-lock');
          return [{ ...pending }];
        }
        assert.match(sql, /FROM users/);
        assert.ok(sql.endsWith('FOR SHARE'));
        events.push('actor-lock');
        return input.inactive ? [{ id: input.actorId, status: 'SUSPENDED', emailVerifiedAt: null }]
          : [{ id: input.actorId, status: 'ACTIVE', emailVerifiedAt: null }];
      },
      user: {
        findUnique: async () => { userDelegateReads++; throw new Error('active actor must not be reread'); }
      },
      pageMembership: {
        findUnique: async () => {
          membershipReads++;
          events.push('fresh-role');
          return input.role ? { role: input.role } : null;
        }
      },
      page: {
        update: async ({ data }: any) => { events.push('write'); pending = { ...pending, ...data }; return pending; }
      },
      pageAuditEvent: {
        create: async () => {
          events.push('audit');
          if (input.auditFails) throw new Error('audit unavailable');
          pendingAudits++;
          return { id: 'audit' };
        }
      }
    };
    const result = await work(tx);
    committed = pending;
    committedAudits = pendingAudits;
    return result;
  };
  return {
    transaction,
    events,
    state: () => ({ committed, committedAudits, membershipReads, userDelegateReads })
  };
}

test('Page info permits owner and admin with one actor lock and a fresh role read after the Page lock', async () => {
  const original = prisma.$transaction;
  try {
    for (const scenario of [
      { actorId: 'owner', ownerId: 'owner', role: null as Role, expected: 'OWNER', reads: 0 },
      { actorId: 'admin', ownerId: 'owner', role: 'ADMIN' as Role, expected: 'ADMIN', reads: 1 }
    ]) {
      const fixture = managementFixture(scenario);
      (prisma as any).$transaction = fixture.transaction;
      const result = await updatePageInfo(scenario.actorId, 'page', { name: 'After' });
      assert.equal(result.role, scenario.expected);
      assert.equal(result.name, 'After');
      assert.deepEqual(fixture.events, scenario.reads
        ? ['page-lock', 'actor-lock', 'fresh-role', 'write', 'audit']
        : ['page-lock', 'actor-lock', 'write', 'audit']);
      assert.equal(fixture.state().membershipReads, scenario.reads);
      assert.equal(fixture.state().userDelegateReads, 0);
      assert.equal(fixture.state().committedAudits, 1);
    }
  } finally {
    prisma.$transaction = original;
  }
});

test('Page info denies analyst, revoked and inactive actors before write or audit', async () => {
  const original = prisma.$transaction;
  try {
    for (const scenario of [
      { actorId: 'editor', role: 'EDITOR' as Role, code: 'PAGE_PERMISSION_DENIED', reads: 1 },
      { actorId: 'analyst', role: 'ANALYST' as Role, code: 'PAGE_PERMISSION_DENIED', reads: 1 },
      { actorId: 'revoked', role: null as Role, code: 'PAGE_PERMISSION_DENIED', reads: 1 },
      { actorId: 'inactive', role: 'EDITOR' as Role, inactive: true, code: 'PAGE_ACTIVE_ACCOUNT_REQUIRED', reads: 0 }
    ]) {
      const fixture = managementFixture(scenario);
      (prisma as any).$transaction = fixture.transaction;
      await assert.rejects(updatePageInfo(scenario.actorId, 'page', { name: 'After' }), (error: any) => error.code === scenario.code);
      assert.equal(fixture.state().membershipReads, scenario.reads);
      assert.equal(fixture.state().userDelegateReads, 0);
      assert.equal(fixture.state().committed.name, 'Before');
      assert.equal(fixture.state().committedAudits, 0);
      assert.ok(!fixture.events.includes('write'));
      assert.ok(!fixture.events.includes('audit'));
    }
  } finally {
    prisma.$transaction = original;
  }
});

test('Page info keeps audit in the same transaction so audit failure rolls back the field update', async () => {
  const original = prisma.$transaction;
  const fixture = managementFixture({ actorId: 'admin', role: 'ADMIN', auditFails: true });
  try {
    (prisma as any).$transaction = fixture.transaction;
    await assert.rejects(updatePageInfo('admin', 'page', { name: 'After' }), /audit unavailable/);
    assert.deepEqual(fixture.events, ['page-lock', 'actor-lock', 'fresh-role', 'write', 'audit']);
    assert.equal(fixture.state().committed.name, 'Before');
    assert.equal(fixture.state().committedAudits, 0);
    assert.equal(fixture.state().userDelegateReads, 0);
  } finally {
    prisma.$transaction = original;
  }
});
