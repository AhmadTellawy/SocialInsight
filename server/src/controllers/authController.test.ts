import assert from 'node:assert/strict';
import test from 'node:test';
import type {} from '../middleware/authMiddleware';
import type {} from '../middleware/requestContext';

process.env.AUTH_SESSION_HASH_SECRET = process.env.AUTH_SESSION_HASH_SECRET || 'controller-test-secret-at-least-32-bytes';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'legacy-controller-test-secret-at-least-32-bytes';

const prisma = require('../prisma').default as any;
const bcrypt = require('bcryptjs') as typeof import('bcryptjs');
const otpService = require('../services/otpService') as typeof import('../services/otpService');
const sessionService = require('../services/sessionService') as typeof import('../services/sessionService');
const oauthService = require('../services/oauthService') as typeof import('../services/oauthService');
const authMiddleware = require('../middleware/authMiddleware') as typeof import('../middleware/authMiddleware');
const {
  completeRegistration, confirmEmailChange, confirmEmailVerification, confirmPasswordReset,
  initiateRegistration, login, logout, requestEmailChange, requestEmailVerification, requestPasswordReset, setRegistrationPassword, startOAuth
} = require('./authController') as typeof import('./authController');

const PENDING_ID = '00000000-0000-4000-8000-000000000001';
const baseUser = (overrides: any = {}) => ({
  id: 'user-1', name: 'Private User', handle: 'private_user', email: 'private@example.test',
  emailVerifiedAt: new Date(), avatar: null, avatarMediaId: null, avatarMedia: null,
  country: null, bio: null, location: null, website: null, language: 'en', isPrivate: false,
  verifiedBadge: false, followersCount: 2, followingCount: 3, birthday: new Date('1990-09-01T00:00:00.000Z'),
  demographics: { ageGroup: '25-34' }, status: 'ACTIVE', password: null, passwordHash: 'stored-hash',
  createdAt: new Date(), updatedAt: new Date(), ...overrides
});

const createResponse = () => {
  const state: { statusCode: number; body: any; headers: Record<string, any>; sent?: any; redirect?: string } = { statusCode: 200, body: undefined, headers: {} };
  const response: any = {
    status(code: number) { state.statusCode = code; return response; },
    json(body: any) { state.body = body; return response; },
    send(body?: any) { state.sent = body; return response; },
    setHeader(name: string, value: any) { state.headers[name.toLowerCase()] = value; return response; },
    getHeader(name: string) { return state.headers[name.toLowerCase()]; },
    redirect(code: number, value: string) { state.statusCode = code; state.redirect = value; return response; }
  };
  return { response, state };
};

const originals = {
  userFindFirst: prisma.user.findFirst,
  userFindUnique: prisma.user.findUnique,
  userUpdate: prisma.user.update,
  pendingFindUnique: prisma.pendingRegistration.findUnique,
  pendingCreate: prisma.pendingRegistration.create,
  pendingUpdateMany: prisma.pendingRegistration.updateMany,
  transaction: prisma.$transaction,
  demographicsFindUnique: prisma.userDemographics.findUnique,
  bcryptCompare: bcrypt.compare,
  bcryptHash: bcrypt.hash,
  issueOtp: otpService.issueEmailOtp,
  consumeOtp: otpService.consumeEmailOtp,
  createSession: sessionService.createSession,
  revokeSession: sessionService.revokeSession,
  beginOAuth: oauthService.beginOAuth
};

test.afterEach(() => {
  prisma.user.findFirst = originals.userFindFirst;
  prisma.user.findUnique = originals.userFindUnique;
  prisma.user.update = originals.userUpdate;
  prisma.pendingRegistration.findUnique = originals.pendingFindUnique;
  prisma.pendingRegistration.create = originals.pendingCreate;
  prisma.pendingRegistration.updateMany = originals.pendingUpdateMany;
  prisma.$transaction = originals.transaction;
  prisma.userDemographics.findUnique = originals.demographicsFindUnique;
  (bcrypt as any).compare = originals.bcryptCompare;
  (bcrypt as any).hash = originals.bcryptHash;
  (otpService as any).issueEmailOtp = originals.issueOtp;
  (otpService as any).consumeEmailOtp = originals.consumeOtp;
  (sessionService as any).createSession = originals.createSession;
  (sessionService as any).revokeSession = originals.revokeSession;
  (oauthService as any).beginOAuth = originals.beginOAuth;
});

test('complete registration rejects missing/malformed OTP before database work', async () => {
  let reads = 0;
  prisma.pendingRegistration.findUnique = async () => { reads += 1; return null; };
  for (const body of [
    { pendingId: PENDING_ID },
    { pendingId: PENDING_ID, otp: '123' },
    { pendingId: PENDING_ID, otp: '12345x' },
    { pendingId: PENDING_ID, otp: '123456', code: '654321' }
  ]) {
    const { response, state } = createResponse();
    await completeRegistration({ body, requestId: 'registration-invalid' } as any, response);
    assert.equal(state.statusCode, 400);
  }
  assert.equal(reads, 0);
});

test('registration completion consumes a purpose-bound OTP, verifies email and starts an opaque session', async () => {
  const browserSecret = 'completion-browser-secret-at-least-thirty-two-characters';
  const pending = { id: PENDING_ID, email: 'private@example.test', fullName: 'Private User', dob: new Date('1990-09-01'), password: 'stored-password-hash', handle: 'private_user', currentStep: 5, browserSecretHash: sessionService.hashSessionSecret(`registration:${browserSecret}`) };
  prisma.pendingRegistration.findUnique = async () => pending;
  let consumed: any;
  (otpService as any).consumeEmailOtp = async (input: any, onConsume: any) => {
    consumed = input;
    return { challengeId: 'challenge-1', value: await prisma.$transaction(onConsume) };
  };
  let createdData: any;
  prisma.$transaction = async (callback: any) => callback({
    user: { create: async ({ data }: any) => { createdData = data; return baseUser(data); } },
    notificationSettings: { create: async () => ({}) },
    pendingRegistration: { delete: async () => ({}) }
  });
  (sessionService as any).createSession = async (_userId: string, res: any) => {
    res.setHeader('Set-Cookie', ['si_session=opaque; HttpOnly; Secure', 'si_csrf=csrf-new; Secure']);
    return { sessionId: 'session-1', csrfToken: 'csrf-new' };
  };
  const { response, state } = createResponse();
  await completeRegistration({ body: { pendingId: PENDING_ID, otp: '123456' }, headers: { cookie: `si_registration_browser=${browserSecret}` }, requestId: 'registration-complete' } as any, response);
  assert.equal(state.statusCode, 201);
  assert.deepEqual(consumed, { destination: pending.email, purpose: 'REGISTRATION', subject: PENDING_ID, code: '123456' });
  assert.ok(createdData.emailVerifiedAt instanceof Date);
  assert.equal(state.body.csrfToken, 'csrf-new');
  assert.equal(Object.prototype.hasOwnProperty.call(state.body, 'token'), false);
  assert.equal(JSON.stringify(state.body).includes('stored-password-hash'), false);
});

test('login returns one generic error for unknown, wrong-password and inactive accounts', async () => {
  const candidates = [null, baseUser(), baseUser({ status: 'SUSPENDED' })];
  const compares = [false, false, true];
  for (let index = 0; index < candidates.length; index += 1) {
    prisma.user.findFirst = async () => candidates[index];
    (bcrypt as any).compare = async () => compares[index];
    const { response, state } = createResponse();
    await login({ body: { identifier: 'private@example.test', password: 'WrongPassword1!' }, requestId: `login-${index}` } as any, response);
    assert.equal(state.statusCode, 401);
    assert.deepEqual(state.body, { error: 'Invalid login credentials', code: 'INVALID_CREDENTIALS' });
  }
});

test('successful login returns safe user data, CSRF and cookies but no bearer token', async () => {
  prisma.user.findFirst = async () => baseUser();
  prisma.userDemographics.findUnique = async () => ({ ageGroup: '18-24' });
  (bcrypt as any).compare = async () => true;
  (sessionService as any).createSession = async (_userId: string, res: any) => {
    res.setHeader('Set-Cookie', ['si_session=opaque; HttpOnly', 'si_csrf=csrf-login']);
    return { sessionId: 'session-1', csrfToken: 'csrf-login' };
  };
  const { response, state } = createResponse();
  await login({ body: { identifier: 'private@example.test', password: 'ValidPassword1!' }, requestId: 'login-success' } as any, response);
  assert.equal(state.statusCode, 200);
  assert.equal(state.body.user.birthday, '1990-09-01');
  assert.equal(state.body.csrfToken, 'csrf-login');
  assert.equal(Object.prototype.hasOwnProperty.call(state.body, 'token'), false);
  assert.equal(JSON.stringify(state.body).includes('stored-hash'), false);
  assert.equal(state.headers['cache-control'], 'no-store');
});

test('legacy bearer rollout is opt-in, short-lived and does not require cookie CSRF', async () => {
  const originalFlag = process.env.AUTH_LEGACY_BEARER_COMPAT;
  const originalTtl = process.env.AUTH_LEGACY_BEARER_TTL_SECONDS;
  try {
    process.env.AUTH_LEGACY_BEARER_COMPAT = 'true';
    process.env.AUTH_LEGACY_BEARER_TTL_SECONDS = '900';
    const token = authMiddleware.createLegacyBearerToken('legacy-user');
    assert.equal(typeof token, 'string');
    prisma.user.findUnique = async () => ({ status: 'ACTIVE', passwordUpdatedAt: null });
    const request: any = { method: 'POST', headers: { authorization: `Bearer ${token}` } };
    const { response, state } = createResponse();
    let nextCalls = 0;
    await authMiddleware.requireAuth(request, response, () => { nextCalls += 1; });
    assert.equal(nextCalls, 1);
    assert.equal(state.statusCode, 200);
    assert.deepEqual(request.user, { userId: 'legacy-user', authMode: 'legacy_bearer' });
    assert.equal(request.authSession, undefined);

    prisma.user.findUnique = async () => ({ status: 'ACTIVE', passwordUpdatedAt: null, authInvalidatedAt: new Date(Date.now() + 1_000) });
    const invalidatedRequest: any = { method: 'GET', headers: { authorization: `Bearer ${token}` } };
    const invalidated = createResponse();
    let invalidatedNextCalls = 0;
    await authMiddleware.requireAuth(invalidatedRequest, invalidated.response, () => { invalidatedNextCalls += 1; });
    assert.equal(invalidated.state.statusCode, 401);
    assert.equal(invalidatedNextCalls, 0);
  } finally {
    if (originalFlag === undefined) delete process.env.AUTH_LEGACY_BEARER_COMPAT; else process.env.AUTH_LEGACY_BEARER_COMPAT = originalFlag;
    if (originalTtl === undefined) delete process.env.AUTH_LEGACY_BEARER_TTL_SECONDS; else process.env.AUTH_LEGACY_BEARER_TTL_SECONDS = originalTtl;
  }
});

test('OAuth start binds state to a browser-only HttpOnly SameSite=Lax cookie', async () => {
  (oauthService as any).beginOAuth = async () => ({
    authorizationUrl: 'https://accounts.example.test/authorize?state=public-state',
    browserSecret: 'private-browser-secret-at-least-32-bytes',
    maxAgeSeconds: 600
  });
  const { response, state } = createResponse();
  await startOAuth({ params: { provider: 'google' }, requestId: 'oauth-start' } as any, response);
  assert.equal(state.statusCode, 200);
  assert.equal(state.body.authorizationUrl.includes('public-state'), true);
  assert.equal(JSON.stringify(state.body).includes('private-browser-secret'), false);
  const cookie = state.headers['set-cookie'][0];
  assert.match(cookie, /^si_oauth_browser=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\/api\/auth\/oauth/);
});

test('registration attempts for the same email get distinct browser-bound capabilities', async () => {
  const creates: any[] = [];
  prisma.pendingRegistration.create = async ({ data }: any) => {
    creates.push(data);
    return { id: `00000000-0000-4000-8000-00000000000${creates.length}` };
  };
  const request: any = { body: { fullName: 'Private User', email: 'same@example.test', dob: '1990-09-01' }, headers: {} };
  const first = createResponse();
  const second = createResponse();
  await initiateRegistration(request, first.response);
  await initiateRegistration(request, second.response);
  assert.equal(first.state.statusCode, 201);
  assert.equal(second.state.statusCode, 201);
  assert.notEqual(first.state.body.pendingId, second.state.body.pendingId);
  assert.notEqual(creates[0].browserSecretHash, creates[1].browserSecretHash);
  const registrationCookie = first.state.headers['set-cookie'][0];
  assert.match(registrationCookie, /^si_registration_browser=/);
  assert.match(registrationCookie, /HttpOnly/);
});

test('registration password update rejects a pendingId without its browser secret', async () => {
  const browserSecret = 'browser-secret-with-at-least-thirty-two-characters';
  prisma.pendingRegistration.findUnique = async () => ({
    id: PENDING_ID,
    currentStep: 2,
    browserSecretHash: sessionService.hashSessionSecret(`registration:${browserSecret}`)
  });
  let updates = 0;
  prisma.pendingRegistration.updateMany = async () => { updates += 1; return { count: 1 }; };
  (bcrypt as any).hash = async () => 'password-hash';

  const missing = createResponse();
  await setRegistrationPassword({ body: { pendingId: PENDING_ID, password: 'StrongPass1!' }, headers: {} } as any, missing.response);
  assert.equal(missing.state.statusCode, 400);
  assert.equal(missing.state.body.code, 'REGISTRATION_SESSION_INVALID');
  assert.equal(updates, 0);

  const bound = createResponse();
  await setRegistrationPassword({
    body: { pendingId: PENDING_ID, password: 'StrongPass1!' },
    headers: { cookie: `si_registration_browser=${browserSecret}` }
  } as any, bound.response);
  assert.equal(bound.state.statusCode, 200);
  assert.equal(updates, 1);
});

test('password reset request is non-enumerating for existing and absent accounts', async () => {
  let issued = 0;
  (otpService as any).issueEmailOtp = async () => { issued += 1; return { cooldownUntil: new Date() }; };
  (bcrypt as any).hash = async () => 'dummy-hash';
  for (const candidate of [baseUser(), null]) {
    prisma.user.findFirst = async () => candidate;
    const { response, state } = createResponse();
    await requestPasswordReset({ body: { email: 'private@example.test' }, ip: '127.0.0.1', header: () => undefined, requestId: 'reset-request' } as any, response);
    assert.equal(state.statusCode, 202);
    assert.equal(state.body.message, 'If the account is eligible, a verification code will be sent');
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(issued, 1);
});

test('password reset consumes bound OTP, updates hash and revokes all sessions atomically', async () => {
  prisma.user.findFirst = async () => ({ id: 'user-1', status: 'ACTIVE' });
  let consumed: any;
  (otpService as any).consumeEmailOtp = async (input: any, onConsume: any) => {
    consumed = input;
    return { challengeId: 'challenge-reset', value: await prisma.$transaction(onConsume) };
  };
  (bcrypt as any).hash = async () => 'new-password-hash';
  const operations: any[] = [];
  prisma.$transaction = async (callback: any) => callback({
    user: { update: async (input: any) => { operations.push(['user', input]); return {}; } },
    authSession: { updateMany: async (input: any) => { operations.push(['sessions', input]); return { count: 2 }; } }
  });
  const { response, state } = createResponse();
  await confirmPasswordReset({ body: { email: 'private@example.test', code: '123456', password: 'NewPassword1!' }, requestId: 'reset-confirm' } as any, response);
  assert.equal(state.statusCode, 200);
  assert.deepEqual(consumed, { destination: 'private@example.test', purpose: 'PASSWORD_RESET', subject: 'user-1', code: '123456' });
  assert.equal(operations[0][1].data.passwordHash, 'new-password-hash');
  assert.deepEqual(operations[1][1].where, { userId: 'user-1', revokedAt: null });
  assert.ok(operations[1][1].data.revokedAt instanceof Date);
});

test('email verification request/confirm uses current account destination and correct purpose', async () => {
  prisma.user.findUnique = async () => ({ email: 'private@example.test', emailVerifiedAt: null });
  let issued: any;
  let consumed: any;
  let update: any;
  (otpService as any).issueEmailOtp = async (input: any) => { issued = input; return { cooldownUntil: new Date() }; };
  (otpService as any).consumeEmailOtp = async (input: any, onConsume: any) => {
    consumed = input;
    return { challengeId: 'challenge-verify', value: await prisma.$transaction(onConsume) };
  };
  prisma.$transaction = async (callback: any) => callback({ user: { update: async (input: any) => { update = input; return {}; } } });
  const req: any = { user: { userId: 'user-1' }, body: {}, ip: '127.0.0.1', header: () => undefined, requestId: 'verify-email' };
  const sent = createResponse();
  await requestEmailVerification(req, sent.response);
  assert.equal(sent.state.statusCode, 202);
  assert.equal(issued.purpose, 'EMAIL_VERIFICATION');
  assert.equal(issued.subject, 'user-1');
  const confirmed = createResponse();
  req.body = { code: '123456' };
  await confirmEmailVerification(req, confirmed.response);
  assert.equal(confirmed.state.statusCode, 200);
  assert.equal(consumed.destination, 'private@example.test');
  assert.equal(consumed.purpose, 'EMAIL_VERIFICATION');
  assert.ok(update.data.emailVerifiedAt instanceof Date);
});

test('email change confirmation revokes old sessions then issues a fresh session and CSRF', async () => {
  let consumed: any;
  (otpService as any).consumeEmailOtp = async (input: any, onConsume: any) => {
    consumed = input;
    return { challengeId: 'challenge-change', value: await prisma.$transaction(onConsume) };
  };
  const operations: any[] = [];
  prisma.$transaction = async (callback: any) => callback({
    user: { update: async (input: any) => { operations.push(['user', input]); return {}; } },
    authSession: { updateMany: async (input: any) => { operations.push(['sessions', input]); return { count: 3 }; } }
  });
  (sessionService as any).createSession = async (userId: string, res: any) => {
    operations.push(['new-session', userId]);
    res.setHeader('Set-Cookie', ['si_session=new-opaque; HttpOnly', 'si_csrf=new-csrf']);
    return { sessionId: 'session-new', csrfToken: 'new-csrf' };
  };
  const { response, state } = createResponse();
  await confirmEmailChange({ user: { userId: 'user-1' }, body: { email: 'new@example.test', code: '123456' }, requestId: 'email-change' } as any, response);
  assert.equal(state.statusCode, 200);
  assert.deepEqual(consumed, { destination: 'new@example.test', purpose: 'EMAIL_CHANGE', subject: 'user-1', code: '123456' });
  assert.deepEqual(operations.map(([name]) => name), ['user', 'sessions', 'new-session']);
  assert.deepEqual(operations[1][1].where, { userId: 'user-1', revokedAt: null });
  assert.equal(state.body.csrfToken, 'new-csrf');
  assert.equal(state.body.email, 'new@example.test');
});

test('email change request does not disclose whether another account owns the destination', async () => {
  let issued = 0;
  (otpService as any).issueEmailOtp = async () => { issued += 1; return { cooldownUntil: new Date() }; };
  const { response, state } = createResponse();
  await requestEmailChange({ user: { userId: 'user-1' }, body: { email: 'taken@example.test' }, ip: '127.0.0.1', header: () => undefined, requestId: 'email-change-request' } as any, response);
  assert.equal(state.statusCode, 202);
  assert.equal(state.body.success, true);
  assert.equal(issued, 1);
});

test('logout revokes the active server session and clears both cookies', async () => {
  let revoked = '';
  (sessionService as any).revokeSession = async (id: string) => { revoked = id; };
  const { response, state } = createResponse();
  await logout({ authSession: { id: 'session-current' }, requestId: 'logout' } as any, response);
  assert.equal(state.statusCode, 204);
  assert.equal(revoked, 'session-current');
  assert.equal(state.headers['set-cookie'].length, 2);
  assert.ok(state.headers['set-cookie'].every((cookie: string) => cookie.includes('Max-Age=0')));
});

test('legacy bearer logout invalidates every previously issued compatibility token', async () => {
  let update: any;
  prisma.user.update = async (input: any) => { update = input; return {}; };
  const { response, state } = createResponse();
  await logout({ user: { userId: 'legacy-user', authMode: 'legacy_bearer' }, requestId: 'legacy-logout' } as any, response);
  assert.equal(state.statusCode, 204);
  assert.equal(update.where.id, 'legacy-user');
  assert.ok(update.data.authInvalidatedAt instanceof Date);
});
