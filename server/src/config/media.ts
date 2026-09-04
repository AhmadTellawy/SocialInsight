import { MediaPurpose, MediaVariantKind } from '@prisma/client';

export const MEDIA_CONFIG = {
  maxPostImages: 8,
  maxInputBytes: 15 * 1024 * 1024,
  maxCoverInputBytes: 10 * 1024 * 1024,
  maxCoverOutputBytes: 3 * 1024 * 1024,
  maxDecodedPixels: 40_000_000,
  maxMasterEdge: 2400,
  maxPreparedOutputBytes: 12 * 1024 * 1024,
  heifConversionTimeoutMs: 30_000,
  maxUploadConcurrency: 3,
  minAspectRatio: 0.8,
  maxAspectRatio: 1.91,
  temporaryLifetimeHours: 24,
  privateUrlLifetimeSeconds: 300,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
  allowedSourceMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const,
  buckets: {
    originals: 'media-originals',
    public: 'media-public',
    private: 'media-private'
  }
} as const;

export type AllowedMediaMime = (typeof MEDIA_CONFIG.allowedMimeTypes)[number];
export type AllowedMediaSourceMime = (typeof MEDIA_CONFIG.allowedSourceMimeTypes)[number];

type PurposeConfig = {
  widths: ReadonlyArray<{ width: number; kind: MediaVariantKind }>;
  fixedAspectRatio?: number;
  maxInputBytes?: number;
};

export const MEDIA_PURPOSE_CONFIG: Record<MediaPurpose, PurposeConfig> = {
  POST: {
    widths: [
      { width: 480, kind: 'SMALL' },
      { width: 768, kind: 'MEDIUM' },
      { width: 1080, kind: 'LARGE' }
    ]
  },
  PROFILE_AVATAR: {
    fixedAspectRatio: 1,
    widths: [
      { width: 64, kind: 'THUMBNAIL' },
      { width: 128, kind: 'SMALL' },
      { width: 256, kind: 'MEDIUM' },
      { width: 512, kind: 'LARGE' }
    ]
  },
  PROFILE_COVER: {
    fixedAspectRatio: 3,
    maxInputBytes: 10 * 1024 * 1024,
    widths: [
      { width: 600, kind: 'SMALL' },
      { width: 1200, kind: 'LARGE' },
      { width: 1500, kind: 'XLARGE' }
    ]
  },
  GROUP_IMAGE: {
    fixedAspectRatio: 1,
    widths: [
      { width: 256, kind: 'SMALL' },
      { width: 512, kind: 'MEDIUM' },
      { width: 1024, kind: 'LARGE' }
    ]
  },
  QUESTION_IMAGE: {
    widths: [
      { width: 480, kind: 'SMALL' },
      { width: 768, kind: 'MEDIUM' },
      { width: 1080, kind: 'LARGE' }
    ]
  },
  OPTION_IMAGE: {
    fixedAspectRatio: 1,
    widths: [
      { width: 160, kind: 'SMALL' },
      { width: 320, kind: 'MEDIUM' },
      { width: 640, kind: 'LARGE' }
    ]
  }
};

export const isAllowedMediaMime = (value: string): value is AllowedMediaMime =>
  MEDIA_CONFIG.allowedMimeTypes.includes(value as AllowedMediaMime);

export const isAllowedMediaSourceMime = (value: string): value is AllowedMediaSourceMime =>
  MEDIA_CONFIG.allowedSourceMimeTypes.includes(value as AllowedMediaSourceMime);

export const isHeifMediaMime = (value: string): value is 'image/heic' | 'image/heif' =>
  value === 'image/heic' || value === 'image/heif';

export const maxInputBytesForPurpose = (purpose: MediaPurpose): number =>
  MEDIA_PURPOSE_CONFIG[purpose].maxInputBytes || MEDIA_CONFIG.maxInputBytes;

export const clampMediaAspectRatio = (value: number): number =>
  Math.min(MEDIA_CONFIG.maxAspectRatio, Math.max(MEDIA_CONFIG.minAspectRatio, value));
