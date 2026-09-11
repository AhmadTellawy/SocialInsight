export const DEFAULT_MEDIA_MAX_INPUT_BYTES = 15 * 1024 * 1024;
export const PROFILE_COVER_MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MEDIA_MAX_DECODED_PIXELS = 40_000_000;
export const HEIF_NATIVE_DECODE_TIMEOUT_MS = 15_000;

export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';
export type SupportedSourceImageMime = SupportedImageMime | 'image/heic' | 'image/heif';

export type InspectedImage = {
  mime: SupportedSourceImageMime;
  width?: number;
  height?: number;
  aggregatePixelCount?: number;
};

export type MediaFileValidationErrorCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'MIME_MISMATCH'
  | 'INVALID_IMAGE'
  | 'HEIF_CODEC_UNAVAILABLE'
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
  mime: SupportedSourceImageMime;
  sourceMime: SupportedSourceImageMime;
  wasConverted: boolean;
  requiresServerPreparation: boolean;
  width: number;
  height: number;
  pixelCount: number;
};

export type HeifConverter = (options: {
  blob: Blob;
  toType: 'image/jpeg';
  quality: number;
}) => Promise<Blob | Blob[]>;

export type MediaFileValidationOptions = {
  maxInputBytes?: number;
  maxDecodedPixels?: number;
  heifConverter?: HeifConverter;
  heifHandling?: 'native' | 'server';
};

const SUPPORTED_MIME_ALIASES: Record<string, SupportedSourceImageMime> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/x-png': 'image/png',
  'image/webp': 'image/webp',
  'image/heic': 'image/heic',
  'image/heic-sequence': 'image/heic',
  'image/x-heic': 'image/heic',
  'image/heif': 'image/heif',
  'image/heif-sequence': 'image/heif',
  'image/x-heif': 'image/heif'
};

const normalizeDeclaredMime = (value: string): SupportedSourceImageMime | null => (
  SUPPORTED_MIME_ALIASES[value.trim().toLowerCase()] || null
);

const HEIC_BRANDS = new Set(['heic', 'heix']);
const HEIF_BRANDS = new Set(['mif1']);
const HEIF_SEQUENCE_BRANDS = new Set(['hevc', 'hevx', 'hevm', 'hevs', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);
const MAX_HEIF_SPATIAL_PROPERTIES = 16;

const hasBytes = (bytes: Uint8Array, offset: number, expected: number[]): boolean => (
  offset >= 0
  && offset + expected.length <= bytes.length
  && expected.every((value, index) => bytes[offset + index] === value)
);

const ascii = (bytes: Uint8Array, offset: number, length: number): string => (
  String.fromCharCode(...bytes.slice(offset, offset + length))
);

const hasAscii = (bytes: Uint8Array, offset: number, value: string): boolean => {
  if (offset < 0 || offset + value.length > bytes.length) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
};

const readUint16BigEndian = (bytes: Uint8Array, offset: number): number => (
  (bytes[offset] << 8) | bytes[offset + 1]
);

const readUint16LittleEndian = (bytes: Uint8Array, offset: number): number => (
  bytes[offset] | (bytes[offset + 1] << 8)
);

const readUint24LittleEndian = (bytes: Uint8Array, offset: number): number => (
  bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
);

const readUint32BigEndian = (bytes: Uint8Array, offset: number): number => (
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset)
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

const inspectHeifBytes = (bytes: Uint8Array): InspectedImage | null => {
  if (bytes.length < 24 || ascii(bytes, 4, 4) !== 'ftyp') return null;
  const boxSize = readUint32BigEndian(bytes, 0);
  if (boxSize < 16 || boxSize > 4096 || boxSize > bytes.length || (boxSize - 16) % 4 !== 0) return null;
  const brands = [ascii(bytes, 8, 4)];
  for (let offset = 16; offset + 3 < boxSize; offset += 4) brands.push(ascii(bytes, offset, 4));
  if (brands.length > 257) return null;
  if (brands.some((brand) => HEIF_SEQUENCE_BRANDS.has(brand))) return null;
  if (brands.some((brand) => AVIF_BRANDS.has(brand))) return null;
  const mime = brands.some((brand) => HEIC_BRANDS.has(brand))
    ? 'image/heic'
    : brands.some((brand) => HEIF_BRANDS.has(brand)) ? 'image/heif' : null;
  if (!mime) return null;
  const dimensions: Array<{ width: number; height: number }> = [];
  let boxCount = 0;
  let hasHevcConfiguration = false;
  let hasMediaData = false;
  const parseBoxes = (start: number, end: number, depth = 0): boolean => {
    if (depth > 8) return false;
    let cursor = start;
    while (cursor < end) {
      if (end - cursor < 8 || ++boxCount > 4096) return false;
      let size = readUint32BigEndian(bytes, cursor);
      const type = ascii(bytes, cursor + 4, 4);
      let headerSize = 8;
      if (size === 1) {
        if (end - cursor < 16) return false;
        const wideSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(cursor + 8);
        if (wideSize > BigInt(Number.MAX_SAFE_INTEGER)) return false;
        size = Number(wideSize);
        headerSize = 16;
      } else if (size === 0) {
        size = end - cursor;
      }
      if (size < headerSize || cursor + size > end) return false;
      const payloadStart = cursor + headerSize;
      const boxEnd = cursor + size;
      if (type === 'ispe') {
        if (boxEnd - payloadStart < 12) return false;
        const width = readUint32BigEndian(bytes, payloadStart + 4);
        const height = readUint32BigEndian(bytes, payloadStart + 8);
        if (width <= 0 || height <= 0 || width > 32_768 || height > 32_768) return false;
        dimensions.push({ width, height });
        if (dimensions.length > MAX_HEIF_SPATIAL_PROPERTIES) return false;
      } else if (type === 'hvcC') {
        hasHevcConfiguration = true;
      } else if (type === 'mdat') {
        hasMediaData = hasMediaData || boxEnd > payloadStart;
      }
      if (type === 'meta' || type === 'iprp' || type === 'ipco') {
        const childStart = payloadStart + (type === 'meta' ? 4 : 0);
        if (childStart > boxEnd || !parseBoxes(childStart, boxEnd, depth + 1)) return false;
      }
      cursor = boxEnd;
    }
    return cursor === end;
  };
  if (!parseBoxes(boxSize, bytes.length) || !hasHevcConfiguration || !hasMediaData || dimensions.length === 0) return null;
  const primary = dimensions.reduce((largest, candidate) => (
    candidate.width * candidate.height > largest.width * largest.height ? candidate : largest
  ));
  const aggregatePixelCount = dimensions.reduce(
    (total, dimension) => total + (dimension.width * dimension.height),
    0
  );
  return { mime, ...primary, aggregatePixelCount };
};

export const inspectImageBytes = (
  bytes: Uint8Array
): InspectedImage | null => {
  const png = pngDimensions(bytes);
  if (png) return { mime: 'image/png', ...png };
  const jpeg = jpegDimensions(bytes);
  if (jpeg) return { mime: 'image/jpeg', ...jpeg };
  const webp = webpDimensions(bytes);
  if (webp) return { mime: 'image/webp', ...webp };
  return inspectHeifBytes(bytes);
};

const isHeifMime = (mime: SupportedSourceImageMime): mime is 'image/heic' | 'image/heif' => (
  mime === 'image/heic' || mime === 'image/heif'
);

const declaredMimeMatches = (declared: SupportedSourceImageMime, detected: SupportedSourceImageMime): boolean => (
  declared === detected || (isHeifMime(declared) && isHeifMime(detected))
);

const validatedDimensions = (
  inspected: InspectedImage,
  maxDecodedPixels: number
): { width: number; height: number; pixelCount: number } => {
  const { width, height } = inspected;
  if (!Number.isInteger(width) || !Number.isInteger(height) || !width || !height || width <= 0 || height <= 0) {
    throw new MediaFileValidationError('INVALID_IMAGE');
  }
  const pixelCount = width * height;
  const aggregatePixelCount = inspected.aggregatePixelCount ?? pixelCount;
  if (
    !Number.isSafeInteger(pixelCount)
    || !Number.isSafeInteger(aggregatePixelCount)
    || pixelCount > maxDecodedPixels
    || aggregatePixelCount > maxDecodedPixels
  ) {
    throw new MediaFileValidationError('PIXEL_LIMIT_EXCEEDED');
  }
  return { width, height, pixelCount };
};

const jpegBlobFromImage = async (
  image: CanvasImageSource,
  width: number,
  height: number,
  quality: number,
  maxDecodedPixels: number
): Promise<Blob> => {
  const pixelCount = width * height;
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width <= 0
    || height <= 0
    || !Number.isSafeInteger(pixelCount)
    || pixelCount > maxDecodedPixels
  ) throw new Error('PIXEL_LIMIT_EXCEEDED');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('CANVAS_UNAVAILABLE');
  context.drawImage(image, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('JPEG_CONVERSION_FAILED')),
      'image/jpeg',
      quality
    );
  });
};

const defaultHeifConverter = async (
  options: Parameters<HeifConverter>[0],
  maxDecodedPixels: number
): Promise<Blob> => {
  if (typeof document === 'undefined') throw new Error('NATIVE_HEIF_UNAVAILABLE');
  const objectUrl = URL.createObjectURL(options.blob);
  const image = new Image();
  image.decoding = 'async';
  image.src = objectUrl;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      image.decode(),
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error('NATIVE_HEIF_TIMEOUT')), HEIF_NATIVE_DECODE_TIMEOUT_MS);
      })
    ]);
    return await jpegBlobFromImage(
      image,
      image.naturalWidth,
      image.naturalHeight,
      options.quality,
      maxDecodedPixels
    );
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    image.src = '';
    URL.revokeObjectURL(objectUrl);
  }
};

const jpegNameFor = (name: string): string => (
  /\.(?:heic|heif)$/i.test(name) ? name.replace(/\.(?:heic|heif)$/i, '.jpg') : `${name}.jpg`
);

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

  const rawDeclaredMime = sourceFile.type.trim().toLowerCase();
  if (rawDeclaredMime === 'image/heic-sequence' || rawDeclaredMime === 'image/heif-sequence') {
    throw new MediaFileValidationError('UNSUPPORTED_MEDIA_TYPE');
  }
  const declaredMime = normalizeDeclaredMime(rawDeclaredMime);
  const genericHeifMime = rawDeclaredMime === 'application/octet-stream' && isHeifMime(inspected.mime);
  if (rawDeclaredMime && !declaredMime && !genericHeifMime) {
    throw new MediaFileValidationError('UNSUPPORTED_MEDIA_TYPE');
  }
  if (declaredMime && !declaredMimeMatches(declaredMime, inspected.mime)) {
    throw new MediaFileValidationError('MIME_MISMATCH');
  }

  if (isHeifMime(inspected.mime)) {
    // Fail closed before invoking the decoder: decoding a container without a
    // bounded primary-image size could exhaust memory even when its file is
    // below the byte limit.
    const sourceDimensions = validatedDimensions(inspected, maxDecodedPixels);
    if (options.heifHandling === 'server') {
      const file = sourceFile.type === inspected.mime
        ? sourceFile
        : new File([sourceFile], sourceFile.name, {
            type: inspected.mime,
            lastModified: sourceFile.lastModified
          });
      return {
        file,
        mime: inspected.mime,
        sourceMime: inspected.mime,
        wasConverted: false,
        requiresServerPreparation: true,
        ...sourceDimensions
      };
    }
    let converted: Blob | Blob[];
    try {
      const converter: HeifConverter = options.heifConverter
        || ((converterOptions) => defaultHeifConverter(converterOptions, maxDecodedPixels));
      converted = await converter({
        blob: sourceFile,
        toType: 'image/jpeg',
        quality: 0.92
      });
    } catch {
      throw new MediaFileValidationError(options.heifConverter ? 'INVALID_IMAGE' : 'HEIF_CODEC_UNAVAILABLE');
    }
    const convertedBlob = Array.isArray(converted) ? (converted.length === 1 ? converted[0] : undefined) : converted;
    if (!convertedBlob || convertedBlob.size <= 0) throw new MediaFileValidationError('INVALID_IMAGE');
    if (convertedBlob.size > maxInputBytes) throw new MediaFileValidationError('FILE_TOO_LARGE');
    const convertedBytes = new Uint8Array(await convertedBlob.arrayBuffer());
    const convertedInspection = inspectImageBytes(convertedBytes);
    if (!convertedInspection || convertedInspection.mime !== 'image/jpeg') {
      throw new MediaFileValidationError('INVALID_IMAGE');
    }
    const dimensions = validatedDimensions(convertedInspection, maxDecodedPixels);
    const file = new File([convertedBlob], jpegNameFor(sourceFile.name), {
      type: 'image/jpeg',
      lastModified: sourceFile.lastModified
    });
    return {
      file,
      mime: 'image/jpeg',
      sourceMime: inspected.mime,
      wasConverted: true,
      requiresServerPreparation: false,
      ...dimensions
    };
  }

  const dimensions = validatedDimensions(inspected, maxDecodedPixels);

  const file = sourceFile.type === inspected.mime
    ? sourceFile
    : new File([sourceFile], sourceFile.name, {
        type: inspected.mime,
        lastModified: sourceFile.lastModified
      });
  return {
    file,
    mime: inspected.mime,
    sourceMime: inspected.mime,
    wasConverted: false,
    requiresServerPreparation: false,
    ...dimensions
  };
};
