import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'otp-controller-test-secret';

const prisma = require('../prisma').default as typeof import('../prisma').default;
const otpService = require('../services/otpService') as typeof import('../services/otpService');
const { sendOTP, verifyOTP } = require('./otpController') as typeof import('./otpController');

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

test('generic email OTP keeps the main success contract while delegating to secure Resend delivery', async () => {
  const originalIssue = otpService.issueEmailOtp;
  const originalFindUnique = prisma.user.findUnique;
  let issueInput: any;
  try {
    (prisma.user as any).findUnique = async () => ({ id: 'user-1', email: 'Private@Example.Test' });
    (otpService as any).issueEmailOtp = async (input: any) => {
      issueInput = input;
      return { cooldownUntil: new Date('2026-09-05T12:01:00.000Z') };
    };
    const { response, state } = createResponse();
    await sendOTP({ user: { userId: 'user-1' }, body: { identifier: 'Private@Example.Test', type: 'email' } } as any, response);

    assert.equal(state.statusCode, 200);
    assert.deepEqual(issueInput, {
      destination: 'private@example.test',
      purpose: 'EMAIL_VERIFICATION',
      subject: 'user-1'
    });
    assert.equal(state.body.message, 'OTP sent to Private@Example.Test');
    assert.equal(state.body.cooldownUntil, '2026-09-05T12:01:00.000Z');
    assert.equal(Object.prototype.hasOwnProperty.call(state.body, 'devCode'), false);
  } finally {
    (otpService as any).issueEmailOtp = originalIssue;
    (prisma.user as any).findUnique = originalFindUnique;
  }
});

test('generic email OTP exposes cooldown metadata without exposing a code', async () => {
  const originalIssue = otpService.issueEmailOtp;
  const originalFindUnique = prisma.user.findUnique;
  try {
    (prisma.user as any).findUnique = async () => ({ id: 'user-1', email: 'private@example.test' });
    (otpService as any).issueEmailOtp = async () => {
      throw new otpService.OtpError('OTP_COOLDOWN', 'Please wait before requesting another code', {
        cooldownUntil: '2026-09-05T12:01:00.000Z',
        retryAfterSeconds: 42
      });
    };
    const { response, state } = createResponse();
    await sendOTP({ user: { userId: 'user-1' }, body: { identifier: 'private@example.test', type: 'email' } } as any, response);

    assert.equal(state.statusCode, 429);
    assert.equal(state.headers['retry-after'], '42');
    assert.equal(state.body.code, 'OTP_COOLDOWN');
    assert.equal(Object.prototype.hasOwnProperty.call(state.body, 'devCode'), false);
  } finally {
    (otpService as any).issueEmailOtp = originalIssue;
    (prisma.user as any).findUnique = originalFindUnique;
  }
});

test('phone OTP fails closed without generating, delivering, or consuming a code', async () => {
  const originalIssue = otpService.issueEmailOtp;
  const originalConsume = otpService.consumeEmailOtp;
  let serviceCalls = 0;
  try {
    (otpService as any).issueEmailOtp = async () => { serviceCalls += 1; };
    (otpService as any).consumeEmailOtp = async () => { serviceCalls += 1; };

    const sendResult = createResponse();
    await sendOTP({ body: { identifier: '+962700000000', type: 'phone' } } as any, sendResult.response);
    assert.equal(sendResult.state.statusCode, 503);
    assert.equal(sendResult.state.body.code, 'OTP_CHANNEL_UNAVAILABLE');

    const verifyResult = createResponse();
    await verifyOTP({ body: { identifier: '+962700000000', code: '123456' } } as any, verifyResult.response);
    assert.equal(verifyResult.state.statusCode, 503);
    assert.equal(verifyResult.state.body.code, 'OTP_CHANNEL_UNAVAILABLE');
    assert.equal(serviceCalls, 0);
  } finally {
    (otpService as any).issueEmailOtp = originalIssue;
    (otpService as any).consumeEmailOtp = originalConsume;
  }
});

test('generic email OTP verification consumes once and preserves the main success response', async () => {
  const originalConsume = otpService.consumeEmailOtp;
  const originalFindUnique = prisma.user.findUnique;
  let consumeInput: any;
  let updated: any;
  try {
    (prisma.user as any).findUnique = async () => ({ id: 'user-1', email: 'Private@Example.Test' });
    (otpService as any).consumeEmailOtp = async (input: any, onConsume: (tx: any) => Promise<void>) => {
      consumeInput = input;
      await onConsume({
        user: {
          updateMany: async (args: any) => { updated = args; return { count: 1 }; }
        }
      });
      return { challengeId: 'challenge-1' };
    };
    const { response, state } = createResponse();
    await verifyOTP({ user: { userId: 'user-1' }, body: { identifier: 'Private@Example.Test', code: '654321' } } as any, response);

    assert.equal(state.statusCode, 200);
    assert.deepEqual(consumeInput, {
      destination: 'private@example.test',
      purpose: 'EMAIL_VERIFICATION',
      subject: 'user-1',
      code: '654321'
    });
    assert.deepEqual(updated.where, { id: 'user-1', email: 'Private@Example.Test' });
    assert.ok(updated.data.emailVerifiedAt instanceof Date);
    assert.equal(Object.prototype.hasOwnProperty.call(updated.data, 'verifiedBadge'), false);
    assert.deepEqual(state.body, { success: true, message: 'OTP verified successfully' });
  } finally {
    (otpService as any).consumeEmailOtp = originalConsume;
    (prisma.user as any).findUnique = originalFindUnique;
  }
});

test('invalid generic email OTP keeps the main 400 response class', async () => {
  const originalConsume = otpService.consumeEmailOtp;
  const originalFindUnique = prisma.user.findUnique;
  try {
    (prisma.user as any).findUnique = async () => ({ id: 'user-1', email: 'private@example.test' });
    (otpService as any).consumeEmailOtp = async () => {
      throw new otpService.OtpError('OTP_INVALID', 'Invalid or expired code');
    };
    const { response, state } = createResponse();
    await verifyOTP({ user: { userId: 'user-1' }, body: { identifier: 'private@example.test', code: '000000' } } as any, response);
    assert.equal(state.statusCode, 400);
    assert.equal(state.body.error, 'Invalid OTP code');
    assert.equal(state.body.code, 'OTP_INVALID');
  } finally {
    (otpService as any).consumeEmailOtp = originalConsume;
    (prisma.user as any).findUnique = originalFindUnique;
  }
});

test('generic email OTP rejects a destination not owned by the authenticated user before delivery', async () => {
  const originalIssue = otpService.issueEmailOtp;
  const originalFindUnique = prisma.user.findUnique;
  let issueCalls = 0;
  try {
    (prisma.user as any).findUnique = async () => ({ id: 'user-1', email: 'owner@example.test' });
    (otpService as any).issueEmailOtp = async () => { issueCalls += 1; };
    const { response, state } = createResponse();
    await sendOTP({ user: { userId: 'user-1' }, body: { identifier: 'victim@example.test', type: 'email' } } as any, response);
    assert.equal(state.statusCode, 403);
    assert.equal(state.body.code, 'OTP_IDENTIFIER_MISMATCH');
    assert.equal(issueCalls, 0);
  } finally {
    (otpService as any).issueEmailOtp = originalIssue;
    (prisma.user as any).findUnique = originalFindUnique;
  }
});
