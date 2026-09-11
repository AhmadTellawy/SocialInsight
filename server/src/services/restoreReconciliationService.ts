import { execFileSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { purgeAccount } from './accountErasureService';
import { appendDeletionDecision, captureDeletionMediaPointer, CanonicalDeletionDecision, DeletionMediaPointer, mediaPurgeDecision, normalizeDeletionDecision } from './deletionJournalService';
import { GROUP_ROLES } from '../utils/constants';

// This is an offline operator boundary. No dotenv, app singleton, HTTP server,
// worker startup, automatic fence release or implicit provider configuration.
const MAX_ROWS = 100_000;
const MAX_BYTES = 64 * 1024 * 1024;
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,319}$/);
const instant = z.string().refine(s => Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s);
const evidenceSchema = z.object({ reference: idSchema, sha256: digestSchema }).strict();
const targetSchema = z.object({
  environment: z.enum(['LOCAL_SYNTHETIC', 'STAGING', 'PRODUCTION']), projectRef: idSchema,
  host: z.string().min(1).max(253), port: z.number().int(), database: idSchema, username: idSchema
}).strict();
const fenceSchema = z.object({ id: idSchema, stoppedAt: instant, drainedAt: instant, protectedThrough: instant,
  writerInventory: evidenceSchema, providerStop: evidenceSchema, databaseDrain: evidenceSchema,
  storageWriterDrain: evidenceSchema }).strict();
const coverageSchema = z.object({ baselineAt: instant, journalEnabledAt: instant, finalSourceCutoff: instant,
  baselineEvidence: evidenceSchema, continuousCoverageEvidence: evidenceSchema }).strict();
const commonReceipt = {
  version: z.literal(1), target: targetSchema, sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
  issuedAt: instant, expiresAt: instant, fence: fenceSchema, independentReview: evidenceSchema
};
const captureReceiptSchema = z.object({ ...commonReceipt, purpose: z.literal('CAPTURE'), coverage: coverageSchema,
  protectedStore: z.object({ locationSha256: digestSchema, independentOfProject: z.literal(true), evidence: evidenceSchema }).strict()
}).strict();
const restoreReceiptSchema = z.object({ ...commonReceipt, purpose: z.literal('RESTORE'), artifactSha256: digestSchema,
  sourceCaptureReceiptSha256: digestSchema, finalSourceCutoff: instant,
  finalCoverageEvidence: evidenceSchema,
  backup: z.object({ id: idSchema, capturedAt: instant, projectRef: idSchema, evidence: evidenceSchema }).strict(),
  independentSource: z.object({ locationSha256: digestSchema, independentOfProject: z.literal(true), evidence: evidenceSchema }).strict()
}).strict();
const erasureReceiptSchema = z.object({ ...commonReceipt, purpose: z.literal('ACCOUNT_ERASE'),
  decisionId: idSchema, subjectId: idSchema,
  privacyRequest: z.object({ id: idSchema, scope: z.literal('ACCOUNT_ERASE'), verifiedAt: instant,
    verificationEvidence: evidenceSchema, authorityEvidence: evidenceSchema }).strict()
}).strict();
export type Target = z.infer<typeof targetSchema>;
export type CaptureReceipt = z.infer<typeof captureReceiptSchema>;
export type RestoreReceipt = z.infer<typeof restoreReceiptSchema>;
export type ErasureReceipt = z.infer<typeof erasureReceiptSchema>;
export type ReviewedReceipt = CaptureReceipt | RestoreReceipt | ErasureReceipt;
export class ReconciliationError extends Error { constructor(public readonly code: string) { super(code); } }
const fail = (code: string): never => { throw new ReconciliationError(code); };
export const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
export function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const bounded = <T>(rows: T[]): T[] => rows.length > MAX_ROWS ? fail('CAPTURE_LIMIT_EXCEEDED') : rows;
const iso = (date: Date | string): string => instant.parse(date instanceof Date ? date.toISOString() : date);

export function validateReceipt(bytes: Buffer, expectedSha256: string, purpose: ReviewedReceipt['purpose'], now = new Date()): ReviewedReceipt {
  if (bytes.length > 64 * 1024 || !digestSchema.safeParse(expectedSha256).success || sha256(bytes) !== expectedSha256) fail('RECEIPT_DIGEST_MISMATCH');
  let value: unknown;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { return fail('INVALID_RECEIPT'); }
  const schema = purpose === 'CAPTURE' ? captureReceiptSchema : purpose === 'RESTORE' ? restoreReceiptSchema : erasureReceiptSchema;
  const parsed = schema.safeParse(value);
  if (!parsed.success) return fail('INVALID_RECEIPT');
  const r = parsed.data, t = now.getTime();
  if (Date.parse(r.issuedAt) > t || t >= Date.parse(r.expiresAt) || Date.parse(r.expiresAt) - Date.parse(r.issuedAt) > 2 * 60 * 60 * 1000 ||
      Date.parse(r.fence.stoppedAt) > Date.parse(r.fence.drainedAt) || Date.parse(r.fence.drainedAt) > Date.parse(r.issuedAt) ||
      Date.parse(r.expiresAt) > Date.parse(r.fence.protectedThrough)) fail('FENCE_WINDOW_INVALID');
  if (r.purpose === 'CAPTURE' && (Date.parse(r.coverage.journalEnabledAt) > Date.parse(r.coverage.baselineAt) ||
      Date.parse(r.coverage.baselineAt) > Date.parse(r.coverage.finalSourceCutoff) || r.coverage.finalSourceCutoff !== r.fence.drainedAt)) fail('COVERAGE_INVALID');
  if (r.purpose === 'ACCOUNT_ERASE' && Date.parse(r.privacyRequest.verifiedAt) > Date.parse(r.issuedAt)) fail('REQUEST_SCOPE_INVALID');
  return r;
}

export function validateTarget(target: Target, env: NodeJS.ProcessEnv): string {
  if (env.RECONCILIATION_ENVIRONMENT !== target.environment || env.RECONCILIATION_PROJECT_REF !== target.projectRef) fail('TARGET_ENVIRONMENT_MISMATCH');
  let url: URL;
  try { url = new URL(env.RECONCILIATION_DATABASE_URL || ''); } catch { return fail('TARGET_URL_INVALID'); }
  if (url.protocol !== 'postgresql:' || url.hash || decodeURIComponent(url.username) !== target.username || !url.password ||
      url.hostname !== target.host || Number(url.port || 5432) !== target.port || decodeURIComponent(url.pathname.slice(1)) !== target.database) fail('TARGET_URL_MISMATCH');
  const allowed = new Set(['schema', 'sslmode', 'sslaccept', 'sslcert', 'connect_timeout', 'connection_limit', 'socket_timeout', 'pgbouncer']);
  for (const key of url.searchParams.keys()) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) fail('TARGET_URL_OPTIONS_INVALID');
  if (url.searchParams.get('schema') !== 'public' || url.searchParams.has('pgbouncer')) fail('TARGET_URL_OPTIONS_INVALID');
  if (target.environment === 'LOCAL_SYNTHETIC') {
    if (target.projectRef !== 'local-settings-test' || target.host !== '127.0.0.1' || target.port !== 55447 || !['settings_test', 'restore_reconciliation_test'].includes(target.database) || target.username !== 'postgres') fail('SYNTHETIC_TARGET_INVALID');
  } else {
    if (!/^[a-z]{20}$/.test(target.projectRef) || target.database !== 'postgres' || target.port !== 5432 ||
        (target.environment === 'STAGING' && target.projectRef !== 'mnfiixtgnlzmduunfryt')) fail('HOSTED_TARGET_INVALID');
    const direct = target.host === `db.${target.projectRef}.supabase.co` && target.username === 'postgres';
    const pooler = /^aws-[0-9]+-[a-z]+-[a-z]+-[0-9]+\.pooler\.supabase\.com$/.test(target.host) && target.username === `postgres.${target.projectRef}`;
    if ((!direct && !pooler) || url.searchParams.get('sslmode') !== 'require' || url.searchParams.get('sslaccept') !== 'strict') fail('HOSTED_TRANSPORT_INVALID');
  }
  url.searchParams.set('connection_limit', '1'); url.searchParams.set('connect_timeout', '10'); url.searchParams.set('socket_timeout', '60');
  return url.toString();
}

// The hash pins exactly the separately reviewed bytes. It cannot establish the
// truth of provider observations or grant authority to the caller.
export function assertOutsideGit(path: string, output = false): string {
  if (!isAbsolute(path)) fail('PROTECTED_PATH_MUST_BE_ABSOLUTE');
  const resolved = output ? join(realpathSync(dirname(path)), path.slice(dirname(path).length + 1)) : realpathSync(path);
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) fail('PROTECTED_PATH_LINK_REJECTED');
  let parent = output ? dirname(resolved) : dirname(resolved);
  while (true) {
    if (existsSync(join(parent, '.git'))) fail('PROTECTED_PATH_INSIDE_GIT');
    const next = dirname(parent); if (next === parent) break; parent = next;
  }
  return resolved;
}
export function artifactKey(env: NodeJS.ProcessEnv): Buffer {
  const key = env.RECONCILIATION_ARTIFACT_KEY;
  if (!key || !/^[a-fA-F0-9]{64}$/.test(key)) return fail('ARTIFACT_KEY_REQUIRED');
  return Buffer.from(key, 'hex');
}
export function encryptArtifact(value: unknown, key: Buffer): Buffer {
  if (key.length !== 32) fail('ARTIFACT_KEY_INVALID');
  const plain = Buffer.from(canonical(value));
  if (plain.length > MAX_BYTES) fail('ARTIFACT_LIMIT_EXCEEDED');
  const digest = sha256(plain), nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(`SI-RESTORE-1:${digest}`));
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.from(JSON.stringify({ version: 1, algorithm: 'AES-256-GCM', sha256: digest, nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: encrypted.toString('base64') }));
}
export function decryptArtifact(bytes: Buffer, key: Buffer): unknown {
  try {
    if (bytes.length > MAX_BYTES * 1.4) return fail('ARTIFACT_LIMIT_EXCEEDED');
    const envelope = z.object({ version: z.literal(1), algorithm: z.literal('AES-256-GCM'), sha256: digestSchema,
      nonce: z.string(), tag: z.string(), ciphertext: z.string() }).strict().parse(JSON.parse(bytes.toString('utf8')));
    const nonce = Buffer.from(envelope.nonce, 'base64'), tag = Buffer.from(envelope.tag, 'base64');
    if (nonce.length !== 12 || tag.length !== 16) return fail('ARTIFACT_AUTHENTICATION_FAILED');
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(Buffer.from(`SI-RESTORE-1:${envelope.sha256}`)); decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
    if (sha256(plain) !== envelope.sha256) return fail('ARTIFACT_AUTHENTICATION_FAILED');
    return JSON.parse(plain.toString('utf8'));
  } catch { return fail('ARTIFACT_AUTHENTICATION_FAILED'); }
}
export function writeProtectedNew(path: string, value: unknown, key: Buffer): void {
  const output = assertOutsideGit(path, true);
  const fd = openSync(output, 'wx', 0o600);
  try { writeFileSync(fd, encryptArtifact(value, key)); fsyncSync(fd); } finally { closeSync(fd); }
}
export function readProtected(path: string, limit = MAX_BYTES * 1.4): Buffer {
  const input = assertOutsideGit(path);
  if (!lstatSync(input).isFile() || lstatSync(input).size > limit) fail('PROTECTED_INPUT_INVALID');
  return readFileSync(input);
}

const aliasSchema = z.object({ handle: z.string().min(1).max(256).refine(h => h === h.toLowerCase() && !/[\x00-\x1f]/.test(h)), userId: idSchema.nullable(), createdAt: instant }).strict();
const artifactSchema = z.object({ version: z.literal(1), kind: z.literal('SI_RESTORE_RECONCILIATION'), target: targetSchema,
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/), captureReceiptSha256: digestSchema,
  capturedAt: instant, coverage: coverageSchema,
  decisions: z.array(z.unknown()).max(MAX_ROWS), aliases: z.array(aliasSchema).max(MAX_ROWS),
  deletedAccounts: z.array(z.object({ id: idSchema, resourcePointers: z.unknown() }).strict()).max(MAX_ROWS),
  terminalMedia: z.array(z.unknown()).max(MAX_ROWS),
  counts: z.object({ decisions: z.number().int(), aliases: z.number().int(), deletedAccounts: z.number().int(), terminalMedia: z.number().int() }).strict()
}).strict();
export type Snapshot = Omit<z.infer<typeof artifactSchema>, 'decisions' | 'deletedAccounts' | 'terminalMedia'> & {
  decisions: Array<CanonicalDeletionDecision & { recordedAt: string }>;
  deletedAccounts: Array<{ id: string; resourcePointers: CanonicalDeletionDecision['resourcePointers'] }>;
  terminalMedia: DeletionMediaPointer[];
};
function normalizeRecorded(value: unknown): CanonicalDeletionDecision & { recordedAt: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('ARTIFACT_DECISION_INVALID');
  const { recordedAt, ...input } = value as Record<string, unknown>;
  return { ...normalizeDeletionDecision(input), recordedAt: instant.parse(recordedAt) };
}
export function validateSnapshot(value: unknown): Snapshot {
  const a = artifactSchema.parse(value);
  const decisions = a.decisions.map(normalizeRecorded).sort((x, y) => compare(x.recordedAt, y.recordedAt) || compare(x.id, y.id));
  const aliases = a.aliases.sort((x, y) => compare(x.handle, y.handle));
  const deletedAccounts = a.deletedAccounts.map(row => ({ id: row.id, resourcePointers: normalizeDeletionDecision({ id: `baseline:${row.id}`, subjectKind: 'ACCOUNT', subjectId: row.id, action: 'ACCOUNT_ERASE', resourcePointers: row.resourcePointers }).resourcePointers })).sort((x, y) => compare(x.id, y.id));
  const terminalMedia = a.terminalMedia.map(pointer => {
    const p = pointer as DeletionMediaPointer;
    return mediaPurgeDecision(p).resourcePointers.media[0];
  }).sort((x, y) => compare(x.assetId, y.assetId));
  const lists = [decisions.map(x => x.id), aliases.map(x => x.handle), deletedAccounts.map(x => x.id), terminalMedia.map(x => x.assetId)];
  if (lists.some(list => new Set(list).size !== list.length) || Object.values(a.counts).some(n => n < 0) ||
      a.counts.decisions !== decisions.length || a.counts.aliases !== aliases.length || a.counts.deletedAccounts !== deletedAccounts.length || a.counts.terminalMedia !== terminalMedia.length ||
      decisions.some(d => Date.parse(d.recordedAt) > Date.parse(a.coverage.finalSourceCutoff)) ||
      Date.parse(a.coverage.journalEnabledAt) > Date.parse(a.coverage.baselineAt) || Date.parse(a.coverage.baselineAt) > Date.parse(a.coverage.finalSourceCutoff) ||
      Date.parse(a.capturedAt) < Date.parse(a.coverage.finalSourceCutoff)) fail('ARTIFACT_COVERAGE_INVALID');
  return { ...a, decisions, aliases, deletedAccounts, terminalMedia };
}

async function verifyDatabase(tx: Prisma.TransactionClient, target: Target): Promise<Date> {
  const [identity] = await tx.$queryRaw<Array<{ database: string; username: string; observedAt: Date }>>`SELECT current_database() AS database, current_user AS username, clock_timestamp() AS "observedAt"`;
  // The session pooler authenticates project-qualified names but PostgreSQL sees
  // the underlying role. Endpoint identity was pinned before connecting.
  const expectedRole = target.username.split('.')[0];
  if (!identity || identity.database !== target.database || identity.username !== expectedRole) fail('DATABASE_IDENTITY_MISMATCH');
  const [activity] = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend' AND state IS DISTINCT FROM 'idle'`;
  if (Number(activity?.count) !== 0) fail('DATABASE_NOT_DRAINED');
  if (target.environment !== 'LOCAL_SYNTHETIC') {
    const [ssl] = await tx.$queryRaw<Array<{ ssl: boolean }>>`SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()`;
    if (ssl?.ssl !== true) fail('DATABASE_LEG_TLS_UNVERIFIED');
  }
  return identity.observedAt;
}
type FenceWindow = { assertOpen: () => void; remaining: () => number };
function fenceWindow(expiresAt: string, now: () => Date = () => new Date()): FenceWindow {
  const remaining = () => {
    const ms = Date.parse(expiresAt) - now().getTime();
    if (!Number.isFinite(ms) || ms <= 0) return fail('FENCE_WINDOW_EXPIRED');
    return Math.max(1, Math.floor(ms));
  };
  return { remaining, assertOpen: () => { remaining(); } };
}
// Check every awaited Prisma operation, including statements inside the trusted
// purge core. The transaction deadline also bounds acquisition/lock waits.
function fencedTransactionClient(tx: Prisma.TransactionClient, window: FenceWindow): Prisma.TransactionClient {
  const wrap = (object: object): any => new Proxy(object, { get(target, property) {
    const value = Reflect.get(target, property);
    if (typeof value === 'function') return async (...args: unknown[]) => {
      window.assertOpen(); const result = await Reflect.apply(value, target, args); window.assertOpen(); return result;
    };
    return value && typeof value === 'object' ? wrap(value) : value;
  } });
  return wrap(tx);
}
async function withinFence<T>(db: PrismaClient, target: Target, window: FenceWindow, work: (tx: Prisma.TransactionClient, at: Date) => Promise<T>, readOnly = false): Promise<T> {
  const remaining = window.remaining();
  const result = await db.$transaction(async original => {
    window.assertOpen();
    const tx = fencedTransactionClient(original, window);
    if (readOnly) await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    // PostgreSQL 17 terminates an overlong transaction, including a statement
    // still waiting inside the trusted purge. This remains transaction-local.
    await tx.$executeRawUnsafe(`SET LOCAL transaction_timeout = '${window.remaining()}ms'`);
    const at = await verifyDatabase(tx, target);
    const result = await work(tx, at);
    window.assertOpen(); // Throw before commit if trusted work overran its fence.
    return result;
  }, { maxWait: Math.min(5000, remaining), timeout: Math.min(60000, remaining), ...(readOnly ? { isolationLevel: 'RepeatableRead' as const } : {}) });
  window.assertOpen();
  return result;
}
async function storageWithinFence(window: FenceWindow, remove: (signal: AbortSignal) => Promise<void>): Promise<void> {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => {
    controller.abort(); reject(new ReconciliationError('STORAGE_WINDOW_EXPIRED'));
  }, Math.min(60000, window.remaining())); });
  try { await Promise.race([remove(controller.signal), timeout]); window.assertOpen(); }
  finally { if (timer) clearTimeout(timer); controller.abort(); }
}
async function readonly<T>(db: PrismaClient, target: Target, work: (tx: Prisma.TransactionClient, at: Date) => Promise<T>, window?: FenceWindow): Promise<T> {
  if (window) return withinFence(db, target, window, work, true);
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const at = await verifyDatabase(tx, target);
    return work(tx, at);
  }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 60_000 });
}
export async function captureSnapshot(db: PrismaClient, receipt: CaptureReceipt, receiptDigest: string): Promise<Snapshot> {
  return readonly(db, receipt.target, async (tx, at) => {
    const rows = bounded(await tx.deletionDecision.findMany({ take: MAX_ROWS + 1, orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] }));
    const aliases = bounded(await tx.handleAlias.findMany({ take: MAX_ROWS + 1, orderBy: { handle: 'asc' } }));
    const deleted = bounded(await tx.user.findMany({ where: { OR: [{ status: 'DELETED' }, { deletedAt: { not: null } }] }, select: { id: true }, take: MAX_ROWS + 1, orderBy: { id: 'asc' } }));
    const media = bounded(await tx.mediaAsset.findMany({ where: { OR: [{ ownerId: { in: deleted.map(u => u.id) } }, { status: { in: ['PENDING_DELETE', 'DELETED'] } }] }, include: { variants: true }, take: MAX_ROWS + 1, orderBy: { id: 'asc' } }));
    const byOwner = new Map<string, DeletionMediaPointer[]>();
    for (const asset of media) byOwner.set(asset.ownerId, [...(byOwner.get(asset.ownerId) ?? []), captureDeletionMediaPointer(asset)]);
    const deletedAccounts = deleted.map(u => ({ id: u.id, resourcePointers: { media: byOwner.get(u.id) ?? [] } }));
    const terminalMedia = media.filter(m => m.status === 'PENDING_DELETE' || m.status === 'DELETED').map(captureDeletionMediaPointer);
    return validateSnapshot({ version: 1, kind: 'SI_RESTORE_RECONCILIATION', target: receipt.target, sourceRevision: receipt.sourceRevision,
      captureReceiptSha256: receiptDigest, capturedAt: at.toISOString(), coverage: receipt.coverage,
      decisions: rows.map(row => ({ ...row, recordedAt: row.recordedAt.toISOString() })),
      aliases: aliases.map(row => ({ ...row, createdAt: row.createdAt.toISOString() })), deletedAccounts, terminalMedia,
      counts: { decisions: rows.length, aliases: aliases.length, deletedAccounts: deleted.length, terminalMedia: terminalMedia.length } });
  });
}

export function validateRestoreBinding(snapshot: Snapshot, receipt: RestoreReceipt, artifactPath?: string): string {
  const digest = sha256(canonical(snapshot));
  if (digest !== receipt.artifactSha256 || canonical(snapshot.target) !== canonical(receipt.target) || snapshot.sourceRevision !== receipt.sourceRevision ||
      snapshot.captureReceiptSha256 !== receipt.sourceCaptureReceiptSha256 || snapshot.coverage.finalSourceCutoff !== receipt.finalSourceCutoff ||
      receipt.backup.projectRef !== snapshot.target.projectRef || Date.parse(snapshot.capturedAt) > Date.parse(receipt.issuedAt) ||
      Date.parse(snapshot.coverage.finalSourceCutoff) > Date.parse(receipt.issuedAt)) fail('RESTORE_BINDING_MISMATCH');
  const backupTime = Date.parse(receipt.backup.capturedAt);
  if (backupTime < Date.parse(snapshot.coverage.baselineAt) || backupTime > Date.parse(snapshot.coverage.finalSourceCutoff)) fail('BACKUP_OUTSIDE_COVERAGE');
  if (artifactPath && sha256(dirname(assertOutsideGit(artifactPath))) !== receipt.independentSource.locationSha256) fail('INDEPENDENT_SOURCE_MISMATCH');
  return digest;
}
export function snapshotDecisions(snapshot: Snapshot): CanonicalDeletionDecision[] {
  const map = new Map(snapshot.decisions.map(d => { const { recordedAt: _at, ...input } = d; return [d.id, input] as const; }));
  for (const row of snapshot.deletedAccounts) {
    const input = normalizeDeletionDecision({ id: `restore-baseline:${sha256(canonical(row.resourcePointers))}:${row.id}`, subjectKind: 'ACCOUNT', subjectId: row.id, action: 'ACCOUNT_ERASE', resourcePointers: row.resourcePointers });
    if (map.has(input.id) && canonical(map.get(input.id)) !== canonical(input)) fail('BASELINE_DECISION_CONFLICT');
    map.set(input.id, input);
  }
  for (const p of snapshot.terminalMedia) { const input = mediaPurgeDecision(p); map.set(input.id, input); }
  return [...map.values()].sort((a, b) => compare(a.id, b.id));
}
export function mergeMediaPointers(pointers: DeletionMediaPointer[]): DeletionMediaPointer[] {
  const result = new Map<string, DeletionMediaPointer>();
  for (const pointer of pointers) {
    const p = mediaPurgeDecision(pointer).resourcePointers.media[0], previous = result.get(p.assetId);
    result.set(p.assetId, previous ? mediaPurgeDecision({ assetId: p.assetId, objects: [...previous.objects, ...p.objects],
      deleteNotBefore: [previous.deleteNotBefore, p.deleteNotBefore].filter((x): x is string => x !== null).sort().pop() ?? null }).resourcePointers.media[0] : p);
  }
  return [...result.values()].sort((a, b) => compare(a.assetId, b.assetId));
}
export async function planAliases(tx: Prisma.TransactionClient, snapshot: Snapshot, erasedIds: Set<string>) {
  const existing = bounded(await tx.handleAlias.findMany({ take: MAX_ROWS + 1 }));
  const users = bounded(await tx.user.findMany({ select: { id: true, handle: true, status: true }, take: MAX_ROWS + 1 }));
  const userMap = new Map(users.map(u => [u.id, u]));
  const old = new Map(existing.map(a => [a.handle, a]));
  const currentHandles = new Map<string, typeof users>();
  for (const user of users) { const handle = user.handle.toLowerCase(); currentHandles.set(handle, [...(currentHandles.get(handle) ?? []), user]); }
  const plans: Array<{ handle: string; userId: string | null; createdAt: Date }> = [];
  for (const alias of snapshot.aliases) {
    const owner = alias.userId && userMap.get(alias.userId);
    const userId = owner && owner.status !== 'DELETED' && !erasedIds.has(owner.id) ? owner.id : null;
    const prior = old.get(alias.handle);
    if (prior && prior.userId !== userId && !(prior.userId && erasedIds.has(prior.userId) && userId === null)) fail('ALIAS_OWNERSHIP_CONFLICT');
    if ((currentHandles.get(alias.handle) ?? []).some(u => u.id !== userId && !erasedIds.has(u.id))) fail('ALIAS_CURRENT_HANDLE_CONFLICT');
    plans.push({ handle: alias.handle, userId, createdAt: new Date(alias.createdAt) });
  }
  return plans;
}
async function ownerlessGroups(tx: Prisma.TransactionClient): Promise<string[]> {
  const groups = bounded(await tx.group.findMany({ where: { isDeleted: false,
    members: { none: { role: GROUP_ROLES.OWNER, status: 'JOINED', user: { status: 'ACTIVE' } } } }, select: { id: true }, take: MAX_ROWS + 1, orderBy: { id: 'asc' } }));
  return groups.map(g => g.id);
}
export type ReplayPlan = { decisions: CanonicalDeletionDecision[]; aliases: Awaited<ReturnType<typeof planAliases>>; media: DeletionMediaPointer[]; unresolvedGroupIds: string[] };
export async function buildReplayPlan(db: PrismaClient, snapshot: Snapshot, window?: FenceWindow): Promise<ReplayPlan> {
  return readonly(db, snapshot.target, async tx => {
    const decisions = snapshotDecisions(snapshot);
    const erased = new Set(decisions.filter(d => d.subjectKind === 'ACCOUNT').map(d => d.subjectId));
    const aliases = await planAliases(tx, snapshot, erased);
    for (const decision of decisions) {
      const existing = await tx.deletionDecision.findUnique({ where: { id: decision.id } });
      if (existing) {
        const { recordedAt: _at, ...input } = existing;
        if (canonical(normalizeDeletionDecision(input)) !== canonical(decision)) fail('JOURNAL_REPLAY_CONFLICT');
      }
    }
    const pointers = decisions.flatMap(d => d.resourcePointers.media);
    const assets = bounded(await tx.mediaAsset.findMany({ where: { OR: [{ ownerId: { in: [...erased] } }, { id: { in: pointers.map(p => p.assetId) } }] }, include: { variants: true }, take: MAX_ROWS + 1 }));
    // A restored object must still belong to the owner encoded by captured keys.
    for (const asset of assets) for (const p of pointers.filter(p => p.assetId === asset.id)) {
      if (p.objects.some(o => o.key.split('/')[0] !== asset.ownerId)) fail('MEDIA_OWNER_CONFLICT');
    }
    return { decisions, aliases, media: mergeMediaPointers([...pointers, ...assets.map(captureDeletionMediaPointer)]), unresolvedGroupIds: await ownerlessGroups(tx) };
  }, window);
}
export type ReplayResult = { status: 'DRY_RUN' | 'RECONCILED_FENCE_REMAINS' | 'BLOCKED'; decisions: number; aliases: number; media: number; pendingMedia: number; unresolvedGroupIds: string[] };
export type ReplayDependencies = { remove: (bucket: string, keys: string[], signal: AbortSignal) => Promise<void>; checkpoint: (value: unknown) => Promise<void>; now?: () => Date };
export async function replaySnapshot(db: PrismaClient, snapshot: Snapshot, receipt: RestoreReceipt, apply: boolean, dependencies: ReplayDependencies): Promise<ReplayResult> {
  validateRestoreBinding(snapshot, receipt);
  const now = dependencies.now ?? (() => new Date());
  const window = fenceWindow(receipt.expiresAt, now);
  const assertWindow = window.assertOpen;
  assertWindow();
  const plan = await buildReplayPlan(db, snapshot, window);
  assertWindow();
  const summary = { decisions: plan.decisions.length, aliases: plan.aliases.length, media: plan.media.length, pendingMedia: 0, unresolvedGroupIds: plan.unresolvedGroupIds };
  if (!apply) return { ...summary, status: 'DRY_RUN' };
  // Persist the complete encrypted plan before the first mutation. A crash is
  // an unknown outcome, never a completion receipt. Every step is repeatable.
  await dependencies.checkpoint({ phase: 'PLANNED', artifactSha256: receipt.artifactSha256, plan });
  assertWindow();
  const unresolved = new Set(plan.unresolvedGroupIds);
  for (const decision of plan.decisions) {
    assertWindow();
    const result = await withinFence(db, receipt.target, window, async tx => {
      if (decision.subjectKind === 'ACCOUNT') return purgeAccount(tx, decision.subjectId, { decisionId: decision.id, replay: decision });
      await appendDeletionDecision(tx, decision);
      await tx.mediaAsset.updateMany({ where: { id: decision.subjectId }, data: { status: 'PENDING_DELETE', altText: null, checksum: null, moderationMetadata: Prisma.DbNull, errorCode: null } });
      return { unresolvedGroupIds: [] as string[] };
    });
    for (const id of result.unresolvedGroupIds) unresolved.add(id);
    await dependencies.checkpoint({ phase: 'DECISION_APPLIED', decisionId: decision.id, unresolvedGroupIds: [...unresolved].sort() });
    assertWindow();
  }
  assertWindow();
  await withinFence(db, receipt.target, window, async tx => {
    // Repeat the conflict check immediately before merging. Never steal a name.
    const erased = new Set(plan.decisions.filter(d => d.subjectKind === 'ACCOUNT').map(d => d.subjectId));
    for (const alias of await planAliases(tx, snapshot, erased)) await tx.handleAlias.upsert({ where: { handle: alias.handle }, create: alias, update: { userId: alias.userId } });
  });
  let pendingMedia = 0;
  for (const pointer of plan.media) {
    assertWindow();
    // Covers objects absent from the restored database and signed-upload grace.
    // Do not delete early, even if the DB no longer has the asset row.
    if (pointer.deleteNotBefore && Date.parse(pointer.deleteNotBefore) > now().getTime()) { pendingMedia++; continue; }
    await withinFence(db, receipt.target, window, async tx => {
      await appendDeletionDecision(tx, mediaPurgeDecision(pointer));
      await tx.mediaAsset.updateMany({ where: { id: pointer.assetId }, data: { status: 'PENDING_DELETE' } });
    });
    for (const bucket of [...new Set(pointer.objects.map(o => o.bucket))]) {
      assertWindow();
      await storageWithinFence(window, signal => dependencies.remove(bucket, pointer.objects.filter(o => o.bucket === bucket).map(o => o.key), signal));
      assertWindow();
    }
    await withinFence(db, receipt.target, window, async tx => {
      const asset = await tx.mediaAsset.findUnique({ where: { id: pointer.assetId }, include: { variants: true } });
      if (!asset) return;
      const current = captureDeletionMediaPointer(asset);
      if (current.objects.some(o => !pointer.objects.some(p => p.bucket === o.bucket && p.key === o.key)) ||
          (current.deleteNotBefore && Date.parse(current.deleteNotBefore) > now().getTime())) fail('MEDIA_CHANGED_DURING_FENCE');
      await tx.mediaVariant.deleteMany({ where: { mediaAssetId: pointer.assetId } });
      await tx.mediaAsset.update({ where: { id: pointer.assetId }, data: { status: 'DELETED', deletedAt: asset.deletedAt ?? now(), uploadBucket: null, uploadKey: null,
        storageCleanupNotBefore: null, altText: null, checksum: null, moderationMetadata: Prisma.DbNull, moderationStatus: 'NOT_REVIEWED', errorCode: null,
        sourceMime: null, sourceWidth: null, sourceHeight: null, sourceByteSize: null, aspectRatio: null, cropX: null, cropY: null, cropWidth: null, cropHeight: null, focalX: null, focalY: null } });
    });
    await dependencies.checkpoint({ phase: 'MEDIA_APPLIED', assetId: pointer.assetId });
    assertWindow();
  }
  // Query globally: memberships removed in a previous interrupted attempt no
  // longer reveal which groups lost their last owner. Never silently clear it.
  for (const id of await readonly(db, receipt.target, tx => ownerlessGroups(tx), window)) unresolved.add(id);
  assertWindow();
  const result: ReplayResult = { ...summary, pendingMedia, unresolvedGroupIds: [...unresolved].sort(), status: pendingMedia || unresolved.size ? 'BLOCKED' : 'RECONCILED_FENCE_REMAINS' };
  await dependencies.checkpoint({ phase: 'COMPLETE', result });
  assertWindow();
  return result;
}

export async function executeErasure(db: PrismaClient, receipt: ErasureReceipt, apply: boolean, checkpoint: ReplayDependencies['checkpoint'], now: () => Date = () => new Date()) {
  const window = fenceWindow(receipt.expiresAt, now);
  const preflight = await readonly(db, receipt.target, async tx => {
    const user = await tx.user.findUnique({ where: { id: receipt.subjectId }, select: { id: true } });
    if (!user) fail('ERASURE_SUBJECT_NOT_FOUND');
    const existing = await tx.deletionDecision.findUnique({ where: { id: receipt.decisionId } });
    if (existing && (existing.subjectId !== receipt.subjectId || existing.action !== 'ACCOUNT_ERASE')) fail('ERASURE_DECISION_CONFLICT');
    return { subjectId: receipt.subjectId, decisionId: receipt.decisionId };
  }, window);
  if (!apply) return { status: 'DRY_RUN' as const, ...preflight };
  window.assertOpen();
  await checkpoint({ phase: 'ERASURE_PLANNED', ...preflight, privacyRequestId: receipt.privacyRequest.id });
  window.assertOpen();
  const result = await withinFence(db, receipt.target, window, async tx => {
    return purgeAccount(tx, receipt.subjectId, { decisionId: receipt.decisionId });
  });
  const globalUnresolved = await readonly(db, receipt.target, tx => ownerlessGroups(tx), window);
  const unresolvedGroupIds = [...new Set([...result.unresolvedGroupIds, ...globalUnresolved])].sort();
  const status = unresolvedGroupIds.length ? 'BLOCKED' : 'ERASED_STORAGE_CLEANUP_PENDING';
  window.assertOpen();
  await checkpoint({ phase: 'ERASURE_COMMITTED', status, ...preflight, unresolvedGroupIds });
  window.assertOpen();
  return { status, ...preflight, unresolvedGroupIds };
}

export function parseArguments(argv: string[], accepted: string[]): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.+))?$/.exec(arg);
    if (!match) return fail('INVALID_ARGUMENTS');
    if (!accepted.includes(match[1]) || Object.prototype.hasOwnProperty.call(values, match[1]) || (match[1] !== 'apply' && !match[2]) || (match[1] === 'apply' && match[2])) fail('INVALID_ARGUMENTS');
    values[match[1]] = match[2] ?? true;
  }
  return values;
}
export const requiredArgument = (args: Record<string, string | boolean>, name: string): string => typeof args[name] === 'string' ? args[name] as string : fail('REQUIRED_ARGUMENT_MISSING');
export function openOperatorDatabase(receipt: ReviewedReceipt, env: NodeJS.ProcessEnv): PrismaClient {
  verifySourceRevision(receipt.sourceRevision);
  const url = validateTarget(receipt.target, env);
  return new PrismaClient({ datasources: { db: { url } }, log: [] });
}
export function protectedCheckpoints(directory: string, key: Buffer): ReplayDependencies['checkpoint'] {
  const resolved = assertOutsideGit(join(directory, 'placeholder'), true);
  if (!lstatSync(dirname(resolved)).isDirectory()) fail('CHECKPOINT_DIRECTORY_INVALID');
  return async value => writeProtectedNew(join(dirname(resolved), `${Date.now()}-${randomBytes(8).toString('hex')}.encrypted.json`), value, key);
}
export function sanitizedFailure(error: unknown): string {
  return error instanceof ReconciliationError ? error.code : 'RECONCILIATION_FAILED_REVIEW_REQUIRED';
}

export function verifySourceRevision(expected: string): void {
  const root = resolve(__dirname, '../../..');
  try {
    const args = ['-c', 'safe.directory=' + root, '-C', root];
    const head = execFileSync('git', [...args, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
    const dirty = execFileSync('git', [...args, 'status', '--porcelain', '--untracked-files=all', '--', 'server/src', 'server/prisma', 'server/package.json', 'server/package-lock.json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
    if (head !== expected || dirty) fail('SOURCE_REVISION_NOT_VERIFIED');
  } catch { fail('SOURCE_REVISION_NOT_VERIFIED'); }
}
