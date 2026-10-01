// Runs only against the disposable GitHub Actions PostgreSQL service.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Writable } = require('node:stream');
const { PrismaClient } = require('../server/node_modules/@prisma/client');
const { purgeAccount } = require('../server/dist/services/accountErasureService');
const { exportAccount } = require('../server/dist/controllers/accountLifecycleController');
const { admitPagePurges, processPagePurgeBatch } = require('../server/dist/pages/pageLifecycleWorker');
const { searchAll } = require('../server/dist/controllers/searchController');
const { getDrafts } = require('../server/dist/controllers/postController');
const { pageContent } = require('../server/dist/pages/pageContentService');

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
let stage = 'seed';
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
  stage = 'active-page-requires-owner';
  await assert.rejects(db.page.update({ where: { id: pageId }, data: { ownerId: null } }));
  assert.equal((await db.page.findUniqueOrThrow({ where: { id: pageId } })).ownerId, ownerId);
  await db.mediaAsset.createMany({ data: [
    { id: pageMediaId, ownerId, pageId, purpose: 'PROFILE_AVATAR', status: 'ATTACHED', accessScope: 'RESTRICTED' },
    { id: formerPageMediaId, ownerId: formerId, pageId, purpose: 'POST', status: 'ATTACHED', accessScope: 'RESTRICTED' },
    { id: personalMediaId, ownerId: formerId, purpose: 'PROFILE_AVATAR', status: 'ATTACHED', accessScope: 'OWNER_ONLY' }
  ] });
  await db.page.update({ where: { id: pageId }, data: { avatarMediaId: pageMediaId } });
  stage = 'create-drafts';
  await db.post.createMany({ data: [
    { id: pageDraftId, authorId: formerId, pageId, title: 'Synthetic Page draft', description: 'Page-owned text', type: 'Poll', status: 'DRAFT', expiresAt: new Date(Date.now() + 86400000) },
    { id: personalDraftId, authorId: formerId, title: 'Synthetic personal draft', description: 'Personal text', type: 'Poll', status: 'DRAFT', expiresAt: new Date(Date.now() + 86400000) },
  ] });
  stage = 'owner-confirmation';
  await assert.rejects(erase(ownerId, []), error => error?.code === 'PAGE_ACCOUNT_DELETION_CHOICE_REQUIRED');
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: ownerId } })).status, 'ACTIVE');
  assert.equal((await db.page.findUniqueOrThrow({ where: { id: pageId } })).publicationState, 'PUBLISHED');

  // Revocation never transfers the asset back into personal erasure scope.
  await db.pageMembership.create({ data: { pageId, userId: formerId, role: 'EDITOR' } });
  await db.pageMembership.delete({ where: { pageId_userId: { pageId, userId: formerId } } });
  const chunks = [];
  stage = 'export-revoked-editor';
  const exportResponse = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  exportResponse.set = () => exportResponse;
  await exportAccount({ user: { userId: formerId } }, exportResponse);
  const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  stage = 'export-excludes-page-draft';
  assert.ok(!exported.posts.some(post => post.id === pageDraftId));
  stage = 'export-excludes-page-media';
  assert.ok(!exported.media.some(asset => asset.id === formerPageMediaId));
  stage = 'export-keeps-personal-draft';
  assert.ok(exported.posts.some(post => post.id === personalDraftId));
  stage = 'export-keeps-personal-media';
  assert.ok(exported.media.some(asset => asset.id === personalMediaId));
  const staffCaseId = randomUUID(), heldCaseId = randomUUID(), cursorEventId = randomUUID();
  await db.pageCase.create({ data: { id: staffCaseId, pageId, reporterId: ownerId,
    assigneeId: formerId, status: 'CLOSED', closedAt: new Date(), reason: 'owner@example.test synthetic report',
    evidence: [{ actorId: formerId, text: 'Synthetic staff evidence' }] } });
  await db.pageCase.create({ data: { id: heldCaseId, pageId, reporterId: ownerId,
    status: 'CLOSED', closedAt: new Date(), legalHoldUntil: new Date(Date.now() + 86400000),
    reason: 'Synthetic held reason', detail: 'Synthetic held evidence', evidence: [{ text: 'Synthetic held evidence' }] } });
  await db.pageEvent.create({ data: { id: cursorEventId, pageId, recipientId: ownerId,
    kind: 'PAGE_ACTIVITY', targetId: pageDraftId, dedupeKey: `cursor:${suffix}`,
    context: { kind: 'like', actorId: ownerId, cursor: formerId } } });
  const invitationId = randomUUID(), transferId = randomUUID();
  await db.pageInvitation.create({ data: { id: invitationId, pageId, senderId: ownerId,
    recipientId: formerId, role: 'EDITOR', expiresAt: new Date(Date.now() + 86400000) } });
  await db.pageOwnershipTransfer.create({ data: { id: transferId, pageId, senderId: ownerId,
    recipientId: formerId, expiresAt: new Date(Date.now() + 86400000) } });
  stage = 'erase-former-editor';
  await erase(formerId, []);
  stage = 'retain-page-draft';
  assert.ok(await db.post.findUnique({ where: { id: pageDraftId } }));
  assert.equal(await db.post.findUnique({ where: { id: personalDraftId } }), null);
  assert.equal((await db.mediaAsset.findUniqueOrThrow({ where: { id: formerPageMediaId } })).status, 'ATTACHED');
  assert.equal((await db.mediaAsset.findUniqueOrThrow({ where: { id: personalMediaId } })).status, 'PENDING_DELETE');
  assert.deepEqual((await db.accountCleanupJob.findUniqueOrThrow({ where: { userId: formerId } })).mediaIds, [personalMediaId]);
  stage = 'erased-account-page-identifiers';
  const staffCase = await db.pageCase.findUniqueOrThrow({ where: { id: staffCaseId } });
  assert.equal(staffCase.assigneeId, null);
  assert.deepEqual(staffCase.evidence, [{ text: 'Synthetic staff evidence' }]);
  assert.equal((await db.pageEvent.findUniqueOrThrow({ where: { id: cursorEventId } })).context.cursor, undefined);
  assert.equal(await db.pageInvitation.findUnique({ where: { id: invitationId } }), null);
  assert.equal(await db.pageOwnershipTransfer.findUnique({ where: { id: transferId } }), null);

  stage = 'erase-page-owner';
  const auditId = randomUUID();
  await db.pageAuditEvent.create({ data: { id: auditId, pageId, actorId: ownerId,
    targetId: ownerId, action: 'SYNTHETIC_AUDIT' } });
  await erase(ownerId, [pageId]);
  stage = 'owner-page-state';
  const page = await db.page.findUniqueOrThrow({ where: { id: pageId } });
  assert.equal(page.publicationState, 'UNPUBLISHED');
  assert.ok(page.deletionRequestedAt);
  assert.ok(page.safetyHiddenAt);
  assert.equal((await db.mediaAsset.findUniqueOrThrow({ where: { id: pageMediaId } })).status, 'ATTACHED');
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: ownerId } })).status, 'DELETED');
  const redactedCase = await db.pageCase.findUniqueOrThrow({ where: { id: staffCaseId } });
  assert.notEqual(redactedCase.reporterId, ownerId);
  assert.equal(redactedCase.reason, 'Report from a deleted account');
  const heldCase = await db.pageCase.findUniqueOrThrow({ where: { id: heldCaseId } });
  assert.notEqual(heldCase.reporterId, ownerId);
  assert.equal(heldCase.detail, 'Synthetic held evidence');
  assert.deepEqual(heldCase.evidence, [{ text: 'Synthetic held evidence' }]);
  assert.deepEqual(await db.pageAuditEvent.findUnique({ where: { id: auditId }, select: { actorId: true, targetId: true } }),
    { actorId: null, targetId: null });
  const anonymousOwnerId = randomUUID(), analystId = randomUUID(), expiredPageId = randomUUID(), otherPageId = randomUUID(), expiredHandle = `old_${suffix}`;
  await db.user.createMany({ data: [
    { id: anonymousOwnerId, name: 'Synthetic purge owner', handle: `purge_${suffix}` },
    { id: analystId, name: 'Synthetic Page analyst', handle: `analyst_${suffix}` }
  ] });
  await db.page.create({ data: { id: expiredPageId, ownerId: anonymousOwnerId, handle: expiredHandle,
    name: 'Synthetic expired Page', category: 'company', bio: 'Will be erased',
    publicationState: 'UNPUBLISHED', representationAt: new Date(), createRequestId: randomUUID(),
    deletionRequestedAt: new Date(Date.now() - 31 * 86400000) } });
  await db.pageHandle.create({ data: { pageId: expiredPageId, handle: `past_${suffix}` } });
  await db.page.create({ data: { id: otherPageId, ownerId: anonymousOwnerId, handle: `other_${suffix}`,
    name: 'Synthetic other Page', category: 'company', publicationState: 'PUBLISHED',
    representationAt: new Date(), createRequestId: randomUUID() } });
  await db.pageMembership.create({ data: { pageId: otherPageId, userId: analystId, role: 'ANALYST' } });
  const expiredPostId = randomUUID(), expiredCommentId = randomUUID(), expiredCaseId = randomUUID(), cycleCaseId = randomUUID(), expiredReportId = randomUUID(), shareReportId = randomUUID();
  const copiedTitle = `Synthetic old Page post ${suffix}`;
  await db.post.create({ data: { id: expiredPostId, pageId: expiredPageId, authorId: anonymousOwnerId,
    title: copiedTitle, description: 'Erase this', resultsDetail: 'Private result text',
    type: 'Poll', expiresAt: new Date(Date.now() + 86400000) } });
  const externalShareId = randomUUID(), externalReshareId = randomUUID(), editedShareId = randomUUID(), otherPageShareId = randomUUID();
  await db.post.create({ data: { id: externalShareId, authorId: anonymousOwnerId, sharedFromId: expiredPostId,
    title: copiedTitle, description: 'Erase this', sharedCaption: 'Independent user commentary',
    sharedCopiedTitle: copiedTitle, sharedCopiedDescription: 'Erase this', sharedRootPageId: expiredPageId,
    type: 'Poll', expiresAt: new Date(Date.now() + 86400000) } });
  await db.post.create({ data: { id: externalReshareId, authorId: anonymousOwnerId, sharedFromId: externalShareId,
    title: copiedTitle, description: 'Erase this', sharedCaption: 'Second independent commentary',
    sharedCopiedTitle: copiedTitle, sharedCopiedDescription: 'Erase this', sharedRootPageId: expiredPageId,
    type: 'Poll', expiresAt: new Date(Date.now() + 86400000) } });
  await db.post.create({ data: { id: editedShareId, authorId: anonymousOwnerId, sharedFromId: expiredPostId,
    title: 'Independent edited share title', description: 'Erase this', sharedCaption: 'Independent edited commentary',
    sharedCopiedTitle: copiedTitle, sharedCopiedDescription: 'Erase this', sharedRootPageId: expiredPageId,
    type: 'Poll', expiresAt: new Date(Date.now() + 86400000) } });
  await db.post.create({ data: { id: otherPageShareId, pageId: otherPageId, authorId: anonymousOwnerId,
    sharedFromId: expiredPostId, title: copiedTitle, description: 'Erase this',
    sharedCaption: 'Other Page commentary', sharedCopiedTitle: copiedTitle,
    sharedCopiedDescription: 'Erase this', sharedRootPageId: expiredPageId,
    type: 'Poll', expiresAt: new Date(Date.now() + 86400000) } });
  await db.report.create({ data: { id: shareReportId, reporterId: anonymousOwnerId, targetType: 'POST', targetId: externalShareId,
    reason: 'Synthetic share report', targetSnapshot: { title: copiedTitle, description: 'Erase this' } } });
  stage = 'hidden-page-reshare-search';
  let searchStatus = 200, searchBody;
  const searchResponse = { status(code) { searchStatus = code; return this; }, json(body) { searchBody = body; return this; } };
  await searchAll({ query: { q: copiedTitle } }, searchResponse);
  assert.equal(searchStatus, 200);
  assert.equal(searchBody.surveys.some(post => post.id === externalReshareId), false);
  stage = 'other-page-analyst-hidden-source';
  const managedBefore = await pageContent(otherPageId, analystId, { limit: 10, status: 'PUBLISHED' });
  const managedShareBefore = managedBefore.items.find(post => post.id === otherPageShareId);
  assert.deepEqual([managedShareBefore.title, managedShareBefore.description, managedShareBefore.sharedCaption],
    ['', '', 'Other Page commentary']);
  assert.equal(managedShareBefore.sharedCopiedTitle, undefined);
  stage = 'hidden-page-share-export-redacted';
  const shareExportChunks = [];
  const shareExportResponse = new Writable({ write(chunk, _encoding, callback) { shareExportChunks.push(Buffer.from(chunk)); callback(); } });
  shareExportResponse.set = () => shareExportResponse;
  await exportAccount({ user: { userId: anonymousOwnerId } }, shareExportResponse);
  const shareExport = JSON.parse(Buffer.concat(shareExportChunks).toString('utf8'));
  const exportedShare = shareExport.posts.find(post => post.id === externalShareId);
  const exportedEditedShare = shareExport.posts.find(post => post.id === editedShareId);
  assert.deepEqual([exportedShare.title, exportedShare.description, exportedShare.sharedCaption],
    ['', '', 'Independent user commentary']);
  assert.deepEqual([exportedEditedShare.title, exportedEditedShare.description],
    ['Independent edited share title', '']);
  stage = 'hidden-page-share-draft-redacted';
  await db.post.update({ where: { id: editedShareId }, data: { status: 'DRAFT' } });
  let draftStatus = 200, draftBody;
  const draftResponse = { status(code) { draftStatus = code; return this; }, json(body) { draftBody = body; return this; }, setHeader() {} };
  await getDrafts({ user: { userId: anonymousOwnerId }, query: {} }, draftResponse);
  assert.equal(draftStatus, 200);
  const safeDraft = draftBody.find(post => post.id === editedShareId);
  assert.deepEqual([safeDraft.title, safeDraft.description], ['Independent edited share title', '']);
  assert.equal(safeDraft.sharedCopiedTitle, undefined);
  await db.comment.create({ data: { id: expiredCommentId, postId: expiredPostId, userId: anonymousOwnerId, text: 'Synthetic Page comment' } });
  await db.report.create({ data: { id: expiredReportId, reporterId: anonymousOwnerId, targetType: 'COMMENT', targetId: expiredCommentId,
    reason: 'Synthetic test', targetSnapshot: { text: 'Synthetic Page comment' } } });
  await db.pageCase.create({ data: { id: expiredCaseId, pageId: expiredPageId, reporterId: anonymousOwnerId,
    reason: 'Synthetic test', detail: 'Case evidence to erase', evidence: ['synthetic'], status: 'OPEN' } });
  stage = 'open-case-blocks-purge';
  assert.equal(await admitPagePurges(10), 0);
  await db.pageCase.update({ where: { id: expiredCaseId }, data: {
    status: 'CLOSED', closedAt: new Date(Date.now() - 181 * 86400000) } });
  await db.pageCase.create({ data: { id: cycleCaseId, pageId: expiredPageId, parentId: expiredCaseId,
    reporterId: anonymousOwnerId, reason: 'Synthetic cycle test', detail: 'Erase cycle evidence',
    status: 'CLOSED', closedAt: new Date(Date.now() - 181 * 86400000) } });
  await db.pageCase.update({ where: { id: expiredCaseId }, data: { parentId: cycleCaseId } });
  stage = 'admit-expired-page-purge';
  assert.equal(await admitPagePurges(10), 1);
  let purgeState;
  stage = 'process-expired-page-purge';
  for (let attempt = 0; attempt < 100; attempt++) {
    purgeState = (await processPagePurgeBatch(expiredPageId)).state;
    if (purgeState === 'completed') break;
  }
  stage = 'expired-page-purge-completion';
  if (purgeState !== 'completed') {
    const job = await db.pagePurgeJob.findUnique({ where: { pageId: expiredPageId }, select: { phase: true, attempts: true, lastErrorCode: true } });
    throw new Error(`PAGE_PURGE_INCOMPLETE:${purgeState}:${job?.phase}:${job?.attempts}:${job?.lastErrorCode}`);
  }
  const erasedPage = await db.page.findUniqueOrThrow({ where: { id: expiredPageId } });
  stage = 'detached-owner';
  assert.equal(erasedPage.ownerId, null);
  stage = 'anonymized-handle';
  assert.ok(erasedPage.handle.startsWith('deleted_'));
  assert.match(erasedPage.handle, /^deleted_[a-f0-9]{22}$/);
  assert.notEqual(erasedPage.handle, expiredHandle);
  assert.equal(await db.pageHandle.count({ where: { pageId: expiredPageId } }), 0);
  stage = 'purge-erases-case-and-comment-report';
  assert.equal(await db.pageCase.count({ where: { pageId: expiredPageId } }), 0);
  assert.equal(await db.report.count({ where: { id: expiredReportId } }), 0);
  assert.equal((await db.report.findUniqueOrThrow({ where: { id: shareReportId } })).targetSnapshot, null);
  stage = 'other-page-analyst-after-purge';
  const managedAfter = await pageContent(otherPageId, analystId, { limit: 10, status: 'PUBLISHED' });
  const managedShareAfter = managedAfter.items.find(post => post.id === otherPageShareId);
  assert.deepEqual([managedShareAfter.title, managedShareAfter.description], ['', '']);
  assert.equal(managedShareAfter.sharedCopiedTitle, undefined);
  stage = 'external-share-keeps-anonymous-source-tombstone';
  const tombstone = await db.post.findUniqueOrThrow({ where: { id: expiredPostId } });
  assert.equal(tombstone.isDeleted, true);
  assert.deepEqual([tombstone.title, tombstone.description, tombstone.resultsDetail], ['', '', null]);
  assert.notEqual(tombstone.authorId, anonymousOwnerId);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: tombstone.authorId } })).status, 'DELETED');
  const share = await db.post.findUniqueOrThrow({ where: { id: externalShareId } });
  const reshare = await db.post.findUniqueOrThrow({ where: { id: externalReshareId } });
  const editedShare = await db.post.findUniqueOrThrow({ where: { id: editedShareId } });
  assert.deepEqual([share.sharedFromId, share.title, share.description, share.sharedCaption],
    [expiredPostId, '', '', 'Independent user commentary']);
  assert.deepEqual([reshare.sharedFromId, reshare.title, reshare.description, reshare.sharedCaption],
    [externalShareId, '', '', 'Second independent commentary']);
  assert.deepEqual([editedShare.title, editedShare.description, editedShare.sharedCaption],
    ['Independent edited share title', '', 'Independent edited commentary']);
  for (const post of [share, reshare, editedShare]) {
    assert.deepEqual([post.sharedCopiedTitle, post.sharedCopiedDescription, post.sharedCopiedCategory], [null, null, null]);
  }
  process.stdout.write(JSON.stringify({ result: 'PASS', scenarios: ['missing-owner-confirmation', 'former-editor-media-retained',
    'personal-media-journaled', 'revoked-editor-export-excludes-page', 'former-editor-page-draft-retained', 'personal-draft-erased',
    'erased-account-case-and-cursor-identifiers', 'held-case-evidence-retained-without-reporter-id',
    'owner-page-hidden-with-grace', 'owner-page-media-retained', 'open-case-blocks-purge',
    'completed-purge-detaches-identifiers', 'purge-erases-case-and-comment-report', 'purge-breaks-case-cycle',
    'external-share-keeps-anonymous-source-tombstone', 'external-share-chain-copied-text-erased',
    'edited-share-title-preserved', 'external-share-provenance-erased', 'external-share-report-snapshot-erased',
    'hidden-page-reshare-excluded-from-search-before-purge', 'hidden-page-share-export-redacted',
    'hidden-page-share-draft-redacted', 'other-page-analyst-source-redacted-before-and-after-purge'] }) + '\n');
})().catch(error => { process.stderr.write(`${stage}: ${error?.message?.startsWith('PAGE_PURGE_INCOMPLETE:') ? error.message : error?.name || 'Error'}: ${error?.code || 'CHECK_FAILED'}\n`); process.exitCode = 1; })
  .finally(() => db.$disconnect());
