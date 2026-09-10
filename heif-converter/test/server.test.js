import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { bodySha256, signRequest } from '../src/auth.js';
import { createConverterServer } from '../src/server.js';
import { heifFixture } from './fixtures.js';

const nowMs = 1_800_000_000_000;
const secret = 'a-secret-with-at-least-thirty-two-bytes';
const config = {
  hmacSecret: secret,
  signatureWindowSeconds: 300,
  maxBodyBytes: 15 * 1024 * 1024,
  maxAggregatePixels: 40_000_000,
  maxConcurrency: 2,
};

async function withServer(converter, callback) {
  const server = createConverterServer({
    config,
    converter,
    healthEvidence: { status: 'ready', versions: { libheif: '1.23.3', libde265: '1.1.1', sharp: '0.35.4' } },
    clock: { now: () => nowMs },
    logger: { error() {} },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function signedHeaders(body, requestId = 'request_0123456789abcdef') {
  const timestamp = String(Math.floor(nowMs / 1000));
  return {
    'content-type': 'application/octet-stream',
    'content-length': String(body.length),
    'x-si-timestamp': timestamp,
    'x-si-request-id': requestId,
    'x-si-signature': signRequest({ secret, timestamp, requestId, body }),
    'x-si-body-sha256': bodySha256(body),
  };
}

test('converts authenticated HEIC bytes and returns verified metadata headers', async () => {
  const input = heifFixture();
  const output = Buffer.from('fake-webp');
  await withServer({ convert: async () => ({ data: output, mime: 'image/webp', width: 1200, height: 800 }) }, async (url) => {
    const response = await fetch(`${url}/v1/convert`, { method: 'POST', headers: signedHeaders(input), body: input });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/webp');
    assert.equal(response.headers.get('x-image-width'), '1200');
    assert.equal(response.headers.get('x-image-height'), '800');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), output);
  });
});

test('rejects unauthenticated, AVIF, and replayed requests', async () => {
  const input = heifFixture();
  let calls = 0;
  await withServer({ convert: async () => { calls += 1; } }, async (url) => {
    const invalid = await fetch(`${url}/v1/convert`, {
      method: 'POST', headers: { ...signedHeaders(input), 'x-si-signature': `v1=${'0'.repeat(64)}` }, body: input,
    });
    assert.equal(invalid.status, 401);

    const avif = heifFixture({ brand: 'avif', compatible: ['mif1', 'avif'] });
    const avifResponse = await fetch(`${url}/v1/convert`, {
      method: 'POST', headers: signedHeaders(avif, 'request_avif_0123456789'), body: avif,
    });
    assert.equal(avifResponse.status, 400);

    const headers = signedHeaders(input, 'request_replay_01234567');
    const first = await fetch(`${url}/v1/convert`, { method: 'POST', headers, body: input });
    const second = await fetch(`${url}/v1/convert`, { method: 'POST', headers, body: input });
    assert.equal(first.status, 500);
    assert.equal(second.status, 409);
    assert.equal(calls, 1);
  });
});

test('health endpoints expose pinned runtime evidence', async () => {
  await withServer({ convert: async () => undefined }, async (url) => {
    const live = await fetch(`${url}/health/live`);
    const ready = await fetch(`${url}/health/ready`);
    assert.equal(live.status, 200);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).versions.libheif, '1.23.3');
  });
});

test('returns 429 instead of queueing bodies when conversion capacity is full', async () => {
  const oneAtATime = { ...config, maxConcurrency: 1 };
  let unblock;
  const blocked = new Promise((resolve) => { unblock = resolve; });
  const server = createConverterServer({
    config: oneAtATime,
    converter: { convert: async () => blocked },
    healthEvidence: { status: 'ready' },
    clock: { now: () => nowMs },
    logger: { error() {} },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/v1/convert`;
  const firstBody = heifFixture();
  const first = fetch(url, {
    method: 'POST', headers: signedHeaders(firstBody, 'request_concurrency_0001'), body: firstBody,
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  const secondBody = heifFixture();
  const second = await fetch(url, {
    method: 'POST', headers: signedHeaders(secondBody, 'request_concurrency_0002'), body: secondBody,
  });
  assert.equal(second.status, 429);
  unblock({ data: Buffer.from('webp'), mime: 'image/webp', width: 1, height: 1 });
  assert.equal((await first).status, 200);
  await new Promise((resolve) => server.close(resolve));
});

test('rejects unsigned headers before waiting for a body or occupying a conversion slot', async () => {
  const body = heifFixture(); let calls = 0;
  await withServer({ convert: async () => { calls++; return { data: Buffer.from('webp'), mime: 'image/webp', width: 1, height: 1 }; } }, async url => {
    const status = await new Promise((resolve, reject) => {
      const request = http.request(url + '/v1/convert', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'content-length': config.maxBodyBytes } }, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject); request.setTimeout(1000, () => { request.destroy(); reject(Error('Server waited for unauthenticated body')); });
      request.flushHeaders();
    });
    assert.equal(status, 401);
    const valid = await fetch(url + '/v1/convert', { method: 'POST', headers: signedHeaders(body, 'request_after_unsigned_01'), body });
    assert.equal(valid.status, 200); assert.equal(calls, 1);
  });
});

test('rejects a missing digest or body that differs from the authenticated digest', async () => {
  const body = heifFixture(); let calls = 0;
  await withServer({ convert: async () => { calls++; } }, async url => {
    const missing = signedHeaders(body, 'request_missing_digest_01'); delete missing['x-si-body-sha256'];
    assert.equal((await fetch(url + '/v1/convert', { method: 'POST', headers: missing, body })).status, 401);
    const modified = Buffer.from(body); modified[modified.length - 1] ^= 1;
    assert.equal((await fetch(url + '/v1/convert', { method: 'POST', headers: signedHeaders(body, 'request_changed_digest_01'), body: modified })).status, 401);
    assert.equal(calls, 0);
  });
});
