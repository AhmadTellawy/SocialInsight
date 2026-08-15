import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { MEDIA_CONFIG } from '../config/media';
import { MediaValidationError, processMediaBuffer } from './mediaProcessor';

const makeImage = async (width: number, height: number, format: 'jpeg' | 'png' | 'webp' = 'jpeg') => {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: 25, g: 110, b: 220 } }
  });
  return format === 'png' ? image.png().toBuffer() : format === 'webp' ? image.webp().toBuffer() : image.jpeg().toBuffer();
};

test('normalizes a valid post image and preserves a supported original ratio', async () => {
  const source = await makeImage(1200, 800);
  const result = await processMediaBuffer(source, 'POST', 'image/jpeg', {});

  assert.equal(result.aspectRatio, 1.5);
  assert.equal(result.master.mime, 'image/webp');
  assert.deepEqual(result.variants.map((variant) => variant.width), [480, 768, 1080]);
  assert.ok(result.variants.every((variant) => variant.height === Math.round(variant.width / 1.5)));
});

test('clamps an overly wide post ratio without leaving blank crop space', async () => {
  const source = await makeImage(2000, 700);
  const result = await processMediaBuffer(source, 'POST', 'image/jpeg', {});

  assert.equal(result.aspectRatio, MEDIA_CONFIG.maxAspectRatio);
  assert.ok(result.crop.x > 0);
  assert.ok(result.crop.x + result.crop.width <= 1);
});

test('preserves supported common ratios and clamps tall sources to 4:5', async () => {
  const cases = [
    [400, 400, 1],
    [400, 500, 0.8],
    [400, 300, 4 / 3],
    [450, 300, 1.5],
    [480, 270, 16 / 9],
    [382, 200, 1.91]
  ] as const;
  for (const [width, height, ratio] of cases) {
    const result = await processMediaBuffer(await makeImage(width, height), 'POST', 'image/jpeg', {});
    assert.ok(Math.abs(result.aspectRatio - ratio) < 0.0001, `${width}x${height}`);
  }

  const tall = await processMediaBuffer(await makeImage(360, 640), 'POST', 'image/jpeg', {});
  assert.equal(tall.aspectRatio, MEDIA_CONFIG.minAspectRatio);
  assert.ok(tall.crop.y > 0);
  assert.ok(tall.crop.y + tall.crop.height <= 1);
});

test('does not upscale a small avatar', async () => {
  const source = await makeImage(40, 60, 'png');
  const result = await processMediaBuffer(source, 'PROFILE_AVATAR', 'image/png', {});

  assert.equal(result.aspectRatio, 1);
  assert.equal(result.variants.length, 1);
  assert.equal(result.variants[0].width, 40);
  assert.equal(result.variants[0].height, 40);
});

test('applies EXIF orientation before deriving dimensions', async () => {
  const source = await sharp({
    create: { width: 40, height: 80, channels: 3, background: { r: 10, g: 20, b: 30 } }
  }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const result = await processMediaBuffer(source, 'POST', 'image/jpeg', {});

  assert.equal(result.sourceWidth, 80);
  assert.equal(result.sourceHeight, 40);
});

test('rejects a declared MIME that does not match image bytes', async () => {
  const source = await makeImage(100, 100, 'png');
  await assert.rejects(
    () => processMediaBuffer(source, 'OPTION_IMAGE', 'image/jpeg', {}),
    (error: unknown) => error instanceof MediaValidationError && error.code === 'MIME_MISMATCH'
  );
});

test('rejects unsupported and corrupt input before persistence', async () => {
  const valid = await makeImage(100, 100);
  await assert.rejects(
    () => processMediaBuffer(valid, 'POST', 'image/gif', {}),
    (error: unknown) => error instanceof MediaValidationError && error.code === 'UNSUPPORTED_MEDIA_TYPE'
  );
  await assert.rejects(
    () => processMediaBuffer(Buffer.from('not-an-image'), 'POST', 'image/jpeg', {}),
    (error: unknown) => error instanceof MediaValidationError && error.code === 'INVALID_IMAGE'
  );
  await assert.rejects(
    () => processMediaBuffer(Buffer.alloc(MEDIA_CONFIG.maxInputBytes + 1), 'POST', 'image/jpeg', {}),
    (error: unknown) => error instanceof MediaValidationError && error.code === 'INVALID_FILE_SIZE'
  );
});

test('rejects crop coordinates that extend beyond the image', async () => {
  const source = await makeImage(500, 500);
  await assert.rejects(
    () => processMediaBuffer(source, 'POST', 'image/jpeg', {
      aspectRatio: 1,
      crop: { x: 0.8, y: 0, width: 0.4, height: 1 }
    }),
    (error: unknown) => error instanceof MediaValidationError && error.code === 'INVALID_CROP'
  );
});

test('rejects images above the decoded pixel safety limit', async () => {
  const source = await makeImage(6500, 6200);
  await assert.rejects(
    () => processMediaBuffer(source, 'POST', 'image/jpeg', {}),
    (error: unknown) => error instanceof MediaValidationError && error.code === 'INVALID_IMAGE'
  );
});
