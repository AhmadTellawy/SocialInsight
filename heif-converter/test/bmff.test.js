import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectHeif } from '../src/bmff.js';
import { heifFixture } from './fixtures.js';

test('accepts a bounded single-image HEIC container and reports dimensions', () => {
  const result = inspectHeif(heifFixture({ dimensions: [[4032, 3024]] }));
  assert.equal(result.mime, 'image/heic');
  assert.equal(result.width, 4032);
  assert.equal(result.height, 3024);
  assert.equal(result.aggregatePixels, 12_192_768);
});

test('accepts generic single-image HEIF mif1 when an HEVC configuration is present', () => {
  const result = inspectHeif(heifFixture({ brand: 'mif1', compatible: ['mif1'], dimensions: [[1600, 900]] }));
  assert.equal(result.mime, 'image/heif');
  assert.equal(result.width, 1600);
  assert.equal(result.height, 900);
});

test('rejects AVIF and HEIF sequence brands', () => {
  assert.throws(() => inspectHeif(heifFixture({ brand: 'avif', compatible: ['mif1', 'avif'] })), {
    code: 'AVIF_NOT_ALLOWED',
  });
  assert.throws(() => inspectHeif(heifFixture({ brand: 'hevc', compatible: ['mif1', 'hevc'] })), {
    code: 'HEIF_SEQUENCE_NOT_ALLOWED',
  });
});

test('accepts bounded auxiliary properties and rejects missing or oversized dimensions', () => {
  const withThumbnail = inspectHeif(heifFixture({ dimensions: [[4032, 3024], [320, 240]] }));
  assert.equal(withThumbnail.width, 4032);
  assert.equal(withThumbnail.height, 3024);
  assert.equal(withThumbnail.spatialPropertyCount, 2);
  assert.throws(() => inspectHeif(heifFixture({ dimensions: [] })), { code: 'INVALID_HEIF_DIMENSIONS' });
  assert.throws(
    () => inspectHeif(heifFixture({ dimensions: [[10_000, 5_000]] })),
    { code: 'HEIF_PIXEL_LIMIT_EXCEEDED' },
  );
});

test('rejects excessive spatial properties and oversized ftyp brand tables', () => {
  assert.throws(() => inspectHeif(heifFixture({ dimensions: Array.from({ length: 17 }, () => [100, 100]) })), {
    code: 'INVALID_HEIF_CONTAINER',
  });
  const oversizedFtyp = Buffer.alloc(15 * 1024 * 1024);
  oversizedFtyp.writeUInt32BE(4097, 0);
  oversizedFtyp.write('ftyp', 4, 'ascii');
  oversizedFtyp.write('heic', 8, 'ascii');
  assert.throws(() => inspectHeif(oversizedFtyp), { code: 'INVALID_HEIF_CONTAINER' });
});
