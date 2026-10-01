// Runs only against the disposable GitHub Actions PostgreSQL service.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Writable } = require('node:stream');
const { PrismaClient } = require('../server/node_modules/@prisma/client');
const { purgeAccount } = require('../server/dist/services/accountErasureService');
const { exportAccount } = require('../server/dist/controllers/accountLifecycleController');
const { admitPagePurges, processPagePurgeBatch } = require('../server/dist/pages/pageLifecycleWorker');

const target = new URL(process.env.DATABASE_URL || 'http://invalid');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.PAGES_EPHEMERAL_ERASURE_TEST, 'true');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(target.protocol, 'postgresql:');
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.pathname, '/postgres');

const db = new PrismaClient();
const suffix = randomUUID().replace(/-/g, '').slice(0, 16);
const ownerId = randomUUID(), formerId = randomUUID(), pageId = randomUUID();
const pageMediaId = randomUUID(), formerPageMediaId = randomUUID(), personalMediaId = randomUUID();
const pageDraftId = randomUUID(), personalDraftId = randomUUID();
const handle = `erasure_${suffix}`;
const erase = (userId, deleteOwnedPages) => db.$transaction(
  tx => purgeAccount(tx, userId, { decisionId: randomUUID(), deleteOwnedPages }),
  { isolationLevel: 'Serializable', timeout: 20_000 });

(async () => {
  await db.user.createMany({ data: [
    { id: ownerId, name: 'Synthetic Page owner', handle: `owner_${suffix}` },
    { id: formerId, name: 'Synthetic former editor', handle: `editor_${suffix}` }
  ] });
  await db.page.create({ data: { id: pageId, ownerId, handle, name: 'Synthetic erasure Page',
    category: 'company', bio: 'Synthetic test only', publicationState: 'PUBLISHED',
    representationAt: new Date(), createRequestId: randomUUID() } });
  await db.mediaAsset.createMany({ data: [
    { id: pageMediaId, ownerId, pageId, purpose: 'PROFILE_AVATAR', status: 'ATTACHED', accessScope: 'RESTRICTED' },
    { id: formerPageMediaId, ownerId: formerId, pageId, purpose: 'POST', status: 'ATTACHED', accessScope: 'RESTRICTED' },
    { id: personalMediaId, ownerId: formerId, purpose: 'PROFILE_AVATAR', status: 'ATTACHED', accessScope: 'OWNER_ONLY' }
  ] });
  await db.page.update({ where: { id: pageId }, data: { avatarMediaId: pageMediaId } });
  await db.post.createMany({ data: [
    { id: pageDraftId, authorId: formerId, pageId, title: 'Synthetic Page draft', description: 'Page-owned text', type: 'Poll', status: 'DRAFT', expiresAt: new Date(Date.now() + 86400000) },
    { id: personalDraftId, authorId: formerId, title: 'Synthetic personal draft', description: 'Personal text', type: 'Poll', status: 'DRAFT', expiresAt: new Date(Date.now() + 86400000) },
  ] });
  await assert.rejects(erase(ownerId, []), error => error?.code === 'PAGE_ACCOUNT_DELETION_CHOICE_REQUIRED');
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: ownerId } })).status, 'ACTIVE');
  assert.equal((await db.page.findUniqueOrThrow({ where: { id: pageId } })).publicationState, 'PUBLISHED');

  // Revocation never transfers the asset back into personal erasure scope.
  await db.pageMembership.create({ data: { pageId, userId: formerId, role: 'EDITOR' } });
  await db.pageMembership.delete({ where: { pageId_userId: { pageId, userId: formerId } } });
  const chunks = [];
  const exportResponse = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  exportResponse.set = () => exportResponse;
  await exportAccount({ user: { userId: formerId } }, exportResponse);
  const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.ok(!exported.posts.some(post => post.id === pageDraftId));
  assert.ok(!exported.media.some(asset => asset.id === formerPageMediaId));
  assert.ok(exported.posts.some(post => post.id === personalDraftId));
  assert.ok(exported.media.some(asset => asset.id === personalMediaId));
  await erase(formerId, []);
  assert.ok(await db.post.findUnique({ where: { id: pageDraftId } }));
  assert.equal(await db.post.findUnique({ where: { id: personalDraftId } }), null);
  assert.equal((await db.mediaAsset.findUniqueOrThrow({ where: { id: formerPageMediaId } })).status, 'ATTACHED');
  assert.equal((await db.mediaAsset.findUniqueOrThrow({ where: { id: personalMediaId } })).status, 'PENDING_DELETE');
  assert.deepEqual((await db.accountCleanupJob.findUniqueOrThrow({ where: { userId: formerId } })).mediaIds, [personalMediaId]);

  await erase(ownerId, [pageId]);
  const page = await db.page.findUniqueOrThrow({ where: { id: pageId } });
  assert.equal(page.publicationState, 'UNPUBLISHED');
  assert.ok(page.deletionRequestedAt);
  assert.ok(page.safetyHiddenAt);
  assert.equal((await db.mediaAsset.findUniqueOrThrow({ where: { id: pageMediaId } })).status, 'ATTACHED');
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: ownerId } })).status, 'DELETED');
  const anonymousOwnerId = randomUUID(), expiredPageId = randomUUID(), expiredHandle = `old_${suffix}`;
  await db.user.create({ data: { id: anonymousOwnerId, name: 'Synthetic purge owner', handle: `purge_${suffix}` } });
  await db.page.create({ data: { id: expiredPageId, ownerId: anonymousOwnerId, handle: expiredHandle,
    name: 'Synthetic expired Page', category: 'company', bio: 'Will be erased',
    publicationState: 'UNPUBLISHED', representationAt: new Date(), createRequestId: randomUUID(),
    deletionRequestedAt: new Date(Date.now() - 31 * 86400000) } });
  await db.pageHandle.create({ data: { pageId: expiredPageId, handle: `past_${suffix}` } });
  assert.equal(await admitPagePurges(10), 1);
  let purgeState;
  for (let attempt = 0; attempt < 100; attempt++) {
    purgeState = (await processPagePurgeBatch(expiredPageId)).state;
    if (purgeState === 'completed') break;
  }
  assert.equal(purgeState, 'completed');
  const erasedPage = await db.page.findUniqueOrThrow({ where: { id: expiredPageId } });
  assert.equal(erasedPage.ownerId, null);
  assert.ok(erasedPage.handle.startsWith('deleted_'));
  assert.notEqual(erasedPage.handle, expiredHandle);
  assert.equal(await db.pageHandle.count({ where: { pageId: expiredPageId } }), 0);
  process.stdout.write(JSON.stringify({ result: 'PASS', scenarios: ['missing-owner-confirmation', 'former-editor-media-retained',
    'personal-media-journaled', 'revoked-editor-export-excludes-page', 'former-editor-page-draft-retained', 'personal-draft-erased',
    'owner-page-hidden-with-grace', 'owner-page-media-retained', 'completed-purge-detaches-identifiers'] }) + '\n');
})().catch(error => { process.stderr.write(`${error?.name || 'Error'}: ${error?.code || 'CHECK_FAILED'}\n`); process.exitCode = 1; })
  .finally(() => db.$disconnect());
