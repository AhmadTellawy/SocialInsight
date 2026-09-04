import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, createHmac } from 'crypto';
import { MEDIA_CONFIG } from '../config/media';
import {
  convertHeifRemotely,
  isHeifConversionConfigured,
  resetHeifReadinessForTests,
  verifyHeifConversionReadiness
} from './heifConversionClient';
import { MediaValidationError } from './mediaProcessor';

const originalEnv = {
  enabled: process.env.MEDIA_HEIF_SERVER_ENABLED,
  url: process.env.HEIF_CONVERTER_URL,
  secret: process.env.HEIF_CONVERTER_SECRET
};

test.afterEach(() => {
  resetHeifReadinessForTests();
  if (originalEnv.enabled === undefined) delete process.env.MEDIA_HEIF_SERVER_ENABLED;
  else process.env.MEDIA_HEIF_SERVER_ENABLED = originalEnv.enabled;
  if (originalEnv.url === undefined) delete process.env.HEIF_CONVERTER_URL;
  else process.env.HEIF_CONVERTER_URL = originalEnv.url;
  if (originalEnv.secret === undefined) delete process.env.HEIF_CONVERTER_SECRET;
  else process.env.HEIF_CONVERTER_SECRET = originalEnv.secret;
});

test('advertises readiness only for the pinned converter runtime', async () => {
  configure();
  const ready = await verifyHeifConversionReadiness(true, async () => Response.json({
    status: 'ready',
    service: 'heif-converter',
    versions: { libheif: '1.23.3', libde265: '1.1.1', sharp: '0.35.4' }
  }));
  assert.equal(ready, true);
  resetHeifReadinessForTests();
  const stale = await verifyHeifConversionReadiness(true, async () => Response.json({
    status: 'ready',
    service: 'heif-converter',
    versions: { libheif: '1.23.2', libde265: '1.1.1', sharp: '0.35.4' }
  }));
  assert.equal(stale, false);
});

const configure = () => {
  process.env.MEDIA_HEIF_SERVER_ENABLED = 'true';
  process.env.HEIF_CONVERTER_URL = 'http://heif-converter:10000';
  process.env.HEIF_CONVERTER_SECRET = 'unit-test-secret';
};

test('fails closed unless the feature flag, URL, and secret are all valid', async () => {
  delete process.env.MEDIA_HEIF_SERVER_ENABLED;
  delete process.env.HEIF_CONVERTER_URL;
  delete process.env.HEIF_CONVERTER_SECRET;
  assert.equal(isHeifConversionConfigured(), false);
  await assert.rejects(
    () => convertHeifRemotely(Buffer.from('x'), 'image/heic'),
    (error: unknown) => error instanceof MediaValidationError && error.code === 'HEIF_CONVERTER_UNAVAILABLE'
  );
});

test('signs the exact body and accepts only bounded WebP output', async () => {
  configure();
  const input = Buffer.from('verified-heif-input');
  const output = Buffer.from('webp-output');
  const fakeFetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const timestamp = headers.get('x-si-timestamp')!;
    const requestId = headers.get('x-si-request-id')!;
    const hash = createHash('sha256').update(input).digest('hex');
    assert.match(requestId, /^[a-f0-9-]{36}$/);
    assert.equal(
      headers.get('x-si-signature'),
      `v1=${createHmac('sha256', 'unit-test-secret').update(`v1\n${timestamp}\n${requestId}\n${hash}`).digest('hex')}`
    );
    assert.equal(headers.get('content-type'), 'application/octet-stream');
    return new Response(output, { status: 200, headers: { 'content-type': 'image/webp', 'content-length': String(output.length) } });
  };
  assert.deepEqual(await convertHeifRemotely(input, 'image/heic', fakeFetch as typeof fetch), output);
});

test('rejects wrong MIME, converter errors, and oversized responses', async () => {
  configure();
  const input = Buffer.from('input');
  await assert.rejects(
    () => convertHeifRemotely(input, 'image/heic', async () => new Response('png', { status: 200, headers: { 'content-type': 'image/png' } })),
    MediaValidationError
  );
  await assert.rejects(
    () => convertHeifRemotely(input, 'image/heif', async () => new Response('', { status: 429 })),
    (error: unknown) => error instanceof MediaValidationError && error.code === 'HEIF_CONVERTER_BUSY'
  );
  await assert.rejects(
    () => convertHeifRemotely(input, 'image/heif', async () => new Response('x', {
      status: 200,
      headers: { 'content-type': 'image/webp', 'content-length': String(MEDIA_CONFIG.maxPreparedOutputBytes + 1) }
    })),
    (error: unknown) => error instanceof MediaValidationError && error.code === 'HEIF_OUTPUT_TOO_LARGE'
  );
});
