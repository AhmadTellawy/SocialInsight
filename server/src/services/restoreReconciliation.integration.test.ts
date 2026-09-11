import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { purgeAccount } from './accountErasureService';
import { captureSnapshot, canonical, CaptureReceipt, decryptArtifact, encryptArtifact, executeErasure, replaySnapshot, RestoreReceipt, sha256, validateSnapshot, validateTarget } from './restoreReconciliationService';

// Dedicated database is prepared using the reviewed migrations. No shared or
// hosted target, database drop/reset, or fixture cleanup of other tasks.
const target = { environment: 'LOCAL_SYNTHETIC' as const, projectRef: 'local-settings-test', host: '127.0.0.1', port: 55447, database: 'restore_reconciliation_test', username: 'postgres' };
const url = validateTarget(target, { RECONCILIATION_ENVIRONMENT: target.environment, RECONCILIATION_PROJECT_REF: target.projectRef, RECONCILIATION_DATABASE_URL: process.env.RECONCILIATION_DATABASE_URL });
const db = new PrismaClient({ datasources: { db: { url } }, log: [] });
const evidence = { reference: 'SYNTHETIC-LOCAL-OBSERVATION', sha256: 'a'.repeat(64) };
const iso = (n: number) => new Date(n).toISOString();

test('actual PostgreSQL capture and replay erase resurrected credentials, preserve aliases, delete orphan storage and block ownerless groups', { timeout: 120_000 }, async () => {
  const userId = randomUUID(), assetId = randomUUID(), orphanAsset = randomUUID(), groupId = randomUUID();
  const handle = `r${randomBytes(6).toString('hex')}`, newerHandle = `${handle}_new`;
  const decisionId = `restore-test:${userId}`;
  const before = Date.now();
  try {
    await db.user.create({ data: { id: userId, name: 'Synthetic restore', handle, email: `${userId}@example.invalid`, passwordHash: 'synthetic-only-not-login', status: 'ACTIVE' } });
    await db.handleAlias.createMany({ data: [{ handle, userId }, { handle: newerHandle, userId }] });
    await db.mediaAsset.create({ data: { id: assetId, ownerId: userId, purpose: 'POST', status: 'ATTACHED', sourceMime: 'image/png', uploadBucket: 'media-originals', uploadKey: `${userId}/${assetId}/source.png` } });
    await db.group.create({ data: { id: groupId, name: 'Synthetic ownership', description: 'Restore fixture', category: 'test', memberCount: 1 } });
    await db.groupMember.create({ data: { groupId, userId, role: 'Owner', status: 'JOINED' } });
    const erased = await db.$transaction(tx => purgeAccount(tx, userId, { decisionId }), { timeout: 60_000 });
    assert.ok(erased.unresolvedGroupIds.includes(groupId));
    // An orphan object whose metadata is absent after restore must still be
    // represented by a terminal decision retained by the source journal.
    const { appendDeletionDecision, mediaPurgeDecision } = await import('./deletionJournalService');
    await db.$transaction(tx => appendDeletionDecision(tx, mediaPurgeDecision({ assetId: orphanAsset, objects: [{ bucket: 'media-private', key: `${userId}/${orphanAsset}/large.webp` }], deleteNotBefore: null })));
    const cutoff = Date.now();
    const receipt: CaptureReceipt = { version: 1, purpose: 'CAPTURE', target, sourceRevision: 'b'.repeat(40), issuedAt: iso(cutoff), expiresAt: iso(cutoff + 3600000),
      fence: { id: 'synthetic-fence', stoppedAt: iso(before), drainedAt: iso(cutoff), protectedThrough: iso(cutoff + 3600000), writerInventory: evidence, providerStop: evidence, databaseDrain: evidence, storageWriterDrain: evidence }, independentReview: evidence,
      coverage: { baselineAt: iso(before), journalEnabledAt: iso(before), finalSourceCutoff: iso(cutoff), baselineEvidence: evidence, continuousCoverageEvidence: evidence },
      protectedStore: { locationSha256: 'c'.repeat(64), independentOfProject: true, evidence } };
    const source = await captureSnapshot(db, receipt, 'd'.repeat(64));
    assert.ok(source.deletedAccounts.some(row => row.id === userId));
    assert.ok(source.decisions.some(row => row.id === decisionId));
    assert.ok(source.aliases.some(row => row.handle === newerHandle && row.userId === null));
    assert.equal(source.counts.decisions, await db.deletionDecision.count());
    const key = randomBytes(32), artifact = validateSnapshot(decryptArtifact(encryptArtifact(source, key), key));
    assert.equal(canonical(source), canonical(artifact));
    // Reproduce old backup rows while retaining immutable source journal. This
    // is a row-state restoration rehearsal, not a provider backup restore.
    await db.user.update({ where: { id: userId }, data: { status: 'ACTIVE', deletedAt: null, handle, name: 'Resurrected fixture', email: `${userId}@example.invalid`, passwordHash: 'restored-credential' } });
    await db.authSession.create({ data: { userId, tokenHash: randomBytes(32).toString('hex'), csrfHash: randomBytes(32).toString('hex'), expiresAt: new Date(cutoff + 3600000) } });
    await db.handleAlias.update({ where: { handle }, data: { userId } });
    await db.handleAlias.delete({ where: { handle: newerHandle } });
    await db.groupMember.create({ data: { groupId, userId, role: 'Owner', status: 'JOINED' } });
    const { purpose: _purpose, coverage: _coverage, protectedStore: _store, ...shared } = receipt;
    const restore: RestoreReceipt = { ...shared, issuedAt: iso(Date.now()), purpose: 'RESTORE', artifactSha256: sha256(canonical(artifact)), sourceCaptureReceiptSha256: artifact.captureReceiptSha256,
      finalSourceCutoff: artifact.coverage.finalSourceCutoff, finalCoverageEvidence: evidence, backup: { id: 'synthetic-row-backup', capturedAt: iso(before), projectRef: target.projectRef, evidence }, independentSource: { locationSha256: 'c'.repeat(64), independentOfProject: true, evidence } };
    const restoreBytes = Buffer.from(JSON.stringify(restore));
    validateReceipt(restoreBytes, sha256(restoreBytes), 'RESTORE');
    const removed: Array<{ bucket: string; keys: string[] }> = [], checkpoints: any[] = [];
    const dependencies = { remove: async (bucket: string, keys: string[]) => { removed.push({ bucket, keys }); }, checkpoint: async (value: unknown) => { checkpoints.push(value); } };
    const journalCountBeforeDryRun = await db.deletionDecision.count();
    assert.equal((await replaySnapshot(db, artifact, restore, false, dependencies)).status, 'DRY_RUN');
    assert.equal(await db.deletionDecision.count(), journalCountBeforeDryRun); assert.equal(removed.length, 0); assert.equal(checkpoints.length, 0);
    const first = await replaySnapshot(db, artifact, restore, true, dependencies);
    assert.equal(first.status, 'BLOCKED'); assert.ok(first.unresolvedGroupIds.includes(groupId));
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    assert.equal(user.status, 'DELETED'); assert.equal(user.email, null); assert.equal(user.passwordHash, null); assert.equal(await db.authSession.count({ where: { userId } }), 0);
    assert.equal((await db.handleAlias.findUniqueOrThrow({ where: { handle: newerHandle } })).userId, null);
    assert.ok(removed.some(call => call.bucket === 'media-private' && call.keys.includes(`${userId}/${orphanAsset}/large.webp`)));
    assert.equal((await db.mediaAsset.findUniqueOrThrow({ where: { id: assetId } })).status, 'DELETED');
    const countAfterFirst = await db.deletionDecision.count();
    const second = await replaySnapshot(db, artifact, restore, true, dependencies);
    assert.equal(second.status, 'BLOCKED'); assert.ok(second.unresolvedGroupIds.includes(groupId)); assert.equal(await db.deletionDecision.count(), countAfterFirst);
    assert.ok(checkpoints.some(item => item.phase === 'COMPLETE' && item.result.unresolvedGroupIds.includes(groupId)));
  } finally { await db.$disconnect(); }
});
import { validateReceipt } from './restoreReconciliationService';
test('actual PostgreSQL operator erasure uses stable request ID and remains idempotent', { timeout: 60_000 }, async () => {
  const userId = randomUUID(), decisionId = `verified-request:${randomUUID()}`;
  const start = Date.now();
  const receipt = { version: 1 as const, purpose: 'ACCOUNT_ERASE' as const, target, sourceRevision: 'b'.repeat(40), issuedAt: iso(start), expiresAt: iso(start + 3600000),
    fence: { id: 'synthetic-operator-fence', stoppedAt: iso(start), drainedAt: iso(start), protectedThrough: iso(start + 3600000), writerInventory: evidence, providerStop: evidence, databaseDrain: evidence, storageWriterDrain: evidence }, independentReview: evidence,
    subjectId: userId, decisionId, privacyRequest: { id: 'synthetic-request', scope: 'ACCOUNT_ERASE' as const, verifiedAt: iso(start), verificationEvidence: evidence, authorityEvidence: evidence } };
  const reviewed = Buffer.from(JSON.stringify(receipt));
  validateReceipt(reviewed, sha256(reviewed), 'ACCOUNT_ERASE');
  try {
    await db.user.create({ data: { id: userId, name: 'Synthetic operator', handle: `o${randomBytes(6).toString('hex')}`, email: `${userId}@example.invalid`, passwordHash: 'synthetic-restored' } });
    const checkpoints: any[] = [];
    assert.equal((await executeErasure(db, receipt, false, async v => { checkpoints.push(v); })).status, 'DRY_RUN');
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: userId } })).status, 'ACTIVE');
    await executeErasure(db, receipt, true, async v => { checkpoints.push(v); });
    const first = await db.deletionDecision.findUniqueOrThrow({ where: { id: decisionId } });
    await executeErasure(db, receipt, true, async v => { checkpoints.push(v); });
    assert.equal(await db.deletionDecision.count({ where: { id: decisionId } }), 1);
    assert.equal((await db.deletionDecision.findUniqueOrThrow({ where: { id: decisionId } })).recordedAt.toISOString(), first.recordedAt.toISOString());
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash, null);
    assert.ok(checkpoints.some(c => c.phase === 'ERASURE_COMMITTED'));
  } finally { await db.$disconnect(); }
});
