import assert from 'node:assert/strict';
import test from 'node:test';

process.env.OTP_HASH_SECRET = process.env.OTP_HASH_SECRET || 'otp-test-secret-at-least-32-bytes-long';
process.env.OTP_BCRYPT_ROUNDS = '8';

const prisma = require('../prisma').default as any;
const emailService = require('./emailService') as typeof import('./emailService');
const { consumeEmailOtp, issueEmailOtp, OtpError } = require('./otpService') as typeof import('./otpService');

type Challenge = any;

const installOtpStore = () => {
  const rows: Challenge[] = [];
  let sequence = 0;
  const originals = {
    findFirst: prisma.otpChallenge.findFirst,
    updateMany: prisma.otpChallenge.updateMany,
    create: prisma.otpChallenge.create,
    transaction: prisma.$transaction,
    sendAuthEmail: emailService.sendAuthEmail
  };
  const matches = (row: Challenge, where: any): boolean => {
    for (const [key, expected] of Object.entries(where || {})) {
      const actual = row[key];
      if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
        if ('gt' in expected && !(actual > (expected as any).gt)) return false;
        if ('gte' in expected && !(actual >= (expected as any).gte)) return false;
        if ('not' in expected && actual === (expected as any).not) return false;
        if ('in' in expected && !(expected as any).in.includes(actual)) return false;
      } else if (actual !== expected) return false;
    }
    return true;
  };
  const findFirst = async ({ where, orderBy, select }: any) => {
    const found = rows.filter((row) => matches(row, where)).sort((a, b) => {
      if (orderBy?.version === 'desc') return b.version - a.version;
      if (orderBy?.createdAt === 'desc') return b.createdAt.getTime() - a.createdAt.getTime();
      return 0;
    })[0];
    if (!found) return null;
    if (!select) return { ...found };
    return Object.fromEntries(Object.keys(select).map((key) => [key, found[key]]));
  };
  const updateMany = async ({ where, data }: any) => {
    let count = 0;
    for (const row of rows) {
      if (!matches(row, where)) continue;
      for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === 'object' && 'increment' in (value as any)) row[key] += (value as any).increment;
        else row[key] = value;
      }
      count += 1;
    }
    return { count };
  };
  const create = async ({ data }: any) => {
    const row = { id: `challenge-${++sequence}`, createdAt: new Date(Date.now() + sequence), updatedAt: new Date(), consumedAt: null, invalidatedAt: null, ...data };
    rows.push(row);
    return { ...row };
  };
  const findUnique = async ({ where }: any) => {
    const found = rows.find((row) => row.id === where.id);
    return found ? { ...found } : null;
  };
  prisma.otpChallenge.findFirst = findFirst;
  prisma.otpChallenge.updateMany = updateMany;
  prisma.otpChallenge.create = create;
  prisma.$transaction = async (callback: any) => {
    const snapshot = rows.map((row) => ({ ...row }));
    try {
      return await callback({
        $queryRaw: async () => [{ pg_advisory_xact_lock: null }],
        otpChallenge: { findFirst, findUnique, updateMany, create }
      });
    } catch (error) {
      rows.splice(0, rows.length, ...snapshot);
      throw error;
    }
  };
  const restore = () => {
    prisma.otpChallenge.findFirst = originals.findFirst;
    prisma.otpChallenge.updateMany = originals.updateMany;
    prisma.otpChallenge.create = originals.create;
    prisma.$transaction = originals.transaction;
    (emailService as any).sendAuthEmail = originals.sendAuthEmail;
  };
  return { rows, restore };
};

test('OTP issuance stores only a hash, sends configurable TTL and records SENT state', async () => {
  const store = installOtpStore();
  let email: any;
  try {
    process.env.OTP_TTL_SECONDS = '420';
    (emailService as any).sendAuthEmail = async (input: any) => { email = input; return { messageId: 'email-1' }; };
    const issued = await issueEmailOtp({ destination: 'Private@Example.Test ', purpose: 'REGISTRATION', subject: 'pending-1', requestIp: '127.0.0.1', userAgent: 'fixture' });
    assert.equal(store.rows.length, 1);
    const row = store.rows[0];
    assert.equal(row.destination, 'private@example.test');
    assert.match(row.codeHash, /^\$2[aby]\$/);
    assert.equal(/^\d{6}$/.test(row.codeHash), false);
    assert.equal(row.deliveryStatus, 'SENT');
    assert.equal(email.expiresInMinutes, 7);
    assert.equal(email.code.length, 6);
    assert.equal(email.idempotencyKey, 'otp-challenge-1-v1');
    assert.ok(issued.cooldownUntil > new Date());
    assert.notEqual(row.ipHash, '127.0.0.1');
    assert.notEqual(row.userAgentHash, 'fixture');
  } finally { delete process.env.OTP_TTL_SECONDS; store.restore(); }
});

test('OTP purpose/subject binding rejects replay in another flow', async () => {
  const store = installOtpStore();
  let code = '';
  try {
    (emailService as any).sendAuthEmail = async (input: any) => { code = input.code; return { messageId: 'email-2' }; };
    await issueEmailOtp({ destination: 'private@example.test', purpose: 'REGISTRATION', subject: 'pending-1' });
    await assert.rejects(
      consumeEmailOtp({ destination: 'private@example.test', purpose: 'PASSWORD_RESET', subject: 'user-1', code }),
      (error: any) => error instanceof OtpError && error.code === 'OTP_INVALID'
    );
    assert.equal(store.rows[0].consumedAt, null);
  } finally { store.restore(); }
});

test('wrong OTP increments attempts and invalidates exactly at max attempts', async () => {
  const store = installOtpStore();
  try {
    process.env.OTP_MAX_ATTEMPTS = '3';
    (emailService as any).sendAuthEmail = async () => ({ messageId: 'email-3' });
    await issueEmailOtp({ destination: 'private@example.test', purpose: 'EMAIL_VERIFICATION', subject: 'user-1' });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await assert.rejects(consumeEmailOtp({ destination: 'private@example.test', purpose: 'EMAIL_VERIFICATION', subject: 'user-1', code: '000000' }));
      assert.equal(store.rows[0].attempts, attempt);
    }
    assert.equal(store.rows[0].deliveryStatus, 'FAILED');
    assert.ok(store.rows[0].invalidatedAt instanceof Date);
  } finally { delete process.env.OTP_MAX_ATTEMPTS; store.restore(); }
});

test('expired OTP and malformed codes fail without consumption', async () => {
  const store = installOtpStore();
  let code = '';
  try {
    (emailService as any).sendAuthEmail = async (input: any) => { code = input.code; return { messageId: 'email-4' }; };
    await issueEmailOtp({ destination: 'private@example.test', purpose: 'PASSWORD_RESET', subject: 'user-1' });
    store.rows[0].expiresAt = new Date(Date.now() - 1);
    await assert.rejects(consumeEmailOtp({ destination: 'private@example.test', purpose: 'PASSWORD_RESET', subject: 'user-1', code }));
    await assert.rejects(consumeEmailOtp({ destination: 'private@example.test', purpose: 'PASSWORD_RESET', subject: 'user-1', code: '12x' }));
    assert.equal(store.rows[0].consumedAt, null);
  } finally { store.restore(); }
});

test('a delivered OTP is single-use even under concurrent verification', async () => {
  const store = installOtpStore();
  let code = '';
  try {
    (emailService as any).sendAuthEmail = async (input: any) => { code = input.code; return { messageId: 'email-5' }; };
    await issueEmailOtp({ destination: 'private@example.test', purpose: 'EMAIL_CHANGE', subject: 'user-1' });
    const results = await Promise.allSettled([
      consumeEmailOtp({ destination: 'private@example.test', purpose: 'EMAIL_CHANGE', subject: 'user-1', code }),
      consumeEmailOtp({ destination: 'private@example.test', purpose: 'EMAIL_CHANGE', subject: 'user-1', code })
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    assert.ok(store.rows[0].consumedAt instanceof Date);
  } finally { store.restore(); }
});

test('OTP consumption rolls back when the protected business mutation fails', async () => {
  const store = installOtpStore();
  let code = '';
  try {
    (emailService as any).sendAuthEmail = async (input: any) => { code = input.code; return { messageId: 'email-rollback' }; };
    await issueEmailOtp({ destination: 'private@example.test', purpose: 'PASSWORD_RESET', subject: 'user-rollback' });
    await assert.rejects(
      consumeEmailOtp(
        { destination: 'private@example.test', purpose: 'PASSWORD_RESET', subject: 'user-rollback', code },
        async () => { throw new Error('injected mutation failure'); }
      ),
      /injected mutation failure/
    );
    assert.equal(store.rows[0].consumedAt, null);
    await consumeEmailOtp(
      { destination: 'private@example.test', purpose: 'PASSWORD_RESET', subject: 'user-rollback', code },
      async () => 'mutation-completed'
    );
    assert.ok(store.rows[0].consumedAt instanceof Date);
  } finally { store.restore(); }
});

test('resend invalidates the previous challenge and delivery failure leaves no usable OTP', async () => {
  const store = installOtpStore();
  let calls = 0;
  try {
    (emailService as any).sendAuthEmail = async () => {
      calls += 1;
      if (calls === 2) throw new Error('provider unavailable');
      return { messageId: 'email-6' };
    };
    await issueEmailOtp({ destination: 'private@example.test', purpose: 'REGISTRATION', subject: 'pending-1' });
    store.rows[0].cooldownUntil = new Date(Date.now() - 1);
    await assert.rejects(
      issueEmailOtp({ destination: 'private@example.test', purpose: 'REGISTRATION', subject: 'pending-1' }),
      (error: any) => error instanceof OtpError && error.code === 'OTP_DELIVERY_FAILED'
    );
    assert.equal(store.rows.length, 2);
    assert.ok(store.rows[0].invalidatedAt instanceof Date);
    assert.equal(store.rows[0].deliveryStatus, 'FAILED');
    assert.ok(store.rows[1].invalidatedAt instanceof Date);
    assert.equal(store.rows[1].deliveryStatus, 'FAILED');
  } finally { store.restore(); }
});

test('cooldown rejects rapid resend without generating or emailing another code', async () => {
  const store = installOtpStore();
  let deliveryCalls = 0;
  try {
    (emailService as any).sendAuthEmail = async () => { deliveryCalls += 1; return { messageId: 'email-7' }; };
    await issueEmailOtp({ destination: 'private@example.test', purpose: 'REGISTRATION', subject: 'pending-1' });
    await assert.rejects(
      issueEmailOtp({ destination: 'private@example.test', purpose: 'REGISTRATION', subject: 'pending-1' }),
      (error: any) => error instanceof OtpError && error.code === 'OTP_COOLDOWN'
    );
    assert.equal(store.rows.length, 1);
    assert.equal(deliveryCalls, 1);
  } finally { store.restore(); }
});

test('concurrent issuance is serialized to one challenge and one delivery', async () => {
  const store = installOtpStore();
  let deliveryCalls = 0;
  try {
    (emailService as any).sendAuthEmail = async () => {
      deliveryCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { messageId: 'email-concurrent' };
    };
    const results = await Promise.allSettled([
      issueEmailOtp({ destination: 'private@example.test', purpose: 'REGISTRATION', subject: 'pending-concurrent' }),
      issueEmailOtp({ destination: 'private@example.test', purpose: 'REGISTRATION', subject: 'pending-concurrent' })
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected' && (result.reason as any).code === 'OTP_COOLDOWN').length, 1);
    assert.equal(store.rows.length, 1);
    assert.equal(deliveryCalls, 1);
  } finally { store.restore(); }
});

test('parallel invalid verifications each count atomically until the challenge locks', async () => {
  const store = installOtpStore();
  try {
    process.env.OTP_MAX_ATTEMPTS = '3';
    (emailService as any).sendAuthEmail = async () => ({ messageId: 'email-parallel-invalid' });
    await issueEmailOtp({ destination: 'private@example.test', purpose: 'PASSWORD_RESET', subject: 'user-parallel' });
    const results = await Promise.allSettled([
      consumeEmailOtp({ destination: 'private@example.test', purpose: 'PASSWORD_RESET', subject: 'user-parallel', code: '000000' }),
      consumeEmailOtp({ destination: 'private@example.test', purpose: 'PASSWORD_RESET', subject: 'user-parallel', code: '000000' }),
      consumeEmailOtp({ destination: 'private@example.test', purpose: 'PASSWORD_RESET', subject: 'user-parallel', code: '000000' })
    ]);
    assert.equal(results.every((result) => result.status === 'rejected'), true);
    assert.equal(store.rows[0].attempts, 3);
    assert.equal(store.rows[0].deliveryStatus, 'FAILED');
    assert.ok(store.rows[0].invalidatedAt instanceof Date);
    assert.equal(store.rows[0].version, 1, 'verification must not mutate issuance version');
  } finally { delete process.env.OTP_MAX_ATTEMPTS; store.restore(); }
});
