import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { MEDIA_CONFIG } from '../config/media';
import { MediaValidationError } from '../services/mediaProcessor';
import { processBase64Image } from './imageProcessor';

const dataUrl = (mime: string, buffer: Buffer) => `data:${mime};base64,${buffer.toString('base64')}`;
const rejectsWith = async (operation: Promise<unknown>, code: string) => {
  await assert.rejects(operation, (error: unknown) => error instanceof MediaValidationError && error.code === code);
};

test('legacy image input is normalized through the central decoder', async () => {
  const png = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#336699' } }).png().toBuffer();
  const result = await processBase64Image(dataUrl('image/png', png));
  assert.match(result || '', /^data:image\/webp;base64,/);
  const output = Buffer.from(result!.split(',')[1], 'base64');
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 32);
  assert.equal(metadata.height, 24);
});

test('legacy image input rejects unsupported types and MIME spoofing', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');
  await rejectsWith(processBase64Image(dataUrl('image/svg+xml', svg)), 'INVALID_IMAGE');
  const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000000' } }).jpeg().toBuffer();
  await rejectsWith(processBase64Image(dataUrl('image/png', jpeg)), 'MIME_MISMATCH');
});

test('legacy image input rejects excessive encoded bytes before decoding', async () => {
  const encodedLimit = Math.ceil(MEDIA_CONFIG.maxCoverInputBytes / 3) * 4;
  await rejectsWith(
    processBase64Image(`data:image/png;base64,${'A'.repeat(encodedLimit + 4)}`, undefined, 'PROFILE_COVER'),
    'INVALID_FILE_SIZE'
  );
});

test('central decoder rejects extreme source edges even below the total pixel ceiling', async () => {
  const tall = await sharp({ create: { width: 1, height: MEDIA_CONFIG.maxSourceEdge + 1, channels: 3, background: '#ffffff' } }).png().toBuffer();
  await rejectsWith(processBase64Image(dataUrl('image/png', tall)), 'INVALID_IMAGE_DIMENSIONS');
});

test('an unchanged stored remote value is the only permitted remote compatibility input', async () => {
  const stored = 'https://cdn.example.invalid/legacy.webp';
  assert.equal(await processBase64Image(stored, stored), stored);
  await rejectsWith(processBase64Image(stored), 'REMOTE_MEDIA_NOT_ALLOWED');
});
