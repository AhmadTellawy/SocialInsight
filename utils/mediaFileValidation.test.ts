import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MediaFileValidationError,
  inspectImageBytes,
  validateAndNormalizeImageFile
} from './mediaFileValidation.ts';

const pngBytes = (width: number, height: number): Uint8Array => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
};

const jpegBytes = (width: number, height: number): Uint8Array => new Uint8Array([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x0b, 0x08,
  (height >> 8) & 0xff, height & 0xff,
  (width >> 8) & 0xff, width & 0xff,
  0x03, 0x01, 0x11, 0x00,
  0xff, 0xd9
]);

const webpBytes = (width: number, height: number): Uint8Array => {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12);
  const encodedWidth = width - 1;
  const encodedHeight = height - 1;
  bytes.set([encodedWidth & 0xff, (encodedWidth >> 8) & 0xff, (encodedWidth >> 16) & 0xff], 24);
  bytes.set([encodedHeight & 0xff, (encodedHeight >> 8) & 0xff, (encodedHeight >> 16) & 0xff], 27);
  return bytes;
};

const heifBytes = (brand: 'heic' | 'mif1' | 'msf1' | 'hevc' | 'avif', width: number, height: number): Uint8Array => {
  const bytes = new Uint8Array(57);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 20);
  bytes.set([...Buffer.from('ftyp')], 4);
  bytes.set([...Buffer.from(brand)], 8);
  bytes.set([...Buffer.from(brand)], 16);
  view.setUint32(20, 8);
  bytes.set([...Buffer.from('hvcC')], 24);
  view.setUint32(28, 20);
  bytes.set([...Buffer.from('ispe')], 32);
  view.setUint32(40, width);
  view.setUint32(44, height);
  view.setUint32(48, 9);
  bytes.set([...Buffer.from('mdat')], 52);
  bytes[56] = 1;
  return bytes;
};

test('detects supported image magic bytes and dimensions', () => {
  assert.deepEqual(inspectImageBytes(pngBytes(1200, 400)), { mime: 'image/png', width: 1200, height: 400 });
  assert.deepEqual(inspectImageBytes(jpegBytes(640, 480)), { mime: 'image/jpeg', width: 640, height: 480 });
  assert.deepEqual(inspectImageBytes(webpBytes(1600, 900)), { mime: 'image/webp', width: 1600, height: 900 });
  assert.equal(inspectImageBytes(new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x3e])), null);
});

test('detects HEIC and generic HEIF brands without accepting AVIF as HEIF', () => {
  assert.deepEqual(inspectImageBytes(heifBytes('heic', 4032, 3024)), {
    mime: 'image/heic',
    width: 4032,
    height: 3024,
    aggregatePixelCount: 12_192_768
  });
  assert.deepEqual(inspectImageBytes(heifBytes('mif1', 1920, 1080)), {
    mime: 'image/heif',
    width: 1920,
    height: 1080,
    aggregatePixelCount: 2_073_600
  });
  assert.equal(inspectImageBytes(heifBytes('avif', 1920, 1080)), null);
  assert.equal(inspectImageBytes(heifBytes('hevc', 1920, 1080)), null);
  assert.equal(inspectImageBytes(heifBytes('msf1', 1920, 1080)), null);
});

test('normalizes missing and legacy MIME aliases from verified content', async () => {
  const missingMime = new File([jpegBytes(320, 240)], 'camera-photo.jpg', { type: '' });
  const normalized = await validateAndNormalizeImageFile(missingMime);
  assert.equal(normalized.mime, 'image/jpeg');
  assert.equal(normalized.sourceMime, 'image/jpeg');
  assert.equal(normalized.wasConverted, false);
  assert.equal(normalized.file.type, 'image/jpeg');
  assert.equal(normalized.pixelCount, 76_800);

  const legacyAlias = new File([jpegBytes(320, 240)], 'camera-photo.jpg', { type: 'image/jpg' });
  assert.equal((await validateAndNormalizeImageFile(legacyAlias)).file.type, 'image/jpeg');
});

test('converts HEIC aliases to a verified high-quality JPEG before upload', async () => {
  let converterCalls = 0;
  const source = new File([heifBytes('heic', 1600, 1200)], 'camera.HEIC', { type: 'image/x-heif' });
  const result = await validateAndNormalizeImageFile(source, {
    heifConverter: async ({ blob, toType, quality }) => {
      converterCalls += 1;
      assert.equal(blob, source);
      assert.equal(toType, 'image/jpeg');
      assert.equal(quality, 0.92);
      return new Blob([jpegBytes(1200, 900)], { type: 'image/jpeg' });
    }
  });

  assert.equal(converterCalls, 1);
  assert.equal(result.mime, 'image/jpeg');
  assert.equal(result.sourceMime, 'image/heic');
  assert.equal(result.wasConverted, true);
  assert.equal(result.requiresServerPreparation, false);
  assert.equal(result.file.type, 'image/jpeg');
  assert.equal(result.file.name, 'camera.jpg');
  assert.equal(result.width, 1200);
  assert.equal(result.height, 900);
  assert.equal(result.pixelCount, 1_080_000);
});

test('preserves verified HEIC bytes for isolated server preparation', async () => {
  const source = new File([heifBytes('heic', 1600, 1200)], 'camera.HEIC', { type: 'image/x-heic' });
  const result = await validateAndNormalizeImageFile(source, { heifHandling: 'server' });

  assert.equal(result.mime, 'image/heic');
  assert.equal(result.sourceMime, 'image/heic');
  assert.equal(result.wasConverted, false);
  assert.equal(result.requiresServerPreparation, true);
  assert.equal(result.file.type, 'image/heic');
  assert.equal(result.file.name, 'camera.HEIC');
  assert.equal(result.width, 1600);
  assert.equal(result.height, 1200);
});

test('accepts HEIC and HEIF MIME aliases only for HEIF-family content', async () => {
  const converter = async () => new Blob([jpegBytes(320, 240)], { type: 'image/jpeg' });
  assert.equal((await validateAndNormalizeImageFile(
    new File([heifBytes('mif1', 320, 240)], 'photo.heif', { type: 'image/x-heic' }),
    { heifConverter: converter }
  )).sourceMime, 'image/heif');

  await assert.rejects(
    validateAndNormalizeImageFile(
      new File([jpegBytes(320, 240)], 'spoof.heic', { type: 'image/heic' }),
      { heifConverter: converter }
    ),
    (error: unknown) => error instanceof MediaFileValidationError && error.code === 'MIME_MISMATCH'
  );
});

test('accepts application/octet-stream only when HEIF magic bytes are verified', async () => {
  const converter = async () => new Blob([jpegBytes(320, 240)], { type: 'image/jpeg' });
  const converted = await validateAndNormalizeImageFile(
    new File([heifBytes('heic', 320, 240)], 'camera.heic', { type: 'application/octet-stream' }),
    { heifConverter: converter }
  );
  assert.equal(converted.sourceMime, 'image/heic');
  assert.equal(converted.wasConverted, true);

  await assert.rejects(
    validateAndNormalizeImageFile(
      new File([jpegBytes(320, 240)], 'camera.jpg', { type: 'application/octet-stream' }),
      { heifConverter: converter }
    ),
    (error: unknown) => error instanceof MediaFileValidationError && error.code === 'UNSUPPORTED_MEDIA_TYPE'
  );
});

test('rejects failed, corrupt, ambiguous, and oversized HEIF conversions', async () => {
  const source = new File([heifBytes('heic', 640, 480)], 'camera.heic', { type: 'image/heic' });
  await assert.rejects(
    validateAndNormalizeImageFile(source, { heifConverter: async () => { throw new Error('decode failed'); } }),
    (error: unknown) => error instanceof MediaFileValidationError && error.code === 'INVALID_IMAGE'
  );
  await assert.rejects(
    validateAndNormalizeImageFile(source, { heifConverter: async () => new Blob(['not a jpeg'], { type: 'image/jpeg' }) }),
    (error: unknown) => error instanceof MediaFileValidationError && error.code === 'INVALID_IMAGE'
  );
  await assert.rejects(
    validateAndNormalizeImageFile(source, {
      heifConverter: async () => [
        new Blob([jpegBytes(320, 240)], { type: 'image/jpeg' }),
        new Blob([jpegBytes(320, 240)], { type: 'image/jpeg' })
      ]
    }),
    (error: unknown) => error instanceof MediaFileValidationError && error.code === 'INVALID_IMAGE'
  );
  await assert.rejects(
    validateAndNormalizeImageFile(source, {
      maxInputBytes: source.size + 10,
      heifConverter: async () => new Blob([jpegBytes(320, 240), new Uint8Array(source.size + 20)], { type: 'image/jpeg' })
    }),
    (error: unknown) => error instanceof MediaFileValidationError && error.code === 'FILE_TOO_LARGE'
  );
});

test('fails closed when no trusted platform HEIF decoder is available', async () => {
  const source = new File([heifBytes('heic', 640, 480)], 'camera.heic', { type: 'image/heic' });
  await assert.rejects(
    validateAndNormalizeImageFile(source),
    (error: unknown) => error instanceof MediaFileValidationError && error.code === 'HEIF_CODEC_UNAVAILABLE'
  );
});

test('revalidates converted HEIF dimensions against the decoded pixel limit', async () => {
  const source = new File([heifBytes('heic', 5, 5)], 'camera.heic', { type: 'image/heic' });
  await assert.rejects(
    validateAndNormalizeImageFile(source, {
      maxDecodedPixels: 100,
      heifConverter: async () => new Blob([jpegBytes(20, 20)], { type: 'image/jpeg' })
    }),
    (error: unknown) => error instanceof MediaFileValidationError && error.code === 'PIXEL_LIMIT_EXCEEDED'
  );
});

test('rejects oversized HEIF dimensions before invoking the converter', async () => {
  let converterCalls = 0;
  const source = new File([heifBytes('heic', 100, 100)], 'camera.heic', { type: 'image/heic' });
  await assert.rejects(
    validateAndNormalizeImageFile(source, {
      maxDecodedPixels: 9_999,
      heifConverter: async () => {
        converterCalls += 1;
        return new Blob([jpegBytes(10, 10)], { type: 'image/jpeg' });
      }
    }),
    (error: unknown) => error instanceof MediaFileValidationError && error.code === 'PIXEL_LIMIT_EXCEEDED'
  );
  assert.equal(converterCalls, 0);
});

test('rejects HEIF with no bounded primary dimensions and declared sequences before decoding', async () => {
  let converterCalls = 0;
  const converter = async () => {
    converterCalls += 1;
    return new Blob([jpegBytes(10, 10)], { type: 'image/jpeg' });
  };
  const missingDimensions = heifBytes('heic', 100, 100).slice(0, 20);
  await assert.rejects(
    validateAndNormalizeImageFile(
      new File([missingDimensions], 'unbounded.heic', { type: 'image/heic' }),
      { heifConverter: converter }
    ),
    (error: unknown) => error instanceof MediaFileValidationError && error.code === 'UNSUPPORTED_MEDIA_TYPE'
  );
  await assert.rejects(
    validateAndNormalizeImageFile(
      new File([heifBytes('heic', 100, 100)], 'sequence.heic', { type: 'image/heic-sequence' }),
      { heifConverter: converter }
    ),
    (error: unknown) => error instanceof MediaFileValidationError && error.code === 'UNSUPPORTED_MEDIA_TYPE'
  );
  assert.equal(converterCalls, 0);
});

test('rejects MIME spoofing, unsupported content, excessive bytes, and excessive pixels', async () => {
  await assert.rejects(
    validateAndNormalizeImageFile(new File([jpegBytes(20, 20)], 'spoof.png', { type: 'image/png' })),
    (error: unknown) => error instanceof MediaFileValidationError && error.code === 'MIME_MISMATCH'
  );
  await assert.rejects(
    validateAndNormalizeImageFile(new File(['not an image'], 'bad.heic', { type: 'image/heic' })),
    (error: unknown) => error instanceof MediaFileValidationError && error.code === 'UNSUPPORTED_MEDIA_TYPE'
  );
  await assert.rejects(
    validateAndNormalizeImageFile(new File([jpegBytes(20, 20)], 'bad.gif', { type: 'image/gif' })),
    (error: unknown) => error instanceof MediaFileValidationError && error.code === 'UNSUPPORTED_MEDIA_TYPE'
  );
  await assert.rejects(
    validateAndNormalizeImageFile(new File([pngBytes(10, 10)], 'large.png', { type: 'image/png' }), { maxInputBytes: 8 }),
    (error: unknown) => error instanceof MediaFileValidationError && error.code === 'FILE_TOO_LARGE'
  );
  await assert.rejects(
    validateAndNormalizeImageFile(new File([pngBytes(10_000, 10_000)], 'pixels.png', { type: 'image/png' })),
    (error: unknown) => error instanceof MediaFileValidationError && error.code === 'PIXEL_LIMIT_EXCEEDED'
  );
});
