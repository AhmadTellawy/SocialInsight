import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../prisma';
import { currentPageDatabaseContext } from './pageDatabaseContext';
import { admitPagePurges, processPagePurgeBatch } from './pageLifecycleWorker';

test('direct lifecycle primitives establish exactly one system context', async () => {
  const originalTransaction = prisma.$transaction;
  let transactions = 0;
  const observed: boolean[] = [];
  const tx: any = {
    page: {
      findMany: async () => {
        observed.push(currentPageDatabaseContext()?.system === true);
        return [];
      },
      findUnique: async () => {
        observed.push(currentPageDatabaseContext()?.system === true);
        return { id: 'page-id', purgedAt: null };
      },
    },
    $queryRaw: async () => [],
  };
  (prisma as any).$transaction = async (work: (transaction: any) => unknown) => {
    transactions++;
    return work(tx);
  };
  try {
    assert.equal(await admitPagePurges(), 0);
    assert.deepEqual(await processPagePurgeBatch('page-id'), { state: 'idle' });
    assert.deepEqual(observed, [true, true]);
    assert.equal(transactions, 2, 'a wrapped call must not recurse into a second wrapper transaction');
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});
