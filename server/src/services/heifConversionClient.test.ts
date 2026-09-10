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
  process.env.HEIF_CONVERTER_URL = 'http://heif-converter.internal:10000';
  process.env.HEIF_CONVERTER_SECRET = 'unit-test-secret-with-at-least-32-bytes';
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
      `v1=${createHmac('sha256', 'unit-test-secret-with-at-least-32-bytes').update(`v1\n${timestamp}\n${requestId}\n${hash}`).digest('hex')}`
    );
    assert.equal(headers.get('content-type'), 'application/octet-stream');
    assert.equal(headers.get('x-si-body-sha256'), hash);
    assert.equal(init?.redirect, 'error');
    return new Response(output, { status: 200, headers: { 'content-type': 'image/webp', 'content-length': String(output.length) } });
  };
  assert.deepEqual(await convertHeifRemotely(input, 'image/heic', fakeFetch as typeof fetch), output);
});

test('rejects short secrets and invalid converter destinations', () => {
  configure();
  process.env.HEIF_CONVERTER_SECRET = 'short';
  assert.equal(isHeifConversionConfigured(), false);
  configure();
  for (const url of [
    'file:///tmp/converter', 'http://user:password@localhost', 'https://converter.test/?token=secret',
    'https://converter.test/#fragment', 'https://converter.test/?', 'https://converter.test/#',
    'http://converter.test', 'http://heif-converter:10000', 'http://localhost.evil.test',
    'http://converter.internal.evil.test', 'http://notinternal', 'http://.internal',
    'http://192.168.1.1', 'http://169.254.169.254', 'http://[::2]', 'http://localhost.'
  ]) {
    process.env.HEIF_CONVERTER_URL = url;
    assert.equal(isHeifConversionConfigured(), false, url);
  }
});

test('allows HTTPS destinations and only explicit loopback or internal HTTP hosts', () => {
  configure();
  for (const url of [
    'https://converter.example', 'https://converter.example:8443', 'http://localhost:10000',
    'http://127.0.0.1:10000', 'http://[::1]:10000', 'http://converter.internal:10000'
  ]) {
    process.env.HEIF_CONVERTER_URL = url;
    assert.equal(isHeifConversionConfigured(), true, url);
  }
});

test('an insecure destination fails before any readiness or image request', async () => {
  configure(); process.env.HEIF_CONVERTER_URL = 'http://public-converter.example';
  let requests = 0;
  const fetchImpl = async () => { requests++; return new Response(); };
  assert.equal(await verifyHeifConversionReadiness(true, fetchImpl), false);
  await assert.rejects(convertHeifRemotely(Buffer.from('input'), 'image/heic', fetchImpl),
    (error: unknown) => error instanceof MediaValidationError && error.code === 'HEIF_CONVERTER_UNAVAILABLE');
  assert.equal(requests, 0);
});

test('readiness cache is invalidated when the destination changes', async () => {
  configure();
  let probes = 0;
  const ready = async (_url: any, init?: RequestInit) => {
    probes++;
    assert.equal(init?.redirect, 'error');
    return Response.json({ status: 'ready', service: 'heif-converter', versions: { libheif: '1.23.3', libde265: '1.1.1', sharp: '0.35.4' } });
  };
  assert.equal(await verifyHeifConversionReadiness(false, ready), true);
  assert.equal(await verifyHeifConversionReadiness(false, ready), true);
  process.env.HEIF_CONVERTER_URL = 'https://second-converter.test';
  assert.equal(await verifyHeifConversionReadiness(false, ready), true);
  assert.equal(probes, 2);
});

test('oversized readiness bodies fail closed', async () => {
  configure();
  assert.equal(await verifyHeifConversionReadiness(true, async () => new Response('x'.repeat(8193))), false);
});

test('a busy converter gets only one retry with a fresh authenticated request id', async () => {
  configure();
  const ids: string[] = [];
  let canceled = false;
  const result = await convertHeifRemotely(Buffer.from('input'), 'image/heic', async (_url, init) => {
    ids.push(new Headers(init?.headers).get('x-si-request-id')!);
    if (ids.length === 1) return new Response(new ReadableStream({ cancel() { canceled = true; } }), { status: 429 });
    return new Response('webp', { headers: { 'content-type': 'image/webp' } });
  });
  assert.equal(result.toString(), 'webp');
  assert.equal(canceled, true);
  assert.equal(ids.length, 2); assert.notEqual(ids[0], ids[1]);
});

test('429 retries honor delta-seconds and HTTP-date with a minimum one-second wait', async t => {
  const now = Date.UTC(2026, 8, 10);
  for (const [retryAfter, expectedDelay] of [
    [undefined, 1000], ['0', 1000], ['invalid', 1000], ['2', 2000],
    [new Date(now + 3000).toUTCString(), 3000]
  ] as const) {
    configure();
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now });
    let requests = 0;
    try {
      const result = convertHeifRemotely(Buffer.from('input'), 'image/heic', async () => {
        requests++;
        return requests === 1
          ? new Response('busy', { status: 429, headers: retryAfter ? { 'retry-after': retryAfter } : {} })
          : new Response('webp', { headers: { 'content-type': 'image/webp' } });
      });
      await new Promise<void>(resolve => setImmediate(resolve));
      t.mock.timers.tick(expectedDelay - 1);
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(requests, 1, `No early retry for ${retryAfter}`);
      t.mock.timers.tick(1);
      assert.equal((await result).toString(), 'webp');
      assert.equal(requests, 2);
    } finally { t.mock.timers.reset(); }
  }
});

test('Retry-After beyond the bounded wait does not trigger a premature retry', async () => {
  configure();
  for (const retryAfter of ['4', '99999999999999999999999999999', new Date(Date.now() + 60_000).toUTCString()]) {
    let requests = 0, disposed = false;
    await assert.rejects(convertHeifRemotely(Buffer.from('input'), 'image/heic', async () => {
      requests++;
      return new Response(new ReadableStream({ cancel() { disposed = true; } }), { status: 429, headers: { 'retry-after': retryAfter } });
    }), (error: unknown) => error instanceof MediaValidationError && error.code === 'HEIF_CONVERTER_BUSY');
    assert.equal(requests, 1); assert.equal(disposed, true);
  }
});

test('retry delay cannot exceed the remaining global conversion budget', async t => {
  configure();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 8, 10) });
  let requests = 0;
  try {
    await assert.rejects(convertHeifRemotely(Buffer.from('input'), 'image/heic', async () => {
      requests++;
      t.mock.timers.tick(MEDIA_CONFIG.heifConversionTimeoutMs - 500);
      return new Response('busy', { status: 429, headers: { 'retry-after': '1' } });
    }), (error: unknown) => error instanceof MediaValidationError && error.code === 'HEIF_CONVERTER_BUSY');
    assert.equal(requests, 1);
  } finally { t.mock.timers.reset(); }
});

test('an expired global abort prevents retry even when its continuation was delayed', async t => {
  configure();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 8, 10) });
  let requests = 0;
  try {
    const result = convertHeifRemotely(Buffer.from('input'), 'image/heic', async () => {
      requests++;
      return new Response('busy', { status: 429, headers: { 'retry-after': '1' } });
    });
    const rejection = assert.rejects(result, (error: unknown) => error instanceof MediaValidationError && error.code === 'HEIF_CONVERTER_UNAVAILABLE');
    await new Promise<void>(resolve => setImmediate(resolve));
    t.mock.timers.tick(MEDIA_CONFIG.heifConversionTimeoutMs);
    await rejection;
    assert.equal(requests, 1);
  } finally { t.mock.timers.reset(); }
});

test('disposes rejected readiness, conversion-error and wrong-MIME bodies', async () => {
  configure();
  let readinessDisposed = false;
  assert.equal(await verifyHeifConversionReadiness(true, async () =>
    new Response(new ReadableStream({ cancel() { readinessDisposed = true; } }), { status: 503 })), false);
  assert.equal(readinessDisposed, true);
  for (const [status, mime] of [[502, 'application/json'], [200, 'image/png']] as const) {
    let disposed = false;
    await assert.rejects(convertHeifRemotely(Buffer.from('input'), 'image/heic', async () =>
      new Response(new ReadableStream({ cancel() { disposed = true; } }), { status, headers: { 'content-type': mime } })),
    (error: unknown) => error instanceof MediaValidationError && error.code === 'HEIF_CONVERSION_FAILED');
    assert.equal(disposed, true);
  }
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
