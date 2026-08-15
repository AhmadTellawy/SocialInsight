import { createHash } from 'crypto';
import sharp from 'sharp';
import { MediaPurpose, MediaVariantKind } from '@prisma/client';
import {
  AllowedMediaMime,
  MEDIA_CONFIG,
  MEDIA_PURPOSE_CONFIG,
  clampMediaAspectRatio,
  isAllowedMediaMime
} from '../config/media';

export type NormalizedCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MediaCropRequest = {
  aspectRatio?: number;
  crop?: NormalizedCrop;
  focalX?: number;
  focalY?: number;
  altText?: string;
};

export type ProcessedMediaVariant = {
  kind: MediaVariantKind;
  width: number;
  height: number;
  mime: AllowedMediaMime;
  buffer: Buffer;
};

export type ProcessedMedia = {
  sourceMime: AllowedMediaMime;
  sourceWidth: number;
  sourceHeight: number;
  sourceByteSize: number;
  checksum: string;
  aspectRatio: number;
  crop: NormalizedCrop;
  master: ProcessedMediaVariant;
  variants: ProcessedMediaVariant[];
};

export class MediaValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = 'MediaValidationError';
  }
}

const FORMAT_MIME: Partial<Record<string, AllowedMediaMime>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
};

const withinUnitInterval = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1;

const validateCrop = (crop: NormalizedCrop): void => {
  if (
    !withinUnitInterval(crop.x) ||
    !withinUnitInterval(crop.y) ||
    !Number.isFinite(crop.width) ||
    !Number.isFinite(crop.height) ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    crop.width > 1 ||
    crop.height > 1 ||
    crop.x + crop.width > 1.000001 ||
    crop.y + crop.height > 1.000001
  ) {
    throw new MediaValidationError('INVALID_CROP', 'Crop coordinates must remain inside the image.');
  }
};

const centeredCrop = (width: number, height: number, targetRatio: number): NormalizedCrop => {
  const sourceRatio = width / height;
  if (Math.abs(sourceRatio - targetRatio) < 0.0001) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  if (sourceRatio > targetRatio) {
    const normalizedWidth = targetRatio / sourceRatio;
    return { x: (1 - normalizedWidth) / 2, y: 0, width: normalizedWidth, height: 1 };
  }
  const normalizedHeight = sourceRatio / targetRatio;
  return { x: 0, y: (1 - normalizedHeight) / 2, width: 1, height: normalizedHeight };
};

const fitCropToRatio = (
  crop: NormalizedCrop,
  imageWidth: number,
  imageHeight: number,
  targetRatio: number
): NormalizedCrop => {
  validateCrop(crop);
  const cropPixelRatio = (crop.width * imageWidth) / (crop.height * imageHeight);
  if (Math.abs(cropPixelRatio - targetRatio) / targetRatio <= 0.01) return crop;

  if (cropPixelRatio > targetRatio) {
    const width = (crop.height * imageHeight * targetRatio) / imageWidth;
    return { ...crop, x: crop.x + (crop.width - width) / 2, width };
  }
  const height = (crop.width * imageWidth) / (imageHeight * targetRatio);
  return { ...crop, y: crop.y + (crop.height - height) / 2, height };
};

const toPixelCrop = (crop: NormalizedCrop, width: number, height: number) => {
  const left = Math.max(0, Math.min(width - 1, Math.round(crop.x * width)));
  const top = Math.max(0, Math.min(height - 1, Math.round(crop.y * height)));
  const cropWidth = Math.max(1, Math.min(width - left, Math.round(crop.width * width)));
  const cropHeight = Math.max(1, Math.min(height - top, Math.round(crop.height * height)));
  return { left, top, width: cropWidth, height: cropHeight };
};

const resolveAspectRatio = (purpose: MediaPurpose, requested: number | undefined, sourceRatio: number): number => {
  const fixed = MEDIA_PURPOSE_CONFIG[purpose].fixedAspectRatio;
  if (fixed) return fixed;
  if (requested !== undefined) {
    if (!Number.isFinite(requested) || requested < MEDIA_CONFIG.minAspectRatio || requested > MEDIA_CONFIG.maxAspectRatio) {
      throw new MediaValidationError('INVALID_ASPECT_RATIO', 'Image aspect ratio is outside the supported range.');
    }
    return requested;
  }
  return clampMediaAspectRatio(sourceRatio);
};

export const processMediaBuffer = async (
  input: Buffer,
  purpose: MediaPurpose,
  declaredMime: string,
  request: MediaCropRequest
): Promise<ProcessedMedia> => {
  if (input.length === 0 || input.length > MEDIA_CONFIG.maxInputBytes) {
    throw new MediaValidationError('INVALID_FILE_SIZE', 'Image must be no larger than 15 MB.');
  }
  if (!isAllowedMediaMime(declaredMime)) {
    throw new MediaValidationError('UNSUPPORTED_MEDIA_TYPE', 'Only JPEG, PNG, and WebP images are supported.');
  }

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(input, {
      failOn: 'error',
      limitInputPixels: MEDIA_CONFIG.maxDecodedPixels
    }).metadata();
  } catch {
    throw new MediaValidationError('INVALID_IMAGE', 'The selected image is corrupt or exceeds the safe pixel limit.');
  }

  const detectedMime = metadata.format ? FORMAT_MIME[metadata.format] : undefined;
  if (!detectedMime || detectedMime !== declaredMime) {
    throw new MediaValidationError('MIME_MISMATCH', 'The image content does not match its declared file type.');
  }

  let normalized: { data: Buffer; info: sharp.OutputInfo };
  try {
    normalized = await sharp(input, {
      failOn: 'error',
      limitInputPixels: MEDIA_CONFIG.maxDecodedPixels
    })
      .rotate()
      .toColourspace('srgb')
      .resize({
        width: MEDIA_CONFIG.maxMasterEdge,
        height: MEDIA_CONFIG.maxMasterEdge,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: 92, effort: 4 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new MediaValidationError('IMAGE_PROCESSING_FAILED', 'The image could not be normalized.');
  }

  const sourceWidth = normalized.info.width;
  const sourceHeight = normalized.info.height;
  const aspectRatio = resolveAspectRatio(purpose, request.aspectRatio, sourceWidth / sourceHeight);
  const crop = fitCropToRatio(
    request.crop || centeredCrop(sourceWidth, sourceHeight, aspectRatio),
    sourceWidth,
    sourceHeight,
    aspectRatio
  );
  validateCrop(crop);
  const pixelCrop = toPixelCrop(crop, sourceWidth, sourceHeight);

  const availableWidth = pixelCrop.width;
  const requestedWidths = MEDIA_PURPOSE_CONFIG[purpose].widths.filter(({ width }) => width <= availableWidth);
  const outputWidths = requestedWidths.length > 0
    ? requestedWidths
    : [{ width: availableWidth, kind: 'THUMBNAIL' as MediaVariantKind }];
  const uniqueWidths = Array.from(new Map(outputWidths.map((item) => [item.width, item])).values());

  const variants = await Promise.all(uniqueWidths.map(async ({ width, kind }) => {
    const result = await sharp(normalized.data)
      .extract(pixelCrop)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    return {
      kind,
      width: result.info.width,
      height: result.info.height,
      mime: 'image/webp' as const,
      buffer: result.data
    };
  }));

  return {
    sourceMime: detectedMime,
    sourceWidth,
    sourceHeight,
    sourceByteSize: input.length,
    checksum: createHash('sha256').update(input).digest('hex'),
    aspectRatio,
    crop,
    master: {
      kind: 'MASTER',
      width: sourceWidth,
      height: sourceHeight,
      mime: 'image/webp',
      buffer: normalized.data
    },
    variants
  };
};
