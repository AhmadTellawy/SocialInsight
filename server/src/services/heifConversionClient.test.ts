import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, createHmac } from 'crypto';
import { createServer } from 'node:http';
import { MEDIA_CONFIG } from '../config/media';
import {
  convertHeifRemotely,
  HeifConversionError,
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

const readyBody = () => ({
  status: 'ready', service: 'heif-converter', protocolVersion: 2,
  capabilities: { wholeWorkerIsolation: 'landlock-seccomp-v1', supervisor: 'subreaper-v1', failurePolicy: 'fail-closed-v1' },
  limits: { inputBytes: 15728640, outputBytes: 12582912, maxPixels: 40000000, wholeWorkerMs: 45000 },
  versions: { libheif: '1.23.3', libde265: '1.1.1', sharp: '0.35.4' }
});
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

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
  const ready = await verifyHeifConversionReadiness(true, async () => Response.json(readyBody()));
  assert.equal(ready, true);
  resetHeifReadinessForTests();
  const stale = await verifyHeifConversionReadiness(true, async () => Response.json({
    ...readyBody(),
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
    return Response.json(readyBody());
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
    (error: unknown) => error instanceof MediaValidationError && error.code === (status === 502 ? 'HEIF_CONVERTER_UNAVAILABLE' : 'HEIF_CONVERSION_FAILED'));
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

test('version-only health and every missing or changed isolation capability fail closed', async () => {
  configure();
  const old = { status: 'ready', service: 'heif-converter', versions: readyBody().versions };
  assert.equal(await verifyHeifConversionReadiness(true, async () => Response.json(old)), false);
  for (const path of [
    ['status'], ['service'], ['protocolVersion'],
    ['capabilities', 'wholeWorkerIsolation'], ['capabilities', 'supervisor'], ['capabilities', 'failurePolicy'],
    ['limits', 'inputBytes'], ['limits', 'outputBytes'], ['limits', 'maxPixels'], ['limits', 'wholeWorkerMs'],
    ['versions', 'libheif'], ['versions', 'libde265'], ['versions', 'sharp']
  ]) {
    for (const replacement of [undefined, 'unverified']) {
      const body: any = readyBody();
      const parent = path.length === 1 ? body : body[path[0]];
      parent[path[path.length - 1]] = replacement;
      assert.equal(await verifyHeifConversionReadiness(true, async () => Response.json(body)), false, path.join('.'));
    }
  }
});

test('warmup bypasses negative cache, coalesces, and one canceled caller cannot cancel another', async () => {
  configure();
  assert.equal(await verifyHeifConversionReadiness(true, async () => new Response('', { status: 503 })), false);
  let requests = 0;
  let complete!: (response: Response) => void;
  let sharedSignal!: AbortSignal;
  const coldFetch: typeof fetch = async (_url, init) => {
    requests++; sharedSignal = init!.signal!;
    return new Promise<Response>(resolve => { complete = resolve; });
  };
  const canceled = new AbortController();
  const first = verifyHeifConversionReadiness(false, coldFetch, { warmup: true, signal: canceled.signal });
  const second = verifyHeifConversionReadiness(false, coldFetch, { warmup: true });
  assert.equal(requests, 1);
  canceled.abort();
  assert.equal(await first, false); assert.equal(sharedSignal.aborted, false);
  complete(Response.json(readyBody()));
  assert.equal(await second, true);
  assert.equal(await verifyHeifConversionReadiness(false, coldFetch), true);
  assert.equal(requests, 1);
});

test('quick readiness remains bounded while cold warmup is pending', async t => {
  configure(); t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let release!: (response: Response) => void;
  try {
    const warmup = verifyHeifConversionReadiness(false, async () => new Promise(resolve => { release = resolve; }), { warmup: true });
    const quick = verifyHeifConversionReadiness(false, async () => new Promise(() => undefined));
    t.mock.timers.tick(3000);
    assert.equal(await quick, false);
    release(Response.json(readyBody()));
    assert.equal(await warmup, true);
  } finally { t.mock.timers.reset(); }
});

test('a pending quick 503 cannot replace a newer verified warmup success in either start order', async () => {
  configure();
  for (const quickFirst of [true, false]) {
    resetHeifReadinessForTests();
    let finishQuick!: (response: Response) => void, finishWarmup!: (response: Response) => void;
    const startQuick = () => verifyHeifConversionReadiness(false, async () => new Promise(resolve => { finishQuick = resolve; }));
    const startWarmup = () => verifyHeifConversionReadiness(false, async () => new Promise(resolve => { finishWarmup = resolve; }), { warmup: true });
    let quick: Promise<boolean>, warmup: Promise<boolean>;
    if (quickFirst) { quick = startQuick(); warmup = startWarmup(); }
    else { warmup = startWarmup(); quick = startQuick(); }
    finishWarmup(Response.json(readyBody())); assert.equal(await warmup, true);
    finishQuick(new Response('', { status: 503 })); assert.equal(await quick, true);
    let unexpectedProbes = 0;
    assert.equal(await verifyHeifConversionReadiness(false, async () => { unexpectedProbes++; return new Response('', { status: 503 }); }), true);
    assert.equal(unexpectedProbes, 0);
  }
});

test('a pending quick timeout cannot replace a newer verified warmup success in either start order', async t => {
  configure();
  for (const quickFirst of [true, false]) {
    resetHeifReadinessForTests(); t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      let finishWarmup!: (response: Response) => void;
      const startQuick = () => verifyHeifConversionReadiness(false, async () => new Promise(() => undefined));
      const startWarmup = () => verifyHeifConversionReadiness(false, async () => new Promise(resolve => { finishWarmup = resolve; }), { warmup: true });
      let quick: Promise<boolean>, warmup: Promise<boolean>;
      if (quickFirst) { quick = startQuick(); warmup = startWarmup(); }
      else { warmup = startWarmup(); quick = startQuick(); }
      finishWarmup(Response.json(readyBody())); assert.equal(await warmup, true);
      t.mock.timers.tick(3000); assert.equal(await quick, true);
      assert.equal(await verifyHeifConversionReadiness(), true);
    } finally { t.mock.timers.reset(); }
  }
});

test('a genuinely later failed probe invalidates readiness and any older pending positive', async () => {
  configure();
  assert.equal(await verifyHeifConversionReadiness(false, async () => Response.json(readyBody())), true);
  let finishOlderPositive!: (response: Response) => void;
  const olderPositive = verifyHeifConversionReadiness(true, async () => new Promise(resolve => { finishOlderPositive = resolve; }), { warmup: true });
  assert.equal(await verifyHeifConversionReadiness(true, async () => new Response('', { status: 503 })), false);
  finishOlderPositive(Response.json(readyBody())); assert.equal(await olderPositive, false);
  let unexpectedProbes = 0;
  assert.equal(await verifyHeifConversionReadiness(false, async () => { unexpectedProbes++; return Response.json(readyBody()); }), false);
  assert.equal(unexpectedProbes, 0);
});

test('warmup has a 90-second absolute bound, including a stalled body and stalled cancellation', async t => {
  configure(); t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let disposed = false, settled = false;
  try {
    const warmup = verifyHeifConversionReadiness(false, async () => new Response(new ReadableStream({
      cancel() { disposed = true; return new Promise(() => undefined); }
    })), { warmup: true }).then(value => { settled = true; return value; });
    await flush(); t.mock.timers.tick(89999); await flush(); assert.equal(settled, false);
    t.mock.timers.tick(1); assert.equal(await warmup, false); assert.equal(disposed, true);
  } finally { t.mock.timers.reset(); }
});

test('a late ready result cannot enable a changed destination or overwrite its new cache', async () => {
  configure();
  let release!: (response: Response) => void;
  const stale = verifyHeifConversionReadiness(false, async () => new Promise(resolve => { release = resolve; }), { warmup: true });
  process.env.HEIF_CONVERTER_URL = 'https://new-converter.test';
  let newRequests = 0;
  const unavailable = async () => { newRequests++; return new Response('', { status: 503 }); };
  assert.equal(await verifyHeifConversionReadiness(false, unavailable), false);
  release(Response.json(readyBody())); assert.equal(await stale, false);
  assert.equal(await verifyHeifConversionReadiness(false, unavailable), false);
  assert.equal(newRequests, 1);
});

test('a fatal converter failure invalidates success and any older in-flight readiness response', async () => {
  configure();
  assert.equal(await verifyHeifConversionReadiness(false, async () => Response.json(readyBody())), true);
  let release!: (response: Response) => void;
  const stale = verifyHeifConversionReadiness(true, async () => new Promise(resolve => { release = resolve; }));
  await assert.rejects(convertHeifRemotely(Buffer.from('input'), 'image/heif', async () => new Response('internal detail', { status: 503 })),
    (e: any) => e.code === 'HEIF_CONVERTER_UNAVAILABLE' && e.statusCode === 503 && !e.message.includes('internal detail'));
  release(Response.json(readyBody())); assert.equal(await stale, false);
  let probes = 0;
  assert.equal(await verifyHeifConversionReadiness(false, async () => { probes++; return new Response('', { status: 503 }); }), false);
  assert.equal(probes, 1);
});

test('readiness disabled or canceled before entry sends no request', async () => {
  configure(); const controller = new AbortController(); controller.abort();
  let calls = 0;
  const probe = async () => { calls++; return Response.json(readyBody()); };
  assert.equal(await verifyHeifConversionReadiness(false, probe, { warmup: true, signal: controller.signal }), false);
  delete process.env.MEDIA_HEIF_SERVER_ENABLED;
  assert.equal(await verifyHeifConversionReadiness(false, probe, { warmup: true }), false);
  assert.equal(calls, 0);
});

test('conversion permits the full 45-second worker plus transport time', async t => {
  configure(); t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let signal!: AbortSignal, release!: (response: Response) => void;
  try {
    const result = convertHeifRemotely(Buffer.from('input'), 'image/heic', async (_url, init) => {
      signal = init!.signal!;
      return new Promise(resolve => { release = resolve; });
    });
    t.mock.timers.tick(45500); assert.equal(signal.aborted, false);
    release(new Response('webp', { headers: { 'content-type': 'image/webp' } }));
    assert.equal((await result).toString(), 'webp');
  } finally { t.mock.timers.reset(); }
});

test('conversion deadline aborts fetch and streamed output at 55 seconds', async t => {
  for (const body of [false, true]) {
    configure(); t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    let signal!: AbortSignal, disposed = false;
    try {
      const result = convertHeifRemotely(Buffer.from('input'), 'image/heic', async (_url, init) => {
        signal = init!.signal!;
        return body ? new Response(new ReadableStream({ cancel() { disposed = true; } }), { headers: { 'content-type': 'image/webp' } }) : new Promise(() => undefined);
      });
      const rejected = assert.rejects(result, (e: any) => e.code === 'HEIF_CONVERTER_UNAVAILABLE' && e.statusCode === 503);
      await flush(); t.mock.timers.tick(54999); assert.equal(signal.aborted, false);
      t.mock.timers.tick(1); await rejected;
      assert.equal(signal.aborted, true); assert.equal(disposed, body);
    } finally { t.mock.timers.reset(); }
  }
});

test('cancellation before conversion, during retry, and during a response body stops work', async () => {
  configure();
  for (const stage of ['before', 'retry', 'body']) {
    const controller = new AbortController();
    let calls = 0, signal: AbortSignal | undefined, disposed = false;
    if (stage === 'before') controller.abort();
    const result = convertHeifRemotely(Buffer.from('input'), 'image/heic', async (_url, init) => {
      calls++; signal = init!.signal!;
      return new Response(new ReadableStream({ cancel() { disposed = true; } }), {
        status: stage === 'retry' ? 429 : 200, headers: { 'content-type': 'image/webp', 'retry-after': '1' }
      });
    }, controller.signal);
    const rejected = assert.rejects(result, (e: any) => e.code === 'MEDIA_PROCESSING_CANCELLED' && e.statusCode === 409);
    await flush(); controller.abort(); await rejected;
    assert.equal(calls, stage === 'before' ? 0 : 1);
    if (stage !== 'before') { assert.equal(signal!.aborted, true); assert.equal(disposed, true); }
  }
});

test('a retry is refused unless a complete worker budget remains after Retry-After', async t => {
  configure(); t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let calls = 0;
  try {
    await assert.rejects(convertHeifRemotely(Buffer.from('input'), 'image/heic', async () => {
      calls++; t.mock.timers.tick(10000);
      return new Response('', { status: 429, headers: { 'retry-after': '1' } });
    }), (e: any) => e instanceof HeifConversionError && e.code === 'HEIF_CONVERTER_BUSY' && e.retryAfterSeconds === 1);
    assert.equal(calls, 1);
  } finally { t.mock.timers.reset(); }
});

test('a delayed retry continuation rechecks the complete worker budget before sending', async t => {
  configure(); t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let calls = 0;
  try {
    const result = convertHeifRemotely(Buffer.from('input'), 'image/heic', async () => {
      calls++; return new Response('', { status: 429, headers: { 'retry-after': '1' } });
    });
    const rejected = assert.rejects(result, (e: any) => e.code === 'HEIF_CONVERTER_BUSY');
    await flush(); t.mock.timers.tick(11000); await rejected;
    assert.equal(calls, 1);
  } finally { t.mock.timers.reset(); }
});

test('HTTP failure classes are safe and Retry-After survives the busy error', async () => {
  configure();
  for (const [status, code, exposedStatus] of [
    [401, 'HEIF_CONVERTER_UNAVAILABLE', 503], [403, 'HEIF_CONVERTER_UNAVAILABLE', 503],
    [404, 'HEIF_CONVERTER_UNAVAILABLE', 503], [500, 'HEIF_CONVERTER_UNAVAILABLE', 503],
    [503, 'HEIF_CONVERTER_UNAVAILABLE', 503], [400, 'HEIF_CONVERSION_FAILED', 422],
    [413, 'HEIF_CONVERSION_FAILED', 422], [422, 'HEIF_CONVERSION_FAILED', 422],
    [429, 'HEIF_CONVERTER_BUSY', 429]
  ] as const) {
    await assert.rejects(convertHeifRemotely(Buffer.from('input'), 'image/heif', async () =>
      new Response('sensitive service details', { status, headers: { 'retry-after': '4' } })),
    (e: any) => e.code === code && e.statusCode === exposedStatus && !e.message.includes('sensitive') && (status !== 429 || e.retryAfterSeconds === 4));
  }
});

test('rejects empty and oversized sources before a network call', async () => {
  configure(); let calls = 0;
  for (const input of [Buffer.alloc(0), Buffer.alloc(MEDIA_CONFIG.maxInputBytes + 1)]) {
    await assert.rejects(convertHeifRemotely(input, 'image/heic', async () => { calls++; return new Response(); }), (e: any) => e.code === 'INVALID_FILE_SIZE');
  }
  assert.equal(calls, 0);
});

test('streaming output overflow cancels the response even without a declared length', async () => {
  configure(); let disposed = false;
  await assert.rejects(convertHeifRemotely(Buffer.from('input'), 'image/heic', async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(MEDIA_CONFIG.maxPreparedOutputBytes + 1)); },
    cancel() { disposed = true; }
  }), { headers: { 'content-type': 'image/webp' } })), (e: any) => e.code === 'HEIF_OUTPUT_TOO_LARGE');
  assert.equal(disposed, true);
});

test('real HTTP cancellation disconnects the converter while its output is pending', { timeout: 10000 }, async () => {
  configure();
  let received!: () => void, disconnected!: () => void;
  const arrived = new Promise<void>(resolve => { received = resolve; });
  const closed = new Promise<void>(resolve => { disconnected = resolve; });
  const server = createServer((req, res) => {
    req.resume(); res.on('close', disconnected);
    res.writeHead(200, { 'content-type': 'image/webp' }); res.write('pending'); received();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const controller = new AbortController();
  try {
    const address = server.address(); assert.ok(address && typeof address === 'object');
    process.env.HEIF_CONVERTER_URL = `http://127.0.0.1:${address.port}`;
    const result = convertHeifRemotely(Buffer.from('synthetic-heif'), 'image/heic', fetch, controller.signal);
    const rejected = assert.rejects(result, (e: any) => e.code === 'MEDIA_PROCESSING_CANCELLED');
    await arrived; controller.abort(); await rejected; await closed;
  } finally {
    controller.abort(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
