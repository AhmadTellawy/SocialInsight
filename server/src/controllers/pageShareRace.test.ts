import assert from 'node:assert/strict';
import test, { after } from 'node:test';

process.env.JWT_SECRET ||= 'page-share-race-test-secret';
const prisma = require('../prisma').default as typeof import('../prisma').default;
const { sharePost } = require('./postController') as typeof import('./postController');
const { PrivacyService } = require('../services/privacyService') as typeof import('../services/privacyService');
const { pageRequestDatabaseContext, runWithPageDatabaseContext } = require('../pages/pageDatabaseContext') as typeof import('../pages/pageDatabaseContext');
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
    let accountLockAcquired = false;
    let writes = 0;
    let finalPredicate: any;
    const tx: any = {
      $executeRaw: async () => { accountLockAcquired = true; return 1; },
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
      authSession: { findFirst: async () => {
        assert.equal(accountLockAcquired, true);
        return { id: 'session', createdAt: new Date() };
      } },
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
      await sharePost({ params: { id: clicked.id }, user: { userId: 'actor', authMode: 'session' }, authSession: { id: 'session', userId: 'actor' }, body: { pageId, pageCreateKey: '00000000-0000-4000-8000-000000000009' } } as any, response);
      assert.equal(status, 403);
      assert.equal(body.code, 'PAGE_SHARE_SOURCE_UNAVAILABLE');
      assert.equal(writes, 0);
      assert.equal(sourceLocksAcquired, true);
      assert.equal(accountLockAcquired, true);
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

test('Page share hydrates its successful response inside a signed restricted-context transaction', async () => {
  const actorId = '00000000-0000-4000-8000-000000000010';
  const pageId = '00000000-0000-4000-8000-000000000011';
  const sourceId = '00000000-0000-4000-8000-000000000012';
  const createdId = '00000000-0000-4000-8000-000000000013';
  const page = { id: pageId, ownerId: actorId, name: 'Publisher', handle: 'publisher', avatarMediaId: null,
    publicationState: 'PUBLISHED', platformState: 'NONE', deletionRequestedAt: null, safetyHiddenAt: null, purgedAt: null };
  const source = { id: sourceId, authorId: actorId, pageId: null, sharedFromId: null, sharedCaption: null,
    status: 'PUBLISHED', isDeleted: false, title: 'Source', description: '', category: null, type: 'Poll',
    targetAudience: 'Public', groupId: null, targetedGroups: [], questions: [], expiresAt: null, imageLayout: null,
    pollChoiceType: null, allowAnonymous: false, forceAnonymous: false, allowComments: true,
    allowMultipleSelection: false, allowUserOptions: false, randomPairing: false, resultsWho: null,
    resultsTiming: null, author: { status: 'ACTIVE', allowSharing: true, isPrivate: false, mediaPrivacyTarget: false } };
  const hydrated = { id: createdId, authorId: actorId, pageId, sharedFromId: sourceId, sharedCaption: null,
    title: source.title, description: source.description, category: source.category, type: source.type,
    demographics: [], targetAudience: 'Public', status: 'PUBLISHED', isDeleted: false, questions: [], sections: [],
    media: [], targetedGroups: [], mentions: [], taggedUsers: [], likesCount: 0, sharesCount: 0, responseCount: 0,
    allowAnonymous: false, forceAnonymous: false, allowComments: true, randomPairing: false, coverImage: null,
    author: { id: actorId, name: 'Actor', handle: 'actor', avatar: null, avatarMediaId: null, verifiedBadge: false, isPrivate: false },
    sharedFrom: { ...source, author: { id: actorId, name: 'Actor', handle: 'actor', avatar: null, avatarMediaId: null,
      verifiedBadge: false, isPrivate: false, following: [] }, sections: [], media: [], mentions: [], taggedUsers: [],
      likesCount: 0, sharesCount: 1, responseCount: 0, responses: [], likes: [], shares: [], savedBy: [] } };
  const originals = { postFindUnique: prisma.post.findUnique, postFindMany: prisma.post.findMany,
    postCount: prisma.post.count, postFindFirst: prisma.post.findFirst, query: prisma.$queryRaw,
    transaction: prisma.$transaction, privacy: PrivacyService.canViewUserContent, enabled: process.env.PAGES_ENABLED,
    testUsers: process.env.PAGES_TEST_USERS, keyId: process.env.PAGES_RLS_CONTEXT_KEY_ID,
    signingKey: process.env.PAGES_RLS_CONTEXT_SIGNING_KEY };
  let signedContexts = 0;
  let committedShare = false;
  let restrictedHydration = false;
  const tx: any = {
    $executeRaw: async (query: any) => {
      const sql = Array.isArray(query) ? query.join('') : query?.strings?.join('') || String(query);
      if (sql.includes("set_config('socialinsight.page_context'")) signedContexts += 1;
      return 1;
    },
    $queryRaw: async (query: any) => {
      const sql = Array.isArray(query) ? query.join('') : query?.strings?.join('') || query?.sql || String(query);
      if (sql.includes('pg_backend_pid')) return [{ backendPid: '123', transactionId: String(signedContexts + 1) }];
      if (sql.includes('SELECT p."id"') && sql.includes('FROM "Page" p')) {
        assert.equal(committedShare, true, 'publisher hydration must follow the successful share transaction');
        assert.ok(signedContexts > 0, 'restricted Page reads require a signed transaction context');
        restrictedHydration = true;
        return [{ ...page, _viewerRole: null, _ownerActive: true, _isFollowing: false }];
      }
      if (sql.includes('AS "visible"')) return [{ visible: true }];
      if (sql.includes('FROM "Page"')) return [page];
      if (sql.includes('FROM users')) return [{ id: actorId, status: 'ACTIVE', emailVerifiedAt: new Date() }];
      if (sql.includes('FROM "Post"')) return [{ ...source }];
      return [];
    },
    page: { findUnique: async () => page },
    pageMembership: { findUnique: async () => null },
    pageBlock: { findFirst: async () => null },
    user: { findUnique: async () => ({ id: actorId, status: 'ACTIVE' }) },
    authSession: { findFirst: async () => ({ id: 'session', createdAt: new Date() }) },
    post: {
      findUnique: async () => ({ pageId: null, sharedFrom: null, status: 'PUBLISHED', isDeleted: false, expiresAt: null }),
      findMany: async () => [{ ...source }],
      count: async () => 1,
      findFirst: async ({ where }: any) => where.id === createdId ? hydrated : null,
      create: async () => ({ ...source, id: createdId, pageId, sharedFromId: sourceId }),
      update: async () => ({ ...source, sharesCount: 1 })
    },
    pageAuditEvent: { findUnique: async () => null, create: async () => ({ id: 'audit' }) },
    mention: { findMany: async () => [] },
    postHashtag: { deleteMany: async () => ({ count: 0 }) }
  };
  try {
    process.env.PAGES_ENABLED = 'true';
    process.env.PAGES_TEST_USERS = actorId;
    process.env.PAGES_RLS_CONTEXT_KEY_ID = 'test-key';
    process.env.PAGES_RLS_CONTEXT_SIGNING_KEY = '11'.repeat(32);
    (prisma.post as any).findUnique = async () => source;
    (prisma.post as any).findMany = async () => [{ id: sourceId, authorId: actorId, pageId: null }];
    (prisma.post as any).count = async () => 1;
    (prisma.post as any).findFirst = async () => hydrated;
    // Simulate FORCE RLS: an unsigned pooled read cannot see this test fixture.
    (prisma as any).$queryRaw = async () => [];
    (PrivacyService as any).canViewUserContent = async () => true;
    (prisma as any).$transaction = async (work: any) => {
      const result = await work(tx);
      if (result?.newPost?.id === createdId) committedShare = true;
      return result;
    };
    let status = 200;
    let body: any;
    const response: any = { status(code: number) { status = code; return this; }, json(value: any) { body = value; return this; } };
    await runWithPageDatabaseContext(pageRequestDatabaseContext(actorId), () => sharePost({
      params: { id: sourceId }, user: { userId: actorId, authMode: 'session' },
      authSession: { id: 'session', userId: actorId },
      body: { pageId, pageCreateKey: '00000000-0000-4000-8000-000000000019' }
    } as any, response));
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.id, createdId);
    assert.equal(restrictedHydration, true);
  } finally {
    (prisma.post as any).findUnique = originals.postFindUnique;
    (prisma.post as any).findMany = originals.postFindMany;
    (prisma.post as any).count = originals.postCount;
    (prisma.post as any).findFirst = originals.postFindFirst;
    (prisma as any).$queryRaw = originals.query;
    (prisma as any).$transaction = originals.transaction;
    (PrivacyService as any).canViewUserContent = originals.privacy;
    for (const [name, value] of Object.entries({ PAGES_ENABLED: originals.enabled, PAGES_TEST_USERS: originals.testUsers,
      PAGES_RLS_CONTEXT_KEY_ID: originals.keyId, PAGES_RLS_CONTEXT_SIGNING_KEY: originals.signingKey })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
