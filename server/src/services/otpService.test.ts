import assert from 'node:assert/strict';
import test from 'node:test';

process.env.OTP_HASH_SECRET = process.env.OTP_HASH_SECRET || 'otp-test-secret-at-least-32-bytes-long';
process.env.OTP_CODE_PEPPER = process.env.OTP_CODE_PEPPER || 'independent-otp-code-pepper-at-least-32-bytes';
process.env.OTP_BCRYPT_ROUNDS = '8';

const prisma = require('../prisma').default as any;
const emailService = require('./emailService') as typeof import('./emailService');
const { consumeEmailOtp, issueEmailOtp, OtpError } = require('./otpService') as typeof import('./otpService');

type Challenge = any;

const installOtpStore = () => {
  const rows: Challenge[] = [];
  const budgets = new Map<string, number>();
  let sequence = 0;
  const originals = {
    findFirst: prisma.otpChallenge.findFirst,
    updateMany: prisma.otpChallenge.updateMany,
    create: prisma.otpChallenge.create,
    transaction: prisma.$transaction,
    budgetUpsert: prisma.authRateLimit.upsert,
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
      if (orderBy?.intentVersion === 'desc') return b.intentVersion - a.intentVersion;
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
  const budgetUpsert = async ({ where, create, update }: any) => {
    const current = budgets.get(where.keyHash) || 0;
    const next = current ? current + Number(update.count.increment || 0) : create.count;
    budgets.set(where.keyHash, next);
    return { count: next };
  };
  prisma.authRateLimit.upsert = budgetUpsert;
  prisma.$transaction = async (callback: any) => {
    const snapshot = rows.map((row) => ({ ...row }));
    try {
      return await callback({
        $executeRaw: async () => [{ pg_advisory_xact_lock: null }],
        otpChallenge: { findFirst, findUnique, updateMany, create },
        authRateLimit: { upsert: budgetUpsert }
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
    prisma.authRateLimit.upsert = originals.budgetUpsert;
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
    assert.equal(row.hashVersion, 2);
    assert.equal(row.intentVersion, 1);
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

test('OTP v2 is destination-bound and legacy hash material cannot verify it', async () => {
  const store = installOtpStore();
  let code = '';
  try {
    (emailService as any).sendAuthEmail = async (input: any) => { code = input.code; return { messageId: 'email-v2' }; };
    await issueEmailOtp({ destination: 'private@example.test', purpose: 'PASSWORD_RESET', subject: 'user-v2' });
    const bcrypt = require('bcryptjs') as typeof import('bcryptjs');
    assert.equal(await bcrypt.compare(`PASSWORD_RESET:user-v2:${code}`, store.rows[0].codeHash), false);
    await assert.rejects(consumeEmailOtp({ destination: 'other@example.test', purpose: 'PASSWORD_RESET', subject: 'user-v2', code }));
    await consumeEmailOtp({ destination: 'private@example.test', purpose: 'PASSWORD_RESET', subject: 'user-v2', code });
  } finally { store.restore(); }
});

test('latest email-change intent supersedes older destinations and binds the source mailbox', async () => {
  const store = installOtpStore();
  const codes: string[] = [];
  try {
    (emailService as any).sendAuthEmail = async (input: any) => { codes.push(input.code); return { messageId: `email-intent-${codes.length}` }; };
    const common = { purpose: 'EMAIL_CHANGE' as const, subject: 'user-intent', sourceDestination: 'current@example.test', supersedeBySubjectPurpose: true };
    await issueEmailOtp({ ...common, destination: 'first@example.test' });
    await issueEmailOtp({ ...common, destination: 'second@example.test' });
    assert.equal(store.rows[0].deliveryStatus, 'FAILED');
    assert.ok(store.rows[0].invalidatedAt instanceof Date);
    assert.equal(store.rows[1].intentVersion, 2);
    assert.equal(store.rows[1].sourceDestinationHash?.length, 64);
    await assert.rejects(consumeEmailOtp({ destination: 'first@example.test', purpose: 'EMAIL_CHANGE', subject: 'user-intent', code: codes[0], requireLatestIntent: true }));
    await consumeEmailOtp({ destination: 'second@example.test', purpose: 'EMAIL_CHANGE', subject: 'user-intent', code: codes[1], requireLatestIntent: true });
  } finally { store.restore(); }
});

test('OTP issuance budgets normalize destination across purposes and pending subjects', async () => {
  const store = installOtpStore();
  try {
    process.env.OTP_DESTINATION_HOURLY_LIMIT = '2';
    process.env.OTP_DESTINATION_DAILY_LIMIT = '10';
    (emailService as any).sendAuthEmail = async () => ({ messageId: 'email-budget' });
    await issueEmailOtp({ destination: 'Private@Example.Test ', purpose: 'REGISTRATION', subject: 'pending-a' });
    await issueEmailOtp({ destination: 'private@example.test', purpose: 'PASSWORD_RESET', subject: 'user-a' });
    await assert.rejects(
      issueEmailOtp({ destination: 'PRIVATE@example.test', purpose: 'REGISTRATION', subject: 'pending-b' }),
      (error: any) => error instanceof OtpError && error.code === 'OTP_RATE_LIMITED'
    );
    assert.equal(store.rows.length, 2);
  } finally {
    delete process.env.OTP_DESTINATION_HOURLY_LIMIT;
    delete process.env.OTP_DESTINATION_DAILY_LIMIT;
    store.restore();
  }
});

test('concurrent shared-destination issuance cannot exceed the durable budget', async () => {
  const store = installOtpStore();
  try {
    process.env.OTP_DESTINATION_HOURLY_LIMIT = '1';
    (emailService as any).sendAuthEmail = async () => ({ messageId: 'email-budget-race' });
    const results = await Promise.allSettled([
      issueEmailOtp({ destination: 'same@example.test', purpose: 'REGISTRATION', subject: 'pending-a' }),
      issueEmailOtp({ destination: 'SAME@example.test', purpose: 'REGISTRATION', subject: 'pending-b' })
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected' && (result.reason as any).code === 'OTP_RATE_LIMITED').length, 1);
  } finally { delete process.env.OTP_DESTINATION_HOURLY_LIMIT; store.restore(); }
});

test('OTP issuance fails closed when the durable budget store is unavailable', async () => {
  const store = installOtpStore();
  let sent = false;
  try {
    prisma.$transaction = async () => { throw new Error('database unavailable'); };
    (emailService as any).sendAuthEmail = async () => { sent = true; return { messageId: 'unexpected' }; };
    await assert.rejects(issueEmailOtp({ destination: 'private@example.test', purpose: 'REGISTRATION', subject: 'pending-db' }), /database unavailable/);
    assert.equal(sent, false);
  } finally { store.restore(); }
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
