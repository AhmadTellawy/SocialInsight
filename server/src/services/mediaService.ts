import {
  MediaAccessScope,
  MediaAsset,
  MediaPurpose,
  MediaVariant,
  Prisma
} from '@prisma/client';
import prisma from '../prisma';
import { createHash, randomUUID } from 'crypto';
import sharp from 'sharp';
import { lockAccountSecurity, AccountSecurityError } from './mfaService';
import { MEDIA_CONFIG, isAllowedMediaMime, isHeifMediaMime, isSupportedSourceMime, maxInputBytesForPurpose } from '../config/media';
import { convertHeifRemotely, HeifConversionError, isHeifConversionConfigured, verifyHeifConversionReadiness } from './heifConversionClient';
import { inspectHeifBuffer } from './heifInspection';
import { GroupPermissionService } from './groupPermissionService';
import { PrivacyService } from './privacyService';
import { getMediaStorage, isMediaStorageConfigured } from './mediaStorage';
import { appendDeletionDecision, captureDeletionMediaPointer, mediaPurgeDecision } from './deletionJournalService';
import {
  MediaCropRequest,
  MediaValidationError,
  ProcessedMediaVariant,
  processMediaBuffer
} from './mediaProcessor';

const mimeExtension: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif'
};

const addHours = (date: Date, hours: number): Date => new Date(date.getTime() + hours * 60 * 60 * 1000);
type AuthorizeMediaWrite = (tx: Prisma.TransactionClient) => Promise<unknown>;
const MEDIA_OPERATION_TIMEOUT_MS = 60_000;
const PROCESSING_LEASE_MS = 15 * 60_000;
const SOURCE_UPLOAD_LIFETIME_MS = (7200 + 300) * 1000;
// MediaAsset is the durable reservation ledger. These account-level ceilings
// are derived from the product's per-file, post-gallery, and concurrency limits
// so a caller cannot mint unlimited upload capabilities or reserve storage.
const OWNER_MAX_ACTIVE_ASSETS = MEDIA_CONFIG.maxPostImages * 128;
const OWNER_MAX_ACTIVE_SOURCE_BYTES = MEDIA_CONFIG.maxInputBytes * MEDIA_CONFIG.maxPostImages * MEDIA_CONFIG.maxUploadConcurrency * 4;
const OWNER_MAX_TRANSIENT_ASSETS = MEDIA_CONFIG.maxUploadConcurrency;
export const PUBLIC_MEDIA_CACHE_SECONDS = 300;

// A scope transition owns its storage keys until its I/O has actually settled.
// No elapsed lease can prove a stopped writer will not later expose a public copy.
export const mediaScopeRuntimeId = randomUUID();
let scopeRuntimeAnnounced = false;
const announceScopeRuntime = () => {
  if (scopeRuntimeAnnounced) return;
  scopeRuntimeAnnounced = true;
  console.info(JSON.stringify({
    event: 'media_scope_runtime',
    runtimeId: mediaScopeRuntimeId,
    pid: process.pid,
    processStartedAt: new Date(Date.now() - process.uptime() * 1000).toISOString()
  }));
};
const MEDIA_SCOPE_OPERATION_PREFIX = 'MEDIA_SCOPE:';
const isMediaScopeOperation = (code: string | null | undefined): boolean =>
  Boolean(code?.startsWith(MEDIA_SCOPE_OPERATION_PREFIX));
const scopeOperationAvailableWhere: Prisma.MediaAssetWhereInput = {
  OR: [{ errorCode: null }, { NOT: { errorCode: { startsWith: MEDIA_SCOPE_OPERATION_PREFIX } } }]
};
const mediaBusy = () => new MediaValidationError(
  'MEDIA_BUSY',
  'Image processing is still in progress. Retry shortly or upload the image again.',
  409
);

const assertMediaWriter = async (tx: Prisma.TransactionClient, ownerId: string, authorize?: AuthorizeMediaWrite) => {
  await lockAccountSecurity(tx, ownerId);
  if (authorize) await authorize(tx);
  const owner = await tx.user.findUnique({ where: { id: ownerId }, select: { status: true } });
  if (owner?.status !== 'ACTIVE') throw new AccountSecurityError('AUTH_REQUIRED', 401);
};
const boundedMediaOperation = async <T>(operation: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new MediaValidationError('MEDIA_OPERATION_TIMEOUT', 'Image processing timed out. Please try again.', 503)), MEDIA_OPERATION_TIMEOUT_MS); })]);
  } finally { if (timer) clearTimeout(timer); }
};

let decoderOperationsActive = 0;
const acquireDecoderAdmission = () => {
  if (decoderOperationsActive >= MEDIA_CONFIG.maxUploadConcurrency) {
    throw new MediaValidationError('MEDIA_PROCESSING_LIMIT', 'Image processing is busy. Please retry.', 429);
  }
  decoderOperationsActive += 1;
  let pending = 0, closed = false, released = false;
  const releaseIfSettled = () => {
    if (closed && pending === 0 && !released) { released = true; decoderOperationsActive -= 1; }
  };
  const track = <T>(operation: Promise<T>): Promise<T> => {
    pending += 1;
    const settled = () => { pending -= 1; releaseIfSettled(); };
    void operation.then(settled, settled);
    return operation;
  };
  return { track, close: () => { closed = true; releaseIfSettled(); } };
};

const activeOwnerMediaWhere = (ownerId: string): Prisma.MediaAssetWhereInput => ({
  ownerId,
  deletedAt: null,
  status: { notIn: ['PENDING_DELETE', 'DELETED'] }
});

const reclaimStaleOwnerProcessing = async (tx: Prisma.TransactionClient, ownerId: string): Promise<void> => {
  await tx.mediaAsset.updateMany({
    where: {
      ownerId,
      status: 'PROCESSING',
      deletedAt: null,
      updatedAt: { lte: new Date(Date.now() - PROCESSING_LEASE_MS) }
    },
    data: { status: 'FAILED', errorCode: 'PROCESSING_LEASE_EXPIRED' }
  });
};

const assertOwnerUploadCapacity = async (
  tx: Prisma.TransactionClient,
  ownerId: string,
  requestedBytes: number
): Promise<void> => {
  await reclaimStaleOwnerProcessing(tx, ownerId);
  const assets = await tx.mediaAsset.findMany({
    where: activeOwnerMediaWhere(ownerId),
    select: { status: true, sourceByteSize: true }
  });
  const transientCount = assets.filter(asset => asset.status === 'TEMPORARY' || asset.status === 'PROCESSING').length;
  const sourceBytes = assets.reduce((total, asset) => total + (asset.sourceByteSize || 0), 0);
  if (transientCount >= OWNER_MAX_TRANSIENT_ASSETS
    || assets.length >= OWNER_MAX_ACTIVE_ASSETS
    || sourceBytes + requestedBytes > OWNER_MAX_ACTIVE_SOURCE_BYTES) {
    throw new MediaValidationError('MEDIA_UPLOAD_QUOTA_EXCEEDED', 'Too many images are already active for this account.', 429);
  }
};

const assertOwnerProcessingCapacity = async (tx: Prisma.TransactionClient, ownerId: string): Promise<void> => {
  await reclaimStaleOwnerProcessing(tx, ownerId);
  const active = await tx.mediaAsset.count({ where: { ownerId, status: 'PROCESSING', deletedAt: null } });
  if (active >= MEDIA_CONFIG.maxUploadConcurrency) {
    throw new MediaValidationError('MEDIA_PROCESSING_LIMIT', 'Too many images are already being processed for this account.', 429);
  }
};

// Process-local admission bounds source/output buffers before any HEIF lease or download.
// No queue: a disconnected/timed-out caller does not free capacity while its provider
// still owns a buffer or a late-write cleanup is pending.
let heifPreparationActive = false;
const acquireHeifPreparation = () => {
  if (heifPreparationActive) throw new HeifConversionError('HEIF_CONVERTER_BUSY', 'Image preparation is busy. Please retry.', 429, 1);
  heifPreparationActive = true;
  let pending = 0, closed = false, released = false;
  const releaseIfSettled = () => {
    if (closed && pending === 0 && !released) { released = true; heifPreparationActive = false; }
  };
  const track = <T>(operation: Promise<T>): Promise<T> => {
    pending++;
    const settled = () => { pending--; releaseIfSettled(); };
    void operation.then(settled, settled);
    return operation;
  };
  const wait = async <T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> => {
    track(operation);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      return await new Promise<T>((resolve, reject) => {
        onAbort = () => reject(new MediaValidationError('MEDIA_PROCESSING_CANCELLED', 'Image preparation was cancelled.', 409));
        timer = setTimeout(() => reject(new MediaValidationError('MEDIA_OPERATION_TIMEOUT', 'Image processing timed out. Please try again.', 503)), MEDIA_OPERATION_TIMEOUT_MS);
        signal?.addEventListener('abort', onAbort, { once: true });
        operation.then(resolve, reject);
        if (signal?.aborted) onAbort();
      });
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
    }
  };
  // The converter intentionally races cancellation against fetch/body operations.
  // Observe their actual settlement here without changing its readiness/deadline policy.
  const trackedFetch: typeof fetch = (input, init) => track((async () => {
    const response = await fetch(input, init);
    if (!response.body) return response;
    const reader = response.body.getReader();
    let finishBody!: () => void;
    track(new Promise<void>(resolve => { finishBody = resolve; }));
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const result = await track(reader.read());
          if (result.done) { finishBody(); reader.releaseLock(); controller.close(); }
          else controller.enqueue(result.value);
        } catch (error) { finishBody(); controller.error(error); }
      },
      async cancel(reason) {
        try { await track(reader.cancel(reason)); }
        finally { finishBody(); reader.releaseLock(); }
      }
    }, { highWaterMark: 0 });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  })());
  return { track, wait, fetch: trackedFetch, close: () => { closed = true; releaseIfSettled(); } };
};

const variantKey = (asset: Pick<MediaAsset, 'id' | 'ownerId'>, visibility: 'private' | 'public', width: number): string =>
  `${asset.ownerId}/${asset.id}/${visibility}/${width}.webp`;

const masterKey = (asset: Pick<MediaAsset, 'id' | 'ownerId'>): string =>
  `${asset.ownerId}/${asset.id}/master.webp`;

// One preparation attempt per asset. This exact private source remains known
// after MASTER is replaced during crop/finalize; purge removes it explicitly.
const preparedKey = (asset: Pick<MediaAsset, 'id' | 'ownerId'>): string =>
  `${asset.ownerId}/${asset.id}/prepared.webp`;

const sourceKey = (ownerId: string, assetId: string, mime: string): string =>
  `${ownerId}/${assetId}/upload.${mimeExtension[mime]}`;

type StorageObject = { bucket: string; key: string };

const groupStorageObjects = (objects: StorageObject[]): Map<string, string[]> => {
  const grouped = new Map<string, string[]>();
  for (const object of objects) {
    const keys = grouped.get(object.bucket) || [];
    keys.push(object.key);
    grouped.set(object.bucket, keys);
  }
  return grouped;
};

export type MediaPresentation = {
  id: string;
  access: 'PUBLIC' | 'RESTRICTED';
  aspectRatio: number;
  focalX: number;
  focalY: number;
  altText: string | null;
  width: number;
  height: number;
  src?: string;
  srcSet?: string;
  sources?: Array<{ src: string; width: number; height: number }>;
  requiresAuth?: boolean;
};

const privateAttachmentWhere: Prisma.MediaAssetWhereInput = {
  accessScope: { not: 'PUBLIC' },
  variants: { none: { isPublic: true } }
};

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

const presentationFocalPoint = (
  asset: Pick<MediaAsset, 'cropX' | 'cropY' | 'cropWidth' | 'cropHeight' | 'focalX' | 'focalY'>
): { focalX: number; focalY: number } => {
  const cropX = asset.cropX ?? 0;
  const cropY = asset.cropY ?? 0;
  const cropWidth = asset.cropWidth && asset.cropWidth > 0 ? asset.cropWidth : 1;
  const cropHeight = asset.cropHeight && asset.cropHeight > 0 ? asset.cropHeight : 1;
  const focalX = asset.focalX ?? cropX + cropWidth / 2;
  const focalY = asset.focalY ?? cropY + cropHeight / 2;
  return {
    focalX: clampUnit((focalX - cropX) / cropWidth),
    focalY: clampUnit((focalY - cropY) / cropHeight)
  };
};

export type MediaAttachmentRequirement = {
  id: string;
  purpose: MediaPurpose;
};

export type PreparedMediaAttachment = {
  assetIds: string[];
  scope: MediaAccessScope;
  promotedAssetIds: string[];
};

export type PreparedMediaScopeChange = {
  assetIds: string[];
  scope: MediaAccessScope;
  promoted: Array<{ id: string; previousScope: MediaAccessScope }>;
  demoteAfterCommit: string[];
};

export const PUBLIC_AVATAR_MEDIA_SELECT = {
  isPrivate: true,
  mediaPrivacyTarget: true,
  status: true,
  avatarMediaId: true,
  avatarMedia: { include: { variants: true, owner: { select: { isPrivate: true, mediaPrivacyTarget: true, status: true } } } }
} as const;

// Compact identity cards never include profile biography or contact/location
// details. Those fields require the dedicated profile visibility decision.
export const PUBLIC_USER_CARD_SELECT = {
  id: true, name: true, handle: true, avatar: true, ...PUBLIC_AVATAR_MEDIA_SELECT,
  verifiedBadge: true, followersCount: true, followingCount: true
} as const;

export const PROFILE_COVER_MEDIA_SELECT = {
  coverMediaId: true,
  coverMedia: { include: { variants: true } }
} as const;

export const PUBLIC_GROUP_MEDIA_INCLUDE = {
  imageMedia: { include: { variants: true } }
} as const;

export const POST_MEDIA_INCLUDE = {
  orderBy: { sortOrder: 'asc' as const },
  include: { mediaAsset: { include: { variants: true } } }
} as const;

const publicPresentation = (
  asset: MediaAsset & { variants: MediaVariant[] }
): MediaPresentation | null => {
  const storage = getMediaStorage();
  const variants = asset.variants.filter((variant) => variant.isPublic).sort((a, b) => a.width - b.width);
  if (variants.length === 0 || !asset.aspectRatio) return null;
  const largest = variants[variants.length - 1];
  return {
    id: asset.id,
    access: 'PUBLIC',
    aspectRatio: asset.aspectRatio,
    ...presentationFocalPoint(asset),
    altText: asset.altText,
    width: largest.width,
    height: largest.height,
    src: storage.getPublicUrl(largest.storageBucket, largest.storageKey),
    srcSet: variants.map((variant) => `${storage.getPublicUrl(variant.storageBucket, variant.storageKey)} ${variant.width}w`).join(', ')
  };
};

export const getMediaConfigResponse = async () => {
  const heifServerPreparationEnabled = await verifyHeifConversionReadiness();
  return {
  enabled: isMediaStorageConfigured(),
  maxPostImages: MEDIA_CONFIG.maxPostImages,
  maxInputBytes: MEDIA_CONFIG.maxInputBytes,
  maxCoverInputBytes: MEDIA_CONFIG.maxCoverInputBytes,
  maxDecodedPixels: MEDIA_CONFIG.maxDecodedPixels,
  maxUploadConcurrency: MEDIA_CONFIG.maxUploadConcurrency,
  minAspectRatio: MEDIA_CONFIG.minAspectRatio,
  maxAspectRatio: MEDIA_CONFIG.maxAspectRatio,
  allowedMimeTypes: heifServerPreparationEnabled
    ? [...MEDIA_CONFIG.allowedMimeTypes, ...MEDIA_CONFIG.heifMimeTypes]
    : [...MEDIA_CONFIG.allowedMimeTypes],
  heifServerPreparationEnabled,
  heifServerPreparationConfigured: isHeifConversionConfigured()
  };
};

export const createMediaUpload = async (
  ownerId: string,
  purpose: MediaPurpose,
  declaredMime: string,
  declaredSize: number,
  altText?: string,
  authorize?: AuthorizeMediaWrite
) => {
  if (!isSupportedSourceMime(declaredMime)) {
    throw new MediaValidationError('UNSUPPORTED_MEDIA_TYPE', 'Only JPEG, PNG, WebP, HEIC, and HEIF images are supported.');
  }
  if (isHeifMediaMime(declaredMime) && !(await verifyHeifConversionReadiness())) {
    throw new MediaValidationError('HEIF_CONVERTER_UNAVAILABLE', 'HEIC/HEIF preparation is temporarily unavailable.', 503);
  }
  const maxInputBytes = maxInputBytesForPurpose(purpose);
  if (!Number.isInteger(declaredSize) || declaredSize <= 0 || declaredSize > maxInputBytes) {
    throw new MediaValidationError('INVALID_FILE_SIZE', `Image must be no larger than ${Math.floor(maxInputBytes / 1024 / 1024)} MB.`);
  }

  const assetId = randomUUID();
  const key = sourceKey(ownerId, assetId, declaredMime);
  const asset = await prisma.$transaction(async tx => {
    await assertMediaWriter(tx, ownerId, authorize);
    await assertOwnerUploadCapacity(tx, ownerId, declaredSize);
    return tx.mediaAsset.create({
    data: {
      id: assetId,
      ownerId,
      purpose,
      sourceMime: declaredMime,
      sourceByteSize: declaredSize,
      altText: altText?.trim() || null,
      uploadBucket: MEDIA_CONFIG.buckets.originals,
      uploadKey: key,
      sourceCleanupNotBefore: new Date(Date.now() + SOURCE_UPLOAD_LIFETIME_MS),
      expiresAt: addHours(new Date(), MEDIA_CONFIG.temporaryLifetimeHours)
    }
    });
  });

  try {
    const upload = await boundedMediaOperation(getMediaStorage().createSignedUpload(MEDIA_CONFIG.buckets.originals, key));
    await prisma.$transaction(async tx => {
      await assertMediaWriter(tx, ownerId, authorize);
      const fresh = await tx.mediaAsset.findUnique({ where: { id: asset.id }, select: { status: true, deletedAt: true } });
      if (fresh?.status !== 'TEMPORARY' || fresh.deletedAt) throw new MediaValidationError('MEDIA_NOT_FOUND', 'Media asset was removed.', 404);
      await tx.mediaAsset.update({ where: { id: asset.id }, data: { sourceCleanupNotBefore: new Date(Date.now() + SOURCE_UPLOAD_LIFETIME_MS) } });
    });
    return {
      assetId: asset.id,
      bucket: MEDIA_CONFIG.buckets.originals,
      path: upload.path,
      token: upload.token,
      signedUrl: upload.signedUrl,
      expiresInSeconds: 7200
    };
  } catch (error) {
    // Keep the exact source key until every issued capability has expired.
    await scheduleMediaDeletion([asset.id]).catch(() => undefined);
    throw error;
  }
};

const processedVariantRecord = (
  asset: MediaAsset,
  variant: ProcessedMediaVariant,
  bucket: string,
  key: string,
  isPublic: boolean
) => {
  return {
    mediaAssetId: asset.id,
    kind: variant.kind,
    storageBucket: bucket,
    storageKey: key,
    width: variant.width,
    height: variant.height,
    mime: variant.mime,
    byteSize: variant.buffer.length,
    isPublic
  };
};

const validatePreparedWebp = async (
  buffer: Buffer,
  track: <T>(operation: Promise<T>) => Promise<T> = operation => operation
): Promise<{ width: number; height: number }> => {
  if (!buffer.length || buffer.length > MEDIA_CONFIG.maxPreparedOutputBytes) {
    throw new MediaValidationError('HEIF_OUTPUT_TOO_LARGE', 'The converted image exceeds the safe output limit.');
  }
  try {
    const options = { failOn: 'error' as const, limitInputPixels: MEDIA_CONFIG.maxDecodedPixels };
    const metadata = await track(sharp(buffer, options).metadata());
    const width = metadata.width || 0, height = metadata.height || 0;
    if (metadata.format !== 'webp' || (metadata.pages || 1) !== 1
      || width <= 0 || height <= 0 || width > MEDIA_CONFIG.maxMasterEdge || height > MEDIA_CONFIG.maxMasterEdge
      || width * height > MEDIA_CONFIG.maxDecodedPixels || metadata.exif || metadata.xmp || metadata.iptc || metadata.icc) {
      throw new Error('Unsafe converted output');
    }
    // Metadata parsing alone does not prove the compressed payload can decode.
    await track(sharp(buffer, options).raw().toBuffer());
    return { width, height };
  } catch {
    throw new MediaValidationError('HEIF_CONVERSION_FAILED', 'The converted HEIC/HEIF image failed validation.');
  }
};

export const prepareMediaUpload = async (ownerId: string, assetId: string, authorize?: AuthorizeMediaWrite, signal?: AbortSignal) => {
  const assertNotCancelled = () => {
    if (signal?.aborted) throw new MediaValidationError('MEDIA_PROCESSING_CANCELLED', 'Image preparation was cancelled.', 409);
  };
  assertNotCancelled();
  const decoderAdmission = acquireDecoderAdmission();
  let admission: ReturnType<typeof acquireHeifPreparation> | undefined;
  try {
  const lease = `HEIF_PREPARING:${randomUUID()}`;
  const deadline = Date.now() + PROCESSING_LEASE_MS;
  const claimed = await prisma.$transaction(async tx => {
    await assertMediaWriter(tx, ownerId, authorize);
    await assertOwnerProcessingCapacity(tx, ownerId);
    const asset = await tx.mediaAsset.findUnique({ where: { id: assetId }, include: { variants: true } });
    if (!asset || asset.ownerId !== ownerId || asset.deletedAt) throw new MediaValidationError('MEDIA_NOT_FOUND', 'Media asset was not found.', 404);
    if (!asset.sourceMime || !isHeifMediaMime(asset.sourceMime)) throw new MediaValidationError('MEDIA_PREPARATION_NOT_REQUIRED', 'This image does not require preparation.', 409);
    if (!['TEMPORARY', 'FAILED'].includes(asset.status)) throw new MediaValidationError('MEDIA_BUSY', 'This image cannot be prepared in its current state.', 409);
    assertNotCancelled();
    admission = acquireHeifPreparation();
    if (asset.checksum && asset.sourceWidth && asset.sourceHeight) return { asset, alreadyPrepared: true };
    // A failed attempt may still have a late provider write. Retry with a fresh
    // upload/asset instead of allowing two writers to share the prepared key.
    if (asset.status === 'FAILED') throw new MediaValidationError('MEDIA_REUPLOAD_REQUIRED', 'Select the image again to retry preparation.', 409);
    if (!asset.uploadBucket || !asset.uploadKey || !asset.sourceByteSize) throw new MediaValidationError('UPLOAD_NOT_READY', 'The source upload is not available.', 409);
    const result = await tx.mediaAsset.updateMany({
      where: { id: asset.id, status: 'TEMPORARY', updatedAt: asset.updatedAt, deletedAt: null },
      data: { status: 'PROCESSING', errorCode: lease, storageCleanupNotBefore: new Date(Math.max(asset.storageCleanupNotBefore?.getTime() || 0, deadline)) }
    });
    if (result.count !== 1) throw new MediaValidationError('MEDIA_BUSY', 'This image is already being prepared.', 409);
    return { asset, alreadyPrepared: false };
  });
  const preparation = admission!;
  const { asset } = claimed;
  const bucket = MEDIA_CONFIG.buckets.originals, key = preparedKey(asset);
  const assertPreparation = async (tx: Prisma.TransactionClient) => {
    assertNotCancelled();
    await assertMediaWriter(tx, ownerId, authorize);
    const current = await tx.mediaAsset.findUnique({ where: { id: asset.id }, select: { status: true, errorCode: true, deletedAt: true } });
    if (current?.status !== 'PROCESSING' || current.errorCode !== lease || current.deletedAt || Date.now() >= deadline) {
      throw new MediaValidationError('MEDIA_PROCESSING_CANCELLED', 'Image preparation was cancelled.', 409);
    }
  };
  let width = asset.sourceWidth || 0, height = asset.sourceHeight || 0;
  if (!claimed.alreadyPrepared) {
    try {
      const ready = await verifyHeifConversionReadiness(false, preparation.fetch, { signal });
      assertNotCancelled();
      if (!ready) throw new MediaValidationError('HEIF_CONVERTER_UNAVAILABLE', 'HEIC/HEIF preparation is temporarily unavailable.', 503);
      const source = await preparation.wait(getMediaStorage().download(asset.uploadBucket!, asset.uploadKey!), signal);
      assertNotCancelled();
      if (source.length !== asset.sourceByteSize || source.length > maxInputBytesForPurpose(asset.purpose)) throw new MediaValidationError('INVALID_FILE_SIZE', 'The source image size does not match the upload.');
      inspectHeifBuffer(source);
      const converted = await convertHeifRemotely(source, asset.sourceMime as 'image/heic' | 'image/heif', preparation.fetch, signal);
      ({ width, height } = await validatePreparedWebp(converted, decoderAdmission.track));
      const record = { mediaAssetId: asset.id, kind: 'MASTER' as const, storageBucket: bucket, storageKey: key, width, height, mime: 'image/webp', byteSize: converted.length, isPublic: false };
      await prisma.$transaction(async tx => {
        await assertPreparation(tx);
        await tx.mediaVariant.create({ data: record });
      });
      assertNotCancelled();
      const upload = getMediaStorage().upload(bucket, key, converted, 'image/webp', '0');
      try { await preparation.wait(upload, signal); }
      catch (error) {
        void preparation.track(upload.then(() => getMediaStorage().remove(bucket, [key])).catch(() => undefined));
        throw error;
      }
      await prisma.$transaction(async tx => {
        await assertPreparation(tx);
        await tx.mediaAsset.update({ where: { id: asset.id }, data: {
          status: 'TEMPORARY', errorCode: null, sourceWidth: width, sourceHeight: height,
          checksum: createHash('sha256').update(source).digest('hex'),
          storageCleanupNotBefore: null
        } });
      });
      // Preserve the original key in the durable ledger until the signed
      // upload capability expires, even after removing the original bytes.
      await preparation.wait(getMediaStorage().remove(asset.uploadBucket!, [asset.uploadKey!])).catch(() => undefined);
    } catch (error) {
      await preparation.wait(getMediaStorage().remove(bucket, [key])).catch(() => undefined);
      await prisma.mediaAsset.updateMany({
        where: { id: asset.id, status: 'PROCESSING', errorCode: lease, deletedAt: null },
        data: { status: 'FAILED', errorCode: error instanceof MediaValidationError ? error.code : 'HEIF_CONVERSION_FAILED' }
      }).catch(() => undefined);
      throw error;
    }
  }
  // A session can be revoked or its account deleted while the converter runs.
  assertNotCancelled();
  const src = await preparation.wait(getMediaStorage().createSignedReadUrl(bucket, key, MEDIA_CONFIG.privateUrlLifetimeSeconds), signal);
  await prisma.$transaction(async tx => {
    assertNotCancelled();
    await assertMediaWriter(tx, ownerId, authorize);
    const current = await tx.mediaAsset.findUnique({ where: { id: asset.id }, select: { status: true, checksum: true, deletedAt: true } });
    if (!current || current.deletedAt || !current.checksum || !['TEMPORARY', 'FAILED'].includes(current.status)) throw new MediaValidationError('MEDIA_NOT_FOUND', 'Media asset was removed.', 404);
  });
  assertNotCancelled();
  return { id: asset.id, status: 'TEMPORARY' as const, sourceMime: asset.sourceMime as 'image/heic' | 'image/heif',
    preview: { src, mime: 'image/webp' as const, width, height, aspectRatio: width / height, expiresInSeconds: MEDIA_CONFIG.privateUrlLifetimeSeconds } };
  } finally { admission?.close(); decoderAdmission.close(); }
};

export const finalizeMediaUpload = async (ownerId: string, assetId: string, request: MediaCropRequest, authorize?: AuthorizeMediaWrite) => {
  const decoderAdmission = acquireDecoderAdmission();
  try {
  const processingDeadline = Date.now() + PROCESSING_LEASE_MS;
  const asset = await prisma.$transaction(async tx => {
  await assertMediaWriter(tx, ownerId, authorize);
  await assertOwnerProcessingCapacity(tx, ownerId);
  const asset = await tx.mediaAsset.findUnique({ where: { id: assetId }, include: { variants: true } });
  if (!asset || asset.ownerId !== ownerId || asset.deletedAt) {
    throw new MediaValidationError('MEDIA_NOT_FOUND', 'Media asset was not found.', 404);
  }
  const isPrepared = Boolean(asset.sourceMime && isHeifMediaMime(asset.sourceMime));
  if (isPrepared && (!asset.checksum || !asset.sourceWidth || !asset.sourceHeight)) {
    throw new MediaValidationError('MEDIA_NOT_PREPARED', 'Prepare the HEIC/HEIF image before applying a crop.', 409);
  }
  if (!asset.sourceMime || (!isPrepared && (!asset.uploadBucket || !asset.uploadKey))) {
    throw new MediaValidationError('UPLOAD_NOT_READY', 'The source upload is not available.', 409);
  }
  if (asset.status === 'ATTACHED') {
    throw new MediaValidationError('MEDIA_ALREADY_ATTACHED', 'Attached media cannot be finalized again.', 409);
  }

  const claimed = await tx.mediaAsset.updateMany({
    where: { id: asset.id, status: { in: ['TEMPORARY', 'FAILED', 'READY'] } },
    data: { status: 'PROCESSING', errorCode: null, storageCleanupNotBefore: new Date(Math.max(asset.storageCleanupNotBefore?.getTime() || 0, processingDeadline)) }
  });
  if (claimed.count !== 1) {
    throw new MediaValidationError('MEDIA_BUSY', 'This image is already being processed.', 409);
  }
  return asset;
  });

  const uploadedObjects: Array<{ bucket: string; key: string }> = [];
  const isPrepared = isHeifMediaMime(asset.sourceMime!);
  try {
    const source = await boundedMediaOperation(getMediaStorage().download(
      isPrepared ? MEDIA_CONFIG.buckets.originals : asset.uploadBucket!, isPrepared ? preparedKey(asset) : asset.uploadKey!));
    const processed = await boundedMediaOperation(decoderAdmission.track(processMediaBuffer(source, asset.purpose, isPrepared ? 'image/webp' : asset.sourceMime!, request)));
    const plans = [
      { variant: processed.master, bucket: MEDIA_CONFIG.buckets.originals, key: masterKey(asset) },
      ...processed.variants.map(variant => ({ variant, bucket: MEDIA_CONFIG.buckets.private, key: variantKey(asset, 'private', variant.width) }))
    ];
    const records = plans.map(plan => processedVariantRecord(asset, plan.variant, plan.bucket, plan.key, false));
    const assertProcessing = async (tx: Prisma.TransactionClient) => {
      await assertMediaWriter(tx, ownerId, authorize);
      const current = await tx.mediaAsset.findUnique({ where: { id: asset.id }, select: { status: true, deletedAt: true } });
      if (current?.status !== 'PROCESSING' || current.deletedAt || Date.now() >= processingDeadline) throw new MediaValidationError('MEDIA_PROCESSING_CANCELLED', 'This image is no longer available for processing.', 409);
    };
    // Register every possible object before I/O. Deletion can then retry exact
    // removals, including uploads that complete after cancellation or timeout.
    await prisma.$transaction(async tx => {
      await assertProcessing(tx);
      for (const record of records) await tx.mediaVariant.upsert({
        where: { mediaAssetId_kind_width_isPublic: { mediaAssetId: asset.id, kind: record.kind, width: record.width, isPublic: false } },
        create: record, update: record
      });
    });
    uploadedObjects.push(...plans.map(({ bucket, key }) => ({ bucket, key })));
    for (const plan of plans) {
      if (Date.now() >= processingDeadline) throw new MediaValidationError('MEDIA_OPERATION_TIMEOUT', 'Image processing timed out.', 503);
      const upload = getMediaStorage().upload(plan.bucket, plan.key, plan.variant.buffer, plan.variant.mime, '31536000');
      try { await boundedMediaOperation(upload); }
      catch (error) {
        // A provider may finish after its caller times out. Keep the ledger and
        // attach explicit compensation instead of forgetting that late write.
        void upload.then(() => getMediaStorage().remove(plan.bucket, [plan.key])).catch(() => undefined);
        throw error;
      }
    }
    const keys = new Set(plans.map(plan => plan.key));
    for (const previous of asset.variants) if (!keys.has(previous.storageKey) && (!isPrepared || previous.storageKey !== preparedKey(asset))) await boundedMediaOperation(getMediaStorage().remove(previous.storageBucket, [previous.storageKey]));

    const updated = await prisma.$transaction(async (tx) => {
      await assertProcessing(tx);
      await tx.mediaVariant.deleteMany({ where: { mediaAssetId: asset.id, storageKey: { notIn: [...keys] } } });
      return tx.mediaAsset.update({
        where: { id: asset.id },
        data: {
          status: 'READY',
          sourceMime: isPrepared ? asset.sourceMime : processed.sourceMime,
          sourceWidth: processed.sourceWidth,
          sourceHeight: processed.sourceHeight,
          sourceByteSize: isPrepared ? asset.sourceByteSize : processed.sourceByteSize,
          checksum: isPrepared ? asset.checksum : processed.checksum,
          aspectRatio: processed.aspectRatio,
          cropX: processed.crop.x,
          cropY: processed.crop.y,
          cropWidth: processed.crop.width,
          cropHeight: processed.crop.height,
          focalX: request.focalX,
          focalY: request.focalY,
          altText: request.altText?.trim() || asset.altText,
          errorCode: null,
          storageCleanupNotBefore: null
        },
        include: { variants: true }
      });
    });

    try {
      if (asset.uploadBucket && asset.uploadKey) await boundedMediaOperation(getMediaStorage().remove(asset.uploadBucket, [asset.uploadKey]));
      // The signed source capability remains valid after a successful upload.
      // Keep its exact key for deletion retries until that capability expires.
    } catch {
      // The cleanup job can remove this exact source object later.
    }

    return {
      id: updated.id,
      status: updated.status,
      purpose: updated.purpose,
      aspectRatio: updated.aspectRatio,
      width: processed.variants[processed.variants.length - 1]?.width || processed.master.width,
      height: processed.variants[processed.variants.length - 1]?.height || processed.master.height
    };
  } catch (error) {
    for (const [bucket, keys] of groupStorageObjects(uploadedObjects)) {
      await getMediaStorage().remove(bucket, keys).catch(() => undefined);
    }
    const code = error instanceof MediaValidationError ? error.code : 'PROCESSING_FAILED';
    await prisma.mediaAsset.updateMany({ where: { id: asset.id, status: 'PROCESSING', deletedAt: null, owner: { status: 'ACTIVE' } }, data: { status: 'FAILED', errorCode: code } }).catch(() => undefined);
    throw error;
  }
  } finally { decoderAdmission.close(); }
};

/** Import the legacy Page editor transport through the shared media processor.
 * The Page authorization is rechecked by its caller before attachment; this
 * reservation remains an ordinary expiring upload until that transaction. */
export const importPageInlineMedia = async (
  ownerId: string,
  purpose: MediaPurpose,
  dataUrl: string,
  request: MediaCropRequest = {}
): Promise<string> => {
  const { assertPagesEnabled } = await import('../pages/pageFeature');
  assertPagesEnabled(ownerId);
  const match = typeof dataUrl === 'string'
    && dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) throw new MediaValidationError('REMOTE_MEDIA_NOT_ALLOWED', 'Upload the image through the media service.');

  const mime = match[1].toLowerCase();
  if (!isAllowedMediaMime(mime)) {
    throw new MediaValidationError('UNSUPPORTED_MEDIA_TYPE', 'Only JPEG, PNG, and WebP images are supported.');
  }
  const encoded = match[2].replace(/[\r\n]/g, '');
  const maxBytes = maxInputBytesForPurpose(purpose);
  if (encoded.length > 4 * Math.ceil(maxBytes / 3)) {
    throw new MediaValidationError('INVALID_FILE_SIZE', 'Image exceeds the existing upload limit.');
  }
  const source = Buffer.from(encoded, 'base64');
  if (!source.length || source.length > maxBytes || source.toString('base64') !== encoded) {
    throw new MediaValidationError('INVALID_IMAGE', 'The image data is invalid or exceeds the existing upload limit.');
  }

  const assetId = randomUUID();
  const key = sourceKey(ownerId, assetId, mime);
  const sourceWriteDeadline = Date.now() + MEDIA_OPERATION_TIMEOUT_MS;
  const authorize = async () => { assertPagesEnabled(ownerId); };
  const asset = await prisma.$transaction(async tx => {
    await assertMediaWriter(tx, ownerId, authorize);
    await assertOwnerUploadCapacity(tx, ownerId, source.length);
    return tx.mediaAsset.create({
      data: {
        id: assetId,
        ownerId,
        purpose,
        sourceMime: mime,
        sourceByteSize: source.length,
        uploadBucket: MEDIA_CONFIG.buckets.originals,
        uploadKey: key,
        // A timed-out provider write may still complete. Retain the exact key
        // until that late-write window has closed so purge can retry it.
        sourceCleanupNotBefore: new Date(sourceWriteDeadline),
        expiresAt: addHours(new Date(), MEDIA_CONFIG.temporaryLifetimeHours)
      }
    });
  });

  try {
    const upload = getMediaStorage().upload(MEDIA_CONFIG.buckets.originals, key, source, mime, '0');
    try {
      await boundedMediaOperation(upload);
    } catch (error) {
      void upload.then(() => getMediaStorage().remove(MEDIA_CONFIG.buckets.originals, [key])).catch(() => undefined);
      throw error;
    }
    await finalizeMediaUpload(ownerId, asset.id, request, authorize);
    return asset.id;
  } catch (error) {
    // Preserve the durable pointer and production cleanup fences if storage is
    // unavailable or a provider completes after the request has failed.
    await prisma.mediaAsset.updateMany({
      where: { id: asset.id, status: { not: 'DELETED' } },
      data: { status: 'PENDING_DELETE' }
    }).catch(() => undefined);
    await purgeMediaAsset(asset.id).catch(() => undefined);
    throw error;
  }
};

type MediaScopeOperation = {
  asset: MediaAsset & { variants: MediaVariant[] };
  token: string;
  restoreScope: MediaAccessScope;
};

const settledScopeOperations = new Map<string, MediaScopeOperation>();
const settledCleanupInFlight = new Set<string>();

const rememberSettledOperation = (operation: MediaScopeOperation): void => {
  // Overflow remains durably blocked and recoverable after runtime shutdown.
  if (settledScopeOperations.size < 500) settledScopeOperations.set(operation.asset.id, operation);
};

const assertPublicPromotion = async (
  tx: Prisma.TransactionClient,
  asset: Pick<MediaAsset, 'ownerId' | 'purpose'>,
  authorize?: AuthorizeMediaWrite
): Promise<void> => {
  await assertMediaWriter(tx, asset.ownerId, authorize);
  const owner = await tx.user.findUnique({
    where: { id: asset.ownerId },
    select: { isPrivate: true, mediaPrivacyTarget: true }
  });
  // PC-003: group identity images remain public independently of the
  // uploading account's privacy. Account lifecycle checks still apply above.
  if (!owner || (asset.purpose !== 'GROUP_IMAGE'
    && (owner.mediaPrivacyTarget === true || (owner.isPrivate && owner.mediaPrivacyTarget !== false)))) {
    throw new MediaValidationError('MEDIA_PRIVACY_CONFLICT', 'This account no longer permits public media.', 409);
  }
};

const claimMediaScopeOperation = async (
  assetId: string,
  mode: 'PROMOTE' | 'RESTRICT',
  scope?: MediaAccessScope,
  authorize?: AuthorizeMediaWrite
): Promise<MediaScopeOperation | null> => prisma.$transaction(async tx => {
  announceScopeRuntime();
  const initial = await tx.mediaAsset.findUnique({ where: { id: assetId }, include: { variants: true } });
  if (mode === 'PROMOTE' && initial?.pageId) {
    throw new MediaValidationError('PAGE_MEDIA_MUST_REMAIN_PRIVATE', 'Page media must remain private.', 409);
  }
  if (!initial || initial.deletedAt || !['READY', 'ATTACHED'].includes(initial.status)) throw mediaBusy();
  if (mode === 'PROMOTE') {
    await assertPublicPromotion(tx, initial, authorize);
    if (initial.accessScope === 'PUBLIC' && initial.variants.some(variant => variant.isPublic)) return null;
    if (initial.variants.some(variant => variant.isPublic)) throw mediaBusy();
  } else {
    await assertMediaWriter(tx, initial.ownerId, authorize);
  }

  const restoreScope = scope || (initial.accessScope === 'PUBLIC' ? 'OWNER_ONLY' : initial.accessScope);
  const token = `${MEDIA_SCOPE_OPERATION_PREFIX}${mediaScopeRuntimeId}:${randomUUID()}:${mode}:${initial.status}:${restoreScope}`;
  const claimed = await tx.mediaAsset.updateMany({
    where: {
      id: assetId,
      status: initial.status,
      updatedAt: initial.updatedAt,
      ...(mode === 'PROMOTE' ? { pageId: null } : {}),
      ...scopeOperationAvailableWhere
    },
    data: {
      status: 'PROCESSING',
      errorCode: token,
      // Restriction becomes fail-closed before public storage deletion starts.
      ...(mode === 'RESTRICT' ? { accessScope: restoreScope } : {})
    }
  });
  if (claimed.count !== 1) throw mediaBusy();

  if (mode === 'PROMOTE') {
    const records = initial.variants
      .filter(variant => !variant.isPublic && variant.kind !== 'MASTER')
      .map(variant => ({
        mediaAssetId: assetId,
        kind: variant.kind,
        storageBucket: MEDIA_CONFIG.buckets.public,
        storageKey: variantKey(initial, 'public', variant.width),
        width: variant.width,
        height: variant.height,
        mime: variant.mime,
        byteSize: variant.byteSize,
        isPublic: true
      }));
    if (records.length === 0) throw new MediaValidationError('MEDIA_NOT_READY', 'Media variants are unavailable.', 409);
    // Exact public keys are durable before any storage write, including a write
    // whose provider response is lost.
    await tx.mediaVariant.createMany({ data: records, skipDuplicates: true });
  }

  return { asset: { ...initial, status: initial.status }, token, restoreScope };
});

const finishMediaScopeOperation = async (
  operation: MediaScopeOperation,
  scope: MediaAccessScope,
  removePublic: boolean,
  authorizePublic?: AuthorizeMediaWrite
): Promise<void> => {
  await prisma.$transaction(async tx => {
    if (scope === 'PUBLIC') await assertPublicPromotion(tx, operation.asset, authorizePublic);
    const current = await tx.mediaAsset.findUnique({
      where: { id: operation.asset.id },
      select: { status: true, errorCode: true, storageCleanupNotBefore: true }
    });
    if (!current || current.status !== 'PROCESSING' || current.errorCode !== operation.token) throw mediaBusy();
    const result = await tx.mediaAsset.updateMany({
      where: { id: operation.asset.id, status: 'PROCESSING', errorCode: operation.token, ...(scope === 'PUBLIC' ? { pageId: null } : {}) },
      data: {
        status: operation.asset.status,
        accessScope: scope,
        errorCode: null,
        ...(scope === 'PUBLIC' ? { storageCleanupNotBefore: null } : {})
      }
    });
    if (result.count !== 1) throw mediaBusy();
    // Preserve Production's late-write fence. It may retain exact public keys
    // for another cleanup pass, but it never authorizes recovery of a writer.
    if (removePublic && (!current.storageCleanupNotBefore || current.storageCleanupNotBefore.getTime() <= Date.now())) {
      await tx.mediaVariant.deleteMany({ where: { mediaAssetId: operation.asset.id, isPublic: true } });
    }
  });
  settledScopeOperations.delete(operation.asset.id);
};

const removeOperationPublicCopies = async (assetId: string): Promise<void> => {
  const records = await prisma.mediaVariant.findMany({
    where: { mediaAssetId: assetId, isPublic: true },
    select: { storageBucket: true, storageKey: true }
  });
  for (const [bucket, keys] of groupStorageObjects(records.map(record => ({ bucket: record.storageBucket, key: record.storageKey })))) {
    // Await actual settlement. A timeout or elapsed cleanup fence is not proof
    // that a provider-side removal has stopped.
    await getMediaStorage().remove(bucket, keys);
  }
};

export const promoteMediaAsset = async (assetId: string, authorize?: AuthorizeMediaWrite): Promise<void> => {
  const identity = await prisma.mediaAsset.findUnique({ where: { id: assetId }, select: { pageId: true } });
  if (identity?.pageId) throw new MediaValidationError('PAGE_MEDIA_MUST_REMAIN_PRIVATE', 'Page media must remain private.', 409);
  const operation = await claimMediaScopeOperation(assetId, 'PROMOTE', undefined, authorize);
  if (!operation) return;
  try {
    for (const variant of operation.asset.variants.filter(value => !value.isPublic && value.kind !== 'MASTER')) {
      const body = await getMediaStorage().download(variant.storageBucket, variant.storageKey);
      await getMediaStorage().upload(
        MEDIA_CONFIG.buckets.public,
        variantKey(operation.asset, 'public', variant.width),
        body,
        variant.mime,
        String(PUBLIC_MEDIA_CACHE_SECONDS)
      );
    }
    await finishMediaScopeOperation(operation, 'PUBLIC', false, authorize);
  } catch (error) {
    try {
      await removeOperationPublicCopies(assetId);
      await finishMediaScopeOperation(operation, operation.restoreScope, true);
    } catch {
      // The storage writes above have settled. Keep the durable barrier until
      // this runtime retries cleanup or an operator proves it has stopped.
      rememberSettledOperation(operation);
    }
    throw error;
  }
};
export const prepareMediaAttachments = async (
  ownerId: string,
  requirements: MediaAttachmentRequirement[],
  scope: MediaAccessScope
): Promise<PreparedMediaAttachment> => {
  const uniqueRequirements = Array.from(new Map(requirements.map((requirement) => [requirement.id, requirement])).values());
  if (uniqueRequirements.length !== requirements.length) {
    throw new MediaValidationError('DUPLICATE_MEDIA', 'The same image cannot be attached more than once.', 409);
  }
  if (requirements.length === 0) return { assetIds: [], scope, promotedAssetIds: [] };

  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: requirements.map((requirement) => requirement.id) }, ownerId, status: 'READY' },
    select: { id: true, purpose: true, accessScope: true, variants: { select: { isPublic: true } } }
  });
  if (assets.length !== requirements.length) {
    throw new MediaValidationError('MEDIA_NOT_READY', 'One or more images are unavailable, already used, or still processing.', 409);
  }
  const purposeById = new Map(assets.map((asset) => [asset.id, asset.purpose]));
  if (requirements.some((requirement) => purposeById.get(requirement.id) !== requirement.purpose)) {
    throw new MediaValidationError('MEDIA_PURPOSE_MISMATCH', 'An image was uploaded for a different content type.', 409);
  }

  const promotedAssetIds: string[] = [];
  if (scope !== 'PUBLIC') {
    // Private attachment is permitted only after every durable public pointer
    // has been removed. This also closes the interrupted-promotion race.
    for (const asset of assets) {
      if (asset.accessScope === 'PUBLIC' || asset.variants.some(variant => variant.isPublic)) {
        await restrictMediaAsset(asset.id, scope);
      }
    }
  }
  if (scope === 'PUBLIC') {
    try {
      for (const requirement of requirements) {
        await promoteMediaAsset(requirement.id);
        promotedAssetIds.push(requirement.id);
      }
    } catch (error) {
      await rollbackPreparedMedia({ assetIds: requirements.map(({ id }) => id), scope, promotedAssetIds });
      throw error;
    }
  }
  return { assetIds: requirements.map(({ id }) => id), scope, promotedAssetIds };
};

export const commitPreparedMedia = async (
  tx: Prisma.TransactionClient,
  prepared: PreparedMediaAttachment
): Promise<void> => {
  if (prepared.assetIds.length === 0) return;
  const result = await tx.mediaAsset.updateMany({
    where: {
      id: { in: prepared.assetIds },
      status: 'READY',
      ...scopeOperationAvailableWhere,
      ...(prepared.scope === 'PUBLIC'
        ? { pageId: null, accessScope: 'PUBLIC' as const }
        : privateAttachmentWhere)
    },
    data: { status: 'ATTACHED', accessScope: prepared.scope, expiresAt: null }
  });
  if (result.count !== prepared.assetIds.length) {
    throw new MediaValidationError('MEDIA_ATTACHMENT_CONFLICT', 'An image was attached by another request.', 409);
  }
};

export const rollbackPreparedMedia = async (prepared: PreparedMediaAttachment): Promise<void> => {
  for (const assetId of prepared.promotedAssetIds) {
    await restrictMediaAsset(assetId, 'OWNER_ONLY').catch(() => undefined);
  }
};

export const prepareMediaScopeChange = async (
  assetIds: string[],
  scope: MediaAccessScope
): Promise<PreparedMediaScopeChange> => {
  const ids = Array.from(new Set(assetIds));
  const assets = ids.length === 0 ? [] : await prisma.mediaAsset.findMany({
    where: { id: { in: ids }, status: 'ATTACHED' },
    select: { id: true, accessScope: true }
  });
  if (assets.length !== ids.length) {
    throw new MediaValidationError('MEDIA_ATTACHMENT_CONFLICT', 'Existing media attachments are inconsistent.', 409);
  }
  const prepared: PreparedMediaScopeChange = {
    assetIds: ids,
    scope,
    promoted: [],
    demoteAfterCommit: assets.filter((asset) => asset.accessScope === 'PUBLIC' && scope !== 'PUBLIC').map((asset) => asset.id)
  };
  if (scope === 'PUBLIC') {
    try {
      for (const asset of assets) {
        if (asset.accessScope === 'PUBLIC') continue;
        await promoteMediaAsset(asset.id);
        prepared.promoted.push({ id: asset.id, previousScope: asset.accessScope });
      }
    } catch (error) {
      await rollbackMediaScopeChange(prepared);
      throw error;
    }
  }
  return prepared;
};

export const commitMediaScopeChange = async (
  tx: Prisma.TransactionClient,
  prepared: PreparedMediaScopeChange
): Promise<void> => {
  if (prepared.assetIds.length === 0) return;
  const result = await tx.mediaAsset.updateMany({
    where: {
      id: { in: prepared.assetIds },
      status: 'ATTACHED',
      AND: [scopeOperationAvailableWhere, prepared.scope === 'PUBLIC'
        ? { pageId: null, accessScope: 'PUBLIC' }
        : { OR: [{ pageId: null }, privateAttachmentWhere] }]
    },
    data: { accessScope: prepared.scope }
  });
  if (result.count !== prepared.assetIds.length) {
    throw new MediaValidationError('MEDIA_ATTACHMENT_CONFLICT', 'Existing media attachments are inconsistent.', 409);
  }
};

export const rollbackMediaScopeChange = async (prepared: PreparedMediaScopeChange): Promise<void> => {
  for (const asset of prepared.promoted) {
    await restrictMediaAsset(asset.id, asset.previousScope).catch(() => undefined);
  }
};

export const finalizeMediaScopeChange = async (prepared: PreparedMediaScopeChange): Promise<void> => {
  for (const assetId of prepared.demoteAfterCommit) {
    await restrictMediaAsset(assetId, prepared.scope).catch(() => undefined);
  }
};

export const scheduleMediaDeletion = async (assetIds: Array<string | null | undefined>): Promise<void> => {
  const ids = Array.from(new Set(assetIds.filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return;
  try {
    await prisma.mediaAsset.updateMany({
      where: { id: { in: ids }, status: { in: ['READY', 'ATTACHED', 'FAILED'] }, ...scopeOperationAvailableWhere },
      data: { status: 'PENDING_DELETE' }
    });
  } catch (error) {
    console.error('Could not schedule exact media cleanup:', error instanceof Error ? error.message : 'unknown error');
    return;
  }
  for (const id of ids) {
    await purgeMediaAsset(id).catch(() => undefined);
  }
};

export const resolvePostMediaScope = async (
  authorId: string,
  status: string,
  targetGroupIds: string[],
  targetAudience?: string | null
): Promise<MediaAccessScope> => {
  const withoutAccountPrivacy = resolvePostMediaScopeFromState(status, targetGroupIds, targetAudience, false);
  if (withoutAccountPrivacy !== 'PUBLIC') return withoutAccountPrivacy;
  const author = await prisma.user.findUnique({
    where: { id: authorId },
    select: { isPrivate: true, mediaPrivacyTarget: true }
  });
  return author && (author.isPrivate || author.mediaPrivacyTarget === true) ? 'RESTRICTED' : 'PUBLIC';
};

export const resolvePostMediaScopeFromState = (
  status: string,
  targetGroupIds: string[],
  targetAudience: string | null | undefined,
  authorIsPrivate: boolean
): MediaAccessScope => {
  if (status !== 'PUBLISHED') return 'OWNER_ONLY';
  if (targetGroupIds.length > 0) return 'INHERITED_GROUP';
  const normalizedAudience = targetAudience?.trim().toLowerCase();
  if (normalizedAudience && normalizedAudience !== 'public') return 'RESTRICTED';
  return authorIsPrivate ? 'RESTRICTED' : 'PUBLIC';
};

const ATTACHED_MEDIA_POST_SCOPE_SELECT = {
  status: true,
  isDeleted: true,
  targetAudience: true,
  groupId: true,
  targetedGroups: { select: { id: true } }
} as const;

// Shared by lifecycle transitions and their commit-time authorization checks.
// The scope comes from the asset's current attachment, never from its previous
// MediaAsset.accessScope value.
export const ATTACHED_MEDIA_SCOPE_SELECT = {
  id: true,
  purpose: true,
  status: true,
  accessScope: true,
  variants: { select: { isPublic: true } },
  avatarFor: { select: { id: true } },
  coverFor: { select: { id: true } },
  postAttachment: { select: { post: { select: ATTACHED_MEDIA_POST_SCOPE_SELECT } } },
  questionFor: {
    select: {
      post: { select: ATTACHED_MEDIA_POST_SCOPE_SELECT },
      section: { select: { post: { select: ATTACHED_MEDIA_POST_SCOPE_SELECT } } }
    }
  },
  optionFor: {
    select: {
      question: {
        select: {
          post: { select: ATTACHED_MEDIA_POST_SCOPE_SELECT },
          section: { select: { post: { select: ATTACHED_MEDIA_POST_SCOPE_SELECT } } }
        }
      }
    }
  }
} as const;

export const resolveAttachedMediaScopeFromState = (
  asset: any,
  ownerIsPrivate: boolean
): MediaAccessScope => {
  if (!asset || asset.status !== 'ATTACHED') return 'OWNER_ONLY';
  if ((asset.purpose === 'PROFILE_AVATAR' && asset.avatarFor)
    || (asset.purpose === 'PROFILE_COVER' && asset.coverFor)) {
    return ownerIsPrivate ? 'RESTRICTED' : 'PUBLIC';
  }
  const post = asset.postAttachment?.post
    || asset.questionFor?.post
    || asset.questionFor?.section?.post
    || asset.optionFor?.question?.post
    || asset.optionFor?.question?.section?.post;
  if (!post || post.isDeleted) return 'OWNER_ONLY';
  const groupIds = [
    ...(post.groupId ? [post.groupId] : []),
    ...(post.targetedGroups || []).map((group: { id: string }) => group.id)
  ];
  return resolvePostMediaScopeFromState(post.status, groupIds, post.targetAudience, ownerIsPrivate);
};

export const validatePostMediaSet = async (
  ownerId: string,
  assetIds: string[],
  requestedAspectRatio?: number,
  authorizedPageId?: string
): Promise<number | null> => {
  if (assetIds.length === 0) return null;
  if (assetIds.length > MEDIA_CONFIG.maxPostImages) {
    throw new MediaValidationError('TOO_MANY_POST_IMAGES', `A post can contain up to ${MEDIA_CONFIG.maxPostImages} images.`);
  }
  const assets = await prisma.mediaAsset.findMany({
    where: {
      id: { in: assetIds },
      ...(authorizedPageId
        ? { OR: [{ ownerId }, { pageId: authorizedPageId, status: 'ATTACHED' as const }] }
        : { ownerId }),
      purpose: 'POST',
      status: { in: ['READY', 'ATTACHED'] }
    },
    select: { id: true, aspectRatio: true }
  });
  if (assets.length !== assetIds.length || assets.some((asset) => !asset.aspectRatio)) {
    throw new MediaValidationError('MEDIA_NOT_READY', 'One or more post images are unavailable or still processing.', 409);
  }
  const ratioById = new Map(assets.map((asset) => [asset.id, asset.aspectRatio!]));
  const establishedRatio = ratioById.get(assetIds[0])!;
  if (assetIds.some((id) => Math.abs(ratioById.get(id)! - establishedRatio) / establishedRatio > 0.01)) {
    throw new MediaValidationError('MEDIA_RATIO_MISMATCH', 'All post images must use the same frame ratio.', 409);
  }
  if (requestedAspectRatio !== undefined && Math.abs(requestedAspectRatio - establishedRatio) / establishedRatio > 0.01) {
    throw new MediaValidationError('MEDIA_RATIO_MISMATCH', 'The post frame ratio does not match its images.', 409);
  }
  return establishedRatio;
};

export const restrictMediaAsset = async (assetId: string, scope: MediaAccessScope = 'RESTRICTED', authorize?: AuthorizeMediaWrite): Promise<void> => {
  if (scope === 'PUBLIC') throw new MediaValidationError('INVALID_MEDIA_SCOPE', 'Use the public promotion operation.', 409);
  const identity = await prisma.mediaAsset.findUnique({ where: { id: assetId }, select: { id: true } });
  if (!identity) return;
  const operation = await claimMediaScopeOperation(assetId, 'RESTRICT', scope, authorize);
  if (!operation) return;
  try {
    await removeOperationPublicCopies(assetId);
    await finishMediaScopeOperation(operation, scope, true);
  } catch (error) {
    // Removal has settled (successfully or with an error), so this live runtime
    // may retry it. The durable barrier remains fail closed meanwhile.
    rememberSettledOperation(operation);
    throw error;
  }
};

/** Retry only an operation this runtime knows has finished all storage writes. */
export const retrySettledMediaScopeCleanup = async (assetId: string): Promise<boolean> => {
  const operation = settledScopeOperations.get(assetId);
  if (!operation || settledCleanupInFlight.has(assetId)) return false;
  settledCleanupInFlight.add(assetId);
  try {
    const current = await prisma.mediaAsset.findUnique({ where: { id: assetId }, select: { status: true, errorCode: true } });
    if (!current || current.errorCode !== operation.token) {
      settledScopeOperations.delete(assetId);
      return false;
    }
    if (current.status !== 'PROCESSING') return false;
    await removeOperationPublicCopies(assetId);
    await finishMediaScopeOperation(operation, operation.restoreScope, true);
    return true;
  } finally {
    settledCleanupInFlight.delete(assetId);
  }
};

/**
 * Operator-only recovery; intentionally not exposed by an HTTP route.
 * The issuing worker must first be stopped and matched to deployment/process
 * evidence. An elapsed lease or cleanup timestamp is never sufficient proof.
 */
export const recoverStoppedMediaScopeOperation = async (
  assetId: string,
  expectedToken: string,
  confirmation: { runtimeId: string; confirmedStopped: true; evidenceRef: string }
) => {
  announceScopeRuntime();
  const parsed = expectedToken.match(
    /^MEDIA_SCOPE:([0-9a-f-]{36}):([0-9a-f-]{36}):(PROMOTE|RESTRICT|RECOVER):(READY|ATTACHED|PENDING_DELETE):(OWNER_ONLY|RESTRICTED|INHERITED_GROUP)$/
  );
  if (!parsed || confirmation.confirmedStopped !== true || confirmation.runtimeId !== parsed[1]
    || confirmation.runtimeId === mediaScopeRuntimeId || !confirmation.evidenceRef.trim()) {
    throw new MediaValidationError(
      'MEDIA_RECOVERY_CONFIRMATION_REQUIRED',
      'Verify the issuing runtime has stopped before recovery.',
      409
    );
  }

  const operation = await prisma.$transaction(async tx => {
    const asset = await tx.mediaAsset.findUnique({ where: { id: assetId }, include: { variants: true } });
    if (!asset || asset.errorCode !== expectedToken || !['PROCESSING', 'PENDING_DELETE'].includes(asset.status)) throw mediaBusy();
    await lockAccountSecurity(tx, asset.ownerId);
    const status = asset.status === 'PENDING_DELETE' ? 'PENDING_DELETE' : parsed[4] as MediaAsset['status'];
    const restoreScope = parsed[5] as MediaAccessScope;
    const token = `${MEDIA_SCOPE_OPERATION_PREFIX}${mediaScopeRuntimeId}:${randomUUID()}:RECOVER:${status}:${restoreScope}`;
    const claim = await tx.mediaAsset.updateMany({
      where: { id: assetId, status: asset.status, errorCode: expectedToken },
      data: { status: 'PROCESSING', errorCode: token, accessScope: restoreScope }
    });
    if (claim.count !== 1) throw mediaBusy();
    return { asset: { ...asset, status }, token, restoreScope } as MediaScopeOperation;
  });

  try {
    await removeOperationPublicCopies(assetId);
    await finishMediaScopeOperation(operation, operation.restoreScope, true);
  } catch (error) {
    rememberSettledOperation(operation);
    throw error;
  }
  return {
    assetId,
    recoveredRuntimeId: confirmation.runtimeId,
    evidenceRef: confirmation.evidenceRef,
    restoredStatus: operation.asset.status,
    accessScope: operation.restoreScope,
    recoveredAt: new Date().toISOString()
  };
};

export const markMediaAttached = async (assetIds: string[], scope: MediaAccessScope): Promise<void> => {
  if (assetIds.length === 0) return;
  const result = await prisma.mediaAsset.updateMany({
    where: {
      id: { in: assetIds },
      status: 'READY',
      ...scopeOperationAvailableWhere,
      ...(scope === 'PUBLIC'
        ? { pageId: null, accessScope: 'PUBLIC' as const }
        : privateAttachmentWhere)
    },
    data: { status: 'ATTACHED', accessScope: scope, expiresAt: null }
  });
  if (result.count !== assetIds.length) {
    throw new MediaValidationError('MEDIA_NOT_READY', 'One or more images are unavailable or already attached.', 409);
  }
};

const resolveAssetPost = (asset: any): { id: string; authorId: string; groupId: string | null; targetedGroups?: Array<{ id: string }> } | null => {
  const direct = asset.postAttachment?.post;
  const question = asset.questionFor?.post || asset.questionFor?.section?.post;
  const optionQuestion = asset.optionFor?.question;
  const option = optionQuestion?.post || optionQuestion?.section?.post;
  return direct || question || option || null;
};

const canReadRestrictedAsset = async (asset: any, viewerId?: string): Promise<boolean> => {
  if (viewerId === asset.ownerId) return true;
  if (asset.coverFor || asset.avatarFor) return PrivacyService.canViewUserContent(viewerId, asset.ownerId);
  const post = resolveAssetPost(asset);
  if (!post) return false;
  const canViewPost = await GroupPermissionService.canViewPost(post.id, viewerId);
  if (!canViewPost || post.groupId || post.targetedGroups?.length) return canViewPost;
  return PrivacyService.canViewUserContent(viewerId, post.authorId);
};

const POST_ACCESS_SELECT = { id: true, authorId: true, groupId: true, targetedGroups: { select: { id: true } } } as const;

const assetWithAccessContext = (assetId: string) => prisma.mediaAsset.findUnique({
  where: { id: assetId },
  include: {
    variants: true,
    coverFor: { select: { id: true } },
    avatarFor: { select: { id: true } },
    owner: { select: { status: true } },
    postAttachment: { include: { post: { select: POST_ACCESS_SELECT } } },
    questionFor: {
      include: {
        post: { select: POST_ACCESS_SELECT },
        section: { include: { post: { select: POST_ACCESS_SELECT } } }
      }
    },
    optionFor: {
      include: {
        question: {
          include: {
            post: { select: POST_ACCESS_SELECT },
            section: { include: { post: { select: POST_ACCESS_SELECT } } }
          }
        }
      }
    }
  }
});

export const getMediaReadPresentation = async (assetId: string, viewerId?: string): Promise<MediaPresentation> => {
  const asset = await assetWithAccessContext(assetId);
  if (!asset || asset.status !== 'ATTACHED' || !asset.aspectRatio) {
    throw new MediaValidationError('MEDIA_NOT_FOUND', 'Media asset was not found.', 404);
  }
  if (asset.pageId) {
    const { pageMediaPresentation } = await import('../pages/pageMediaService');
    try {
      return await pageMediaPresentation(assetId, viewerId);
    } catch (error) {
      const { PagePolicyError } = await import('../pages/pagePolicy');
      if (error instanceof PagePolicyError) {
        throw new MediaValidationError('MEDIA_NOT_FOUND', 'Media asset was not found.', 404);
      }
      throw error;
    }
  }
  if (asset.owner?.status !== 'ACTIVE' || ((asset.coverFor || asset.avatarFor) && !(await PrivacyService.canViewUserContent(viewerId, asset.ownerId)))) {
    throw new MediaValidationError('MEDIA_NOT_FOUND', 'Media asset was not found.', 404);
  }
  if (resolveAssetPost(asset) && !(await canReadRestrictedAsset(asset, viewerId))) {
    throw new MediaValidationError('MEDIA_NOT_FOUND', 'Media asset was not found.', 404);
  }
  if (asset.accessScope === 'PUBLIC') {
    const presentation = publicPresentation(asset);
    if (!presentation) throw new MediaValidationError('MEDIA_NOT_FOUND', 'Media variants are unavailable.', 404);
    return presentation;
  }
  if (!(await canReadRestrictedAsset(asset, viewerId))) {
    throw new MediaValidationError('MEDIA_NOT_FOUND', 'Media asset was not found.', 404);
  }

  const storage = getMediaStorage();
  const variants = asset.variants.filter((variant) => !variant.isPublic && variant.kind !== 'MASTER').sort((a, b) => a.width - b.width);
  if (variants.length === 0) throw new MediaValidationError('MEDIA_NOT_FOUND', 'Media variants are unavailable.', 404);
  const sources = await Promise.all(variants.map(async (variant) => ({
    src: await storage.createSignedReadUrl(variant.storageBucket, variant.storageKey, MEDIA_CONFIG.privateUrlLifetimeSeconds),
    width: variant.width,
    height: variant.height
  })));
  const largest = sources[sources.length - 1];
  return {
    id: asset.id,
    access: 'RESTRICTED',
    aspectRatio: asset.aspectRatio,
    ...presentationFocalPoint(asset),
    altText: asset.altText,
    width: largest.width,
    height: largest.height,
    src: largest.src,
    srcSet: sources.map((source) => `${source.src} ${source.width}w`).join(', '),
    sources
  };
};

export const getStoredMediaPresentation = async (assetId?: string | null): Promise<MediaPresentation | null> => {
  if (!assetId) return null;
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId }, include: { variants: true } });
  if (!asset || !asset.aspectRatio) return null;
  if (asset.accessScope === 'PUBLIC') return publicPresentation(asset);
  const largest = asset.variants.filter((variant) => !variant.isPublic && variant.kind !== 'MASTER').sort((a, b) => b.width - a.width)[0];
  if (!largest) return null;
  return {
    id: asset.id,
    access: 'RESTRICTED',
    aspectRatio: asset.aspectRatio,
    ...presentationFocalPoint(asset),
    altText: asset.altText,
    width: largest.width,
    height: largest.height
  };
};

export const serializeMediaAsset = (
  asset?: (MediaAsset & { variants: MediaVariant[] }) | null
): MediaPresentation | null => {
  if (!asset || !asset.aspectRatio) return null;
  if (asset.accessScope === 'PUBLIC' && !asset.pageId) return publicPresentation(asset);
  const largest = asset.variants.filter((variant) => !variant.isPublic && variant.kind !== 'MASTER').sort((a, b) => b.width - a.width)[0];
  if (!largest) return null;
  return {
    id: asset.id,
    access: 'RESTRICTED',
    aspectRatio: asset.aspectRatio,
    ...presentationFocalPoint(asset),
    altText: asset.altText,
    width: largest.width,
    height: largest.height,
    ...(asset.pageId
      ? { src: `/api/media/${encodeURIComponent(asset.id)}/content`, requiresAuth: true }
      : {})
  };
};

export const serializeUserMediaRecord = <T extends Record<string, any>>(user?: T | null): T | null | undefined => {
  if (!user) return user;
  const { avatarMedia, coverMedia, mediaPrivacyTarget: _mediaPrivacyTarget, ...rest } = user;
  const rawPresentation = serializeMediaAsset(avatarMedia);
  const accountRestrictsAvatar = !avatarMedia?.owner || avatarMedia.owner.status !== 'ACTIVE' || avatarMedia.owner.isPrivate || avatarMedia.owner.mediaPrivacyTarget === true;
  const presentation: MediaPresentation | null = rawPresentation && accountRestrictsAvatar
    ? { id: rawPresentation.id, access: 'RESTRICTED', aspectRatio: rawPresentation.aspectRatio, width: rawPresentation.width, height: rawPresentation.height, focalX: rawPresentation.focalX, focalY: rawPresentation.focalY, altText: null }
    : rawPresentation;
  const coverPresentation = serializeMediaAsset(coverMedia);
  const legacyAvatar = typeof user.avatar === 'string' && /(?:ui-avatars\.com|api\.dicebear\.com|picsum\.photos|randomuser\.me)/i.test(user.avatar)
    ? null
    : user.status === 'ACTIVE' && user.isPrivate === false && user.mediaPrivacyTarget !== true ? user.avatar : null;
  return {
    ...rest,
    avatar: presentation?.src || (!user.avatarMediaId && legacyAvatar ? legacyAvatar : ''),
    avatarMedia: presentation,
    ...(Object.prototype.hasOwnProperty.call(user, 'coverMedia') ? { coverMedia: coverPresentation } : {})
  } as unknown as T;
};

export const serializePublicUserCard = (user: Record<string, any>) => {
  const media = serializeUserMediaRecord(user)!;
  return {
    id: media.id, name: media.name, handle: media.handle,
    avatar: media.avatar, avatarMediaId: media.avatarMediaId, avatarMedia: media.avatarMedia,
    isPrivate: Boolean(user.isPrivate || user.mediaPrivacyTarget === true),
    verifiedBadge: media.verifiedBadge, followersCount: media.followersCount, followingCount: media.followingCount
  };
};

export const serializeGroupMediaRecord = <T extends Record<string, any>>(group?: T | null): T | null | undefined => {
  if (!group) return group;
  const { imageMedia, ...rest } = group;
  const presentation = serializeMediaAsset(imageMedia);
  return {
    ...rest,
    image: presentation?.src || (group.imageMediaId ? null : group.image),
    imageMedia: presentation
  } as unknown as T;
};

export const serializePostMediaRecord = (post: any, viewerId?: string | null): any => {
  if (!post) return post;
  const maySeeInternalOptionNames = post.pageId
    ? Boolean(post.pageCapabilities?.includes('analytics'))
    : post.status !== 'PUBLISHED' || (Boolean(viewerId) && post.authorId === viewerId);
  const hidePostOptionNames = !maySeeInternalOptionNames
    && post.optionPresentation === 'image'
    && post.showOptionNames === false;
  const media = Array.isArray(post.media)
    ? post.media.map((attachment: any) => serializeMediaAsset(attachment.mediaAsset)).filter(Boolean)
    : [];
  const serializeOption = (option: any, hideName = false): any => {
    const rawPresentation = serializeMediaAsset(option?.imageMedia);
    const presentation = hideName && rawPresentation ? { ...rawPresentation, altText: null } : rawPresentation;
    const { imageMedia, ...rest } = option || {};
    return {
      ...rest,
      text: hideName ? '' : rest.text,
      image: presentation?.src || (option?.imageMediaId ? undefined : option?.image),
      imageMedia: presentation
    };
  };
  const serializeQuestion = (question: any): any => {
    const presentation = serializeMediaAsset(question?.imageMedia);
    const { imageMedia, ...rest } = question || {};
    const hideQuestionOptionNames = !maySeeInternalOptionNames
      && question?.optionPresentation === 'image'
      && question?.showOptionNames === false;
    return {
      ...rest,
      image: presentation?.src || (question?.imageMediaId ? undefined : question?.image),
      imageMedia: presentation,
      options: Array.isArray(question?.options)
        ? question.options.map((option: any) => serializeOption(option, hideQuestionOptionNames || hidePostOptionNames))
        : question?.options
    };
  };
  return {
    ...post,
    author: post.author ? {
      ...serializePublicUserCard(post.author),
      // Existing feed mappers consume only relation presence, not row identities.
      ...(Array.isArray(post.author.following) ? { following: post.author.following.length ? [{}] : [] } : {})
    } : post.author,
    image: media.length > 0 ? undefined : post.image,
    media,
    coverImage: media.length > 0 ? media[0]?.src : post.image,
    questions: Array.isArray(post.questions) ? post.questions.map(serializeQuestion) : post.questions,
    sections: Array.isArray(post.sections) ? post.sections.map((section: any) => ({
      ...section,
      questions: Array.isArray(section.questions) ? section.questions.map(serializeQuestion) : section.questions
    })) : post.sections,
    sharedFrom: post.sharedFrom ? serializePostMediaRecord(post.sharedFrom, viewerId) : post.sharedFrom
  };
};

export const deleteMediaAsset = async (ownerId: string, assetId: string): Promise<void> => {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId }, include: { variants: true } });
  if (!asset || asset.ownerId !== ownerId) {
    throw new MediaValidationError('MEDIA_NOT_FOUND', 'Media asset was not found.', 404);
  }
  if (asset.status === 'ATTACHED') {
    throw new MediaValidationError('MEDIA_ATTACHED', 'Attached media must be removed from its content first.', 409);
  }
  if (isMediaScopeOperation(asset.errorCode)) throw mediaBusy();
  const cancelled = await prisma.mediaAsset.updateMany({
    where: { id: asset.id, status: asset.status, updatedAt: asset.updatedAt, ...scopeOperationAvailableWhere },
    data: { status: 'PENDING_DELETE' }
  });
  if (cancelled.count !== 1) throw mediaBusy();
  await purgeMediaAsset(asset.id);
};

export const purgeMediaAsset = async (assetId: string): Promise<void> => {
  const identity = await prisma.mediaAsset.findUnique({ where: { id: assetId }, select: { ownerId: true } });
  if (!identity) return;
  const asset = await prisma.$transaction(async tx => {
    await lockAccountSecurity(tx, identity.ownerId);
    const current = await tx.mediaAsset.findUnique({ where: { id: assetId }, include: { variants: true } });
    if (!current || current.status === 'DELETED') return null;
    if (isMediaScopeOperation(current.errorCode)) throw mediaBusy();
    // A decision records the terminal purge intent, not completion of storage
    // I/O. Keep it even if the provider fails. Changed batches get their own
    // deterministic ID rather than changing a prior append-only decision.
    await appendDeletionDecision(tx, mediaPurgeDecision(captureDeletionMediaPointer(current)));
    const claimed = await tx.mediaAsset.updateMany({ where: {
      id: assetId, status: current.status, updatedAt: current.updatedAt, ...scopeOperationAvailableWhere
    }, data: {
      status: 'PENDING_DELETE', altText: null, checksum: null, moderationMetadata: Prisma.DbNull, errorCode: null
    } });
    if (claimed.count !== 1) throw mediaBusy();
    return current;
  });
  if (!asset) return;
  const removedPointer = captureDeletionMediaPointer(asset);
  const objects = removedPointer.objects;
  for (const [bucket, keys] of groupStorageObjects(objects)) {
    await boundedMediaOperation(getMediaStorage().remove(bucket, keys));
  }
  await prisma.$transaction(async tx => {
    await lockAccountSecurity(tx, asset.ownerId);
    const current = await tx.mediaAsset.findUnique({ where: { id: asset.id }, include: { variants: true } });
    const cleanupBoundary = Math.max(
      current?.sourceCleanupNotBefore?.getTime() || 0,
      current?.storageCleanupNotBefore?.getTime() || 0
    );
    if (!current || cleanupBoundary > Date.now()) return;
    if (current.status === 'DELETED') return;
    // Never clear a pointer registered after this batch was removed. The next
    // worker pass journals and retries that exact batch after its writer fence.
    const currentPointer = captureDeletionMediaPointer(current);
    if (JSON.stringify(currentPointer.objects) !== JSON.stringify(removedPointer.objects)) return;
    await appendDeletionDecision(tx, mediaPurgeDecision(currentPointer));
    await tx.mediaVariant.deleteMany({ where: { mediaAssetId: asset.id } });
    await tx.mediaAsset.update({
      where: { id: asset.id },
      data: { status: 'DELETED', deletedAt: new Date(), uploadBucket: null, uploadKey: null, sourceCleanupNotBefore: null, storageCleanupNotBefore: null,
        altText: null, checksum: null, moderationMetadata: Prisma.DbNull, moderationStatus: 'NOT_REVIEWED', errorCode: null,
        sourceMime: null, sourceWidth: null, sourceHeight: null, sourceByteSize: null,
        aspectRatio: null, cropX: null, cropY: null, cropWidth: null, cropHeight: null, focalX: null, focalY: null }
    });
  });
};

export const cleanupExpiredMedia = async (limit = 100): Promise<number> => {
  if (!isMediaStorageConfigured()) return 0;
  for (const assetId of [...settledScopeOperations.keys()].slice(0, Math.min(limit, 25))) {
    await retrySettledMediaScopeCleanup(assetId).catch(() => undefined);
  }
  // An interrupted HEIF request never reuses the same preparation key. Retire
  // stale leases and let the existing exact-key cleanup retry late writes.
  await prisma.mediaAsset.updateMany({
    where: { status: 'PROCESSING', errorCode: { startsWith: 'HEIF_PREPARING:' }, updatedAt: { lte: new Date(Date.now() - PROCESSING_LEASE_MS) } },
    data: { status: 'PENDING_DELETE', errorCode: null }
  });
  const staleSourceUploads = await prisma.mediaAsset.findMany({
    where: {
      status: { in: ['READY', 'ATTACHED'] },
      uploadBucket: { not: null },
      uploadKey: { not: null },
      OR: [{ sourceCleanupNotBefore: null }, { sourceCleanupNotBefore: { lte: new Date() } }]
    },
    take: Math.min(limit, 25),
    select: { id: true, uploadBucket: true, uploadKey: true }
  });
  for (const asset of staleSourceUploads) {
    if (!asset.uploadBucket || !asset.uploadKey) continue;
    try {
      await getMediaStorage().remove(asset.uploadBucket, [asset.uploadKey]);
      await prisma.mediaAsset.updateMany({
        where: { id: asset.id, uploadBucket: asset.uploadBucket, uploadKey: asset.uploadKey },
        data: { uploadBucket: null, uploadKey: null, sourceCleanupNotBefore: null }
      });
    } catch {
      // Retry the same exact object during the next scheduled cleanup.
    }
  }
  const stalePublicAssets = await prisma.mediaAsset.findMany({
    where: {
      status: { in: ['READY', 'ATTACHED'] },
      ...scopeOperationAvailableWhere,
      accessScope: { not: 'PUBLIC' },
      variants: { some: { isPublic: true } }
    },
    take: Math.min(limit, 25),
    select: { id: true, accessScope: true }
  });
  for (const asset of stalePublicAssets) {
    await restrictMediaAsset(asset.id, asset.accessScope).catch(() => undefined);
  }
  const assets = await prisma.mediaAsset.findMany({
    where: {
      OR: [
        { status: 'PENDING_DELETE' },
        { status: { in: ['TEMPORARY', 'FAILED'] }, expiresAt: { lte: new Date() }, ...scopeOperationAvailableWhere }
      ]
    },
    take: limit,
    orderBy: { createdAt: 'asc' },
    select: { id: true }
  });
  let completed = 0;
  for (const asset of assets) {
    try {
      await purgeMediaAsset(asset.id);
      completed += 1;
    } catch {
      // Exact-ID retry remains pending for the next scheduled run.
    }
  }
  return completed;
};
