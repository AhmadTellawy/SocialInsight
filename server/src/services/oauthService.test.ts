import assert from 'node:assert/strict';
import test from 'node:test';
import { OAuth2Client } from 'google-auth-library';

process.env.AUTH_SESSION_HASH_SECRET = process.env.AUTH_SESSION_HASH_SECRET || 'oauth-test-secret-at-least-32-bytes-long';
process.env.GOOGLE_OAUTH_CLIENT_ID = 'google-client-fixture';
process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'google-secret-fixture';
process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://api.example.test/api/auth/oauth/google/callback';
process.env.FACEBOOK_APP_ID = 'facebook-app-fixture';
process.env.FACEBOOK_APP_SECRET = 'facebook-secret-fixture';
process.env.FACEBOOK_OAUTH_REDIRECT_URI = 'https://api.example.test/api/auth/oauth/facebook/callback';

let fetchImplementation: (url: string, init?: any) => Promise<any> = async () => { throw new Error('Unexpected network request'); };
const nodeFetchPath = require.resolve('node-fetch');
const originalNodeFetch = require(nodeFetchPath);
const fetchProxy = (url: any, init?: any) => fetchImplementation(String(url), init);
(fetchProxy as any).__esModule = false;
require.cache[nodeFetchPath]!.exports = fetchProxy;

const prisma = require('../prisma').default as any;
const { hashSessionSecret } = require('./sessionService') as typeof import('./sessionService');
const { beginOAuth, completeOAuth, OAuthError } = require('./oauthService') as typeof import('./oauthService');
const BROWSER_SECRET = 'browser-secret-fixture-at-least-32-bytes-long';

const originals = {
  stateCreate: prisma.oAuthState.create,
  stateFindUnique: prisma.oAuthState.findUnique,
  stateUpdateMany: prisma.oAuthState.updateMany,
  accountFindFirst: prisma.oAuthAccount.findFirst,
  accountCreate: prisma.oAuthAccount.create,
  userFindFirst: prisma.user.findFirst,
  userFindUnique: prisma.user.findUnique,
  transaction: prisma.$transaction,
  generateVerifier: OAuth2Client.prototype.generateCodeVerifierAsync,
  generateAuthUrl: OAuth2Client.prototype.generateAuthUrl,
  getToken: OAuth2Client.prototype.getToken,
  verifyIdToken: OAuth2Client.prototype.verifyIdToken
};

const stateRecord = (provider: 'GOOGLE' | 'FACEBOOK', state: string, overrides: any = {}) => ({
  id: `state-${provider.toLowerCase()}`,
  stateHash: hashSessionSecret(`oauth-state:${state}:${BROWSER_SECRET}`),
  provider,
  pkceVerifier: 'pkce-verifier-fixture',
  nonce: 'nonce-fixture',
  mode: 'LOGIN',
  linkingUserId: null,
  expiresAt: new Date(Date.now() + 60_000),
  consumedAt: null,
  ...overrides
});

const installState = (record: any) => {
  let consumed = false;
  prisma.oAuthState.findUnique = async ({ where }: any) => where.stateHash === record.stateHash ? { ...record, consumedAt: consumed ? new Date() : record.consumedAt } : null;
  prisma.oAuthState.updateMany = async () => { if (consumed) return { count: 0 }; consumed = true; return { count: 1 }; };
};

const restoreDb = () => {
  prisma.oAuthState.create = originals.stateCreate;
  prisma.oAuthState.findUnique = originals.stateFindUnique;
  prisma.oAuthState.updateMany = originals.stateUpdateMany;
  prisma.oAuthAccount.findFirst = originals.accountFindFirst;
  prisma.oAuthAccount.create = originals.accountCreate;
  prisma.user.findFirst = originals.userFindFirst;
  prisma.user.findUnique = originals.userFindUnique;
  prisma.$transaction = originals.transaction;
  OAuth2Client.prototype.generateCodeVerifierAsync = originals.generateVerifier;
  OAuth2Client.prototype.generateAuthUrl = originals.generateAuthUrl;
  OAuth2Client.prototype.getToken = originals.getToken;
  OAuth2Client.prototype.verifyIdToken = originals.verifyIdToken;
};

test.after(() => { require.cache[nodeFetchPath]!.exports = originalNodeFetch; restoreDb(); });
test.afterEach(restoreDb);

test('OAuth start stores hashed state and uses PKCE/nonce without secrets in provider URLs', async () => {
  const created: any[] = [];
  prisma.oAuthState.create = async ({ data }: any) => { created.push(data); return { id: `state-${created.length}`, ...data }; };
  OAuth2Client.prototype.generateCodeVerifierAsync = async () => ({ codeVerifier: 'google-verifier', codeChallenge: 'google-challenge' } as any);
  OAuth2Client.prototype.generateAuthUrl = function (options: any) {
    return `https://accounts.google.test/auth?${new URLSearchParams({ state: options.state, nonce: options.nonce, code_challenge: options.code_challenge }).toString()}`;
  };
  const googleStart = await beginOAuth('GOOGLE', 'LOGIN');
  const facebookStart = await beginOAuth('FACEBOOK', 'LOGIN');
  const googleUrl = googleStart.authorizationUrl;
  const facebookUrl = facebookStart.authorizationUrl;
  for (const urlValue of [googleUrl, facebookUrl]) {
    const url = new URL(urlValue);
    assert.equal(url.searchParams.has('client_secret'), false);
    assert.equal(url.searchParams.has('access_token'), false);
    assert.equal(url.toString().includes('google-secret-fixture'), false);
    assert.equal(url.toString().includes('facebook-secret-fixture'), false);
    assert.ok(url.searchParams.get('state'));
    assert.ok(url.searchParams.get('code_challenge'));
  }
  assert.equal(created.length, 2);
  assert.equal(created[0].stateHash, hashSessionSecret(`oauth-state:${new URL(googleUrl).searchParams.get('state')!}:${googleStart.browserSecret}`));
  assert.notEqual(created[0].stateHash, new URL(googleUrl).searchParams.get('state'));
  assert.equal(created[0].pkceVerifier, 'google-verifier');
  assert.ok(created[0].nonce);
});

test('expired and replayed OAuth state fail closed before provider exchange', async () => {
  const state = 'state-fixture';
  let providerCalls = 0;
  OAuth2Client.prototype.getToken = async () => { providerCalls += 1; return { tokens: { id_token: 'id-token' } } as any; };
  installState(stateRecord('GOOGLE', state, { expiresAt: new Date(Date.now() - 1) }));
  await assert.rejects(completeOAuth('GOOGLE', 'code', state, BROWSER_SECRET), (error: any) => error instanceof OAuthError && error.code === 'OAUTH_STATE_INVALID');
  installState(stateRecord('GOOGLE', state));
  prisma.oAuthState.updateMany = async () => ({ count: 0 });
  await assert.rejects(completeOAuth('GOOGLE', 'code', state, BROWSER_SECRET), (error: any) => error.code === 'OAUTH_STATE_INVALID');
  assert.equal(providerCalls, 0);
});

test('Google rejects unverified email and nonce mismatch', async () => {
  const cases = [
    { sub: 'google-user', nonce: 'nonce-fixture', email: 'private@example.test', email_verified: false },
    { sub: 'google-user', nonce: 'wrong-nonce', email: 'private@example.test', email_verified: true }
  ];
  OAuth2Client.prototype.getToken = async () => ({ tokens: { id_token: 'id-token-fixture' } } as any);
  for (const [index, payload] of cases.entries()) {
    installState(stateRecord('GOOGLE', `google-state-${index}`));
    OAuth2Client.prototype.verifyIdToken = async () => ({ getPayload: () => payload } as any);
    await assert.rejects(
      completeOAuth('GOOGLE', 'authorization-code', `google-state-${index}`, BROWSER_SECRET),
      (error: any) => error instanceof OAuthError && error.code === 'OAUTH_IDENTITY_INVALID'
    );
  }
});

test('OAuth login never auto-links an existing email account', async () => {
  const state = 'duplicate-email-state';
  installState(stateRecord('GOOGLE', state));
  OAuth2Client.prototype.getToken = async () => ({ tokens: { id_token: 'id-token-fixture' } } as any);
  OAuth2Client.prototype.verifyIdToken = async () => ({ getPayload: () => ({ sub: 'google-user', nonce: 'nonce-fixture', email: 'private@example.test', email_verified: true, name: 'Private User' }) } as any);
  prisma.oAuthAccount.findFirst = async () => null;
  prisma.user.findFirst = async ({ where }: any) => where.email ? { id: 'existing-user' } : null;
  await assert.rejects(completeOAuth('GOOGLE', 'authorization-code', state, BROWSER_SECRET), (error: any) => error.code === 'ACCOUNT_LINK_REQUIRED');
  assert.equal(prisma.oAuthAccount.create, originals.accountCreate, 'no provider link is created implicitly');
});

test('Facebook rejects a token issued for another App ID and never puts secrets/tokens in URLs', async () => {
  const state = 'facebook-invalid-app-state';
  installState(stateRecord('FACEBOOK', state));
  const calls: Array<{ url: string; init: any }> = [];
  fetchImplementation = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/oauth/access_token')) return { ok: true, json: async () => ({ access_token: 'provider-token-fixture' }) };
    return { ok: true, json: async () => ({ data: { is_valid: true, app_id: 'other-app', user_id: 'facebook-user' } }) };
  };
  await assert.rejects(completeOAuth('FACEBOOK', 'authorization-code', state, BROWSER_SECRET), (error: any) => error.code === 'OAUTH_IDENTITY_INVALID');
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url.includes('facebook-secret-fixture'), false);
    assert.equal(call.url.includes('provider-token-fixture'), false);
    assert.equal(new URL(call.url).searchParams.has('access_token'), false);
    assert.equal(new URL(call.url).searchParams.has('client_secret'), false);
  }
});

test('Facebook provider timeout covers a response body that never completes', async () => {
  const previousTimeout = process.env.OAUTH_PROVIDER_TIMEOUT_MS;
  process.env.OAUTH_PROVIDER_TIMEOUT_MS = '1000';
  const state = 'facebook-hanging-body-state';
  installState(stateRecord('FACEBOOK', state));
  fetchImplementation = async (_url, init) => ({
    ok: true,
    json: () => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    })
  });
  try {
    const started = Date.now();
    await assert.rejects(
      completeOAuth('FACEBOOK', 'authorization-code', state, BROWSER_SECRET),
      (error: any) => error instanceof OAuthError && error.code === 'OAUTH_PROVIDER_TIMEOUT'
    );
    assert.ok(Date.now() - started < 2_500);
  } finally {
    if (previousTimeout === undefined) delete process.env.OAUTH_PROVIDER_TIMEOUT_MS;
    else process.env.OAUTH_PROVIDER_TIMEOUT_MS = previousTimeout;
  }
});

test('Facebook identity never treats its unverified profile email as the canonical account address', async () => {
  const state = 'facebook-no-email-state';
  installState(stateRecord('FACEBOOK', state));
  const calls: Array<{ url: string; init: any }> = [];
  fetchImplementation = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/oauth/access_token')) return { ok: true, json: async () => ({ access_token: 'provider-token-fixture' }) };
    if (url.endsWith('/debug_token')) return { ok: true, json: async () => ({ data: { is_valid: true, app_id: 'facebook-app-fixture', user_id: 'facebook-user' } }) };
    return { ok: true, json: async () => ({ id: 'facebook-user', name: 'Facebook User', email: 'unverified@example.test' }) };
  };
  prisma.oAuthAccount.findFirst = async () => null;
  prisma.user.findFirst = async () => null;
  prisma.user.findUnique = async () => null;
  let createdUserData: any;
  let createdOAuthData: any;
  prisma.$transaction = async (callback: any) => callback({
    user: { create: async ({ data }: any) => { createdUserData = data; return { id: 'new-user', status: 'ACTIVE', ...data }; } },
    oAuthAccount: { create: async ({ data }: any) => { createdOAuthData = data; return {}; } },
    notificationSettings: { create: async () => ({}) }
  });
  const result = await completeOAuth('FACEBOOK', 'authorization-code', state, BROWSER_SECRET);
  assert.equal(result.user.id, 'new-user');
  assert.equal(createdUserData.email, null);
  assert.equal(createdUserData.emailVerifiedAt, null);
  assert.equal(createdOAuthData.emailSnapshot, 'unverified@example.test');
  const profileCall = calls[2];
  assert.equal(profileCall.url.includes('provider-token-fixture'), false);
  assert.match(profileCall.init.headers.authorization, /^Bearer /);
});

test('explicit linking rejects a provider identity already linked to another user', async () => {
  const state = 'link-conflict-state';
  installState(stateRecord('GOOGLE', state, { mode: 'LINK', linkingUserId: 'current-user' }));
  OAuth2Client.prototype.getToken = async () => ({ tokens: { id_token: 'id-token-fixture' } } as any);
  OAuth2Client.prototype.verifyIdToken = async () => ({ getPayload: () => ({ sub: 'google-user', nonce: 'nonce-fixture', email: 'private@example.test', email_verified: true }) } as any);
  prisma.oAuthAccount.findFirst = async ({ where }: any) => where.providerAccountId ? { userId: 'another-user', providerAccountId: 'google-user' } : null;
  await assert.rejects(completeOAuth('GOOGLE', 'authorization-code', state, BROWSER_SECRET, 'current-user'), (error: any) => error.code === 'OAUTH_ACCOUNT_CONFLICT');
});

test('OAuth state is rejected when the browser-binding cookie is missing or belongs to another browser', async () => {
  const state = 'browser-bound-state';
  let providerCalls = 0;
  OAuth2Client.prototype.getToken = async () => { providerCalls += 1; return { tokens: { id_token: 'id-token' } } as any; };
  installState(stateRecord('GOOGLE', state));
  await assert.rejects(
    completeOAuth('GOOGLE', 'authorization-code', state, ''),
    (error: any) => error instanceof OAuthError && error.code === 'OAUTH_STATE_INVALID'
  );
  await assert.rejects(
    completeOAuth('GOOGLE', 'authorization-code', state, 'another-browser-secret-at-least-32-bytes'),
    (error: any) => error instanceof OAuthError && error.code === 'OAUTH_STATE_INVALID'
  );
  assert.equal(providerCalls, 0);
});

test('OAuth LINK rejects a missing or mismatched live callback session before provider exchange', async () => {
  let providerCalls = 0;
  OAuth2Client.prototype.getToken = async () => { providerCalls += 1; return { tokens: { id_token: 'id-token' } } as any; };
  for (const [index, callbackUserId] of [undefined, 'different-user'].entries()) {
    const state = `link-session-state-${index}`;
    installState(stateRecord('GOOGLE', state, { mode: 'LINK', linkingUserId: 'current-user' }));
    await assert.rejects(
      completeOAuth('GOOGLE', 'authorization-code', state, BROWSER_SECRET, callbackUserId),
      (error: any) => error instanceof OAuthError && error.code === 'OAUTH_LINK_SESSION_INVALID'
    );
  }
  assert.equal(providerCalls, 0);
});
