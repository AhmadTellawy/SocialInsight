import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPagesRuntimeDatabaseRoleRecord,
  pagesRuntimeRoleVerificationRequired,
  PagesRuntimeDatabaseRoleRecord,
} from '../prisma';
import { assertPageDatabaseContextSigningConfiguration, signPageDatabaseContext } from './pageDatabaseContext';

const safeRole: PagesRuntimeDatabaseRoleRecord = {
  rolsuper: false,
  rolbypassrls: false,
  runtimeMember: true,
  canCreatePublic: false,
  canAccessMigrations: false,
  unexpectedMemberships: BigInt(0),
  ownedPublicObjects: BigInt(0),
};

test('Production role verification covers global and pilot-only Page activation', () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    PAGES_ENABLED: process.env.PAGES_ENABLED,
    PAGES_TEST_USERS: process.env.PAGES_TEST_USERS,
  };
  try {
    process.env.NODE_ENV = 'production';
    process.env.PAGES_ENABLED = 'false';
    process.env.PAGES_TEST_USERS = '';
    assert.equal(pagesRuntimeRoleVerificationRequired(), false);
    process.env.PAGES_TEST_USERS = '  pilot-a, ';
    assert.equal(pagesRuntimeRoleVerificationRequired(), true);
    process.env.PAGES_TEST_USERS = '';
    process.env.PAGES_ENABLED = 'true';
    assert.equal(pagesRuntimeRoleVerificationRequired(), true);
    process.env.NODE_ENV = 'test';
    assert.equal(pagesRuntimeRoleVerificationRequired(), false);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('runtime database role invariant rejects every migration or inherited privilege path', () => {
  assert.doesNotThrow(() => assertPagesRuntimeDatabaseRoleRecord(safeRole));
  assert.throws(() => assertPagesRuntimeDatabaseRoleRecord(undefined), /PAGES_RUNTIME_DATABASE_ROLE_UNSAFE/);
  for (const unsafe of [
    { rolsuper: true },
    { rolbypassrls: true },
    { runtimeMember: false },
    { canCreatePublic: true },
    { canAccessMigrations: true },
    { unexpectedMemberships: BigInt(1) },
    { ownedPublicObjects: BigInt(1) },
  ]) {
    assert.throws(() => assertPagesRuntimeDatabaseRoleRecord({ ...safeRole, ...unsafe }),
      /PAGES_RUNTIME_DATABASE_ROLE_UNSAFE/);
  }
});

test('signed Page database context requires a strong hex key and constrained key id', () => {
  const previous = {
    PAGES_RLS_CONTEXT_KEY_ID: process.env.PAGES_RLS_CONTEXT_KEY_ID,
    PAGES_RLS_CONTEXT_SIGNING_KEY: process.env.PAGES_RLS_CONTEXT_SIGNING_KEY,
  };
  try {
    delete process.env.PAGES_RLS_CONTEXT_KEY_ID;
    delete process.env.PAGES_RLS_CONTEXT_SIGNING_KEY;
    assert.throws(assertPageDatabaseContextSigningConfiguration, /KEY_ID_INVALID/);
    process.env.PAGES_RLS_CONTEXT_KEY_ID = 'primary-2026';
    process.env.PAGES_RLS_CONTEXT_SIGNING_KEY = 'ab'.repeat(31);
    assert.throws(assertPageDatabaseContextSigningConfiguration, /SIGNING_KEY_INVALID/);
    process.env.PAGES_RLS_CONTEXT_SIGNING_KEY = 'ab'.repeat(32);
    assert.doesNotThrow(assertPageDatabaseContextSigningConfiguration);
    const token = signPageDatabaseContext({ actorId: '00000000-0000-4000-8000-000000000001', staff: false,
      system: false, testUser: true }, { backendPid: '42', transactionId: '99' }, new Date('2026-10-02T00:00:00Z'));
    const fields = token.split('.');
    assert.equal(fields.length, 12);
    assert.deepEqual(fields.slice(0, 10), ['v1', 'primary-2026', '00000000-0000-4000-8000-000000000001',
      '0', '0', '1', '1790899200', '1790899230', '42', '99']);
    assert.match(fields[10], /^[0-9a-f]{32}$/);
    assert.match(fields[11], /^[0-9a-f]{64}$/);
    assert.throws(() => signPageDatabaseContext({ actorId: 'attacker.controlled', staff: false,
      system: false, testUser: false }, { backendPid: '42', transactionId: '99' }), /ACTOR_INVALID/);
    assert.throws(() => signPageDatabaseContext({ actorId: null, staff: true,
      system: false, testUser: false }, { backendPid: '42', transactionId: '99' }), /SCOPE_INVALID/);
    assert.throws(() => signPageDatabaseContext({ actorId: '00000000-0000-4000-8000-000000000001', staff: false,
      system: true, testUser: false }, { backendPid: '42', transactionId: '99' }), /SCOPE_INVALID/);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
