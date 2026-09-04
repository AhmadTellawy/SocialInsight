import { MEDIA_CONFIG } from '../config/media';
import { MediaValidationError } from './mediaProcessor';

export type InspectedHeif = {
  mime: 'image/heic' | 'image/heif';
  width: number;
  height: number;
  aggregatePixelCount: number;
};

const SINGLE_HEIC_BRANDS = new Set(['heic', 'heix']);
const GENERIC_HEIF_BRANDS = new Set(['mif1']);
const SEQUENCE_BRANDS = new Set(['hevc', 'hevx', 'hevm', 'hevs', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);
const CONTAINER_BOXES = new Set(['meta', 'iprp', 'ipco']);
const MAX_BOXES = 4096;
const MAX_DEPTH = 8;
const MAX_DIMENSION = 32_768;
const MAX_FTYP_BYTES = 4096;
const MAX_COMPATIBLE_BRANDS = 256;
const MAX_SPATIAL_PROPERTIES = 16;

type Box = { type: string; end: number; payloadStart: number };

const ascii = (bytes: Buffer, offset: number, length: number): string =>
  bytes.toString('ascii', offset, offset + length);

const invalidContainer = (): MediaValidationError =>
  new MediaValidationError('INVALID_IMAGE', 'The HEIC/HEIF container is invalid.');

const readBox = (bytes: Buffer, offset: number, end: number): Box => {
  if (end - offset < 8) throw invalidContainer();
  let size = bytes.readUInt32BE(offset);
  const type = ascii(bytes, offset + 4, 4);
  let headerSize = 8;
  if (size === 1) {
    if (end - offset < 16) throw invalidContainer();
    const wideSize = bytes.readBigUInt64BE(offset + 8);
    if (wideSize > BigInt(Number.MAX_SAFE_INTEGER)) throw invalidContainer();
    size = Number(wideSize);
    headerSize = 16;
  } else if (size === 0) {
    size = end - offset;
  }
  if (size < headerSize || offset + size > end) throw invalidContainer();
  return { type, end: offset + size, payloadStart: offset + headerSize };
};

const parseBoxes = (
  bytes: Buffer,
  start: number,
  end: number,
  state: {
    boxCount: number;
    dimensions: Array<{ width: number; height: number }>;
    hasHevcConfiguration: boolean;
    hasMediaData: boolean;
  },
  depth = 0
): void => {
  if (depth > MAX_DEPTH) throw invalidContainer();
  let cursor = start;
  while (cursor < end) {
    state.boxCount += 1;
    if (state.boxCount > MAX_BOXES) throw invalidContainer();
    const box = readBox(bytes, cursor, end);
    if (box.type === 'ispe') {
      if (box.end - box.payloadStart < 12) throw invalidContainer();
      const width = bytes.readUInt32BE(box.payloadStart + 4);
      const height = bytes.readUInt32BE(box.payloadStart + 8);
      if (width <= 0 || height <= 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
        throw new MediaValidationError('INVALID_IMAGE', 'The HEIC/HEIF image dimensions are invalid.');
      }
      state.dimensions.push({ width, height });
      if (state.dimensions.length > MAX_SPATIAL_PROPERTIES) throw invalidContainer();
    } else if (box.type === 'hvcC') {
      state.hasHevcConfiguration = true;
    } else if (box.type === 'mdat') {
      state.hasMediaData = state.hasMediaData || box.end > box.payloadStart;
    }
    if (CONTAINER_BOXES.has(box.type)) {
      const childStart = box.payloadStart + (box.type === 'meta' ? 4 : 0);
      if (childStart > box.end) throw invalidContainer();
      parseBoxes(bytes, childStart, box.end, state, depth + 1);
    }
    cursor = box.end;
  }
};

export const inspectHeifBuffer = (bytes: Buffer): InspectedHeif => {
  if (bytes.length < 24) {
    throw new MediaValidationError('MIME_MISMATCH', 'The image content does not match its declared file type.');
  }
  const first = readBox(bytes, 0, bytes.length);
  if (first.type !== 'ftyp' || first.end - first.payloadStart < 8) {
    throw new MediaValidationError('MIME_MISMATCH', 'The image content does not match its declared file type.');
  }
  if (first.end > MAX_FTYP_BYTES || Math.floor((first.end - first.payloadStart - 8) / 4) > MAX_COMPATIBLE_BRANDS) {
    throw invalidContainer();
  }
  const brands = new Set([ascii(bytes, first.payloadStart, 4)]);
  for (let offset = first.payloadStart + 8; offset + 4 <= first.end; offset += 4) {
    brands.add(ascii(bytes, offset, 4));
  }
  if ([...brands].some((brand) => SEQUENCE_BRANDS.has(brand))) {
    throw new MediaValidationError('UNSUPPORTED_MEDIA_SEQUENCE', 'HEIC/HEIF image sequences are not supported.');
  }
  if ([...brands].some((brand) => AVIF_BRANDS.has(brand))) {
    throw new MediaValidationError('UNSUPPORTED_MEDIA_TYPE', 'AVIF is not accepted by the HEIC/HEIF conversion path.');
  }
  const hasHeicBrand = [...brands].some((brand) => SINGLE_HEIC_BRANDS.has(brand));
  const hasGenericHeifBrand = [...brands].some((brand) => GENERIC_HEIF_BRANDS.has(brand));
  if (!hasHeicBrand && !hasGenericHeifBrand) {
    throw new MediaValidationError('UNSUPPORTED_MEDIA_TYPE', 'The HEIC/HEIF brand is not supported.');
  }

  const state = {
    boxCount: 0,
    dimensions: [] as Array<{ width: number; height: number }>,
    hasHevcConfiguration: false,
    hasMediaData: false
  };
  parseBoxes(bytes, first.end, bytes.length, state);
  if (!state.hasHevcConfiguration || !state.hasMediaData || state.dimensions.length === 0) {
    throw invalidContainer();
  }
  const primary = state.dimensions.reduce((largest, candidate) => (
    candidate.width * candidate.height > largest.width * largest.height ? candidate : largest
  ));
  const aggregatePixelCount = state.dimensions.reduce(
    (total, dimension) => total + (dimension.width * dimension.height),
    0
  );
  if (!Number.isSafeInteger(aggregatePixelCount) || aggregatePixelCount > MEDIA_CONFIG.maxDecodedPixels) {
    throw new MediaValidationError('PIXEL_LIMIT_EXCEEDED', 'The image exceeds the safe decoded pixel limit.');
  }
  return {
    mime: hasHeicBrand ? 'image/heic' : 'image/heif',
    width: primary.width,
    height: primary.height,
    aggregatePixelCount
  };
};
