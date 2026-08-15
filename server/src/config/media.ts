import { MediaPurpose, MediaVariantKind } from '@prisma/client';

export const MEDIA_CONFIG = {
  maxPostImages: 8,
  maxInputBytes: 15 * 1024 * 1024,
  maxDecodedPixels: 40_000_000,
  maxMasterEdge: 2400,
  maxUploadConcurrency: 3,
  minAspectRatio: 0.8,
  maxAspectRatio: 1.91,
  temporaryLifetimeHours: 24,
  privateUrlLifetimeSeconds: 300,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
  buckets: {
    originals: 'media-originals',
    public: 'media-public',
    private: 'media-private'
  }
} as const;

export type AllowedMediaMime = (typeof MEDIA_CONFIG.allowedMimeTypes)[number];

type PurposeConfig = {
  widths: ReadonlyArray<{ width: number; kind: MediaVariantKind }>;
  fixedAspectRatio?: number;
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

export const clampMediaAspectRatio = (value: number): number =>
  Math.min(MEDIA_CONFIG.maxAspectRatio, Math.max(MEDIA_CONFIG.minAspectRatio, value));
