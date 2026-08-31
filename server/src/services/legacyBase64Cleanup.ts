import { createHash } from 'crypto';
import {
  MediaAccessScope,
  MediaPurpose,
  MediaStatus,
  MediaVariantKind,
  Prisma
} from '@prisma/client';
import { MEDIA_CONFIG, isAllowedMediaMime } from '../config/media';

export const LEGACY_BASE64_CLEANUP_DOMAINS = ['user', 'group', 'post', 'question', 'option'] as const;
export type LegacyBase64CleanupDomain = (typeof LEGACY_BASE64_CLEANUP_DOMAINS)[number];

export type LegacyBase64VariantSnapshot = {
  id: string;
  mediaAssetId: string;
  kind: MediaVariantKind;
  storageBucket: string;
  storageKey: string;
  width: number;
  height: number;
  mime: string;
  byteSize: number;
  isPublic: boolean;
};

export type LegacyBase64AssetSnapshot = {
  id: string;
  ownerId: string;
  purpose: MediaPurpose;
  status: MediaStatus;
  accessScope: MediaAccessScope;
  sourceMime: string | null;
  sourceByteSize: number | null;
  checksum: string | null;
  aspectRatio: number | null;
  deletedAt: Date | string | null;
  variants: LegacyBase64VariantSnapshot[];
};

export type LegacyBase64SourceSnapshot = {
  mime: string;
  byteSize: number;
  checksum: string;
};

export type LegacyBase64EligibilityReason =
  | 'invalidSource'
  | 'missingAuthoritativeOwner'
  | 'missingAsset'
  | 'ownerMismatch'
  | 'purposeMismatch'
  | 'assetNotAttached'
  | 'assetDeleted'
  | 'invalidAspectRatio'
  | 'sourceMimeMismatch'
  | 'sourceByteSizeMismatch'
  | 'checksumMismatch'
  | 'missingDisplayVariant';

export type LegacyBase64Eligibility =
  | {
      eligible: true;
      source: LegacyBase64SourceSnapshot;
      variant: LegacyBase64VariantSnapshot;
    }
  | {
      eligible: false;
      reason: LegacyBase64EligibilityReason;
    };

const PURPOSE_BY_DOMAIN: Record<LegacyBase64CleanupDomain, MediaPurpose> = {
  user: 'PROFILE_AVATAR',
  group: 'GROUP_IMAGE',
  post: 'POST',
  question: 'QUESTION_IMAGE',
  option: 'OPTION_IMAGE'
};

export const purposeForLegacyBase64Domain = (domain: LegacyBase64CleanupDomain): MediaPurpose =>
  PURPOSE_BY_DOMAIN[domain];

export const inspectLegacyBase64DataImage = (value: unknown): LegacyBase64SourceSnapshot | null => {
  if (typeof value !== 'string') return null;
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) return null;

  const mime = match[1].toLowerCase();
  if (!isAllowedMediaMime(mime)) return null;
  const encoded = match[2].replace(/\s/g, '');
  if (!encoded || Math.ceil(encoded.length * 0.75) > MEDIA_CONFIG.maxInputBytes) return null;

  const decoded = Buffer.from(encoded, 'base64');
  if (decoded.length === 0 || decoded.length > MEDIA_CONFIG.maxInputBytes) return null;
  return {
    mime,
    byteSize: decoded.length,
    checksum: createHash('sha256').update(decoded).digest('hex')
  };
};

const isValidAspectRatio = (value: number | null): value is number =>
  typeof value === 'number'
  && Number.isFinite(value)
  && value >= MEDIA_CONFIG.minAspectRatio
  && value <= MEDIA_CONFIG.maxAspectRatio;

const isValidVariantMetadata = (
  variant: LegacyBase64VariantSnapshot,
  accessScope: MediaAccessScope
): boolean => {
  const expectedBucket = accessScope === 'PUBLIC'
    ? MEDIA_CONFIG.buckets.public
    : MEDIA_CONFIG.buckets.private;
  return variant.mediaAssetId.length > 0
    && variant.storageBucket === expectedBucket
    && variant.storageKey.trim().length > 0
    && Number.isInteger(variant.width)
    && variant.width > 0
    && Number.isInteger(variant.height)
    && variant.height > 0
    && Number.isInteger(variant.byteSize)
    && variant.byteSize > 0
    && isAllowedMediaMime(variant.mime)
    && variant.kind !== 'MASTER';
};

export const selectLegacyBase64DisplayVariant = (
  asset: LegacyBase64AssetSnapshot
): LegacyBase64VariantSnapshot | null => {
  const visibilityMatch = asset.accessScope === 'PUBLIC'
    ? (variant: LegacyBase64VariantSnapshot) => variant.isPublic
    : (variant: LegacyBase64VariantSnapshot) => !variant.isPublic && variant.kind !== 'MASTER';
  return [...asset.variants]
    .filter((variant) => visibilityMatch(variant) && isValidVariantMetadata(variant, asset.accessScope))
    .sort((left, right) => right.width - left.width || left.id.localeCompare(right.id))[0] || null;
};

export const evaluateLegacyBase64CleanupCandidate = (
  domain: LegacyBase64CleanupDomain,
  legacySource: unknown,
  authoritativeOwnerId: string | null | undefined,
  asset: LegacyBase64AssetSnapshot | null | undefined
): LegacyBase64Eligibility => {
  const source = inspectLegacyBase64DataImage(legacySource);
  if (!source) return { eligible: false, reason: 'invalidSource' };
  if (!authoritativeOwnerId) return { eligible: false, reason: 'missingAuthoritativeOwner' };
  if (!asset) return { eligible: false, reason: 'missingAsset' };
  if (asset.ownerId !== authoritativeOwnerId) return { eligible: false, reason: 'ownerMismatch' };
  if (asset.purpose !== purposeForLegacyBase64Domain(domain)) {
    return { eligible: false, reason: 'purposeMismatch' };
  }
  if (asset.status !== 'ATTACHED') return { eligible: false, reason: 'assetNotAttached' };
  if (asset.deletedAt !== null) return { eligible: false, reason: 'assetDeleted' };
  if (!isValidAspectRatio(asset.aspectRatio)) return { eligible: false, reason: 'invalidAspectRatio' };
  if (asset.sourceMime !== null && asset.sourceMime.toLowerCase() !== source.mime) {
    return { eligible: false, reason: 'sourceMimeMismatch' };
  }
  if (asset.sourceByteSize !== null && asset.sourceByteSize !== source.byteSize) {
    return { eligible: false, reason: 'sourceByteSizeMismatch' };
  }
  if (!asset.checksum || asset.checksum.toLowerCase() !== source.checksum) {
    return { eligible: false, reason: 'checksumMismatch' };
  }
  const variant = selectLegacyBase64DisplayVariant(asset);
  if (!variant) return { eligible: false, reason: 'missingDisplayVariant' };
  return { eligible: true, source, variant };
};

export const buildExactLegacyBase64AssetWhere = (
  asset: LegacyBase64AssetSnapshot,
  variant: LegacyBase64VariantSnapshot
): Prisma.MediaAssetWhereInput => ({
  id: asset.id,
  ownerId: asset.ownerId,
  purpose: asset.purpose,
  status: 'ATTACHED',
  accessScope: asset.accessScope,
  sourceMime: asset.sourceMime,
  sourceByteSize: asset.sourceByteSize,
  checksum: asset.checksum,
  aspectRatio: asset.aspectRatio,
  deletedAt: null,
  variants: {
    some: {
      id: variant.id,
      mediaAssetId: variant.mediaAssetId,
      kind: variant.kind,
      storageBucket: variant.storageBucket,
      storageKey: variant.storageKey,
      width: variant.width,
      height: variant.height,
      mime: variant.mime,
      byteSize: variant.byteSize,
      isPublic: variant.isPublic
    }
  }
});

export const downloadedVariantMatchesSnapshot = (
  value: Buffer,
  variant: LegacyBase64VariantSnapshot
): boolean => value.length > 0 && value.length === variant.byteSize;

export const parseLegacyBase64CleanupDomains = (raw?: string): LegacyBase64CleanupDomain[] => {
  if (!raw) return [...LEGACY_BASE64_CLEANUP_DOMAINS];
  const tokens = raw.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (tokens.length === 0 || tokens.some((value) =>
    !LEGACY_BASE64_CLEANUP_DOMAINS.includes(value as LegacyBase64CleanupDomain))) {
    throw new Error('INVALID_CLEANUP_DOMAINS');
  }
  return Array.from(new Set(tokens)) as LegacyBase64CleanupDomain[];
};

export const parseLegacyBase64ExpectedCounts = (
  raw?: string
): Partial<Record<LegacyBase64CleanupDomain, number>> => {
  if (!raw) return {};
  const expected: Partial<Record<LegacyBase64CleanupDomain, number>> = {};
  for (const token of raw.split(',').map((value) => value.trim()).filter(Boolean)) {
    const [rawDomain, rawCount, extra] = token.split(':');
    const domain = rawDomain?.toLowerCase() as LegacyBase64CleanupDomain;
    const count = Number(rawCount);
    if (extra !== undefined
        || !LEGACY_BASE64_CLEANUP_DOMAINS.includes(domain)
        || !Number.isSafeInteger(count)
        || count < 0
        || expected[domain] !== undefined) {
      throw new Error('INVALID_CLEANUP_EXPECTATION');
    }
    expected[domain] = count;
  }
  if (Object.keys(expected).length === 0) throw new Error('INVALID_CLEANUP_EXPECTATION');
  return expected;
};

export const parseLegacyBase64BoundedInteger = (
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number => {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error('INVALID_CLEANUP_INTEGER');
  }
  return parsed;
};
