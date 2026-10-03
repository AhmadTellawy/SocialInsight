import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';
import { handleRequest, limits } from '../src/index.js';

const secret = 'test-only-secret-that-is-at-least-thirty-two-bytes';
const fixture = (brand = 'heic') => {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(24, 0);
  bytes.write('ftyp', 4, 'ascii');
  bytes.write(brand, 8, 'ascii');
  bytes.writeUInt32BE(0, 12);
  bytes.write(brand, 16, 'ascii');
  bytes.write('mif1', 20, 'ascii');
  return bytes;
};

const signedRequest = (bytes, overrides = {}) => {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const requestId = randomUUID();
  const hash = createHash('sha256').update(bytes).digest('hex');
  const signature = `v1=${createHmac('sha256', secret).update(`v1\n${timestamp}\n${requestId}\n${hash}`).digest('hex')}`;
  return new Request('https://worker.test/v1/convert', {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(bytes.length),
      'x-si-source-mime': 'image/heic',
      'x-si-timestamp': timestamp,
      'x-si-request-id': requestId,
      'x-si-body-sha256': hash,
      'x-si-signature': signature,
      ...overrides
    },
    body: bytes
  });
};

const webp = Buffer.from('524946460400000057454250', 'hex');
const successEnv = {
  HEIF_CONVERTER_SECRET: secret,
  IMAGES: {
    input: () => ({
      transform: () => ({
        output: async () => ({ response: () => new Response(webp, { headers: { 'content-type': 'image/webp' } }) })
      })
    })
  }
};

test('readiness declares the pinned private adapter contract', async () => {
  const response = await handleRequest(new Request('https://worker.test/health/ready'), successEnv);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.protocolVersion, 3);
  assert.equal(body.capabilities.provider, 'cloudflare-images-binding');
  assert.equal(body.limits.inputBytes, 15 * 1024 * 1024);
  assert.equal(body.limits.bindingInputBytes, 20_000_000);
});

test('readiness fails closed when the server-only secret is missing', async () => {
  const response = await handleRequest(new Request('https://worker.test/health/ready'), { IMAGES: successEnv.IMAGES });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('x-si-error-code'), 'NOT_READY');
});

test('conversion rejects unauthenticated requests without invoking Images', async () => {
  const bytes = fixture();
  const request = new Request('https://worker.test/v1/convert', {
    method: 'POST', headers: { 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) }, body: bytes
  });
  const response = await handleRequest(request, successEnv);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('x-si-error-code'), 'UNAUTHORIZED');
});

test('signed HEIC input is converted to WebP', async () => {
  const response = await handleRequest(signedRequest(fixture()), successEnv);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), webp);
});

test('tampered body hash is rejected', async () => {
  const response = await handleRequest(signedRequest(fixture(), { 'x-si-body-sha256': '0'.repeat(64) }), successEnv);
  assert.equal(response.status, 401);
});

test('sequence and AVIF brands never reach Images', async () => {
  for (const brand of ['hevc', 'avif']) {
    const response = await handleRequest(signedRequest(fixture(brand)), successEnv);
    assert.equal(response.status, 422);
  }
});

test('Cloudflare free-tier exhaustion maps to a bounded retryable response', async () => {
  const env = {
    HEIF_CONVERTER_SECRET: secret,
    IMAGES: { input: () => { throw new Error('Cloudflare Images error 9422'); } }
  };
  const response = await handleRequest(signedRequest(fixture()), env);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('x-si-error-code'), 'IMAGES_QUOTA_EXCEEDED');
  assert.equal(response.headers.get('retry-after'), '3600');
});

test('declared input above the Images binding cap is rejected before reading', async () => {
  const response = await handleRequest(new Request('https://worker.test/v1/convert', {
    method: 'POST', headers: { 'content-type': 'application/octet-stream', 'content-length': String(limits.MAX_INPUT_BYTES + 1) }, body: fixture()
  }), successEnv);
  assert.equal(response.status, 413);
});
