import test from 'node:test';
import assert from 'node:assert/strict';
import { currentPageDatabaseContext } from '../pages/pageDatabaseContext';
import { runAccountErasureInPageSystemContext } from './accountErasureService';

test('account erasure applies a signed system context to its supplied transaction', async () => {
  const previous = {
    PAGES_RLS_CONTEXT_KEY_ID: process.env.PAGES_RLS_CONTEXT_KEY_ID,
    PAGES_RLS_CONTEXT_SIGNING_KEY: process.env.PAGES_RLS_CONTEXT_SIGNING_KEY,
  };
  const contexts: string[] = [];
  const tx: any = {
    $queryRaw: async () => [{ backendPid: '42', transactionId: '99' }],
    $executeRaw: async (query: any, value: unknown) => {
      // A raw tagged-template double receives strings and interpolations as
      // separate arguments; Prisma's real implementation receives Sql.
      contexts.push(String(value || query.values?.[0] || ''));
      return 1;
    },
  };
  try {
    process.env.PAGES_RLS_CONTEXT_KEY_ID = 'erasure-test';
    process.env.PAGES_RLS_CONTEXT_SIGNING_KEY = 'ab'.repeat(32);
    await runAccountErasureInPageSystemContext(tx, async refresh => {
      assert.equal(currentPageDatabaseContext()?.system, true);
      const initialContext = contexts[0];
      await refresh();
      assert.notEqual(contexts[1], initialContext, 'late Page work receives a newly signed context token');
    });
    assert.equal(contexts.length, 2);
    assert.match(contexts[0], /^v1\.erasure-test\.0\.0\.1\.0\./);
    assert.match(contexts[1], /^v1\.erasure-test\.0\.0\.1\.0\./);
    assert.equal(currentPageDatabaseContext(), undefined);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
