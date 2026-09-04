import assert from 'node:assert/strict';
import test from 'node:test';

const localValues = new Map<string, string>([['si_token', 'legacy-bearer-must-not-be-used']]);
const sessionValues = new Map<string, string>();
const storage = (values: Map<string, string>) => ({
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
  clear: () => values.clear(), key: (index: number) => [...values.keys()][index] ?? null,
  get length() { return values.size; }
});
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage(localValues) });
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage(sessionValues) });

const { api, authFetch, ApiError, AUTH_REQUEST_TIMEOUT_MS } = await import('./api.ts');

test('authentication requests have a bounded default and surface timeout recovery', async () => {
  assert.equal(AUTH_REQUEST_TIMEOUT_MS, 15_000);
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    })
  });
  await assert.rejects(authFetch('/api/auth/login', { timeoutMs: 10 }), (error: any) =>
    error instanceof ApiError && error.code === 'REQUEST_TIMEOUT' && error.status === 408);
});

test('login remembers only session metadata and every request uses cookie credentials without bearer auth', async () => {
  let captured: any;
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (input: RequestInfo | URL, init?: RequestInit) => {
    captured = { url: String(input), init };
    return Response.json({ user: { id: 'user-session-1' }, csrfToken: 'csrf-token-fixture-at-least-16' });
  } });
  await api.login({ identifier: 'private@example.test', password: 'ValidPassword1!' });
  const headers = new Headers(captured.init.headers);
  assert.equal(captured.init.credentials, 'include');
  assert.equal(headers.has('Authorization'), false);
  assert.equal(localValues.get('si_token'), 'legacy-bearer-must-not-be-used', 'API client never reads or rewrites the legacy value');
  assert.equal(sessionValues.get('si_auth_identity'), 'user-session-1');
  assert.equal(sessionValues.get('si_csrf_token'), 'csrf-token-fixture-at-least-16');
});

test('unsafe authenticated calls send CSRF from session metadata but never Authorization', async () => {
  let captured: any;
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (input: RequestInfo | URL, init?: RequestInit) => {
    captured = { url: String(input), init };
    return Response.json({ ok: true });
  } });
  await authFetch('/api/private-mutation', { method: 'POST', body: JSON.stringify({ value: true }) });
  const headers = new Headers(captured.init.headers);
  assert.equal(captured.init.credentials, 'include');
  assert.equal(headers.get('X-CSRF-Token'), 'csrf-token-fixture-at-least-16');
  assert.equal(headers.has('Authorization'), false);
});

test('registration resend always reaches the real purpose-bound API and surfaces cooldown failures', async () => {
  const calls: any[] = [];
  let responseIndex = 0;
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    responseIndex += 1;
    if (responseIndex === 1) return Response.json({ success: true, cooldownUntil: '2026-09-04T20:00:00.000Z' }, { status: 202 });
    return Response.json({ error: 'Please wait before requesting another code', code: 'OTP_COOLDOWN' }, { status: 429 });
  } });
  const first = await api.sendRegistrationOTP('00000000-0000-4000-8000-000000000001');
  assert.equal(first.success, true);
  await assert.rejects(api.sendRegistrationOTP('00000000-0000-4000-8000-000000000001'), (error: any) => error instanceof ApiError && error.status === 429 && error.code === 'OTP_COOLDOWN');
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.url === '/api/auth/register/otp/send'));
  assert.ok(calls.every((call) => JSON.parse(String(call.init.body)).pendingId));
});

test('OAuth start accepts only the exact provider host and rejects attacker-controlled redirects', async () => {
  const responses = [
    'https://accounts.google.com/o/oauth2/v2/auth?state=fixture&code_challenge=fixture',
    'https://accounts.google.com.evil.test/o/oauth2/v2/auth?state=fixture'
  ];
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => Response.json({ authorizationUrl: responses.shift() }) });
  assert.match(await api.startOAuth('google'), /^https:\/\/accounts\.google\.com\//);
  await assert.rejects(api.startOAuth('google'), (error: any) => error instanceof ApiError && error.code === 'INVALID_OAUTH_REDIRECT');
});

test('password reset request and confirmation send no bearer token and preserve generic API errors', async () => {
  const calls: any[] = [];
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(null, { status: 202 });
  } });
  await api.requestPasswordReset('private@example.test');
  await api.confirmPasswordReset('private@example.test', '123456', 'NewPassword1!');
  assert.deepEqual(calls.map((call) => call.url), ['/api/auth/password-reset/request', '/api/auth/password-reset/confirm']);
  assert.equal(JSON.parse(String(calls[1].init.body)).code, '123456');
  for (const call of calls) {
    assert.equal(call.init.credentials, 'include');
    assert.equal(new Headers(call.init.headers).has('Authorization'), false);
  }
});

test('logout clears in-memory/session metadata after the server revokes the cookie session', async () => {
  let captured: any;
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (input: RequestInfo | URL, init?: RequestInit) => {
    captured = { url: String(input), init };
    return new Response(null, { status: 204 });
  } });
  await api.logout();
  assert.equal(captured.url, '/api/auth/logout');
  assert.equal(captured.init.credentials, 'include');
  assert.equal(sessionValues.has('si_auth_identity'), false);
  assert.equal(sessionValues.has('si_csrf_token'), false);
});
