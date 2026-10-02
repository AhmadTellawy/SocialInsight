import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPagesRuntimeDatabaseRoleRecord,
  pagesRuntimeRoleVerificationRequired,
  PagesRuntimeDatabaseRoleRecord,
} from '../prisma';

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
