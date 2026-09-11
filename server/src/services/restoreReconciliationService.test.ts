import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifactKey, assertOutsideGit, buildReplayPlan, canonical, CaptureReceipt, decryptArtifact, encryptArtifact, executeErasure, mergeMediaPointers, parseArguments, planAliases, replaySnapshot, RestoreReceipt, sanitizedFailure, sha256, validateReceipt, validateRestoreBinding, validateSnapshot, validateTarget, writeProtectedNew } from './restoreReconciliationService';
import { mediaPurgeDecision } from './deletionJournalService';
const now = new Date('2026-09-10T01:00:00.000Z');
const evidence = { reference: 'synthetic-evidence', sha256: 'a'.repeat(64) };
const target = { environment: 'LOCAL_SYNTHETIC' as const, projectRef: 'local-settings-test', host: '127.0.0.1', port: 55447, database: 'settings_test', username: 'postgres' };
const common = { version: 1 as const, target, sourceRevision: 'b'.repeat(40), issuedAt: '2026-09-10T01:00:00.000Z', expiresAt: '2026-09-10T02:00:00.000Z', fence: { id: 'fence-1', stoppedAt: '2026-09-10T00:40:00.000Z', drainedAt: '2026-09-10T00:45:00.000Z', protectedThrough: '2026-09-10T02:00:00.000Z', writerInventory: evidence, providerStop: evidence, databaseDrain: evidence, storageWriterDrain: evidence }, independentReview: evidence };
const coverage = { baselineAt: '2026-09-09T00:00:00.000Z', journalEnabledAt: '2026-09-08T00:00:00.000Z', finalSourceCutoff: common.fence.drainedAt, baselineEvidence: evidence, continuousCoverageEvidence: evidence };
const capture: CaptureReceipt = { ...common, purpose: 'CAPTURE', coverage, protectedStore: { locationSha256: 'c'.repeat(64), independentOfProject: true, evidence } };
const pointer = { assetId: 'asset-1', objects: [{ bucket: 'media-originals', key: 'account-1/asset-1/source.heic' }], deleteNotBefore: null };
const snapshot = () => validateSnapshot({ version: 1, kind: 'SI_RESTORE_RECONCILIATION', target, sourceRevision: common.sourceRevision, captureReceiptSha256: 'd'.repeat(64), capturedAt: now.toISOString(), coverage, decisions: [], aliases: [], deletedAccounts: [], terminalMedia: [], counts: { decisions: 0, aliases: 0, deletedAccounts: 0, terminalMedia: 0 } });
const restore = (s = snapshot()): RestoreReceipt => ({ ...common, purpose: 'RESTORE', artifactSha256: sha256(canonical(s)), sourceCaptureReceiptSha256: s.captureReceiptSha256, finalSourceCutoff: coverage.finalSourceCutoff, finalCoverageEvidence: evidence, backup: { id: 'backup-1', capturedAt: '2026-09-09T12:00:00.000Z', projectRef: target.projectRef, evidence }, independentSource: { locationSha256: 'c'.repeat(64), independentOfProject: true, evidence } });
const bytes = (r: unknown) => Buffer.from(JSON.stringify(r));
function fakeDb(options: { journal?: any[]; assets?: any[]; aliases?: any[]; users?: any[]; groups?: any[]; active?: number } = {}) {
  const writes: string[] = [], journals = new Map((options.journal ?? []).map(d => [d.id, d]));
  const assets = new Map((options.assets ?? []).map(d => [d.id, d]));
  const tx: any = {
    $queryRaw: async (sql: any) => String(sql).includes('pg_stat_activity') ? [{ count: BigInt(options.active ?? 0) }] : String(sql).includes('current_database') ? [{ database: target.database, username: 'postgres', observedAt: now }] : [],
    $executeRawUnsafe: async () => 0, $executeRaw: async () => 0,
    deletionDecision: { findMany: async () => [...journals.values()], findUnique: async ({ where }: any) => journals.get(where.id) ?? null, create: async ({ data }: any) => { writes.push('decision'); const row = { ...data, recordedAt: now }; journals.set(data.id, row); return row; } },
    handleAlias: { findMany: async () => options.aliases ?? [], upsert: async () => { writes.push('alias'); } },
    user: { findMany: async () => options.users ?? [], findUnique: async ({ where }: any) => options.users?.find(u => u.id === where.id) ?? null },
    mediaAsset: { findMany: async () => [...assets.values()], findUnique: async ({ where }: any) => assets.get(where.id) ?? null, updateMany: async ({ where, data }: any) => { writes.push('media-update'); const asset = assets.get(where.id); if (asset) Object.assign(asset, data); return { count: asset ? 1 : 0 }; }, update: async ({ where, data }: any) => { writes.push('media-finalize'); Object.assign(assets.get(where.id), data); return assets.get(where.id); } },
    mediaVariant: { deleteMany: async () => { writes.push('variants-delete'); return { count: 0 }; } },
    group: { findMany: async () => options.groups ?? [] }
  };
  return { db: { $transaction: async (work: any) => work(tx) } as any, tx, writes, journals };
}
test('review receipt requires exact bytes, independent hash, strict schema, evidence and valid fence window', () => {
  const b = bytes(capture); assert.equal(validateReceipt(b, sha256(b), 'CAPTURE', now).purpose, 'CAPTURE');
  assert.throws(() => validateReceipt(Buffer.concat([b, Buffer.from(' ')]), sha256(b), 'CAPTURE', now), /RECEIPT_DIGEST_MISMATCH/);
  for (const mutation of [{ ...capture, force: true }, { ...capture, fence: { ...capture.fence, providerStop: undefined } }, { ...capture, coverage: { ...coverage, baselineAt: '2026-09-07T00:00:00.000Z' } }]) { const v = bytes(mutation); assert.throws(() => validateReceipt(v, sha256(v), 'CAPTURE', now)); }
  assert.throws(() => validateReceipt(b, sha256(b), 'CAPTURE', new Date(capture.expiresAt)), /FENCE_WINDOW_INVALID/);
});
test('target guard rejects crossover, wrong port, unsafe TLS and unreviewed URL options', () => {
  const env = { RECONCILIATION_ENVIRONMENT: target.environment, RECONCILIATION_PROJECT_REF: target.projectRef, RECONCILIATION_DATABASE_URL: 'postgresql://postgres:synthetic-only@127.0.0.1:55447/settings_test?schema=public' };
  assert.equal(new URL(validateTarget(target, env)).searchParams.get('connection_limit'), '1');
  for (const changed of [{ ...env, RECONCILIATION_ENVIRONMENT: 'PRODUCTION' }, { ...env, RECONCILIATION_DATABASE_URL: env.RECONCILIATION_DATABASE_URL.replace('55447', '5432') }, { ...env, RECONCILIATION_DATABASE_URL: env.RECONCILIATION_DATABASE_URL + '&options=unsafe' }, { ...env, RECONCILIATION_DATABASE_URL: env.RECONCILIATION_DATABASE_URL + '&schema=public' }]) assert.throws(() => validateTarget(target, changed));
  const stage = { ...target, environment: 'STAGING' as const, projectRef: 'mnfiixtgnlzmduunfryt', host: 'aws-0-ap-southeast-1.pooler.supabase.com', port: 5432, database: 'postgres', username: 'postgres.mnfiixtgnlzmduunfryt' };
  const hosted = { RECONCILIATION_ENVIRONMENT: 'STAGING', RECONCILIATION_PROJECT_REF: stage.projectRef, RECONCILIATION_DATABASE_URL: `postgresql://${stage.username}:synthetic-only@${stage.host}:5432/postgres?schema=public&sslmode=require&sslaccept=strict` };
  assert.doesNotThrow(() => validateTarget(stage, hosted)); assert.throws(() => validateTarget(stage, { ...hosted, RECONCILIATION_DATABASE_URL: hosted.RECONCILIATION_DATABASE_URL.replace('sslaccept=strict', 'sslaccept=accept_invalid_certs') }));
});
test('AES-GCM rejects tamper, wrong key and digest substitution without exposing plaintext', () => {
  const key = randomBytes(32), value = { privateIdentifier: 'synthetic-sensitive-subject' }, encrypted = encryptArtifact(value, key);
  assert.deepEqual(decryptArtifact(encrypted, key), value); assert.deepEqual(decryptArtifact(encryptArtifact({ at: now }, key), key), { at: now.toISOString() }); assert.ok(!encrypted.includes(Buffer.from(value.privateIdentifier)));
  assert.throws(() => decryptArtifact(encrypted, randomBytes(32)), /ARTIFACT_AUTHENTICATION_FAILED/);
  const changed = JSON.parse(encrypted.toString()); changed.sha256 = '0'.repeat(64); assert.throws(() => decryptArtifact(bytes(changed), key), /ARTIFACT_AUTHENTICATION_FAILED/);
  const corrupted = JSON.parse(encrypted.toString()), cipher = Buffer.from(corrupted.ciphertext, 'base64'); cipher[0] ^= 1; corrupted.ciphertext = cipher.toString('base64'); assert.throws(() => decryptArtifact(bytes(corrupted), key), /ARTIFACT_AUTHENTICATION_FAILED/);
  assert.throws(() => artifactKey({ RECONCILIATION_ARTIFACT_KEY: 'weak' }));
});
test('protected output refuses Git ancestry and overwrite; external ciphertext round trips', () => {
  const directory = mkdtempSync(join(tmpdir(), 'si-restore-unit-'));
  try { const output = join(directory, 'snapshot.encrypted.json'), key = randomBytes(32); writeProtectedNew(output, { synthetic: true }, key); assert.deepEqual(decryptArtifact(readFileSync(output), key), { synthetic: true }); assert.throws(() => writeProtectedNew(output, {}, key)); mkdirSync(join(directory, '.git')); assert.throws(() => assertOutsideGit(output), /PROTECTED_PATH_INSIDE_GIT/); } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('count mismatch, duplicate IDs, unknown actions and entries past the cutoff fail', () => {
  const s = snapshot(), d = { ...mediaPurgeDecision(pointer), recordedAt: '2026-09-09T12:00:00.000Z' };
  assert.throws(() => validateSnapshot({ ...s, counts: { ...s.counts, aliases: 1 } }));
  assert.throws(() => validateSnapshot({ ...s, decisions: [d, d], counts: { ...s.counts, decisions: 2 } }));
  for (const row of [{ ...d, action: 'DELETE_ANYTHING' }, { ...d, recordedAt: now.toISOString() }]) assert.throws(() => validateSnapshot({ ...s, decisions: [row], counts: { ...s.counts, decisions: 1 } }));
});
test('backup binding rejects wrong target/digest/cutoff and pre-baseline backup', () => {
  const s = snapshot(), r = restore(s); assert.equal(validateRestoreBinding(s, r), r.artifactSha256);
  for (const wrong of [{ ...r, artifactSha256: 'e'.repeat(64) }, { ...r, finalSourceCutoff: now.toISOString() }, { ...r, target: { ...target, projectRef: 'another-project' } }, { ...r, backup: { ...r.backup, capturedAt: '2026-09-08T00:00:00.000Z' } }, { ...r, sourceCaptureReceiptSha256: 'e'.repeat(64) }]) assert.throws(() => validateRestoreBinding(s, wrong));
});
test('alias namespace reserves future accounts and erased tombstones without stealing an active name', async () => {
  const s = { ...snapshot(), aliases: [{ handle: 'old_name', userId: null, createdAt: coverage.baselineAt }, { handle: 'future_name', userId: 'new-user', createdAt: coverage.baselineAt }] };
  const f = fakeDb({ aliases: [{ handle: 'old_name', userId: 'erased-user' }], users: [{ id: 'erased-user', handle: 'old_name', status: 'ACTIVE' }] });
  assert.deepEqual((await planAliases(f.tx, s, new Set(['erased-user']))).map(a => a.userId), [null, null]); await assert.rejects(planAliases(f.tx, s, new Set()));
  await assert.rejects(planAliases(fakeDb({ users: [{ id: 'other', handle: 'future_name', status: 'ACTIVE' }] }).tx, s, new Set()), /ALIAS_CURRENT_HANDLE_CONFLICT/);
});
test('default replay is a dry-run with zero mutations, storage or checkpoint calls', async () => {
  const s = snapshot(), f = fakeDb(); let external = 0;
  const result = await replaySnapshot(f.db, s, restore(s), false, { now: () => now, remove: async () => { external++; }, checkpoint: async () => { external++; } });
  assert.equal(result.status, 'DRY_RUN'); assert.deepEqual(f.writes, []); assert.equal(external, 0);
});
test('undrained database blocks planning before mutation', async () => {
  const f = fakeDb({ active: 1 }); await assert.rejects(buildReplayPlan(f.db, snapshot()), /DATABASE_NOT_DRAINED/); assert.deepEqual(f.writes, []);
});
test('orphan storage keys replay with no restored row and repeated application is idempotent', async () => {
  const base = snapshot(), s = validateSnapshot({ ...base, terminalMedia: [pointer], counts: { ...base.counts, terminalMedia: 1 } }), f = fakeDb();
  const removals: unknown[] = [], checkpoints: any[] = [], deps = { now: () => now, remove: async (bucket: string, keys: string[]) => { removals.push({ bucket, keys }); }, checkpoint: async (v: unknown) => { checkpoints.push(v); } };
  assert.equal((await replaySnapshot(f.db, s, restore(s), true, deps)).status, 'RECONCILED_FENCE_REMAINS'); const count = f.journals.size;
  assert.equal((await replaySnapshot(f.db, s, restore(s), true, deps)).status, 'RECONCILED_FENCE_REMAINS'); assert.equal(f.journals.size, count); assert.equal(removals.length, 2);
  assert.deepEqual(removals[0], { bucket: 'media-originals', keys: ['account-1/asset-1/source.heic'] }); assert.equal(checkpoints[0].phase, 'PLANNED');
});
test('maximum grace deadline blocks all early storage deletion including absent asset rows', async () => {
  const delayed = { ...pointer, deleteNotBefore: '2026-09-10T01:30:00.000Z' }; assert.equal(mergeMediaPointers([pointer, delayed])[0].deleteNotBefore, delayed.deleteNotBefore);
  const base = snapshot(), s = validateSnapshot({ ...base, terminalMedia: [delayed], counts: { ...base.counts, terminalMedia: 1 } }), f = fakeDb(); let removed = 0;
  const result = await replaySnapshot(f.db, s, restore(s), true, { now: () => now, remove: async () => { removed++; }, checkpoint: async () => undefined }); assert.equal(result.status, 'BLOCKED'); assert.equal(result.pendingMedia, 1); assert.equal(removed, 0);
});
test('failed storage call retains durable intent and cannot produce a completion receipt', async () => {
  const base = snapshot(), s = validateSnapshot({ ...base, terminalMedia: [pointer], counts: { ...base.counts, terminalMedia: 1 } }), f = fakeDb(), checkpoints: any[] = [];
  await assert.rejects(replaySnapshot(f.db, s, restore(s), true, { now: () => now, remove: async () => { throw new Error('synthetic outage'); }, checkpoint: async v => { checkpoints.push(v); } })); assert.ok(f.journals.size > 0); assert.ok(!checkpoints.some(c => c.phase === 'COMPLETE'));
});
test('global ownerless groups remain blocked on repeated runs after memberships were removed', async () => {
  const s = snapshot(), f = fakeDb({ groups: [{ id: 'ownerless-group' }] });
  for (let n = 0; n < 2; n++) { const r = await replaySnapshot(f.db, s, restore(s), true, { now: () => now, remove: async () => undefined, checkpoint: async () => undefined }); assert.equal(r.status, 'BLOCKED'); assert.deepEqual(r.unresolvedGroupIds, ['ownerless-group']); }
});
test('operator receipt accepts only verified ACCOUNT_ERASE scope and default dry-run', async () => {
  const r = { ...common, purpose: 'ACCOUNT_ERASE' as const, decisionId: 'request:1', subjectId: 'account-1', privacyRequest: { id: 'privacy-request-1', scope: 'ACCOUNT_ERASE' as const, verifiedAt: common.issuedAt, verificationEvidence: evidence, authorityEvidence: evidence } };
  const b = bytes(r); assert.equal(validateReceipt(b, sha256(b), 'ACCOUNT_ERASE', now).purpose, 'ACCOUNT_ERASE'); const bad = bytes({ ...r, privacyRequest: { ...r.privacyRequest, scope: 'DELETE_ALL' } }); assert.throws(() => validateReceipt(bad, sha256(bad), 'ACCOUNT_ERASE', now));
  const f = fakeDb({ users: [{ id: 'account-1', handle: 'old_name', status: 'ACTIVE' }] }); let count = 0;
  assert.equal((await executeErasure(f.db, r, false, async () => { count++; }, () => now)).status, 'DRY_RUN'); assert.deepEqual(f.writes, []); assert.equal(count, 0);
});
test('CLI rejects unknown/duplicate flags and does not expose provider or database errors', () => {
  assert.deepEqual(parseArguments([], ['apply']), {}); assert.throws(() => parseArguments(['--apply=yes'], ['apply'])); assert.throws(() => parseArguments(['--receipt=one', '--receipt=two'], ['receipt'])); assert.throws(() => parseArguments(['--force'], ['apply'])); assert.equal(sanitizedFailure(new Error('password=synthetic-secret; SQL private data')), 'RECONCILIATION_FAILED_REVIEW_REQUIRED');
});
test('operator rechecks fence expiry after durable checkpoint before any erasure mutation', async () => {
  const at = Date.now(), r = { ...common, issuedAt: new Date(at).toISOString(), expiresAt: new Date(at + 60_000).toISOString(), purpose: 'ACCOUNT_ERASE' as const,
    decisionId: 'request:expiry', subjectId: 'account-1', privacyRequest: { id: 'privacy-expiry', scope: 'ACCOUNT_ERASE' as const, verifiedAt: new Date(at).toISOString(), verificationEvidence: evidence, authorityEvidence: evidence } };
  const f = fakeDb({ users: [{ id: 'account-1', handle: 'old_name', status: 'ACTIVE' }] });
  let clock = at;
  await assert.rejects(executeErasure(f.db, r, true, async () => { clock = at + 60_001; }, () => new Date(clock)), /FENCE_WINDOW_EXPIRED/);
  assert.deepEqual(f.writes, []);
});
test('storage response after fence expiry cannot finalize media or write COMPLETE', async () => {
  const base = snapshot(), s = validateSnapshot({ ...base, terminalMedia: [pointer], counts: { ...base.counts, terminalMedia: 1 } });
  const asset = { id: pointer.assetId, ownerId: 'account-1', status: 'ATTACHED', sourceMime: 'image/png', uploadBucket: pointer.objects[0].bucket, uploadKey: pointer.objects[0].key, storageCleanupNotBefore: null, variants: [] };
  const f = fakeDb({ assets: [asset] }), r = restore(s); let clock = now.getTime(); const checkpoints: any[] = [];
  await assert.rejects(replaySnapshot(f.db, s, r, true, { now: () => new Date(clock), checkpoint: async v => { checkpoints.push(v); }, remove: async (_bucket, _keys, signal) => { assert.equal(signal.aborted, false); clock = Date.parse(r.expiresAt); } }), /FENCE_WINDOW_EXPIRED/);
  assert.ok(!f.writes.includes('media-finalize')); assert.ok(!f.writes.includes('variants-delete')); assert.ok(!checkpoints.some(c => c.phase === 'COMPLETE'));
});
test('transaction acquired after expiry cannot write and acquisition/execution budgets are bounded', async () => {
  const base = snapshot(), s = validateSnapshot({ ...base, terminalMedia: [pointer], counts: { ...base.counts, terminalMedia: 1 } });
  const f = fakeDb(), r = restore(s); let clock = now.getTime(), calls = 0; const budgets: any[] = [];
  f.db.$transaction = async (work: any, options: any) => { budgets.push(options); if (++calls === 2) clock = Date.parse(r.expiresAt); return work(f.tx); };
  await assert.rejects(replaySnapshot(f.db, s, r, true, { now: () => new Date(clock), checkpoint: async () => undefined, remove: async () => undefined }), /FENCE_WINDOW_EXPIRED/);
  assert.deepEqual(f.writes, []); assert.ok(budgets.every(b => b.maxWait <= 5000 && b.timeout <= 60000));
});
test('delayed database observation is checked again before subsequent writes', async () => {
  const base = snapshot(), s = validateSnapshot({ ...base, terminalMedia: [pointer], counts: { ...base.counts, terminalMedia: 1 } });
  const f = fakeDb(), r = restore(s); let clock = now.getTime(), txCount = 0; const original = f.tx.$queryRaw;
  f.db.$transaction = async (work: any) => { txCount++; return work(f.tx); };
  f.tx.$queryRaw = async (...args: any[]) => { const result = await original(...args); if (txCount === 2) clock = Date.parse(r.expiresAt); return result; };
  await assert.rejects(replaySnapshot(f.db, s, r, true, { now: () => new Date(clock), checkpoint: async () => undefined, remove: async () => undefined }), /FENCE_WINDOW_EXPIRED/);
  assert.deepEqual(f.writes, []);
});
test('unresponsive storage receives abort at the remaining-window timeout', async () => {
  const base = snapshot(), s = validateSnapshot({ ...base, terminalMedia: [pointer], counts: { ...base.counts, terminalMedia: 1 } });
  const f = fakeDb(), r = { ...restore(s), issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 100).toISOString() }; let signal: AbortSignal | undefined;
  await assert.rejects(replaySnapshot(f.db, s, r, true, { checkpoint: async () => undefined, remove: async (_bucket, _keys, nextSignal) => { signal = nextSignal; return new Promise<void>(() => undefined); } }), /STORAGE_WINDOW_EXPIRED/);
  assert.equal(signal?.aborted, true); assert.ok(!f.writes.includes('media-finalize'));
});
