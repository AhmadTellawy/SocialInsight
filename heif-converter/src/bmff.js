import { badRequest } from './errors.js';

const SEQUENCE_BRANDS = new Set(['avis', 'hevc', 'hevx', 'hevs', 'hevm', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);
const SINGLE_HEIF_BRANDS = new Set(['heic', 'heix', 'mif1']);
const MAX_BOXES = 4096;
const MAX_DEPTH = 8;
const MAX_DIMENSION = 32_768;
const MAX_FTYP_BYTES = 4096;
const MAX_COMPATIBLE_BRANDS = 256;
const MAX_SPATIAL_PROPERTIES = 16;

function ascii(buffer, start, length) {
  return buffer.toString('ascii', start, start + length);
}

function readBox(buffer, offset, end) {
  if (end - offset < 8) throw badRequest('INVALID_HEIF_CONTAINER', 'Truncated ISO-BMFF box header');
  let size = buffer.readUInt32BE(offset);
  const type = ascii(buffer, offset + 4, 4);
  let headerSize = 8;

  if (size === 1) {
    if (end - offset < 16) throw badRequest('INVALID_HEIF_CONTAINER', 'Truncated extended ISO-BMFF box');
    const wideSize = buffer.readBigUInt64BE(offset + 8);
    if (wideSize > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw badRequest('INVALID_HEIF_CONTAINER', 'ISO-BMFF box exceeds safe parsing limits');
    }
    size = Number(wideSize);
    headerSize = 16;
  } else if (size === 0) {
    size = end - offset;
  }

  if (size < headerSize || offset + size > end) {
    throw badRequest('INVALID_HEIF_CONTAINER', 'Invalid ISO-BMFF box length');
  }
  return { type, start: offset, end: offset + size, payloadStart: offset + headerSize };
}

function parseBoxes(buffer, start, end, state, depth = 0) {
  if (depth > MAX_DEPTH) throw badRequest('INVALID_HEIF_CONTAINER', 'ISO-BMFF nesting is too deep');
  let cursor = start;
  while (cursor < end) {
    if (++state.boxCount > MAX_BOXES) {
      throw badRequest('INVALID_HEIF_CONTAINER', 'ISO-BMFF contains too many boxes');
    }
    const box = readBox(buffer, cursor, end);
    if (box.type === 'ispe') {
      if (box.end - box.payloadStart < 12) {
        throw badRequest('INVALID_HEIF_DIMENSIONS', 'Truncated image spatial extents property');
      }
      const width = buffer.readUInt32BE(box.payloadStart + 4);
      const height = buffer.readUInt32BE(box.payloadStart + 8);
      if (width === 0 || height === 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
        throw badRequest('INVALID_HEIF_DIMENSIONS', 'Invalid HEIF image dimensions');
      }
      state.dimensions.push({ width, height });
      if (state.dimensions.length > MAX_SPATIAL_PROPERTIES) {
        throw badRequest('INVALID_HEIF_CONTAINER', 'HEIF contains too many spatial properties');
      }
    } else if (box.type === 'hvcC') {
      state.hasHevcConfiguration = true;
    } else if (box.type === 'mdat') {
      state.hasMediaData = state.hasMediaData || box.end > box.payloadStart;
    }

    const childOffset = box.type === 'meta' ? 4 : 0;
    if (box.type === 'meta' || box.type === 'iprp' || box.type === 'ipco') {
      const childStart = box.payloadStart + childOffset;
      if (childStart > box.end) throw badRequest('INVALID_HEIF_CONTAINER', 'Truncated container box');
      parseBoxes(buffer, childStart, box.end, state, depth + 1);
    }
    cursor = box.end;
  }
}

export function inspectHeif(buffer, { maxAggregatePixels = 40_000_000 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) {
    throw badRequest('INVALID_HEIF_CONTAINER', 'Input is not a complete HEIF file');
  }
  const first = readBox(buffer, 0, buffer.length);
  if (first.type !== 'ftyp' || first.end - first.payloadStart < 8) {
    throw badRequest('UNSUPPORTED_MEDIA_TYPE', 'Input does not have a valid HEIF file-type box');
  }
  if (first.end > MAX_FTYP_BYTES || Math.floor((first.end - first.payloadStart - 8) / 4) > MAX_COMPATIBLE_BRANDS) {
    throw badRequest('INVALID_HEIF_CONTAINER', 'HEIF file-type box exceeds safe parsing limits');
  }

  const brands = new Set([ascii(buffer, first.payloadStart, 4)]);
  for (let offset = first.payloadStart + 8; offset + 4 <= first.end; offset += 4) {
    brands.add(ascii(buffer, offset, 4));
  }
  if ([...brands].some((brand) => AVIF_BRANDS.has(brand))) {
    throw badRequest('AVIF_NOT_ALLOWED', 'AVIF input is not accepted by this service');
  }
  if ([...brands].some((brand) => SEQUENCE_BRANDS.has(brand))) {
    throw badRequest('HEIF_SEQUENCE_NOT_ALLOWED', 'HEIF image sequences and collections are not accepted');
  }

  const state = { boxCount: 0, dimensions: [], hasHevcConfiguration: false, hasMediaData: false };
  parseBoxes(buffer, first.end, buffer.length, state);
  if (!state.hasHevcConfiguration || ![...brands].some((brand) => SINGLE_HEIF_BRANDS.has(brand))) {
    throw badRequest('UNSUPPORTED_HEIF_CODEC', 'Only single-image HEVC HEIF/HEIC input is accepted');
  }
  if (!state.hasMediaData) throw badRequest('INVALID_HEIF_CONTAINER', 'HEIF media data is missing');
  if (state.dimensions.length === 0) throw badRequest('INVALID_HEIF_DIMENSIONS', 'HEIF image dimensions are missing');

  let aggregatePixels = 0;
  for (const { width, height } of state.dimensions) {
    aggregatePixels += width * height;
    if (!Number.isSafeInteger(aggregatePixels) || aggregatePixels > maxAggregatePixels) {
      throw badRequest('HEIF_PIXEL_LIMIT_EXCEEDED', 'HEIF aggregate pixel limit exceeded');
    }
  }

  const primary = state.dimensions.reduce((largest, candidate) => (
    candidate.width * candidate.height > largest.width * largest.height ? candidate : largest
  ));
  return Object.freeze({
    mime: brands.has('heic') || brands.has('heix') ? 'image/heic' : 'image/heif',
    width: primary.width,
    height: primary.height,
    aggregatePixels,
    spatialPropertyCount: state.dimensions.length,
    brands: Object.freeze([...brands]),
  });
}
