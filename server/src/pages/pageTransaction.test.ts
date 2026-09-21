import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { pageTransaction, updatePageInfo } from './pageService';

const conflict = (code: string, sqlState?: string) => new Prisma.PrismaClientKnownRequestError('fixture',
  { code, clientVersion: 'test', ...(sqlState ? { meta: { code: sqlState } } : {}) });

test('Page transaction retries wrapped and raw serialization/deadlock failures with fresh callbacks', async () => {
  const original = prisma.$transaction;
  try {
    for (const error of [conflict('P2034'), conflict('P2010', '40001'), conflict('P2010', '40P01')]) {
      let calls = 0, callbacks = 0;
      (prisma as any).$transaction = async (action: any, options: any) => {
        assert.deepEqual(options, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 15000 });
        const result = await action({});
        if (++calls < 3) throw error; // Includes failure at COMMIT, after callback work.
        return result;
      };
      const result = await pageTransaction(async () => ++callbacks);
      assert.equal(result, 3); assert.equal(calls, 3); assert.equal(callbacks, 3);
    }
  } finally { prisma.$transaction = original; }
});

test('Page transaction preserves three-attempt cap and does not retry unrelated errors', async () => {
  const original = prisma.$transaction;
  try {
    for (const [error, expected] of [
      [conflict('P2034'), 3], [conflict('P2010', '40001'), 3], [conflict('P2010', '40P01'), 3],
      [conflict('P2010', '23505'), 1], [conflict('P2010'), 1], [conflict('P2002'), 1],
      [conflict('P2028'), 1], [new Error('network'), 1], [{ code: 'P2034' }, 1],
    ] as const) {
      let calls = 0;
      (prisma as any).$transaction = async () => { calls++; throw error; };
      await assert.rejects(pageTransaction(async () => null), actual => actual === error);
      assert.equal(calls, expected);
    }
  } finally { prisma.$transaction = original; }
});

function infoFixture(options: { revoked?: boolean; deleting?: boolean; missingContact?: boolean; auditFails?: boolean; inactive?: boolean } = {}) {
  const events: string[] = [];
  const page: any = { id: 'page', ownerId: 'owner', name: 'Current name', handle: 'stable_handle',
    cta: null, website: 'https://example.test', publicEmail: null, publicPhone: null,
    deletionRequestedAt: null, purgedAt: null };
  let stored: any = { ...page }, audits = 0;
  const transaction = async (action: any, config: any) => {
    assert.deepEqual(config, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 });
    let pending = { ...stored }, pendingAudits = audits;
    const tx: any = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        const sql = strings.join('?');
        if (sql.includes('"Page"')) {
          assert.ok(sql.endsWith('FOR UPDATE')); events.push('page-lock');
          // These values model changes committed by the winner before this lock is acquired.
          if (options.deleting) pending.deletionRequestedAt = new Date();
          if (options.missingContact) pending.website = null;
          events.push('page-read'); return [pending];
        } else {
          assert.ok(sql.endsWith('FOR SHARE')); events.push('actor-lock'); events.push('actor-read');
          return [{ id: 'admin', status: options.inactive ? 'SUSPENDED' : 'ACTIVE', emailVerifiedAt: null }];
        }
      },
      page: {
        findUnique: async () => { throw new Error('Page lock must return its current row without a second fetch'); },
        update: async ({ data }: any) => { events.push('write'); pending = { ...pending, ...data }; return pending; },
      },
      user: { findUnique: async () => { events.push('actor-read'); return { status: options.inactive ? 'SUSPENDED' : 'ACTIVE' }; } },
      pageMembership: { findUnique: async () => { events.push('role-read'); return options.revoked ? null : { role: 'ADMIN' }; } },
      pageAuditEvent: { create: async ({ data }: any) => {
        events.push('audit'); assert.deepEqual(data.data, { fields: ['name'] });
        if (options.auditFails) throw new Error('audit unavailable');
        pendingAudits++; return { id: 'audit' };
      } },
    };
    const result = await action(tx); stored = pending; audits = pendingAudits; return result;
  };
  return { events, transaction, state: () => ({ stored, audits }) };
}

test('Page info takes exclusive Page and actor share locks before current role, field update and audit', async () => {
  const original = prisma.$transaction, fixture = infoFixture();
  try {
    (prisma as any).$transaction = fixture.transaction;
    const result = await updatePageInfo('admin', 'page', { name: 'New name' });
    assert.equal(result.name, 'New name'); assert.equal(result.role, 'ADMIN');
    assert.deepEqual(fixture.events, ['page-lock', 'page-read', 'actor-lock', 'actor-read', 'role-read', 'write', 'audit']);
    assert.equal(fixture.state().audits, 1); assert.equal(fixture.state().stored.ownerId, 'owner');
    assert.equal(fixture.state().stored.handle, 'stable_handle');
  } finally { prisma.$transaction = original; }
});

test('Page info rechecks revoked/inactive actor, deletion and CTA against the state read after lock', async () => {
  const original = prisma.$transaction;
  try {
    for (const [options, patch, code] of [
      [{ revoked: true }, { name: 'New name' }, 'PAGE_PERMISSION_DENIED'],
      [{ inactive: true }, { name: 'New name' }, 'PAGE_ACTIVE_ACCOUNT_REQUIRED'],
      [{ deleting: true }, { name: 'New name' }, 'PAGE_DELETING'],
      [{ missingContact: true }, { cta: 'WEBSITE' }, 'PAGE_CTA_CONTACT_REQUIRED'],
    ] as const) {
      const fixture = infoFixture(options); (prisma as any).$transaction = fixture.transaction;
      await assert.rejects(updatePageInfo('admin', 'page', patch), (error: any) => error.code === code);
      assert.ok(!fixture.events.includes('write')); assert.ok(!fixture.events.includes('audit'));
      assert.equal(fixture.state().stored.name, 'Current name'); assert.equal(fixture.state().audits, 0);
    }
  } finally { prisma.$transaction = original; }
});

test('Page info keeps audit failure inside the transaction and rejects non-info fields before DB work', async () => {
  const original = prisma.$transaction, fixture = infoFixture({ auditFails: true });
  try {
    (prisma as any).$transaction = fixture.transaction;
    await assert.rejects(updatePageInfo('admin', 'page', { name: 'New name' }), /audit unavailable/);
    assert.equal(fixture.state().stored.name, 'Current name'); assert.equal(fixture.state().audits, 0);
    let calls = 0; (prisma as any).$transaction = async () => { calls++; };
    for (const patch of [{ ownerId: 'other' }, { handle: 'other' }, { publicationState: 'PUBLISHED' }]) {
      await assert.rejects(updatePageInfo('admin', 'page', patch));
    }
    assert.equal(calls, 0);
  } finally { prisma.$transaction = original; }
});
