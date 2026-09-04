import assert from 'node:assert/strict';
import test from 'node:test';
import type {} from './authMiddleware';

process.env.AUTH_SESSION_HASH_SECRET = process.env.AUTH_SESSION_HASH_SECRET || 'csrf-test-secret-at-least-32-bytes-long';
process.env.AUTH_ALLOWED_ORIGINS = 'https://socialinsightapp.com,https://preview.example.test';

const { CSRF_COOKIE_NAME, hashSessionSecret } = require('../services/sessionService') as typeof import('../services/sessionService');
const sessionService = require('../services/sessionService') as typeof import('../services/sessionService');
const { hasValidCsrf, isTrustedOrigin, requireCsrf, requireTrustedOrigin } = require('./csrfProtection') as typeof import('./csrfProtection');
const { requireAuth, requireRecentAuth } = require('./authMiddleware') as typeof import('./authMiddleware');

const request = (origin: string | undefined, headerToken = '', cookieToken = headerToken): any => ({
  headers: { cookie: `${CSRF_COOKIE_NAME}=${encodeURIComponent(cookieToken)}` },
  authSession: { csrfHash: hashSessionSecret(headerToken) },
  header(name: string) {
    if (name.toLowerCase() === 'origin') return origin;
    if (name.toLowerCase() === 'x-csrf-token') return headerToken;
    return undefined;
  }
});

const response = () => {
  const state: any = { statusCode: 200, body: undefined };
  const res: any = { status(code: number) { state.statusCode = code; return res; }, json(body: any) { state.body = body; return res; } };
  return { res, state };
};

test('origin matching is exact and rejects missing, lookalike and untrusted origins', () => {
  assert.equal(isTrustedOrigin(request('https://socialinsightapp.com')), true);
  assert.equal(isTrustedOrigin(request('https://preview.example.test')), true);
  assert.equal(isTrustedOrigin(request('https://socialinsightapp.com.evil.test')), false);
  assert.equal(isTrustedOrigin(request('http://socialinsightapp.com')), false);
  assert.equal(isTrustedOrigin(request(undefined)), false);
});

test('double-submit CSRF requires trusted origin, matching cookie/header and session hash', () => {
  assert.equal(hasValidCsrf(request('https://socialinsightapp.com', 'token-a', 'token-a')), true);
  assert.equal(hasValidCsrf(request('https://socialinsightapp.com', 'token-a', 'token-b')), false);
  const wrongSession = request('https://socialinsightapp.com', 'token-a', 'token-a');
  wrongSession.authSession.csrfHash = hashSessionSecret('another-token');
  assert.equal(hasValidCsrf(wrongSession), false);
});

test('CSRF and origin middleware fail closed with generic error codes', () => {
  for (const [middleware, req, expectedCode] of [
    [requireTrustedOrigin, request('https://evil.test'), 'ORIGIN_REJECTED'],
    [requireCsrf, request('https://evil.test', 'token-a'), 'ORIGIN_REJECTED'],
    [requireCsrf, request('https://socialinsightapp.com', 'token-a', 'token-b'), 'CSRF_REJECTED']
  ] as const) {
    const { res, state } = response();
    let nextCalls = 0;
    middleware(req, res, () => { nextCalls += 1; });
    assert.equal(state.statusCode, 403);
    assert.equal(state.body.code, expectedCode);
    assert.equal(nextCalls, 0);
  }
});

test('valid CSRF request reaches the next handler once', () => {
  const { res, state } = response();
  let nextCalls = 0;
  requireCsrf(request('https://socialinsightapp.com', 'token-a'), res, () => { nextCalls += 1; });
  assert.equal(state.statusCode, 200);
  assert.equal(nextCalls, 1);
});

test('authentication middleware rejects legacy bearer identity and accepts only resolved server session', async () => {
  const originalResolve = sessionService.resolveSession;
  try {
    (sessionService as any).resolveSession = async (req: any) => req.headers.cookie ? {
      id: 'session-1', userId: 'user-1', csrfHash: hashSessionSecret('token-a'),
      expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), user: { status: 'ACTIVE' }
    } : null;
    const bearerOnly = response();
    let nextCalls = 0;
    await requireAuth({ method: 'GET', headers: { authorization: 'Bearer legacy-token' }, requestId: 'bearer-only' } as any, bearerOnly.res, () => { nextCalls += 1; });
    assert.equal(bearerOnly.state.statusCode, 401);
    assert.equal(bearerOnly.state.body.code, 'AUTH_REQUIRED');
    assert.equal(nextCalls, 0);

    const cookieRequest: any = { method: 'GET', headers: { cookie: 'si_session=opaque-session' }, requestId: 'cookie-session' };
    const cookieResponse = response();
    await requireAuth(cookieRequest, cookieResponse.res, () => { nextCalls += 1; });
    assert.equal(cookieResponse.state.statusCode, 200);
    assert.deepEqual(cookieRequest.user, { userId: 'user-1', authMode: 'session' });
    assert.equal(cookieRequest.authSession.id, 'session-1');
    assert.equal(nextCalls, 1);
  } finally { (sessionService as any).resolveSession = originalResolve; }
});

test('sensitive sign-in method changes require a recently created server session', () => {
  const fresh = response();
  let nextCalls = 0;
  requireRecentAuth({ authSession: { createdAt: new Date() } } as any, fresh.res, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);

  const stale = response();
  requireRecentAuth({ authSession: { createdAt: new Date(Date.now() - 60 * 60 * 1000) }, requestId: 'stale' } as any, stale.res, () => { nextCalls += 1; });
  assert.equal(stale.state.statusCode, 401);
  assert.equal(stale.state.body.code, 'REAUTHENTICATION_REQUIRED');
  assert.equal(nextCalls, 1);
});
