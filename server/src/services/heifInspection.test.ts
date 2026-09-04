import assert from 'node:assert/strict';
import test from 'node:test';
import { MEDIA_CONFIG } from '../config/media';
import { inspectHeifBuffer } from './heifInspection';
import { MediaValidationError } from './mediaProcessor';

const fixture = (brand: string, dimensions: Array<[number, number]>): Buffer => {
  const bytes = Buffer.alloc(20 + 8 + dimensions.length * 20 + 9);
  bytes.writeUInt32BE(20, 0);
  bytes.write('ftyp', 4, 'ascii');
  bytes.write(brand, 8, 'ascii');
  bytes.write(brand, 16, 'ascii');
  bytes.writeUInt32BE(8, 20);
  bytes.write('hvcC', 24, 'ascii');
  dimensions.forEach(([width, height], index) => {
    const offset = 28 + index * 20;
    bytes.writeUInt32BE(20, offset);
    bytes.write('ispe', offset + 4, 'ascii');
    bytes.writeUInt32BE(width, offset + 12);
    bytes.writeUInt32BE(height, offset + 16);
  });
  const mediaOffset = 28 + dimensions.length * 20;
  bytes.writeUInt32BE(9, mediaOffset);
  bytes.write('mdat', mediaOffset + 4, 'ascii');
  bytes[mediaOffset + 8] = 1;
  return bytes;
};

test('accepts bounded HEIC and generic HEIF still-image containers', () => {
  assert.deepEqual(inspectHeifBuffer(fixture('heic', [[1600, 1200]])), {
    mime: 'image/heic', width: 1600, height: 1200, aggregatePixelCount: 1_920_000
  });
  assert.equal(inspectHeifBuffer(fixture('mif1', [[800, 600]])).mime, 'image/heif');
  assert.deepEqual(inspectHeifBuffer(fixture('heic', [[1600, 1200], [240, 160]])), {
    mime: 'image/heic', width: 1600, height: 1200, aggregatePixelCount: 1_958_400
  });
});

test('rejects sequences, AVIF, missing or excessive properties, and pixel bombs', () => {
  for (const brand of ['hevc', 'msf1', 'avif']) {
    assert.throws(() => inspectHeifBuffer(fixture(brand, [[10, 10]])), MediaValidationError);
  }
  assert.throws(() => inspectHeifBuffer(fixture('heic', [])), MediaValidationError);
  assert.throws(() => inspectHeifBuffer(fixture('heic', Array.from({ length: 17 }, () => [10, 10]))), MediaValidationError);
  assert.throws(
    () => inspectHeifBuffer(fixture('heic', [[10_000, 5_000]])),
    (error: unknown) => error instanceof MediaValidationError && error.code === 'PIXEL_LIMIT_EXCEEDED'
  );
});

test('rejects an oversized ftyp brand table in bounded time', () => {
  const input = Buffer.alloc(15 * 1024 * 1024);
  input.writeUInt32BE(4097, 0);
  input.write('ftyp', 4, 'ascii');
  input.write('heic', 8, 'ascii');
  const started = performance.now();
  assert.throws(() => inspectHeifBuffer(input), MediaValidationError);
  assert.ok(performance.now() - started < 100);
});

test('rejects MIME spoofing before invoking any decoder', () => {
  assert.throws(
    () => inspectHeifBuffer(Buffer.from('not a heif image')),
    (error: unknown) => error instanceof MediaValidationError && error.code === 'MIME_MISMATCH'
  );
});
