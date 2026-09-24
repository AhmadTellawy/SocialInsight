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

const nativeProbe = {
  schemaVersion: 1,
  status: 'passed',
  fixtureSet: 'native-still-v1',
  cases: [
    { id: 'rainbow-heic', fixtureSha256: '4b2ce727f093944975f143ba2b39c4c64511b766d94552f8d51a755916e7f983', inputMime: 'image/heic', outputMime: 'image/webp', width: 451, height: 461, hasAlpha: false },
    { id: 'rainbow-generic-heif', fixtureSha256: '536badaba808ef5e5bf51f80611ab112440474dacc4cb3f99cb05a284d0a8391', inputMime: 'image/heif', outputMime: 'image/webp', width: 451, height: 461, hasAlpha: false },
    { id: 'alpha-heic', fixtureSha256: 'dac399d3bf1019baaf5f88eef8b277087d0643e735db947c42355237bb9d0221', inputMime: 'image/heic', outputMime: 'image/webp', width: 512, height: 512, hasAlpha: true },
  ],
};

const nativeBuild = {
  libheifRef: 'v1.23.4',
  libde265Ref: 'v1.1.1',
  libheifCommit: '4e14f5942c1732ace9611b9522cc991501445463',
  libde265Commit: '4dd701fffac01632ffd5cabc5ef10deb56accba1',
};

const confinement = {
  schemaVersion: 2,
  policy: 'rlimit-nproc-v2',
  status: 'passed',
  processControl: {
    supervisorLimit: 128,
    workerLimit: 32,
    brokerFilterInstalled: true,
    forkBoundsPassed: true,
    threadBoundsPassed: true,
    raiseDenied: true,
    inheritancePassed: true,
    escapeDenied: true,
    countersUnchanged: true,
    cleanupPassed: true,
    attribution: 'UNCLAIMED',
  },
  checks: Array.from({ length: 19 }, (_, index) => `check-${index}`),
  syscallReport: { negativeSyscalls: 31, limitsVerified: 5 },
  envelope: { uid: 10001, noNewPrivileges: true, swapBytes: 0 },
};

const readinessBody = () => structuredClone({
  status: 'ready',
  service: 'heif-converter',
  versions: { libheif: '1.23.4', libde265: '1.1.1', sharp: '0.35.4' },
  nativeBuild,
  nativeProbe,
  confinement,
});

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
    versions: { libheif: '1.23.4', libde265: '1.1.1', sharp: '0.35.4' },
    nativeBuild,
    nativeProbe,
    confinement
  }));
  assert.equal(ready, true);
  resetHeifReadinessForTests();
  const stale = await verifyHeifConversionReadiness(true, async () => Response.json({
    status: 'ready',
    service: 'heif-converter',
    versions: { libheif: '1.23.2', libde265: '1.1.1', sharp: '0.35.4' },
    nativeBuild,
    nativeProbe
  }));
  assert.equal(stale, false);
  resetHeifReadinessForTests();
  const unproven = await verifyHeifConversionReadiness(true, async () => Response.json({
    status: 'ready',
    service: 'heif-converter',
    versions: { libheif: '1.23.4', libde265: '1.1.1', sharp: '0.35.4' },
    nativeBuild
  }));
  assert.equal(unproven, false);
});

const configure = () => {
  process.env.MEDIA_HEIF_SERVER_ENABLED = 'true';
  process.env.HEIF_CONVERTER_URL = 'http://heif-converter:10000';
  process.env.HEIF_CONVERTER_SECRET = 'unit-test-secret-at-least-32-bytes';
};

test('requires schema 2 and the exact process policy', async () => {
  configure();
  for (const schemaVersion of [undefined, null, 0, 1, 3, '2', true]) {
    const body = readinessBody();
    Object.assign(body.confinement, { schemaVersion });
    assert.equal(await verifyHeifConversionReadiness(true, async () => Response.json(body)), false, `schema ${schemaVersion}`);
  }
  for (const policy of [undefined, null, '', 'rlimit-nproc-v1', 'rlimit-nproc-v3', 'RLIMIT-NPROC-V2', true]) {
    const body = readinessBody();
    Object.assign(body.confinement, { policy });
    assert.equal(await verifyHeifConversionReadiness(true, async () => Response.json(body)), false, `policy ${policy}`);
  }
});

test('rejects every missing process-control field and every nonliteral proof boolean', async () => {
  configure();
  for (const [key, expected] of Object.entries(confinement.processControl)) {
    const values = expected === true ? [undefined, null, false, 0, 1, 'true', {}, []] : [undefined, null];
    for (const value of values) {
      const body = readinessBody();
      Object.assign(body.confinement.processControl, { [key]: value });
      assert.equal(await verifyHeifConversionReadiness(true, async () => Response.json(body)), false, `${key}=${JSON.stringify(value)}`);
    }
  }
});

test('requires exact numeric 128 and 32 limits and unclaimed attribution', async () => {
  configure();
  for (const [key, values] of [
    ['supervisorLimit', [0, 32, 127, 129, 512, '128', true]],
    ['workerLimit', [0, 31, 33, 128, 512, '32', true]],
    ['attribution', ['CLAIMED', 'VERIFIED', 'UNVERIFIED', 'EXACT', 'unclaimed', true, 0]],
  ] as const) {
    for (const value of values) {
      const body = readinessBody();
      Object.assign(body.confinement.processControl, { [key]: value });
      assert.equal(await verifyHeifConversionReadiness(true, async () => Response.json(body)), false, `${key}=${value}`);
    }
  }
});

test('rejects malformed or expanded process proof, including provider inventory', async () => {
  configure();
  for (const processControl of [
    undefined, null, {}, [], true, 'passed', Object.values(confinement.processControl),
    { ...confinement.processControl, pid: 123 },
    { ...confinement.processControl, sharedUidTasks: 1 },
    { ...confinement.processControl, namespace: 'provider-namespace' },
  ]) {
    const body = readinessBody();
    Object.assign(body.confinement, { processControl });
    assert.equal(await verifyHeifConversionReadiness(true, async () => Response.json(body)), false);
  }
});

test('schema 2 preserves mandatory confinement and pinned native evidence', async () => {
  configure();
  const mutations: Array<(body: ReturnType<typeof readinessBody>) => void> = [
    body => { body.confinement.status = 'failed'; },
    body => { body.confinement.checks.pop(); },
    body => { Object.assign(body.confinement, { checks: { length: 19 } }); },
    body => { body.confinement.syscallReport.negativeSyscalls = 30; },
    body => { body.confinement.syscallReport.limitsVerified = 4; },
    body => { body.confinement.envelope.uid = 0; },
    body => { body.confinement.envelope.noNewPrivileges = false; },
    body => { body.confinement.envelope.swapBytes = 1; },
    body => { body.nativeProbe.status = 'failed'; },
    body => { body.nativeProbe.cases[0].fixtureSha256 = 'unverified'; },
    body => { body.nativeProbe.cases.pop(); },
    body => { body.nativeBuild.libheifCommit = 'unverified'; },
    body => { body.versions.sharp = '0.0.0'; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const body = readinessBody();
    mutate(body);
    assert.equal(await verifyHeifConversionReadiness(true, async () => Response.json(body)), false, `retained guard ${index}`);
  }
});

test('requires HTTP 200, rejects malformed responses, and uses only the fixed readiness path', async () => {
  configure();
  assert.equal(await verifyHeifConversionReadiness(true, async (url, init) => {
    assert.equal(String(url), 'http://heif-converter:10000/health/ready');
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(init?.headers, undefined);
    return Response.json(readinessBody());
  }), true);
  for (const status of [201, 202, 400, 503]) {
    assert.equal(await verifyHeifConversionReadiness(true, async () => Response.json(readinessBody(), { status })), false, `HTTP ${status}`);
  }
  for (const value of [null, [], true, 'ready']) {
    assert.equal(await verifyHeifConversionReadiness(true, async () => Response.json(value)), false);
  }
  assert.equal(await verifyHeifConversionReadiness(true, async () => new Response('{')), false);
  assert.equal(await verifyHeifConversionReadiness(true, async () => { throw new Error('unavailable'); }), false);
});

test('a forced incompatible proof invalidates cached readiness until a complete v2 response', async () => {
  configure();
  let calls = 0;
  const readyFetch: typeof fetch = async () => { calls += 1; return Response.json(readinessBody()); };
  assert.equal(await verifyHeifConversionReadiness(false, readyFetch), true);
  assert.equal(await verifyHeifConversionReadiness(false, readyFetch), true);
  assert.equal(calls, 1);
  const incompatible = readinessBody();
  incompatible.confinement.schemaVersion = 1;
  assert.equal(await verifyHeifConversionReadiness(true, async () => Response.json(incompatible)), false);
  assert.equal(await verifyHeifConversionReadiness(false, readyFetch), false);
  assert.equal(calls, 1);
  assert.equal(await verifyHeifConversionReadiness(true, readyFetch), true);
  assert.equal(calls, 2);
});

test('fails closed unless the feature flag, URL, and secret are all valid', async () => {
  delete process.env.MEDIA_HEIF_SERVER_ENABLED;
  delete process.env.HEIF_CONVERTER_URL;
  delete process.env.HEIF_CONVERTER_SECRET;
  assert.equal(isHeifConversionConfigured(), false);
  await assert.rejects(
    () => convertHeifRemotely(Buffer.from('x'), 'image/heic'),
    (error: unknown) => error instanceof MediaValidationError && error.code === 'HEIF_CONVERTER_UNAVAILABLE'
  );
  process.env.MEDIA_HEIF_SERVER_ENABLED = 'true';
  process.env.HEIF_CONVERTER_SECRET = 'unit-test-secret-at-least-32-bytes';
  process.env.HEIF_CONVERTER_URL = 'http://converter.example.com';
  assert.equal(isHeifConversionConfigured(), false);
  process.env.HEIF_CONVERTER_URL = 'http://heif-converter:10000';
  process.env.HEIF_CONVERTER_SECRET = 'too-short';
  assert.equal(isHeifConversionConfigured(), false);
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
      `v1=${createHmac('sha256', 'unit-test-secret-at-least-32-bytes').update(`v1\n${timestamp}\n${requestId}\n${hash}`).digest('hex')}`
    );
    assert.equal(headers.get('x-si-body-sha256'), hash);
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
