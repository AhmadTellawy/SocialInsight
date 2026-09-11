import assert from 'node:assert/strict';
import test from 'node:test';

const localValues = new Map<string, string>();
const sessionValues = new Map<string, string>();
const storage = (values: Map<string, string>) => ({
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
  clear: () => values.clear(),
  key: (index: number) => [...values.keys()][index] ?? null,
  get length() { return values.size; }
});
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage(localValues) });
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage(sessionValues) });

const { api } = await import('./api.ts');
const { mediaApi, MediaUploadError, MEDIA_PROCESSING_TIMEOUT_MS, HEIF_WARMUP_TIMEOUT_MS } = await import('./mediaApi.ts');

test('long-running server media processing has an explicit timeout above the auth default', () => {
  assert.equal(MEDIA_PROCESSING_TIMEOUT_MS, 120_000);
});

const presentation = (identity: string) => ({
  id: 'shared-asset-id', access: 'RESTRICTED', aspectRatio: 1, width: 64, height: 64,
  src: `https://media.invalid/${identity}`
});

test('an old session request cannot repopulate signed-url cache after account switch', async () => {
  let releaseIdentityA!: (response: Response) => void;
  const identityAResponse = new Promise<Response>((resolve) => { releaseIdentityA = resolve; });
  let activeIdentity = 'identity-a';
  const requests: Array<{ url: string; credentials?: RequestCredentials; authorization: string }> = [];
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      requests.push({ url, credentials: init?.credentials, authorization: new Headers(init?.headers).get('Authorization') || '' });
      if (url.endsWith('/auth/login')) {
        const body = JSON.parse(String(init?.body));
        activeIdentity = body.identifier;
        return Response.json({ user: { id: activeIdentity }, csrfToken: `csrf-token-${activeIdentity}-long` });
      }
      if (url.endsWith('/media/shared-asset-id')) {
        return activeIdentity === 'identity-a' ? identityAResponse : Response.json(presentation(activeIdentity));
      }
      throw new Error(`Unexpected request: ${url}`);
    }
  });

  await api.login({ identifier: 'identity-a', password: 'ValidPassword1!' });
  const oldRequest = mediaApi.get('shared-asset-id');
  await api.login({ identifier: 'identity-b', password: 'ValidPassword1!' });
  const current = await mediaApi.get('shared-asset-id');
  assert.equal(current.src, 'https://media.invalid/identity-b');
  releaseIdentityA(Response.json(presentation('identity-a')));
  assert.equal((await oldRequest).src, 'https://media.invalid/identity-a');
  assert.equal((await mediaApi.get('shared-asset-id')).src, 'https://media.invalid/identity-b');
  assert.ok(requests.every((request) => request.credentials === 'include'));
  assert.ok(requests.every((request) => request.authorization === ''), 'browser session requests must not carry bearer tokens');
});

test('authenticated HEIF preparation uses cookies and CSRF without Authorization', async () => {
  const requests: Array<{ url: string; method: string; credentials?: RequestCredentials; authorization: string; csrf: string }> = [];
  const expected = {
    id: 'heif-asset', status: 'TEMPORARY', sourceMime: 'image/heic',
    preview: { src: 'https://media.invalid/signed-preview', mime: 'image/webp', width: 1200, height: 900, aspectRatio: 4 / 3, expiresInSeconds: 300 }
  };
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: String(input), method: init?.method || 'GET', credentials: init?.credentials,
        authorization: headers.get('Authorization') || '', csrf: headers.get('X-CSRF-Token') || ''
      });
      return Response.json(expected);
    }
  });
  assert.deepEqual(await mediaApi.prepare('heif-asset'), expected);
  assert.deepEqual(requests, [{
    url: '/api/media/heif-asset/prepare', method: 'POST', credentials: 'include', authorization: '', csrf: 'csrf-token-identity-b-long'
  }]);
});

const coldConfig = { heifServerPreparationConfigured: true, heifServerPreparationEnabled: false };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

test('ready HEIF selection skips warmup and every selection reads fresh readiness', async (t) => {
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    paths.push(String(input));
    return Response.json({ ...coldConfig, heifServerPreparationEnabled: true });
  });
  await mediaApi.ensureHeifReady();
  await mediaApi.ensureHeifReady();
  assert.deepEqual(paths, ['/api/media/config', '/api/media/config']);
});

test('unconfigured HEIF is retryable and creates no upload session', async (t) => {
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    paths.push(String(input));
    return Response.json({ ...coldConfig, heifServerPreparationConfigured: false });
  });
  await assert.rejects(mediaApi.uploadAndPrepare(new File(['synthetic'], 'image.heic'), 'POST', () => {}),
    (error: unknown) => error instanceof MediaUploadError && error.phase === 'preparation' && !error.assetId);
  assert.deepEqual(paths, ['/api/media/config']);
});

test('warmup shares only in-flight work and one canceled selection does not abort another', async (t) => {
  const started = deferred<void>();
  const ready = deferred<Response>();
  let warmupCount = 0;
  let warmupSignal: AbortSignal | null | undefined;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/config')) return Response.json(coldConfig);
    assert.equal(String(input), '/api/media/heif/warmup');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.body, undefined);
    assert.equal(init?.credentials, 'include');
    assert.equal(new Headers(init?.headers).get('Authorization'), null);
    assert.equal(new Headers(init?.headers).get('X-CSRF-Token'), 'csrf-token-identity-b-long');
    warmupCount += 1;
    warmupSignal = init?.signal;
    started.resolve();
    return ready.promise;
  });
  const firstController = new AbortController();
  const first = mediaApi.ensureHeifReady(firstController.signal);
  const second = mediaApi.ensureHeifReady();
  const canceled = assert.rejects(first, { name: 'AbortError' });
  await started.promise;
  // Both config reads finish before the next turn; both consumers now wait.
  await new Promise(resolve => setImmediate(resolve));
  firstController.abort();
  await canceled;
  assert.equal(warmupSignal?.aborted, false);
  ready.resolve(Response.json({ heifServerPreparationEnabled: true }));
  await second;
  assert.equal(warmupCount, 1);
});

test('false warmup does not poison the next retry', async (t) => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/config')) return Response.json(coldConfig);
    return Response.json({ heifServerPreparationEnabled: ++count > 1 });
  });
  await assert.rejects(mediaApi.ensureHeifReady(), (error: unknown) => error instanceof MediaUploadError && error.phase === 'preparation');
  await mediaApi.ensureHeifReady();
  assert.equal(count, 2);
});

test('canceling the last warmup waiter aborts that request and permits a fresh selection', async (t) => {
  const started = deferred<void>();
  let count = 0;
  let oldSignal: AbortSignal | null | undefined;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/config')) return Response.json(coldConfig);
    count += 1;
    if (count > 1) return Response.json({ heifServerPreparationEnabled: true });
    oldSignal = init?.signal;
    started.resolve();
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')), { once: true });
    });
  });
  const controller = new AbortController();
  const pending = mediaApi.ensureHeifReady(controller.signal);
  const canceled = assert.rejects(pending, { name: 'AbortError' });
  await started.promise;
  controller.abort();
  await canceled;
  assert.equal(oldSignal?.aborted, true);
  await mediaApi.ensureHeifReady();
  assert.equal(count, 2);
});

test('warmup waits beyond 90 seconds and remains bounded at 100 seconds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const started = deferred<void>();
  let signal: AbortSignal | null | undefined;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/config')) return Response.json(coldConfig);
    signal = init?.signal;
    started.resolve();
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')), { once: true });
    });
  });
  const pending = mediaApi.ensureHeifReady();
  const timeout = assert.rejects(pending, { code: 'REQUEST_TIMEOUT' });
  await started.promise;
  t.mock.timers.tick(90_001);
  assert.equal(signal?.aborted, false);
  t.mock.timers.tick(HEIF_WARMUP_TIMEOUT_MS - 90_001);
  await timeout;
  assert.equal(signal?.aborted, true);
});

test('account switching cannot share or accept the previous identity warmup', async (t) => {
  const started = deferred<void>();
  const previous = deferred<Response>();
  let warmups = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/auth/login')) return Response.json({ user: { id: 'identity-c' }, csrfToken: 'csrf-token-identity-c-long' });
    if (url.endsWith('/config')) return Response.json(coldConfig);
    warmups += 1;
    if (warmups === 1) { started.resolve(); return previous.promise; }
    return Response.json({ heifServerPreparationEnabled: true });
  });
  const oldIdentity = mediaApi.ensureHeifReady();
  const canceled = assert.rejects(oldIdentity, { name: 'AbortError' });
  await started.promise;
  await api.login({ identifier: 'identity-c', password: 'ValidPassword1!' });
  await mediaApi.ensureHeifReady();
  previous.resolve(Response.json({ heifServerPreparationEnabled: true }));
  await canceled;
  assert.equal(warmups, 2);
});
