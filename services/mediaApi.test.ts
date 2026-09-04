import assert from 'node:assert/strict';
import test from 'node:test';

const values = new Map<string, string>([['si_token', 'identity-a']]);
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  }
});

const { mediaApi } = await import('./mediaApi.ts');

const presentation = (identity: string) => ({
  id: 'shared-asset-id',
  access: 'RESTRICTED',
  aspectRatio: 1,
  width: 64,
  height: 64,
  src: `https://media.invalid/${identity}`
});

test('an old identity request cannot repopulate the signed-url cache after an account switch', async () => {
  let releaseIdentityA!: (response: Response) => void;
  const identityAResponse = new Promise<Response>((resolve) => { releaseIdentityA = resolve; });
  const authorizationHeaders: string[] = [];

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const authorization = new Headers(init?.headers).get('Authorization') || '';
      authorizationHeaders.push(authorization);
      if (authorization === 'Bearer identity-a') return identityAResponse;
      return Response.json(presentation('identity-b'));
    }
  });

  const oldRequest = mediaApi.get('shared-asset-id');
  values.set('si_token', 'identity-b');
  const current = await mediaApi.get('shared-asset-id');
  assert.equal(current.src, 'https://media.invalid/identity-b');

  releaseIdentityA(Response.json(presentation('identity-a')));
  const old = await oldRequest;
  assert.equal(old.src, 'https://media.invalid/identity-a');

  const cachedForCurrentIdentity = await mediaApi.get('shared-asset-id');
  assert.equal(cachedForCurrentIdentity.src, 'https://media.invalid/identity-b');
  assert.deepEqual(authorizationHeaders, ['Bearer identity-a', 'Bearer identity-b']);
});

test('requests an authenticated server-prepared HEIF preview', async () => {
  values.set('si_token', 'identity-c');
  const requests: Array<{ url: string; method: string; authorization: string }> = [];
  const expected = {
    id: 'heif-asset',
    status: 'TEMPORARY',
    sourceMime: 'image/heic',
    preview: {
      src: 'https://media.invalid/signed-preview',
      mime: 'image/webp',
      width: 1200,
      height: 900,
      aspectRatio: 4 / 3,
      expiresInSeconds: 300
    }
  };
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requests.push({
        url: String(input),
        method: init?.method || 'GET',
        authorization: new Headers(init?.headers).get('Authorization') || ''
      });
      return Response.json(expected);
    }
  });

  assert.deepEqual(await mediaApi.prepare('heif-asset'), expected);
  assert.deepEqual(requests, [{
    url: '/api/media/heif-asset/prepare',
    method: 'POST',
    authorization: 'Bearer identity-c'
  }]);
});
