import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'otp-test-secret-at-least-32-bytes-long';
process.env.OTP_BCRYPT_ROUNDS = '8';

const prisma = require('../prisma').default as any;
const emailService = require('./emailService') as typeof import('./emailService');
const { consumeEmailOtp, issueEmailOtp, OtpError } = require('./otpService') as typeof import('./otpService');

const installOtpStore = () => {
  const rows: any[] = [];
  let sequence = 0;
  let reserved = false;
  const originals = {
    findFirst: prisma.otpChallenge.findFirst,
    count: prisma.otpChallenge.count,
    updateMany: prisma.otpChallenge.updateMany,
    create: prisma.otpChallenge.create,
    transaction: prisma.$transaction,
    sendAuthEmail: emailService.sendAuthEmail
  };
  const matches = (row: any, where: any): boolean => Object.entries(where || {}).every(([key, expected]: [string, any]) => {
    const actual = row[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('gt' in expected && !(actual > expected.gt)) return false;
      if ('gte' in expected && !(actual >= expected.gte)) return false;
      if ('not' in expected && actual === expected.not) return false;
      if ('in' in expected && !expected.in.includes(actual)) return false;
      return true;
    }
    return actual === expected;
  });
  const findFirst = async ({ where, orderBy, select }: any) => {
    const found = rows.filter((row) => matches(row, where)).sort((a, b) => {
      if (orderBy?.version === 'desc') return b.version - a.version;
      if (orderBy?.createdAt === 'asc') return a.createdAt.getTime() - b.createdAt.getTime();
      return 0;
    })[0];
    if (!found) return null;
    return select ? Object.fromEntries(Object.keys(select).map((key) => [key, found[key]])) : { ...found };
  };
  const count = async ({ where }: any) => rows.filter((row) => matches(row, where)).length;
  const updateMany = async ({ where, data }: any) => {
    let count = 0;
    for (const row of rows) {
      if (!matches(row, where)) continue;
      Object.assign(row, data);
      count += 1;
    }
    return { count };
  };
  const create = async ({ data }: any) => {
    const row = { id: `challenge-${++sequence}`, createdAt: new Date(), updatedAt: new Date(), consumedAt: null, invalidatedAt: null, ...data };
    rows.push(row);
    return { ...row };
  };
  const findUnique = async ({ where }: any) => {
    const found = rows.find((row) => row.id === where.id);
    return found ? { ...found } : null;
  };
  prisma.otpChallenge.findFirst = findFirst;
  prisma.otpChallenge.count = count;
  prisma.otpChallenge.updateMany = updateMany;
  prisma.otpChallenge.create = create;
  prisma.$transaction = async (callback: any) => {
    const snapshot = rows.map((row) => ({ ...row }));
    const reservedSnapshot = reserved;
    try {
      return await callback({ $executeRaw: async (query: any) => {
        if (!query.sql.includes('INSERT INTO "staging_otp_email_reservation"')) return 1;
        if (reserved) return 0;
        reserved = true;
        return 1;
      }, otpChallenge: { findFirst, findUnique, count, updateMany, create } });
    } catch (error) {
      rows.splice(0, rows.length, ...snapshot);
      reserved = reservedSnapshot;
      throw error;
    }
  };
  return {
    rows,
    restore() {
      prisma.otpChallenge.findFirst = originals.findFirst;
      prisma.otpChallenge.count = originals.count;
      prisma.otpChallenge.updateMany = originals.updateMany;
      prisma.otpChallenge.create = originals.create;
      prisma.$transaction = originals.transaction;
      (emailService as any).sendAuthEmail = originals.sendAuthEmail;
    }
  };
};

test('issuance stores no destination or raw OTP, and marks the mocked delivery SENT', async () => {
  const store = installOtpStore();
  let email: any;
  try {
    process.env.OTP_TTL_SECONDS = '420';
    (emailService as any).sendAuthEmail = async (input: any) => { email = input; return { messageId: 'email-1' }; };
    const issued = await issueEmailOtp({ destination: 'Private@Example.Test ', purpose: 'REGISTRATION', subject: 'pending-1' });
    const row = store.rows[0];
    assert.equal(row.destination, undefined);
    assert.match(row.destinationHash, /^[a-f0-9]{64}$/);
    assert.match(row.codeHash, /^\$2[aby]\$/);
    assert.equal(row.codeHash.includes(email.code), false);
    assert.equal(row.deliveryStatus, 'SENT');
    assert.equal(email.expiresInMinutes, 7);
    assert.equal(email.idempotencyKey, 'otp-challenge-1-v1');
    assert.ok(issued.cooldownUntil > new Date());
  } finally { delete process.env.OTP_TTL_SECONDS; store.restore(); }
});

test('purpose and subject are cryptographically bound to the OTP', async () => {
  const store = installOtpStore();
  let code = '';
  try {
    (emailService as any).sendAuthEmail = async (input: any) => { code = input.code; return { messageId: 'email-2' }; };
    await issueEmailOtp({ destination: 'private@example.test', purpose: 'REGISTRATION', subject: 'pending-1' });
    await assert.rejects(
      consumeEmailOtp({ destination: 'private@example.test', purpose: 'EMAIL_VERIFICATION', subject: 'user-1', code }),
      (error: any) => error instanceof OtpError && error.code === 'OTP_INVALID'
    );
    assert.equal(store.rows[0].consumedAt, null);
  } finally { store.restore(); }
});

test('wrong codes increment attempts and invalidate exactly at the configured maximum', async () => {
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

test('expired and malformed codes fail without consumption', async () => {
  const store = installOtpStore();
  let code = '';
  try {
    (emailService as any).sendAuthEmail = async (input: any) => { code = input.code; return { messageId: 'email-4' }; };
    await issueEmailOtp({ destination: 'private@example.test', purpose: 'REGISTRATION', subject: 'pending-1' });
    store.rows[0].expiresAt = new Date(Date.now() - 1);
    await assert.rejects(consumeEmailOtp({ destination: 'private@example.test', purpose: 'REGISTRATION', subject: 'pending-1', code }));
    await assert.rejects(consumeEmailOtp({ destination: 'private@example.test', purpose: 'REGISTRATION', subject: 'pending-1', code: '12x' }));
    assert.equal(store.rows[0].consumedAt, null);
  } finally { store.restore(); }
});

test('a delivered OTP is single-use under concurrent verification', async () => {
  const store = installOtpStore();
  let code = '';
  try {
    (emailService as any).sendAuthEmail = async (input: any) => { code = input.code; return { messageId: 'email-5' }; };
    await issueEmailOtp({ destination: 'private@example.test', purpose: 'EMAIL_VERIFICATION', subject: 'user-1' });
    const results = await Promise.allSettled([
      consumeEmailOtp({ destination: 'private@example.test', purpose: 'EMAIL_VERIFICATION', subject: 'user-1', code }),
      consumeEmailOtp({ destination: 'private@example.test', purpose: 'EMAIL_VERIFICATION', subject: 'user-1', code })
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  } finally { store.restore(); }
});

test('consumption rolls back when the protected business mutation fails', async () => {
  const store = installOtpStore();
  let code = '';
  try {
    (emailService as any).sendAuthEmail = async (input: any) => { code = input.code; return { messageId: 'email-rollback' }; };
    await issueEmailOtp({ destination: 'private@example.test', purpose: 'REGISTRATION', subject: 'pending-rollback' });
    await assert.rejects(
      consumeEmailOtp(
        { destination: 'private@example.test', purpose: 'REGISTRATION', subject: 'pending-rollback', code },
        async () => { throw new Error('injected mutation failure'); }
      ),
      /injected mutation failure/
    );
    assert.equal(store.rows[0].consumedAt, null);
  } finally { store.restore(); }
});

test('resend invalidates the previous challenge and a failed delivery leaves neither usable', async () => {
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
    assert.equal(store.rows.every((row) => row.deliveryStatus === 'FAILED' && row.invalidatedAt instanceof Date), true);
  } finally { store.restore(); }
});

test('successful resend invalidates the previous code and only the new code can be consumed', async () => {
  const store = installOtpStore();
  const codes: string[] = [];
  try {
    (emailService as any).sendAuthEmail = async (input: any) => {
      codes.push(input.code);
      return { messageId: `email-successful-resend-${codes.length}` };
    };
    const input = { destination: 'private@example.test', purpose: 'REGISTRATION' as const, subject: 'pending-successful-resend' };
    await issueEmailOtp(input);
    store.rows[0].cooldownUntil = new Date(Date.now() - 1);
    await issueEmailOtp(input);
    assert.equal(store.rows[0].deliveryStatus, 'FAILED');
    assert.ok(store.rows[0].invalidatedAt instanceof Date);
    assert.equal(store.rows[1].deliveryStatus, 'SENT');
    await assert.rejects(consumeEmailOtp({ ...input, code: codes[0] }));
    await consumeEmailOtp({ ...input, code: codes[1] });
    assert.ok(store.rows[1].consumedAt instanceof Date);
  } finally { store.restore(); }
});

test('a post-delivery state failure invalidates the emailed challenge', async () => {
  const store = installOtpStore();
  try {
    (emailService as any).sendAuthEmail = async () => ({ messageId: 'email-state-failure' });
    await assert.rejects(
      issueEmailOtp({
        destination: 'private@example.test',
        purpose: 'REGISTRATION',
        subject: 'pending-state-failure',
        onSent: async () => { throw new Error('pending registration update failed'); }
      }),
      (error: any) => error instanceof OtpError && error.code === 'OTP_DELIVERY_FAILED'
    );
    assert.equal(store.rows[0].deliveryStatus, 'FAILED');
    assert.ok(store.rows[0].invalidatedAt instanceof Date);
  } finally { store.restore(); }
});

test('cooldown and concurrent issuance allow only one challenge and one mocked email', async () => {
  const store = installOtpStore();
  let deliveries = 0;
  try {
    (emailService as any).sendAuthEmail = async () => { deliveries += 1; return { messageId: 'email-7' }; };
    const results = await Promise.allSettled([
      issueEmailOtp({ destination: 'private@example.test', purpose: 'REGISTRATION', subject: 'pending-concurrent' }),
      issueEmailOtp({ destination: 'private@example.test', purpose: 'REGISTRATION', subject: 'pending-concurrent' })
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected' && (result.reason as any).code === 'OTP_COOLDOWN').length, 1);
    assert.equal(deliveries, 1);
    assert.equal(store.rows.length, 1);
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    assert.ok(rejected.reason.details.retryAfterSeconds >= 1);
  } finally { store.restore(); }
});

test('database-backed recipient rate limit serializes concurrent sends across subjects', async () => {
  const store = installOtpStore();
  let deliveries = 0;
  try {
    process.env.OTP_MAX_SENDS_PER_WINDOW = '2';
    process.env.OTP_RATE_LIMIT_WINDOW_SECONDS = '3600';
    (emailService as any).sendAuthEmail = async () => { deliveries += 1; return { messageId: `rate-${deliveries}` }; };

    await issueEmailOtp({ destination: 'victim@example.test', purpose: 'EMAIL_VERIFICATION', subject: 'user-1' });
    store.rows[0].cooldownUntil = new Date(Date.now() - 1);
    const boundary = await Promise.allSettled([
      issueEmailOtp({ destination: 'victim@example.test', purpose: 'EMAIL_VERIFICATION', subject: 'user-2' }),
      issueEmailOtp({ destination: 'victim@example.test', purpose: 'EMAIL_VERIFICATION', subject: 'user-3' })
    ]);
    assert.equal(boundary.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(boundary.filter((result) => result.status === 'rejected'
      && (result.reason as any).code === 'OTP_RATE_LIMITED'
      && ((result.reason as any).details?.retryAfterSeconds || 0) >= 1).length, 1);
    assert.equal(deliveries, 2);
    assert.equal(store.rows.length, 2);
  } finally {
    delete process.env.OTP_MAX_SENDS_PER_WINDOW;
    delete process.env.OTP_RATE_LIMIT_WINDOW_SECONDS;
    store.restore();
  }
});

test('staging delivery fails closed unless the normalized recipient is allowlisted', async () => {
  const store = installOtpStore();
  let deliveries = 0;
  const originalDeploymentEnv = process.env.DEPLOYMENT_ENV;
  const originalAllowlist = process.env.STAGING_OTP_ALLOWED_EMAILS;
  try {
    process.env.DEPLOYMENT_ENV = 'staging';
    process.env.STAGING_OTP_ALLOWED_EMAILS = 'owner@example.test';
    (emailService as any).sendAuthEmail = async () => { deliveries += 1; return { messageId: 'must-not-send' }; };

    await assert.rejects(
      issueEmailOtp({ destination: 'other@example.test', purpose: 'REGISTRATION', subject: 'staging-denied' }),
      (error: any) => error instanceof OtpError && error.code === 'OTP_DELIVERY_FAILED'
    );
    assert.equal(deliveries, 0);
    assert.equal(store.rows.length, 0);
  } finally {
    if (originalDeploymentEnv === undefined) delete process.env.DEPLOYMENT_ENV;
    else process.env.DEPLOYMENT_ENV = originalDeploymentEnv;
    if (originalAllowlist === undefined) delete process.env.STAGING_OTP_ALLOWED_EMAILS;
    else process.env.STAGING_OTP_ALLOWED_EMAILS = originalAllowlist;
    store.restore();
  }
});

test('staging allowlist normalizes addresses and enforces a persistent global send cap', async () => {
  const store = installOtpStore();
  let deliveries = 0;
  const originalDeploymentEnv = process.env.DEPLOYMENT_ENV;
  const originalAllowlist = process.env.STAGING_OTP_ALLOWED_EMAILS;
  try {
    process.env.DEPLOYMENT_ENV = 'staging';
    process.env.STAGING_OTP_ALLOWED_EMAILS = 'Owner@Example.Test ';
    (emailService as any).sendAuthEmail = async () => ({ messageId: `staging-${++deliveries}` });

    await issueEmailOtp({ destination: ' owner@example.test', purpose: 'REGISTRATION', subject: 'staging-first' });
    await assert.rejects(
      issueEmailOtp({ destination: 'owner@example.test', purpose: 'EMAIL_VERIFICATION', subject: 'staging-second' }),
      (error: any) => error instanceof OtpError && error.code === 'OTP_RATE_LIMITED'
    );
    assert.equal(deliveries, 1);
    assert.equal(store.rows.length, 1);
  } finally {
    if (originalDeploymentEnv === undefined) delete process.env.DEPLOYMENT_ENV;
    else process.env.DEPLOYMENT_ENV = originalDeploymentEnv;
    if (originalAllowlist === undefined) delete process.env.STAGING_OTP_ALLOWED_EMAILS;
    else process.env.STAGING_OTP_ALLOWED_EMAILS = originalAllowlist;
    store.restore();
  }
});

for (const failure of ['provider-rejection', 'provider-timeout-rejection', 'post-delivery-database-failure', 'none']) {
  test(`staging lifetime reservation survives ${failure}, OTP retention and a fresh service instance`, async () => {
    const store = installOtpStore();
    const previousEnv = process.env.DEPLOYMENT_ENV;
    const previousAllowed = process.env.STAGING_OTP_ALLOWED_EMAILS;
    let calls = 0;
    try {
      process.env.DEPLOYMENT_ENV = 'staging';
      process.env.STAGING_OTP_ALLOWED_EMAILS = 'owner@example.test';
      (emailService as any).sendAuthEmail = async () => {
        calls += 1;
        if (failure.startsWith('provider-')) throw new Error('mock provider failure');
        return { messageId: 'mock-only' };
      };
      const first = issueEmailOtp({ destination: 'owner@example.test', purpose: 'REGISTRATION', subject: 'reserved-first',
        ...(failure === 'post-delivery-database-failure' ? { onSent: async () => { throw new Error('mock DB failure'); } } : {}) });
      if (failure === 'none') await first;
      else await assert.rejects(first, (error: any) => error.code === 'OTP_DELIVERY_FAILED');
      // Simulate all OTP retention: the separate lifetime row must survive.
      store.rows.splice(0);
      delete require.cache[require.resolve('./otpService')];
      const restarted = require('./otpService') as typeof import('./otpService');
      await assert.rejects(restarted.issueEmailOtp({ destination: 'owner@example.test', purpose: 'EMAIL_VERIFICATION', subject: 'reserved-second' }),
        (error: any) => error.code === 'OTP_RATE_LIMITED');
      assert.equal(calls, 1);
      assert.equal(store.rows.length, 0);
    } finally {
      if (previousEnv === undefined) delete process.env.DEPLOYMENT_ENV; else process.env.DEPLOYMENT_ENV = previousEnv;
      if (previousAllowed === undefined) delete process.env.STAGING_OTP_ALLOWED_EMAILS; else process.env.STAGING_OTP_ALLOWED_EMAILS = previousAllowed;
      store.restore();
    }
  });
}
