import assert from 'node:assert/strict';
import test from 'node:test';

process.env.AUTH_SESSION_HASH_SECRET = process.env.AUTH_SESSION_HASH_SECRET || 'session-test-secret-at-least-32-bytes';
process.env.AUTH_COOKIE_SECURE = 'true';
process.env.AUTH_COOKIE_SAME_SITE = 'none';

const prisma = require('../prisma').default as any;
const {
  createSession, resolveSession, revokeSession, revokeAllUserSessions,
  csrfMatchesSession, hashSessionSecret, SESSION_COOKIE_NAME, CSRF_COOKIE_NAME, clearSessionCookies
} = require('./sessionService') as typeof import('./sessionService');

test('createSession persists only hashes and emits hardened cross-site cookies', async () => {
  const originalCreate = prisma.authSession.create;
  let persisted: any;
  let setCookies: string[] = [];
  try {
    prisma.authSession.create = async ({ data }: any) => { persisted = data; return { id: 'session-1' }; };
    const res: any = { setHeader: (name: string, value: string[]) => { if (name === 'Set-Cookie') setCookies = value; } };
    const result = await createSession('user-1', res);
    assert.equal(persisted.userId, 'user-1');
    assert.equal(persisted.tokenHash.length, 64);
    assert.equal(persisted.csrfHash.length, 64);
    assert.equal(JSON.stringify(persisted).includes(result.csrfToken), false);
    assert.equal(setCookies.length, 2);
    const sessionCookie = setCookies.find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`))!;
    const csrfCookie = setCookies.find((value) => value.startsWith(`${CSRF_COOKIE_NAME}=`))!;
    assert.match(sessionCookie, /HttpOnly/);
    assert.match(sessionCookie, /Secure/);
    assert.match(sessionCookie, /SameSite=None/);
    assert.doesNotMatch(csrfCookie, /HttpOnly/);
    assert.match(csrfCookie, /Secure/);
    assert.equal(sessionCookie.includes(persisted.tokenHash), false);
  } finally { prisma.authSession.create = originalCreate; }
});

test('resolveSession accepts an active cookie but rejects revoked, expired and inactive sessions', async () => {
  const originalFind = prisma.authSession.findUnique;
  const originalUpdate = prisma.authSession.updateMany;
  const token = 'a'.repeat(43);
  const request: any = { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } };
  try {
    prisma.authSession.updateMany = async () => ({ count: 1 });
    const base = { id: 'session-1', userId: 'user-1', csrfHash: hashSessionSecret('csrf'), expiresAt: new Date(Date.now() + 60_000), revokedAt: null, lastUsedAt: new Date(), user: { status: 'ACTIVE' } };
    prisma.authSession.findUnique = async ({ where }: any) => {
      assert.equal(where.tokenHash, hashSessionSecret(token));
      return base;
    };
    assert.equal((await resolveSession(request))?.userId, 'user-1');
    for (const candidate of [
      { ...base, revokedAt: new Date() },
      { ...base, expiresAt: new Date(Date.now() - 1) },
      { ...base, user: { status: 'SUSPENDED' } },
      { ...base, user: { status: 'DELETED' } }
    ]) {
      prisma.authSession.findUnique = async () => candidate;
      assert.equal(await resolveSession(request), null);
    }
  } finally {
    prisma.authSession.findUnique = originalFind;
    prisma.authSession.updateMany = originalUpdate;
  }
});

test('CSRF comparison is bound to the authenticated session hash', () => {
  const token = 'csrf-token-fixture';
  const session: any = { csrfHash: hashSessionSecret(token) };
  assert.equal(csrfMatchesSession(session, token), true);
  assert.equal(csrfMatchesSession(session, 'different-token'), false);
});

test('single-session and all-session revocation target only non-revoked records', async () => {
  const originalUpdate = prisma.authSession.updateMany;
  const calls: any[] = [];
  try {
    prisma.authSession.updateMany = async (input: any) => { calls.push(input); return { count: 1 }; };
    await revokeSession('session-1');
    await revokeAllUserSessions('user-1');
    assert.deepEqual(calls[0].where, { id: 'session-1', revokedAt: null });
    assert.deepEqual(calls[1].where, { userId: 'user-1', revokedAt: null });
    assert.ok(calls[0].data.revokedAt instanceof Date);
    assert.ok(calls[1].data.revokedAt instanceof Date);
  } finally { prisma.authSession.updateMany = originalUpdate; }
});

test('clearSessionCookies expires both session and CSRF cookies', () => {
  let cookies: string[] = [];
  clearSessionCookies({ setHeader: (_name: string, value: string[]) => { cookies = value; } } as any);
  assert.equal(cookies.length, 2);
  for (const cookie of cookies) assert.match(cookie, /Max-Age=0/);
});
