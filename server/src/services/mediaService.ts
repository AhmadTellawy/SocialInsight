import {
  MediaAccessScope,
  MediaAsset,
  MediaPurpose,
  MediaVariant,
  Prisma
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import sharp from 'sharp';
import prisma from '../prisma';
import {
  MEDIA_CONFIG,
  MEDIA_PURPOSE_CONFIG,
  isAllowedMediaSourceMime,
  isHeifMediaMime,
  maxInputBytesForPurpose
} from '../config/media';
import { GroupPermissionService } from './groupPermissionService';
import { PrivacyService } from './privacyService';
import { getMediaStorage, isMediaStorageConfigured } from './mediaStorage';
import {
  MediaCropRequest,
  MediaValidationError,
  ProcessedMediaVariant,
  processMediaBuffer
} from './mediaProcessor';
import {
  convertHeifRemotely,
  isHeifConversionConfigured,
  verifyHeifConversionReadiness
} from './heifConversionClient';
import { inspectHeifBuffer } from './heifInspection';

const mimeExtension: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif'
};

const addHours = (date: Date, hours: number): Date => new Date(date.getTime() + hours * 60 * 60 * 1000);
const PROCESSING_LEASE_PREFIX = 'MEDIA_PROCESSING:';
const PROCESSING_CLEANUP_PREFIX = 'MEDIA_PROCESSING_CLEANUP:';
const processingAttempt = (): { id: string; lease: string } => {
  const id = randomUUID();
  return { id, lease: `${PROCESSING_LEASE_PREFIX}${id}` };
};
const processingAttemptId = (value: string | null | undefined): string | null => {
  const prefix = value?.startsWith(PROCESSING_LEASE_PREFIX)
    ? PROCESSING_LEASE_PREFIX
    : value?.startsWith(PROCESSING_CLEANUP_PREFIX) ? PROCESSING_CLEANUP_PREFIX : null;
  if (!prefix) return null;
  const id = value!.slice(prefix.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : null;
};

const variantKey = (
  asset: Pick<MediaAsset, 'id' | 'ownerId'>,
  visibility: 'private' | 'public',
  width: number,
  attemptId?: string
): string => `${asset.ownerId}/${asset.id}/${visibility}/${width}${attemptId ? `-${attemptId}` : ''}.webp`;

const masterKey = (asset: Pick<MediaAsset, 'id' | 'ownerId'>, attemptId?: string): string =>
  `${asset.ownerId}/${asset.id}/master${attemptId ? `-${attemptId}` : ''}.webp`;

const preparedKey = (asset: Pick<MediaAsset, 'id' | 'ownerId'>, attemptId: string): string =>
  `${asset.ownerId}/${asset.id}/prepared-${attemptId}.webp`;

const sourceKey = (ownerId: string, assetId: string, mime: string): string =>
  `${ownerId}/${assetId}/upload.${mimeExtension[mime]}`;

type StorageObject = { bucket: string; key: string };

const processingAttemptObjects = (
  asset: Pick<MediaAsset, 'id' | 'ownerId' | 'purpose' | 'sourceMime'>,
  attemptId: string
): StorageObject[] => [
  { bucket: MEDIA_CONFIG.buckets.originals, key: masterKey(asset, attemptId) },
  ...(asset.sourceMime && isHeifMediaMime(asset.sourceMime)
    ? [{ bucket: MEDIA_CONFIG.buckets.originals, key: preparedKey(asset, attemptId) }]
    : []),
  ...MEDIA_PURPOSE_CONFIG[asset.purpose].widths.map(({ width }) => ({
    bucket: MEDIA_CONFIG.buckets.private,
    key: variantKey(asset, 'private', width, attemptId)
  }))
];

const groupStorageObjects = (objects: StorageObject[]): Map<string, string[]> => {
  const grouped = new Map<string, string[]>();
  for (const object of objects) {
    const keys = grouped.get(object.bucket) || [];
    keys.push(object.key);
    grouped.set(object.bucket, keys);
  }
  return grouped;
};

const failProcessingAttempt = async (
  assetId: string,
  lease: string,
  attemptId: string,
  uploadedObjects: StorageObject[],
  errorCode: string
): Promise<void> => {
  if (uploadedObjects.length === 0) {
    await prisma.mediaAsset.updateMany({
      where: { id: assetId, status: 'PROCESSING', errorCode: lease },
      data: { status: 'FAILED', errorCode }
    }).catch(() => undefined);
    return;
  }
  const cleanupLease = `${PROCESSING_CLEANUP_PREFIX}${attemptId}`;
  const claimed = await prisma.mediaAsset.updateMany({
    where: { id: assetId, status: 'PROCESSING', errorCode: lease },
    data: { errorCode: cleanupLease }
  }).catch(() => ({ count: 0 }));
  try {
    for (const [bucket, keys] of groupStorageObjects(uploadedObjects)) {
      await getMediaStorage().remove(bucket, keys);
    }
  } catch {
    // A claimed cleanup lease remains PROCESSING so the scheduled cleanup can retry safely.
    return;
  }
  if (claimed.count === 1) {
    await prisma.mediaAsset.updateMany({
      where: { id: assetId, status: 'PROCESSING', errorCode: cleanupLease },
      data: { status: 'FAILED', errorCode }
    }).catch(() => undefined);
  }
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
  avatarMediaId: true,
  avatarMedia: { include: { variants: true } }
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
  return ({
  enabled: isMediaStorageConfigured(),
  maxPostImages: MEDIA_CONFIG.maxPostImages,
  maxInputBytes: MEDIA_CONFIG.maxInputBytes,
  maxCoverInputBytes: MEDIA_CONFIG.maxCoverInputBytes,
  maxDecodedPixels: MEDIA_CONFIG.maxDecodedPixels,
  maxUploadConcurrency: MEDIA_CONFIG.maxUploadConcurrency,
  minAspectRatio: MEDIA_CONFIG.minAspectRatio,
  maxAspectRatio: MEDIA_CONFIG.maxAspectRatio,
  allowedMimeTypes: heifServerPreparationEnabled
    ? MEDIA_CONFIG.allowedSourceMimeTypes
    : MEDIA_CONFIG.allowedMimeTypes,
  heifServerPreparationEnabled
  });
};

export const createMediaUpload = async (
  ownerId: string,
  purpose: MediaPurpose,
  declaredMime: string,
  declaredSize: number,
  altText?: string
) => {
  if (!isAllowedMediaSourceMime(declaredMime)) {
    throw new MediaValidationError('UNSUPPORTED_MEDIA_TYPE', 'Only JPEG, PNG, WebP, HEIC, and HEIF images are supported.');
  }
  if (isHeifMediaMime(declaredMime) && !(await verifyHeifConversionReadiness())) {
    throw new MediaValidationError('HEIF_CONVERTER_UNAVAILABLE', 'HEIC/HEIF conversion is temporarily unavailable.', 503);
  }
  const maxInputBytes = maxInputBytesForPurpose(purpose);
  if (!Number.isInteger(declaredSize) || declaredSize <= 0 || declaredSize > maxInputBytes) {
    throw new MediaValidationError('INVALID_FILE_SIZE', `Image must be no larger than ${Math.floor(maxInputBytes / 1024 / 1024)} MB.`);
  }

  const asset = await prisma.mediaAsset.create({
    data: {
      ownerId,
      purpose,
      sourceMime: declaredMime,
      sourceByteSize: declaredSize,
      altText: altText?.trim() || null,
      uploadBucket: MEDIA_CONFIG.buckets.originals,
      expiresAt: addHours(new Date(), MEDIA_CONFIG.temporaryLifetimeHours)
    }
  });
  const key = sourceKey(ownerId, asset.id, declaredMime);

  try {
    const upload = await getMediaStorage().createSignedUpload(MEDIA_CONFIG.buckets.originals, key);
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { uploadKey: key } });
    return {
      assetId: asset.id,
      bucket: MEDIA_CONFIG.buckets.originals,
      path: upload.path,
      token: upload.token,
      signedUrl: upload.signedUrl,
      expiresInSeconds: 7200
    };
  } catch (error) {
    await prisma.mediaAsset.delete({ where: { id: asset.id } }).catch(() => undefined);
    throw error;
  }
};

const uploadProcessedVariant = async (
  asset: MediaAsset,
  variant: ProcessedMediaVariant,
  bucket: string,
  key: string,
  isPublic: boolean
) => {
  await getMediaStorage().upload(bucket, key, variant.buffer, variant.mime, '31536000');
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

const finalizedMediaResponse = (asset: MediaAsset & { variants: MediaVariant[] }) => {
  const largest = asset.variants
    .filter((variant) => variant.kind !== 'MASTER' && !variant.isPublic)
    .sort((left, right) => right.width - left.width)[0]
    || asset.variants.filter((variant) => variant.kind === 'MASTER').sort((left, right) => right.width - left.width)[0];
  if (!asset.aspectRatio || !largest) {
    throw new MediaValidationError('MEDIA_NOT_READY', 'The processed image variants are unavailable.', 409);
  }
  return {
    id: asset.id,
    status: asset.status,
    purpose: asset.purpose,
    aspectRatio: asset.aspectRatio,
    width: largest.width,
    height: largest.height
  };
};

const preparedMediaResponse = async (
  asset: MediaAsset,
  variant: MediaVariant,
  signedSrc?: string
) => ({
  id: asset.id,
  status: 'TEMPORARY' as const,
  sourceMime: asset.sourceMime as 'image/heic' | 'image/heif',
  preview: {
    src: signedSrc || await getMediaStorage().createSignedReadUrl(
        variant.storageBucket,
        variant.storageKey,
        MEDIA_CONFIG.privateUrlLifetimeSeconds
      ),
    mime: 'image/webp' as const,
    width: variant.width,
    height: variant.height,
    aspectRatio: variant.width / variant.height,
    expiresInSeconds: MEDIA_CONFIG.privateUrlLifetimeSeconds
  }
});

const validatePreparedWebp = async (buffer: Buffer): Promise<{ width: number; height: number }> => {
  if (buffer.length === 0 || buffer.length > MEDIA_CONFIG.maxPreparedOutputBytes) {
    throw new MediaValidationError('HEIF_OUTPUT_TOO_LARGE', 'The converted image exceeds the safe output limit.');
  }
  try {
    const metadata = await sharp(buffer, {
      failOn: 'error',
      limitInputPixels: MEDIA_CONFIG.maxDecodedPixels
    }).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    const pixels = width * height;
    if (
      metadata.format !== 'webp'
      || (metadata.pages || 1) !== 1
      || !Number.isSafeInteger(pixels)
      || width <= 0
      || height <= 0
      || width > MEDIA_CONFIG.maxMasterEdge
      || height > MEDIA_CONFIG.maxMasterEdge
      || pixels > MEDIA_CONFIG.maxDecodedPixels
      || metadata.exif
      || metadata.xmp
      || metadata.iptc
    ) {
      throw new Error('unsafe converted output');
    }
    return { width, height };
  } catch (error) {
    if (error instanceof MediaValidationError) throw error;
    throw new MediaValidationError('HEIF_CONVERSION_FAILED', 'The converted HEIC/HEIF image failed validation.');
  }
};

export const prepareMediaUpload = async (ownerId: string, assetId: string) => {
  let asset = await prisma.mediaAsset.findUnique({ where: { id: assetId }, include: { variants: true } });
  if (!asset || asset.ownerId !== ownerId || asset.deletedAt) {
    throw new MediaValidationError('MEDIA_NOT_FOUND', 'Media asset was not found.', 404);
  }
  if (!asset.sourceMime || !isHeifMediaMime(asset.sourceMime)) {
    throw new MediaValidationError('MEDIA_PREPARATION_NOT_REQUIRED', 'This image does not require server preparation.', 409);
  }
  if (!isHeifConversionConfigured() || !(await verifyHeifConversionReadiness())) {
    throw new MediaValidationError('HEIF_CONVERTER_UNAVAILABLE', 'HEIC/HEIF conversion is temporarily unavailable.', 503);
  }
  if (asset.status === 'ATTACHED' || asset.status === 'READY') {
    throw new MediaValidationError('MEDIA_ALREADY_FINALIZED', 'This image has already been finalized.', 409);
  }
  const existingPrepared = asset.variants.find((variant) => (
    variant.kind === 'MASTER'
    && !variant.isPublic
    && variant.storageBucket === MEDIA_CONFIG.buckets.originals
    && variant.mime === 'image/webp'
    && variant.storageKey.startsWith(`${asset.ownerId}/${asset.id}/prepared-`)
  ));
  if (existingPrepared && (asset.status === 'TEMPORARY' || asset.status === 'FAILED')) {
    return preparedMediaResponse(asset, existingPrepared);
  }
  if (!asset.uploadBucket || !asset.uploadKey || !asset.sourceByteSize) {
    throw new MediaValidationError('UPLOAD_NOT_READY', 'The source upload is not available.', 409);
  }

  const attempt = processingAttempt();
  const lease = attempt.lease;
  const claimed = await prisma.mediaAsset.updateMany({
    where: { id: asset.id, status: { in: ['TEMPORARY', 'FAILED'] } },
    data: { status: 'PROCESSING', errorCode: lease }
  });
  if (claimed.count !== 1) {
    throw new MediaValidationError('MEDIA_BUSY', 'This image is already being processed.', 409);
  }

  const object = {
    bucket: MEDIA_CONFIG.buckets.originals,
    key: preparedKey({ id: asset.id, ownerId: asset.ownerId }, attempt.id)
  };
  let uploadAttempted = false;
  try {
    const source = await getMediaStorage().download(asset.uploadBucket, asset.uploadKey);
    const maxInputBytes = maxInputBytesForPurpose(asset.purpose);
    if (source.length !== asset.sourceByteSize || source.length === 0 || source.length > maxInputBytes) {
      throw new MediaValidationError('INVALID_FILE_SIZE', `Image must be no larger than ${Math.floor(maxInputBytes / 1024 / 1024)} MB.`);
    }
    const inspected = inspectHeifBuffer(source);
    if (!isHeifMediaMime(inspected.mime)) {
      throw new MediaValidationError('MIME_MISMATCH', 'The image content does not match its declared file type.');
    }
    const converted = await convertHeifRemotely(source, asset.sourceMime);
    const dimensions = await validatePreparedWebp(converted);
    const stillOwned = await prisma.mediaAsset.updateMany({
      where: { id: asset.id, status: 'PROCESSING', errorCode: lease },
      data: { errorCode: lease }
    });
    if (stillOwned.count !== 1) {
      throw new MediaValidationError('MEDIA_STATE_CONFLICT', 'The media state changed during preparation.', 409);
    }
    uploadAttempted = true;
    await getMediaStorage().upload(object.bucket, object.key, converted, 'image/webp', '0');
    const signedPreview = await getMediaStorage().createSignedReadUrl(
      object.bucket,
      object.key,
      MEDIA_CONFIG.privateUrlLifetimeSeconds
    );
    const rawChecksum = createHash('sha256').update(source).digest('hex');
    const prepared = await prisma.$transaction(async (tx) => {
      const transitioned = await tx.mediaAsset.updateMany({
        where: { id: asset!.id, status: 'PROCESSING', errorCode: lease },
        data: {
          status: 'TEMPORARY',
          sourceMime: asset!.sourceMime,
          sourceWidth: dimensions.width,
          sourceHeight: dimensions.height,
          sourceByteSize: source.length,
          checksum: rawChecksum,
          aspectRatio: dimensions.width / dimensions.height,
          errorCode: null
        }
      });
      if (transitioned.count !== 1) {
        throw new MediaValidationError('MEDIA_STATE_CONFLICT', 'The media state changed during preparation.', 409);
      }
      await tx.mediaVariant.deleteMany({ where: { mediaAssetId: asset!.id, kind: 'MASTER', isPublic: false } });
      return tx.mediaVariant.create({
        data: {
          mediaAssetId: asset!.id,
          kind: 'MASTER',
          storageBucket: object.bucket,
          storageKey: object.key,
          width: dimensions.width,
          height: dimensions.height,
          mime: 'image/webp',
          byteSize: converted.length,
          isPublic: false
        }
      });
    });
    return preparedMediaResponse(asset, prepared, signedPreview);
  } catch (error) {
    const code = error instanceof MediaValidationError ? error.code : 'HEIF_CONVERSION_FAILED';
    await failProcessingAttempt(asset.id, lease, attempt.id, uploadAttempted ? [object] : [], code);
    throw error;
  }
};

export const finalizeMediaUpload = async (ownerId: string, assetId: string, request: MediaCropRequest) => {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId }, include: { variants: true } });
  if (!asset || asset.ownerId !== ownerId || asset.deletedAt) {
    throw new MediaValidationError('MEDIA_NOT_FOUND', 'Media asset was not found.', 404);
  }
  if (asset.status === 'ATTACHED') {
    throw new MediaValidationError('MEDIA_ALREADY_ATTACHED', 'Attached media cannot be finalized again.', 409);
  }
  if (asset.status === 'READY') return finalizedMediaResponse(asset);
  if (!asset.sourceMime) {
    throw new MediaValidationError('UPLOAD_NOT_READY', 'The source upload is not available.', 409);
  }
  const heifSource = isHeifMediaMime(asset.sourceMime);
  const preparedMaster = heifSource
    ? asset.variants.find((variant) => (
        variant.kind === 'MASTER'
        && !variant.isPublic
        && variant.storageBucket === MEDIA_CONFIG.buckets.originals
        && variant.mime === 'image/webp'
        && variant.storageKey.startsWith(`${asset.ownerId}/${asset.id}/prepared-`)
      ))
    : undefined;
  if (heifSource && !preparedMaster) {
    throw new MediaValidationError('MEDIA_NOT_PREPARED', 'The HEIC/HEIF image must be prepared before finalization.', 409);
  }
  if (!heifSource && (!asset.uploadBucket || !asset.uploadKey)) {
    throw new MediaValidationError('UPLOAD_NOT_READY', 'The source upload is not available.', 409);
  }

  const attempt = processingAttempt();
  const lease = attempt.lease;
  const claimed = await prisma.mediaAsset.updateMany({
    where: { id: asset.id, status: { in: ['TEMPORARY', 'FAILED'] } },
    data: { status: 'PROCESSING', errorCode: lease }
  });
  if (claimed.count !== 1) {
    throw new MediaValidationError('MEDIA_BUSY', 'This image is already being processed.', 409);
  }

  const uploadedObjects: Array<{ bucket: string; key: string }> = [];
  try {
    const source = heifSource
      ? await getMediaStorage().download(preparedMaster!.storageBucket, preparedMaster!.storageKey)
      : await getMediaStorage().download(asset.uploadBucket!, asset.uploadKey!);
    const processed = await processMediaBuffer(source, asset.purpose, heifSource ? 'image/webp' : asset.sourceMime, request);
    const stillOwned = await prisma.mediaAsset.updateMany({
      where: { id: asset.id, status: 'PROCESSING', errorCode: lease },
      data: { errorCode: lease }
    });
    if (stillOwned.count !== 1) {
      throw new MediaValidationError('MEDIA_STATE_CONFLICT', 'The media state changed during finalization.', 409);
    }
    const records: Awaited<ReturnType<typeof uploadProcessedVariant>>[] = [];

    const masterObject = { bucket: MEDIA_CONFIG.buckets.originals, key: masterKey(asset, attempt.id) };
    uploadedObjects.push(masterObject);
    records.push(await uploadProcessedVariant(asset, processed.master, masterObject.bucket, masterObject.key, false));

    for (const variant of processed.variants) {
      const object = {
        bucket: MEDIA_CONFIG.buckets.private,
        key: variantKey(asset, 'private', variant.width, attempt.id)
      };
      uploadedObjects.push(object);
      records.push(await uploadProcessedVariant(asset, variant, object.bucket, object.key, false));
    }

    const updated = await prisma.$transaction(async (tx) => {
      const transitioned = await tx.mediaAsset.updateMany({
        where: { id: asset.id, status: 'PROCESSING', errorCode: lease },
        data: {
          status: 'READY',
          sourceMime: heifSource ? asset.sourceMime : processed.sourceMime,
          sourceWidth: processed.sourceWidth,
          sourceHeight: processed.sourceHeight,
          sourceByteSize: heifSource ? asset.sourceByteSize : processed.sourceByteSize,
          checksum: heifSource ? asset.checksum : processed.checksum,
          aspectRatio: processed.aspectRatio,
          cropX: processed.crop.x,
          cropY: processed.crop.y,
          cropWidth: processed.crop.width,
          cropHeight: processed.crop.height,
          focalX: request.focalX,
          focalY: request.focalY,
          altText: request.altText?.trim() || asset.altText,
          uploadBucket: heifSource ? preparedMaster!.storageBucket : asset.uploadBucket,
          uploadKey: heifSource ? preparedMaster!.storageKey : asset.uploadKey,
          errorCode: null
        }
      });
      if (transitioned.count !== 1) {
        throw new MediaValidationError('MEDIA_STATE_CONFLICT', 'The media state changed during finalization.', 409);
      }
      await tx.mediaVariant.deleteMany({ where: { mediaAssetId: asset.id } });
      await tx.mediaVariant.createMany({ data: records });
      return tx.mediaAsset.findUniqueOrThrow({ where: { id: asset.id }, include: { variants: true } });
    });

    try {
      const cleanupObjects: StorageObject[] = [];
      if (asset.uploadBucket && asset.uploadKey) cleanupObjects.push({ bucket: asset.uploadBucket, key: asset.uploadKey });
      if (preparedMaster) cleanupObjects.push({ bucket: preparedMaster.storageBucket, key: preparedMaster.storageKey });
      for (const [bucket, keys] of groupStorageObjects(cleanupObjects)) {
        await getMediaStorage().remove(bucket, keys);
      }
      await prisma.mediaAsset.updateMany({
        where: {
          id: asset.id,
          uploadBucket: heifSource ? preparedMaster!.storageBucket : asset.uploadBucket,
          uploadKey: heifSource ? preparedMaster!.storageKey : asset.uploadKey
        },
        data: { uploadBucket: null, uploadKey: null }
      });
    } catch {
      // The cleanup job can remove this exact source object later.
    }

    return finalizedMediaResponse(updated);
  } catch (error) {
    const code = error instanceof MediaValidationError ? error.code : 'PROCESSING_FAILED';
    await failProcessingAttempt(asset.id, lease, attempt.id, uploadedObjects, code);
    throw error;
  }
};

export const promoteMediaAsset = async (assetId: string): Promise<void> => {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId }, include: { variants: true } });
  if (!asset || !['READY', 'ATTACHED'].includes(asset.status)) {
    throw new MediaValidationError('MEDIA_NOT_READY', 'Media must finish processing before it can be attached.', 409);
  }
  if (asset.variants.some((variant) => variant.isPublic)) {
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { accessScope: 'PUBLIC' } });
    return;
  }

  const privateVariants = asset.variants.filter((variant) => variant.kind !== 'MASTER' && !variant.isPublic);
  const copied: string[] = [];
  try {
    const records: Prisma.MediaVariantCreateManyInput[] = [];
    for (const variant of privateVariants) {
      const key = variantKey(asset, 'public', variant.width);
      const body = await getMediaStorage().download(variant.storageBucket, variant.storageKey);
      await getMediaStorage().upload(MEDIA_CONFIG.buckets.public, key, body, variant.mime, '300');
      copied.push(key);
      records.push({
        mediaAssetId: asset.id,
        kind: variant.kind,
        storageBucket: MEDIA_CONFIG.buckets.public,
        storageKey: key,
        width: variant.width,
        height: variant.height,
        mime: variant.mime,
        byteSize: variant.byteSize,
        isPublic: true
      });
    }
    await prisma.$transaction([
      prisma.mediaVariant.createMany({ data: records, skipDuplicates: true }),
      prisma.mediaAsset.update({ where: { id: asset.id }, data: { accessScope: 'PUBLIC' } })
    ]);
  } catch (error) {
    await getMediaStorage().remove(MEDIA_CONFIG.buckets.public, copied).catch(() => undefined);
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
    select: { id: true, purpose: true }
  });
  if (assets.length !== requirements.length) {
    throw new MediaValidationError('MEDIA_NOT_READY', 'One or more images are unavailable, already used, or still processing.', 409);
  }
  const purposeById = new Map(assets.map((asset) => [asset.id, asset.purpose]));
  if (requirements.some((requirement) => purposeById.get(requirement.id) !== requirement.purpose)) {
    throw new MediaValidationError('MEDIA_PURPOSE_MISMATCH', 'An image was uploaded for a different content type.', 409);
  }

  const promotedAssetIds: string[] = [];
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
    where: { id: { in: prepared.assetIds }, status: 'READY' },
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
  await tx.mediaAsset.updateMany({
    where: { id: { in: prepared.assetIds }, status: 'ATTACHED' },
    data: { accessScope: prepared.scope }
  });
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
      where: { id: { in: ids }, status: { in: ['READY', 'ATTACHED', 'FAILED'] } },
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

export const validatePostMediaSet = async (
  ownerId: string,
  assetIds: string[],
  requestedAspectRatio?: number
): Promise<number | null> => {
  if (assetIds.length === 0) return null;
  if (assetIds.length > MEDIA_CONFIG.maxPostImages) {
    throw new MediaValidationError('TOO_MANY_POST_IMAGES', `A post can contain up to ${MEDIA_CONFIG.maxPostImages} images.`);
  }
  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: assetIds }, ownerId, purpose: 'POST', status: { in: ['READY', 'ATTACHED'] } },
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

export const restrictMediaAsset = async (assetId: string, scope: MediaAccessScope = 'RESTRICTED'): Promise<void> => {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId }, include: { variants: true } });
  if (!asset) return;
  const publicVariants = asset.variants.filter((variant) => variant.isPublic);
  await getMediaStorage().remove(
    MEDIA_CONFIG.buckets.public,
    publicVariants.map((variant) => variant.storageKey)
  );
  await prisma.$transaction([
    prisma.mediaVariant.deleteMany({ where: { mediaAssetId: asset.id, isPublic: true } }),
    prisma.mediaAsset.update({ where: { id: asset.id }, data: { accessScope: scope } })
  ]);
};

export const markMediaAttached = async (assetIds: string[], scope: MediaAccessScope): Promise<void> => {
  if (assetIds.length === 0) return;
  const result = await prisma.mediaAsset.updateMany({
    where: { id: { in: assetIds }, status: 'READY' },
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
  if (asset.coverFor) return PrivacyService.canViewUserContent(viewerId, asset.ownerId);
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
  if (asset.coverFor && !(await PrivacyService.canViewUserContent(viewerId, asset.ownerId))) {
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

export const serializeUserMediaRecord = <T extends Record<string, any>>(user?: T | null): T | null | undefined => {
  if (!user) return user;
  const { avatarMedia, coverMedia, ...rest } = user;
  const presentation = serializeMediaAsset(avatarMedia);
  const coverPresentation = serializeMediaAsset(coverMedia);
  const legacyAvatar = typeof user.avatar === 'string' && /(?:ui-avatars\.com|api\.dicebear\.com|picsum\.photos|randomuser\.me)/i.test(user.avatar)
    ? null
    : user.avatar;
  return {
    ...rest,
    avatar: presentation?.src || (!user.avatarMediaId && legacyAvatar ? legacyAvatar : ''),
    avatarMedia: presentation,
    ...(Object.prototype.hasOwnProperty.call(user, 'coverMedia') ? { coverMedia: coverPresentation } : {})
  } as unknown as T;
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
  const maySeeInternalOptionNames = post.status !== 'PUBLISHED' || (Boolean(viewerId) && post.authorId === viewerId);
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
    author: serializeUserMediaRecord(post.author),
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
  await prisma.mediaAsset.update({ where: { id: asset.id }, data: { status: 'PENDING_DELETE' } });
  await purgeMediaAsset(asset.id);
};

export const purgeMediaAsset = async (assetId: string): Promise<void> => {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId }, include: { variants: true } });
  if (!asset) return;
  const objects = asset.variants.map((variant) => ({ bucket: variant.storageBucket, key: variant.storageKey }));
  if (asset.uploadBucket && asset.uploadKey) objects.push({ bucket: asset.uploadBucket, key: asset.uploadKey });
  for (const [bucket, keys] of groupStorageObjects(objects)) {
    await getMediaStorage().remove(bucket, keys);
  }
  await prisma.$transaction([
    prisma.mediaVariant.deleteMany({ where: { mediaAssetId: asset.id } }),
    prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { status: 'DELETED', deletedAt: new Date(), uploadBucket: null, uploadKey: null }
    })
  ]);
};

export const cleanupExpiredMedia = async (limit = 100): Promise<number> => {
  if (!isMediaStorageConfigured()) return 0;
  const processingCutoff = new Date(Date.now() - 15 * 60 * 1000);
  const staleProcessing = await prisma.mediaAsset.findMany({
    where: {
      status: 'PROCESSING',
      updatedAt: { lte: processingCutoff }
    },
    take: Math.min(limit, 25),
    select: { id: true, ownerId: true, purpose: true, sourceMime: true, errorCode: true }
  });
  for (const asset of staleProcessing) {
    const attemptId = processingAttemptId(asset.errorCode);
    if (!attemptId) {
      await prisma.mediaAsset.updateMany({
        where: { id: asset.id, status: 'PROCESSING', errorCode: asset.errorCode, updatedAt: { lte: processingCutoff } },
        data: { status: 'FAILED', errorCode: 'MEDIA_PROCESSING_INTERRUPTED' }
      });
      continue;
    }
    const cleanupLease = `${PROCESSING_CLEANUP_PREFIX}${attemptId}`;
    const claimed = await prisma.mediaAsset.updateMany({
      where: { id: asset.id, status: 'PROCESSING', errorCode: asset.errorCode, updatedAt: { lte: processingCutoff } },
      data: { errorCode: cleanupLease }
    });
    if (claimed.count !== 1) continue;
    try {
      for (const [bucket, keys] of groupStorageObjects(processingAttemptObjects(asset, attemptId))) {
        await getMediaStorage().remove(bucket, keys);
      }
      await prisma.mediaAsset.updateMany({
        where: { id: asset.id, status: 'PROCESSING', errorCode: cleanupLease },
        data: { status: 'FAILED', errorCode: 'MEDIA_PROCESSING_INTERRUPTED' }
      });
    } catch {
      // Keep the cleanup lease in PROCESSING so no new attempt can race it.
    }
  }
  const staleSourceUploads = await prisma.mediaAsset.findMany({
    where: {
      status: { in: ['READY', 'ATTACHED'] },
      uploadBucket: { not: null },
      uploadKey: { not: null }
    },
    take: Math.min(limit, 25),
    select: { id: true, ownerId: true, sourceMime: true, uploadBucket: true, uploadKey: true }
  });
  for (const asset of staleSourceUploads) {
    if (!asset.uploadBucket || !asset.uploadKey) continue;
    try {
      const keys = [asset.uploadKey];
      if (asset.sourceMime && isHeifMediaMime(asset.sourceMime)) {
        keys.push(sourceKey(asset.ownerId, asset.id, asset.sourceMime));
      }
      await getMediaStorage().remove(asset.uploadBucket, keys);
      await prisma.mediaAsset.updateMany({
        where: { id: asset.id, uploadBucket: asset.uploadBucket, uploadKey: asset.uploadKey },
        data: { uploadBucket: null, uploadKey: null }
      });
    } catch {
      // Retry the same exact object during the next scheduled cleanup.
    }
  }
  const stalePublicAssets = await prisma.mediaAsset.findMany({
    where: {
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
        { status: { in: ['TEMPORARY', 'FAILED'] }, expiresAt: { lte: new Date() } }
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
