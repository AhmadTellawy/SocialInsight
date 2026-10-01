import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../prisma';
import { pageContent } from './pageContentService';
import { PagePolicyError } from './pagePolicy';
import { canonicalShareSourceId, copiedPageRootId, withoutCopiedPageText } from './pageShareCopy';

test('a Page repost keeps its Page as the copied-text source', () => {
  const source = { id: 'page-repost', pageId: 'page-b', sharedFromId: 'personal-original', sharedRootPageId: null };
  assert.equal(canonicalShareSourceId(source), 'page-repost');
  assert.equal(copiedPageRootId(source, null), 'page-b');
  assert.equal(withoutCopiedPageText('Page title', 'Page title'), '');
  assert.equal(withoutCopiedPageText('News — News', 'News'), '');
});

test('management content rechecks revoked membership after acquiring the Page lock', async () => {
  const prior = prisma.$transaction;
  let contentReads = 0;
  const tx: any = {
    $queryRaw: async (query: any) => {
      const sql = Array.isArray(query) ? query.join('') : query.sql;
      if (sql.includes('FROM "Page"')) return [{ id: 'page', ownerId: 'owner', purgedAt: null }];
      if (sql.includes('FROM users')) return [{ id: 'viewer', status: 'ACTIVE' }];
      return [];
    },
    user: { findUnique: async () => ({ status: 'ACTIVE' }) },
    pageMembership: { findUnique: async () => null },
    post: { findMany: async () => { contentReads++; return []; } }
  };
  try {
    (prisma as any).$transaction = async (action: any) => action(tx);
    await assert.rejects(pageContent('page', 'viewer', { limit: 10 }),
      error => error instanceof PagePolicyError && error.code === 'PAGE_PERMISSION_DENIED');
    assert.equal(contentReads, 0, 'No private draft or published content is read after revocation');
  } finally { (prisma as any).$transaction = prior; }
});
