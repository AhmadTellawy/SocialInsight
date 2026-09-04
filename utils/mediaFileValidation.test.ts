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

test('detects supported image magic bytes and dimensions', () => {
  assert.deepEqual(inspectImageBytes(pngBytes(1200, 400)), { mime: 'image/png', width: 1200, height: 400 });
  assert.deepEqual(inspectImageBytes(jpegBytes(640, 480)), { mime: 'image/jpeg', width: 640, height: 480 });
  assert.deepEqual(inspectImageBytes(webpBytes(1600, 900)), { mime: 'image/webp', width: 1600, height: 900 });
  assert.equal(inspectImageBytes(new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x3e])), null);
});

test('normalizes missing and legacy MIME aliases from verified content', async () => {
  const missingMime = new File([jpegBytes(320, 240)], 'camera-photo.jpg', { type: '' });
  const normalized = await validateAndNormalizeImageFile(missingMime);
  assert.equal(normalized.mime, 'image/jpeg');
  assert.equal(normalized.file.type, 'image/jpeg');
  assert.equal(normalized.pixelCount, 76_800);

  const legacyAlias = new File([jpegBytes(320, 240)], 'camera-photo.jpg', { type: 'image/jpg' });
  assert.equal((await validateAndNormalizeImageFile(legacyAlias)).file.type, 'image/jpeg');
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
    validateAndNormalizeImageFile(new File([pngBytes(10, 10)], 'large.png', { type: 'image/png' }), { maxInputBytes: 8 }),
    (error: unknown) => error instanceof MediaFileValidationError && error.code === 'FILE_TOO_LARGE'
  );
  await assert.rejects(
    validateAndNormalizeImageFile(new File([pngBytes(10_000, 10_000)], 'pixels.png', { type: 'image/png' })),
    (error: unknown) => error instanceof MediaFileValidationError && error.code === 'PIXEL_LIMIT_EXCEEDED'
  );
});
