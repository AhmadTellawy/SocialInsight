import assert from 'node:assert/strict';
import test, { after } from 'node:test';

process.env.JWT_SECRET ||= 'page-share-race-test-secret';
const prisma = require('../prisma').default as typeof import('../prisma').default;
const { sharePost } = require('./postController') as typeof import('./postController');
const { PrivacyService } = require('../services/privacyService') as typeof import('../services/privacyService');
after(async () => prisma.$disconnect());

for (const restriction of ['privacy', 'block', 'clicked-wrapper'] as const) {
  test(`Page share rechecks ${restriction} after acquiring source locks and persists nothing`, async () => {
    const pageId = '00000000-0000-4000-8000-000000000001';
    const source = { id: 'source', authorId: 'source-author', pageId: null, sharedFromId: null, sharedCaption: null, status: 'PUBLISHED', isDeleted: false, title: 'Private after barrier', type: 'Poll', targetAudience: 'Public', groupId: null, targetedGroups: [], questions: [], author: { isPrivate: false, mediaPrivacyTarget: false } };
    const clicked = restriction === 'clicked-wrapper' ? { ...source, id: 'wrapper', authorId: 'wrapper-author', sharedFromId: source.id } : source;
    const refs = clicked.id === source.id ? [source] : [source, clicked];
    const page = { id: pageId, ownerId: 'actor', publicationState: 'PUBLISHED', platformState: 'NONE', deletionRequestedAt: null, safetyHiddenAt: null, purgedAt: null };
    const originals = { postFindUnique: prisma.post.findUnique, postFindMany: prisma.post.findMany, postCount: prisma.post.count, pageFindUnique: prisma.page.findUnique, pageCount: prisma.page.count, pageBlock: prisma.pageBlock.findFirst, userFindUnique: prisma.user.findUnique, query: prisma.$queryRaw, transaction: prisma.$transaction, privacy: PrivacyService.canViewUserContent, enabled: process.env.PAGES_ENABLED };
    let sourceLocksAcquired = false;
    let writes = 0;
    let finalPredicate: any;
    const tx: any = {
      $queryRaw: async (query: any) => {
        const sql = Array.isArray(query) ? query.join('') : query.strings.join('');
        if (sql.includes('AS "visible"')) return [{ visible: true }];
        if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) sourceLocksAcquired = true;
        if (sql.includes('FROM "Page"')) return [page];
        if (sql.includes('FROM users') && sql.endsWith('FOR SHARE')) return [{ id: 'actor', status: 'ACTIVE', emailVerifiedAt: null }];
        return [];
      },
      page: { findUnique: async () => page, count: async () => 1 },
      user: { findUnique: async () => ({ id: 'actor', status: 'ACTIVE' }) },
      pageBlock: { findFirst: async () => null },
      post: {
        findMany: async () => {
          assert.equal(sourceLocksAcquired, true);
          return refs.map(post => ({ ...post, author: { ...post.author, isPrivate: restriction === 'privacy' } }));
        },
        count: async (args: any) => {
          assert.equal(sourceLocksAcquired, true);
          finalPredicate = args.where;
          return restriction === 'clicked-wrapper' ? 1 : 0;
        },
        create: async () => { writes++; throw new Error('Unexpected share write'); }
      }
    };
    try {
      process.env.PAGES_ENABLED = 'true';
      (prisma.post as any).findUnique = async () => clicked;
      (prisma.post as any).findMany = async () => refs;
      (prisma.post as any).count = async () => refs.length;
      (prisma.page as any).findUnique = async () => page;
      (prisma.page as any).count = async () => 1;
      (prisma.pageBlock as any).findFirst = async () => null;
      (prisma.user as any).findUnique = async () => ({ id: 'actor', status: 'ACTIVE' });
      (prisma as any).$queryRaw = async (query: any) => {
        const sql = Array.isArray(query) ? query.join('') : query.strings.join('');
        if (sql.includes('AS "visible"')) return [{ visible: true }];
        if (sql.includes('FROM "Page"')) return [page];
        if (sql.includes('FROM users') && sql.endsWith('FOR SHARE')) return [{ id: 'actor', status: 'ACTIVE', emailVerifiedAt: null }];
        return [];
      };
      (PrivacyService as any).canViewUserContent = async () => true;
      (prisma as any).$transaction = async (action: any, options: any) => {
        assert.equal(options.isolationLevel, 'ReadCommitted', 'Post-lock reads must see blocks committed while waiting');
        return action(tx);
      };
      let status = 200;
      let body: any;
      const response: any = { status(code: number) { status = code; return this; }, json(value: any) { body = value; return this; } };
      await sharePost({ params: { id: clicked.id }, user: { userId: 'actor' }, body: { pageId, pageCreateKey: '00000000-0000-4000-8000-000000000009' } } as any, response);
      assert.equal(status, 403);
      assert.equal(body.code, 'PAGE_SHARE_SOURCE_UNAVAILABLE');
      assert.equal(writes, 0);
      assert.equal(sourceLocksAcquired, true);
      if (restriction !== 'privacy') {
        assert.deepEqual([...finalPredicate.id.in].sort(), refs.map(post => post.id).sort());
        assert.match(JSON.stringify(finalPredicate), /blocking/);
        assert.match(JSON.stringify(finalPredicate), /blockedBy/);
      }
    } finally {
      (prisma.post as any).findUnique = originals.postFindUnique;
      (prisma.post as any).findMany = originals.postFindMany;
      (prisma.post as any).count = originals.postCount;
      (prisma.page as any).findUnique = originals.pageFindUnique;
      (prisma.page as any).count = originals.pageCount;
      (prisma.pageBlock as any).findFirst = originals.pageBlock;
      (prisma.user as any).findUnique = originals.userFindUnique;
      (prisma as any).$queryRaw = originals.query;
      (prisma as any).$transaction = originals.transaction;
      (PrivacyService as any).canViewUserContent = originals.privacy;
      if (originals.enabled === undefined) delete process.env.PAGES_ENABLED;
      else process.env.PAGES_ENABLED = originals.enabled;
    }
  });
}
