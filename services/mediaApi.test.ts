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
const { mediaApi, MEDIA_PROCESSING_TIMEOUT_MS } = await import('./mediaApi.ts');

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
