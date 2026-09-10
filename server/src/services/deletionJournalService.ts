import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { MEDIA_CONFIG, isHeifMediaMime } from '../config/media';

export type DeletionMediaPointer = {
  assetId: string;
  objects: Array<{ bucket: string; key: string }>;
  deleteNotBefore: string | null;
};
export type DeletionResourcePointers = { media: DeletionMediaPointer[] };
export type DeletionDecisionInput = {
  id: string;
  subjectKind: 'ACCOUNT' | 'MEDIA';
  subjectId: string;
  action: 'ACCOUNT_ERASE' | 'MEDIA_PURGE';
  actionVersion?: 1;
  resourcePointers: DeletionResourcePointers;
};
export type CanonicalDeletionDecision = Omit<DeletionDecisionInput, 'actionVersion'> & { actionVersion: 1 };
export class DeletionJournalError extends Error {
  constructor(public code: 'INVALID_DELETION_DECISION' | 'DELETION_DECISION_CONFLICT') { super(code); }
}
const invalid = (): never => { throw new DeletionJournalError('INVALID_DELETION_DECISION'); };
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
};
const only = (value: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(value).some(key => !keys.includes(key))) invalid();
};
const identifier = (value: unknown, limit = 128): string => {
  if (typeof value !== 'string' || !value.length || value.length > limit || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value)) return invalid();
  return value;
};

// Intentionally stores only exact object references, never a URL, credential,
// free-form reason, profile field or content. Restore tooling uses this same
// validator before it can issue an exact-key storage deletion.
export function normalizeDeletionResourcePointers(input: unknown, subjectKind: 'ACCOUNT' | 'MEDIA', subjectId: string): DeletionResourcePointers {
  const pointers = record(input); only(pointers, ['media']);
  if (!Array.isArray(pointers.media)) return invalid();
  const media = pointers.media.map(value => {
    const pointer = record(value); only(pointer, ['assetId', 'objects', 'deleteNotBefore']);
    const assetId = identifier(pointer.assetId);
    if (subjectKind === 'MEDIA' && assetId !== subjectId) return invalid();
    if (!Array.isArray(pointer.objects)) return invalid();
    const objects = pointer.objects.map(value => {
      const object = record(value); only(object, ['bucket', 'key']);
      if (typeof object.bucket !== 'string' || !(Object.values(MEDIA_CONFIG.buckets) as string[]).includes(object.bucket)) return invalid();
      if (typeof object.key !== 'string' || object.key.length > 1024 || !/^[A-Za-z0-9_./-]+$/.test(object.key)) return invalid();
      const segments = object.key.split('/');
      if (segments.length < 3 || segments.some(segment => !segment || segment === '.' || segment === '..') || segments[1] !== assetId) return invalid();
      if (subjectKind === 'ACCOUNT' && segments[0] !== subjectId) return invalid();
      return { bucket: object.bucket, key: object.key };
    });
    const unique = [...new Map(objects.map(object => [JSON.stringify(object), object])).values()]
      .sort((a, b) => compareText(a.bucket, b.bucket) || compareText(a.key, b.key));
    const deadline = pointer.deleteNotBefore;
    if (deadline !== null && (typeof deadline !== 'string' || !Number.isFinite(Date.parse(deadline)) || new Date(deadline).toISOString() !== deadline)) return invalid();
    return { assetId, objects: unique, deleteNotBefore: deadline as string | null };
  }).sort((a, b) => compareText(a.assetId, b.assetId));
  if (new Set(media.map(pointer => pointer.assetId)).size !== media.length) return invalid();
  if (subjectKind === 'MEDIA' && media.length !== 1) return invalid();
  return { media };
}

export function normalizeDeletionDecision(input: unknown): CanonicalDeletionDecision {
  const value = record(input);
  only(value, ['id', 'subjectKind', 'subjectId', 'action', 'actionVersion', 'resourcePointers']);
  const id = identifier(value.id, 320), subjectId = identifier(value.subjectId);
  if (!((value.subjectKind === 'ACCOUNT' && value.action === 'ACCOUNT_ERASE') || (value.subjectKind === 'MEDIA' && value.action === 'MEDIA_PURGE'))) return invalid();
  if (value.actionVersion !== undefined && value.actionVersion !== 1) return invalid();
  return { id, subjectKind: value.subjectKind, subjectId, action: value.action, actionVersion: 1,
    resourcePointers: normalizeDeletionResourcePointers(value.resourcePointers, value.subjectKind, subjectId) };
}

export async function appendDeletionDecision(tx: Prisma.TransactionClient, input: DeletionDecisionInput) {
  const decision = normalizeDeletionDecision(input);
  // Serialize same-ID attempts before INSERT: a unique violation would poison
  // the enclosing erasure transaction in PostgreSQL.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('deletion-decision'), hashtext(${decision.id}))`;
  const existing = await tx.deletionDecision.findUnique({ where: { id: decision.id } });
  if (existing) {
    const { recordedAt: _recordedAt, ...scope } = existing;
    if (JSON.stringify(normalizeDeletionDecision(scope)) !== JSON.stringify(decision)) throw new DeletionJournalError('DELETION_DECISION_CONFLICT');
    return existing;
  }
  return tx.deletionDecision.create({ data: { ...decision, resourcePointers: decision.resourcePointers as Prisma.InputJsonValue } });
}

type MediaPointerSource = {
  id: string; ownerId: string; sourceMime: string | null; uploadBucket: string | null; uploadKey: string | null;
  storageCleanupNotBefore: Date | null; variants: Array<{ storageBucket: string; storageKey: string }>;
};
export function captureDeletionMediaPointer(asset: MediaPointerSource): DeletionMediaPointer {
  if (Boolean(asset.uploadBucket) !== Boolean(asset.uploadKey)) return invalid();
  const objects = asset.variants.map(variant => ({ bucket: variant.storageBucket, key: variant.storageKey }));
  if (asset.uploadBucket && asset.uploadKey) objects.push({ bucket: asset.uploadBucket, key: asset.uploadKey });
  if (asset.sourceMime && isHeifMediaMime(asset.sourceMime)) objects.push({ bucket: MEDIA_CONFIG.buckets.originals, key: `${asset.ownerId}/${asset.id}/prepared.webp` });
  return normalizeDeletionResourcePointers({ media: [{ assetId: asset.id, objects, deleteNotBefore: asset.storageCleanupNotBefore?.toISOString() ?? null }] }, 'MEDIA', asset.id).media[0];
}

export function mediaPurgeDecision(pointer: DeletionMediaPointer): CanonicalDeletionDecision {
  const resourcePointers = normalizeDeletionResourcePointers({ media: [pointer] }, 'MEDIA', pointer.assetId);
  const digest = createHash('sha256').update(JSON.stringify(resourcePointers)).digest('hex');
  return normalizeDeletionDecision({ id: `media-purge:${pointer.assetId}:${digest}`, subjectKind: 'MEDIA', subjectId: pointer.assetId,
    action: 'MEDIA_PURGE', resourcePointers });
}
