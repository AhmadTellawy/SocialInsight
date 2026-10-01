// Runs only against the disposable GitHub Actions PostgreSQL service.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('../server/node_modules/@prisma/client');
const { purgeAccount } = require('../server/dist/services/accountErasureService');

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
  await assert.rejects(erase(ownerId, []), error => error?.code === 'PAGE_ACCOUNT_DELETION_CHOICE_REQUIRED');
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: ownerId } })).status, 'ACTIVE');
  assert.equal((await db.page.findUniqueOrThrow({ where: { id: pageId } })).publicationState, 'PUBLISHED');

  // Revocation never transfers the asset back into personal erasure scope.
  await db.pageMembership.create({ data: { pageId, userId: formerId, role: 'EDITOR' } });
  await db.pageMembership.delete({ where: { pageId_userId: { pageId, userId: formerId } } });
  await erase(formerId, []);
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
  process.stdout.write(JSON.stringify({ result: 'PASS', scenarios: ['missing-owner-confirmation', 'former-editor-media-retained',
    'personal-media-journaled', 'owner-page-hidden-with-grace', 'owner-page-media-retained'] }) + '\n');
})().catch(error => { process.stderr.write(`${error?.name || 'Error'}: ${error?.code || 'CHECK_FAILED'}\n`); process.exitCode = 1; })
  .finally(() => db.$disconnect());
