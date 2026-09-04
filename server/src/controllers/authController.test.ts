import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'auth-controller-test-secret';

const prisma = require('../prisma').default as typeof import('../prisma').default;
const bcrypt = require('bcryptjs') as typeof import('bcryptjs');
const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
const { login } = require('./authController') as typeof import('./authController');
const { JWT_SECRET, requireAuth } = require('../middleware/authMiddleware') as typeof import('../middleware/authMiddleware');
const { requestContext } = require('../middleware/requestContext') as typeof import('../middleware/requestContext');

const createResponse = () => {
  const state: { statusCode: number; body: any } = { statusCode: 200, body: undefined };
  const response: any = {
    status(code: number) { state.statusCode = code; return response; },
    json(body: any) { state.body = body; return response; },
    setHeader() { return response; }
  };
  return { response, state };
};

test('JWT middleware assigns an active req.user without overwriting client body/query fields', async () => {
  const originalFindUnique = prisma.user.findUnique;
  const token = jwt.sign({ userId: 'trusted-user' }, JWT_SECRET);
  const request: any = {
    headers: { authorization: `Bearer ${token}` },
    body: { userId: 'client-body-user' },
    query: { userId: 'client-query-user' },
    requestId: 'request-auth-middleware-test'
  };
  const { response, state } = createResponse();
  let nextCalls = 0;

  try {
    (prisma.user as any).findUnique = async () => ({ status: 'ACTIVE' });
    await requireAuth(request, response, () => { nextCalls += 1; });

    assert.equal(state.statusCode, 200);
    assert.equal(nextCalls, 1);
    assert.deepEqual(request.user, { userId: 'trusted-user' });
    assert.equal(request.body.userId, 'client-body-user');
    assert.equal(request.query.userId, 'client-query-user');
  } finally {
    (prisma.user as any).findUnique = originalFindUnique;
  }
});

test('JWT middleware rejects suspended and deleted accounts before controllers run', async () => {
  const originalFindUnique = prisma.user.findUnique;
  const token = jwt.sign({ userId: 'inactive-user' }, JWT_SECRET);
  try {
    for (const status of ['SUSPENDED', 'DELETED']) {
      (prisma.user as any).findUnique = async () => ({ status });
      const { response, state } = createResponse();
      let nextCalls = 0;
      await requireAuth({
        headers: { authorization: `Bearer ${token}` },
        requestId: `inactive-${status.toLowerCase()}`
      } as any, response, () => { nextCalls += 1; });
      assert.equal(state.statusCode, 401);
      assert.equal(state.body.code, 'AUTH_ACCOUNT_INACTIVE');
      assert.equal(nextCalls, 0);
    }
  } finally {
    (prisma.user as any).findUnique = originalFindUnique;
  }
});

test('request context preserves a safe correlation ID and replaces an unsafe one', () => {
  const run = (incoming: string | undefined) => {
    const request: any = { header: () => incoming };
    let responseHeader: string | undefined;
    const response: any = { setHeader: (_name: string, value: string) => { responseHeader = value; } };
    let nextCalls = 0;
    requestContext(request, response, () => { nextCalls += 1; });
    return { requestId: request.requestId as string, responseHeader, nextCalls };
  };

  const safe = run('client-request-123');
  assert.deepEqual(safe, {
    requestId: 'client-request-123',
    responseHeader: 'client-request-123',
    nextCalls: 1
  });

  const unsafe = run('bad id\nwith-control');
  assert.match(unsafe.requestId, /^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
  assert.equal(unsafe.responseHeader, unsafe.requestId);
  assert.equal(unsafe.nextCalls, 1);
});

test('login serializes private DOB as date-only and derives ageGroup from it', async () => {
  const originals = {
    userFindFirst: prisma.user.findFirst,
    demographicsFindUnique: prisma.userDemographics.findUnique,
    compare: bcrypt.compare
  };
  const birthday = new Date('1990-09-01T00:00:00.000Z');
  try {
    (prisma.user as any).findFirst = async () => ({
      id: 'profile-1',
      name: 'Profile User',
      handle: 'profile_user',
      email: 'private@example.com',
      password: null,
      passwordHash: 'stored-password-hash',
      authProvider: 'Email',
      avatar: null,
      avatarMediaId: null,
      avatarMedia: null,
      birthday,
      followersCount: 2,
      followingCount: 3
    });
    (prisma.userDemographics as any).findUnique = async () => ({ gender: 'Female', ageGroup: '18-24' });
    (bcrypt as any).compare = async () => true;

    const { response, state } = createResponse();
    await login({
      body: { identifier: 'private@example.com', password: 'ValidPassword1!' },
      requestId: 'request-login-test'
    } as any, response);

    assert.equal(state.statusCode, 200);
    assert.equal(state.body.birthday, '1990-09-01');
    assert.notEqual(state.body.demographics.ageGroup, '18-24');
    assert.equal(Object.prototype.hasOwnProperty.call(state.body, 'password'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(state.body, 'passwordHash'), false);
    assert.equal(typeof state.body.token, 'string');
  } finally {
    (prisma.user as any).findFirst = originals.userFindFirst;
    (prisma.userDemographics as any).findUnique = originals.demographicsFindUnique;
    (bcrypt as any).compare = originals.compare;
  }
});
