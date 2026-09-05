import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'auth-controller-test-secret';

const prisma = require('../prisma').default as typeof import('../prisma').default;
const bcrypt = require('bcryptjs') as typeof import('bcryptjs');
const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
const otpService = require('../services/otpService') as typeof import('../services/otpService');
const {
  hashRegistrationSecret,
  parsePendingRegistrationReference,
  verifyRegistrationSecret
} = require('../services/registrationCapability') as typeof import('../services/registrationCapability');
const {
  completeRegistration,
  initiateRegistration,
  login,
  sendRegistrationOTP,
  setRegistrationPassword
} = require('./authController') as typeof import('./authController');
const { JWT_SECRET, requireAuth } = require('../middleware/authMiddleware') as typeof import('../middleware/authMiddleware');
const { requestContext } = require('../middleware/requestContext') as typeof import('../middleware/requestContext');
const registrationSecret = 'A'.repeat(43);
const registrationSecretHash = hashRegistrationSecret(registrationSecret);
const registrationReference = `pending-1.${registrationSecret}`;

const createResponse = () => {
  const state: { statusCode: number; body: any; headers: Record<string, string> } = {
    statusCode: 200,
    body: undefined,
    headers: {}
  };
  const response: any = {
    status(code: number) { state.statusCode = code; return response; },
    json(body: any) { state.body = body; return response; },
    setHeader(name: string, value: string) { state.headers[name.toLowerCase()] = value; return response; }
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

test('registration initiation returns one opaque capability and persists only its hash while clearing stale state', async () => {
  const originals = {
    userFindFirst: prisma.user.findFirst,
    pendingUpsert: prisma.pendingRegistration.upsert
  };
  let upsertInput: any;
  try {
    (prisma.user as any).findFirst = async () => null;
    (prisma.pendingRegistration as any).upsert = async (input: any) => {
      upsertInput = input;
      return { id: 'pending-init' };
    };

    const { response, state } = createResponse();
    await initiateRegistration({
      body: {
        fullName: '  Capability User  ',
        email: 'Capability@Example.Test',
        dob: '2000-09-02'
      }
    } as any, response);

    assert.equal(state.statusCode, 200);
    assert.equal(state.headers['cache-control'], 'private, no-store');
    assert.deepEqual(Object.keys(state.body).sort(), ['pendingId', 'success']);
    assert.equal(state.body.success, true);

    const reference = parsePendingRegistrationReference(state.body.pendingId);
    assert.ok(reference);
    assert.equal(reference.id, 'pending-init');
    assert.match(upsertInput.update.registrationSecretHash, /^[0-9a-f]{64}$/);
    assert.equal(verifyRegistrationSecret(upsertInput.update.registrationSecretHash, reference.secret), true);
    assert.equal(upsertInput.create.registrationSecretHash, upsertInput.update.registrationSecretHash);
    assert.equal(Object.prototype.hasOwnProperty.call(upsertInput.update, 'registrationSecret'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(upsertInput.create, 'registrationSecret'), false);
    assert.equal(upsertInput.update.password, null);
    assert.equal(upsertInput.update.handle, null);
    assert.equal(upsertInput.update.otpCode, null);
    assert.equal(upsertInput.update.otpExpiresAt, null);
  } finally {
    (prisma.user as any).findFirst = originals.userFindFirst;
    (prisma.pendingRegistration as any).upsert = originals.pendingUpsert;
  }
});

test('registration OTP delegates to the secure service and preserves the main response contract', async () => {
  const originals = {
    pendingFindUnique: prisma.pendingRegistration.findUnique,
    pendingUpdate: prisma.pendingRegistration.update,
    issueEmailOtp: otpService.issueEmailOtp
  };
  let issueInput: any;
  try {
    (prisma.pendingRegistration as any).findUnique = async () => ({
      id: 'pending-1',
      email: 'Private@Example.Test',
      currentStep: 4,
      registrationSecretHash
    });
    (prisma.pendingRegistration as any).update = async () => ({ id: 'pending-1' });
    (otpService as any).issueEmailOtp = async (input: any) => {
      issueInput = input;
      return { cooldownUntil: new Date('2026-09-05T12:01:00.000Z') };
    };
    const { response, state } = createResponse();
    await sendRegistrationOTP({ body: { pendingId: registrationReference } } as any, response);
    assert.equal(state.statusCode, 200);
    assert.equal(issueInput.destination, 'Private@Example.Test');
    assert.equal(issueInput.purpose, 'REGISTRATION');
    assert.equal(issueInput.subject, 'pending-1');
    assert.equal(typeof issueInput.onSent, 'function');
    assert.equal(state.body.success, true);
    assert.equal(state.body.cooldownUntil, '2026-09-05T12:01:00.000Z');
    assert.equal(Object.prototype.hasOwnProperty.call(state.body, 'devCode'), false);
  } finally {
    (prisma.pendingRegistration as any).findUnique = originals.pendingFindUnique;
    (prisma.pendingRegistration as any).update = originals.pendingUpdate;
    (otpService as any).issueEmailOtp = originals.issueEmailOtp;
  }
});

test('registration completion accepts the main frontend code field and returns the existing JWT contract', async () => {
  const originals = {
    pendingFindUnique: prisma.pendingRegistration.findUnique,
    consumeEmailOtp: otpService.consumeEmailOtp
  };
  let consumeInput: any;
  let createdUserData: any;
  const birthday = new Date('2000-09-02T00:00:00.000Z');
  try {
    (prisma.pendingRegistration as any).findUnique = async () => ({
      id: 'pending-1',
      email: 'private@example.test',
      fullName: 'OTP User',
      dob: birthday,
      password: 'stored-hash',
      handle: 'otp_user',
      currentStep: 5,
      registrationSecretHash
    });
    (otpService as any).consumeEmailOtp = async (input: any, onConsume: (tx: any) => Promise<any>) => {
      consumeInput = input;
      const user = {
        id: 'user-1',
        name: 'OTP User',
        handle: 'otp_user',
        avatar: null,
        avatarMediaId: null,
        avatarMedia: null,
        coverMediaId: null,
        coverMedia: null,
        country: null,
        bio: null,
        location: null,
        website: null,
        language: 'en',
        isPrivate: false,
        verifiedBadge: false,
        followersCount: 0,
        followingCount: 0,
        birthday,
        demographics: { ageGroup: '25-34' },
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const value = await onConsume({
        user: {
          create: async ({ data }: any) => {
            createdUserData = data;
            return user;
          }
        },
        notificationSettings: { create: async () => ({}) },
        pendingRegistration: { delete: async () => ({}) }
      });
      return {
        challengeId: 'challenge-1',
        value
      };
    };
    const { response, state } = createResponse();
    await completeRegistration({ body: { pendingId: registrationReference, code: '654321' } } as any, response);
    assert.equal(state.statusCode, 200);
    assert.equal(consumeInput.code, '654321');
    assert.equal(consumeInput.purpose, 'REGISTRATION');
    assert.ok(createdUserData.emailVerifiedAt instanceof Date);
    assert.equal(state.body.user.id, 'user-1');
    assert.equal(typeof state.body.token, 'string');
  } finally {
    (prisma.pendingRegistration as any).findUnique = originals.pendingFindUnique;
    (otpService as any).consumeEmailOtp = originals.consumeEmailOtp;
  }
});

test('registration OTP rejects a guessed pendingId without its high-entropy capability', async () => {
  const originalFindUnique = prisma.pendingRegistration.findUnique;
  const originalIssue = otpService.issueEmailOtp;
  let issueCalls = 0;
  try {
    (prisma.pendingRegistration as any).findUnique = async () => ({
      id: 'pending-guarded',
      email: 'private@example.test',
      currentStep: 4,
      registrationSecretHash
    });
    (otpService as any).issueEmailOtp = async () => { issueCalls += 1; };
    const { response, state } = createResponse();
    await sendRegistrationOTP({
      body: { pendingId: `pending-guarded.${'B'.repeat(43)}` }
    } as any, response);
    assert.equal(state.statusCode, 404);
    assert.equal(issueCalls, 0);
  } finally {
    (prisma.pendingRegistration as any).findUnique = originalFindUnique;
    (otpService as any).issueEmailOtp = originalIssue;
  }
});

test('registration detail mutation requires the capability and is locked after OTP issuance', async () => {
  const originals = {
    pendingFindUnique: prisma.pendingRegistration.findUnique,
    pendingUpdate: prisma.pendingRegistration.update,
    hash: bcrypt.hash
  };
  let updates = 0;
  let hashes = 0;
  try {
    (prisma.pendingRegistration as any).update = async () => { updates += 1; };
    (bcrypt as any).hash = async () => { hashes += 1; return 'hash'; };

    (prisma.pendingRegistration as any).findUnique = async () => ({
      id: 'pending-guarded',
      currentStep: 3,
      registrationSecretHash
    });
    const wrong = createResponse();
    await setRegistrationPassword({
      body: { pendingId: `pending-guarded.${'B'.repeat(43)}`, password: 'StrongPass1!' }
    } as any, wrong.response);
    assert.equal(wrong.state.statusCode, 404);

    (prisma.pendingRegistration as any).findUnique = async () => ({
      id: 'pending-guarded',
      currentStep: 5,
      registrationSecretHash
    });
    const locked = createResponse();
    await setRegistrationPassword({
      body: { pendingId: `pending-guarded.${registrationSecret}`, password: 'StrongPass1!' }
    } as any, locked.response);
    assert.equal(locked.state.statusCode, 409);
    assert.equal(updates, 0);
    assert.equal(hashes, 0);
  } finally {
    (prisma.pendingRegistration as any).findUnique = originals.pendingFindUnique;
    (prisma.pendingRegistration as any).update = originals.pendingUpdate;
    (bcrypt as any).hash = originals.hash;
  }
});
