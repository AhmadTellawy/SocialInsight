import test from 'node:test';
import assert from 'node:assert/strict';
import { currentPageDatabaseContext } from '../pages/pageDatabaseContext';
import { runAccountErasureInPageSystemContext } from './accountErasureService';

test('account erasure applies a signed system context to its supplied transaction', async () => {
  const previous = {
    PAGES_RLS_CONTEXT_KEY_ID: process.env.PAGES_RLS_CONTEXT_KEY_ID,
    PAGES_RLS_CONTEXT_SIGNING_KEY: process.env.PAGES_RLS_CONTEXT_SIGNING_KEY,
  };
  let setContextCalls = 0;
  const tx: any = {
    $queryRaw: async () => [{ backendPid: '42', transactionId: '99' }],
    $executeRaw: async () => { setContextCalls++; return 1; },
  };
  try {
    process.env.PAGES_RLS_CONTEXT_KEY_ID = 'erasure-test';
    process.env.PAGES_RLS_CONTEXT_SIGNING_KEY = 'ab'.repeat(32);
    await runAccountErasureInPageSystemContext(tx, async () => {
      assert.equal(currentPageDatabaseContext()?.system, true);
    });
    assert.equal(setContextCalls, 1);
    assert.equal(currentPageDatabaseContext(), undefined);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
