export const DEFAULT_MEDIA_MAX_INPUT_BYTES = 15 * 1024 * 1024;
export const PROFILE_COVER_MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MEDIA_MAX_DECODED_PIXELS = 40_000_000;

export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export type MediaFileValidationErrorCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'MIME_MISMATCH'
  | 'INVALID_IMAGE'
  | 'PIXEL_LIMIT_EXCEEDED';

export class MediaFileValidationError extends Error {
  readonly code: MediaFileValidationErrorCode;

  constructor(code: MediaFileValidationErrorCode) {
    super(code);
    this.name = 'MediaFileValidationError';
    this.code = code;
  }
}

export type ValidatedImageFile = {
  file: File;
  mime: SupportedImageMime;
  width: number;
  height: number;
  pixelCount: number;
};

export type MediaFileValidationOptions = {
  maxInputBytes?: number;
  maxDecodedPixels?: number;
};

const SUPPORTED_MIME_ALIASES: Record<string, SupportedImageMime> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/x-png': 'image/png',
  'image/webp': 'image/webp'
};

const normalizeDeclaredMime = (value: string): SupportedImageMime | null => (
  SUPPORTED_MIME_ALIASES[value.trim().toLowerCase()] || null
);

const hasBytes = (bytes: Uint8Array, offset: number, expected: number[]): boolean => (
  offset >= 0
  && offset + expected.length <= bytes.length
  && expected.every((value, index) => bytes[offset + index] === value)
);

const ascii = (bytes: Uint8Array, offset: number, length: number): string => (
  String.fromCharCode(...bytes.slice(offset, offset + length))
);

const readUint16BigEndian = (bytes: Uint8Array, offset: number): number => (
  (bytes[offset] << 8) | bytes[offset + 1]
);

const readUint16LittleEndian = (bytes: Uint8Array, offset: number): number => (
  bytes[offset] | (bytes[offset + 1] << 8)
);

const readUint24LittleEndian = (bytes: Uint8Array, offset: number): number => (
  bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
);

const pngDimensions = (bytes: Uint8Array): { width: number; height: number } | null => {
  if (
    !hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    || bytes.length < 24
    || ascii(bytes, 12, 4) !== 'IHDR'
  ) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf
]);

const jpegDimensions = (bytes: Uint8Array): { width: number; height: number } | null => {
  if (!hasBytes(bytes, 0, [0xff, 0xd8])) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 1 >= bytes.length) return null;
    const segmentLength = readUint16BigEndian(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 7 || offset + 6 >= bytes.length) return null;
      return {
        height: readUint16BigEndian(bytes, offset + 3),
        width: readUint16BigEndian(bytes, offset + 5)
      };
    }
    offset += segmentLength;
  }
  return null;
};

const webpDimensions = (bytes: Uint8Array): { width: number; height: number } | null => {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null;
  const format = ascii(bytes, 12, 4);
  if (format === 'VP8X' && bytes.length >= 30) {
    return {
      width: readUint24LittleEndian(bytes, 24) + 1,
      height: readUint24LittleEndian(bytes, 27) + 1
    };
  }
  if (format === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    return {
      width: 1 + (bytes[21] | ((bytes[22] & 0x3f) << 8)),
      height: 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10))
    };
  }
  if (format === 'VP8 ' && bytes.length >= 30 && hasBytes(bytes, 23, [0x9d, 0x01, 0x2a])) {
    return {
      width: readUint16LittleEndian(bytes, 26) & 0x3fff,
      height: readUint16LittleEndian(bytes, 28) & 0x3fff
    };
  }
  return null;
};

export const inspectImageBytes = (
  bytes: Uint8Array
): { mime: SupportedImageMime; width: number; height: number } | null => {
  const png = pngDimensions(bytes);
  if (png) return { mime: 'image/png', ...png };
  const jpeg = jpegDimensions(bytes);
  if (jpeg) return { mime: 'image/jpeg', ...jpeg };
  const webp = webpDimensions(bytes);
  if (webp) return { mime: 'image/webp', ...webp };
  return null;
};

export const validateAndNormalizeImageFile = async (
  sourceFile: File,
  options: MediaFileValidationOptions = {}
): Promise<ValidatedImageFile> => {
  const maxInputBytes = options.maxInputBytes ?? DEFAULT_MEDIA_MAX_INPUT_BYTES;
  const maxDecodedPixels = options.maxDecodedPixels ?? DEFAULT_MEDIA_MAX_DECODED_PIXELS;
  if (sourceFile.size <= 0) throw new MediaFileValidationError('EMPTY_FILE');
  if (sourceFile.size > maxInputBytes) throw new MediaFileValidationError('FILE_TOO_LARGE');

  const bytes = new Uint8Array(await sourceFile.arrayBuffer());
  const inspected = inspectImageBytes(bytes);
  if (!inspected) throw new MediaFileValidationError('UNSUPPORTED_MEDIA_TYPE');

  const declaredMime = normalizeDeclaredMime(sourceFile.type);
  if (declaredMime && declaredMime !== inspected.mime) {
    throw new MediaFileValidationError('MIME_MISMATCH');
  }
  if (!Number.isInteger(inspected.width) || !Number.isInteger(inspected.height) || inspected.width <= 0 || inspected.height <= 0) {
    throw new MediaFileValidationError('INVALID_IMAGE');
  }
  const pixelCount = inspected.width * inspected.height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > maxDecodedPixels) {
    throw new MediaFileValidationError('PIXEL_LIMIT_EXCEEDED');
  }

  const file = sourceFile.type === inspected.mime
    ? sourceFile
    : new File([sourceFile], sourceFile.name, {
        type: inspected.mime,
        lastModified: sourceFile.lastModified
      });
  return { file, mime: inspected.mime, width: inspected.width, height: inspected.height, pixelCount };
};
