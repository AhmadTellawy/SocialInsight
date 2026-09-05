import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import bcrypt from 'bcryptjs';

const fixtureUrl = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (fixtureUrl.hostname !== '127.0.0.1' || fixtureUrl.port !== '55432'
  || fixtureUrl.pathname !== '/socialinsight_otp_rehearsal') {
  throw new Error('OTP PostgreSQL integration test requires an explicit local disposable DATABASE_URL');
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'otp-postgres-rehearsal-secret';
process.env.OTP_BCRYPT_ROUNDS = '8';

const prisma = require('../prisma').default as typeof import('../prisma').default;
const emailService = require('./emailService') as typeof import('./emailService');
const originalSend = emailService.sendAuthEmail;
const { consumeEmailOtp, issueEmailOtp, OtpError } = require('./otpService') as typeof import('./otpService');

after(async () => {
  (emailService as any).sendAuthEmail = originalSend;
  await prisma.otpChallenge.deleteMany({ where: { subject: { startsWith: 'postgres-rehearsal-' } } });
  await prisma.$disconnect();
});

test('PostgreSQL advisory locking, hashing, cooldown, invalidation and single-use work with mocked Resend', async () => {
  const deliveredCodes: string[] = [];
  (emailService as any).sendAuthEmail = async (input: any) => {
    deliveredCodes.push(input.code);
    return { messageId: `mock-${deliveredCodes.length}` };
  };
  const input = {
    destination: 'postgres-rehearsal@example.test',
    purpose: 'REGISTRATION' as const,
    subject: 'postgres-rehearsal-registration'
  };

  await prisma.otpChallenge.deleteMany({ where: { subject: input.subject } });
  const first = await Promise.allSettled([issueEmailOtp(input), issueEmailOtp(input)]);
  assert.equal(
    first.filter((result) => result.status === 'fulfilled').length,
    1,
    first.map((result) => result.status === 'rejected' ? String(result.reason?.stack || result.reason) : 'fulfilled').join('\n')
  );
  assert.equal(first.filter((result) => result.status === 'rejected' && (result.reason as any).code === 'OTP_COOLDOWN').length, 1);
  assert.equal(deliveredCodes.length, 1);

  const stored = await prisma.otpChallenge.findFirstOrThrow({ where: { subject: input.subject } });
  assert.equal(stored.deliveryStatus, 'SENT');
  assert.equal(stored.destinationHash.length, 64);
  assert.equal(stored.codeHash.includes(deliveredCodes[0]), false);
  assert.equal(await bcrypt.compare(`REGISTRATION:${input.subject}:${deliveredCodes[0]}`, stored.codeHash), true);

  await prisma.otpChallenge.updateMany({
    where: { subject: input.subject },
    data: { cooldownUntil: new Date(Date.now() - 1) }
  });
  await issueEmailOtp(input);
  const versions = await prisma.otpChallenge.findMany({ where: { subject: input.subject }, orderBy: { version: 'asc' } });
  assert.equal(versions.length, 2);
  assert.equal(versions[0].deliveryStatus, 'FAILED');
  assert.ok(versions[0].invalidatedAt instanceof Date);
  assert.equal(versions[1].deliveryStatus, 'SENT');
  await assert.rejects(consumeEmailOtp({ ...input, code: deliveredCodes[0] }));

  const consumed = await Promise.allSettled([
    consumeEmailOtp({ ...input, code: deliveredCodes[1] }),
    consumeEmailOtp({ ...input, code: deliveredCodes[1] })
  ]);
  assert.equal(consumed.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(consumed.filter((result) => result.status === 'rejected').length, 1);

  await prisma.otpChallenge.updateMany({
    where: { subject: input.subject },
    data: { cooldownUntil: new Date(Date.now() - 1) }
  });
  (emailService as any).sendAuthEmail = async () => { throw new Error('mock provider outage'); };
  await assert.rejects(issueEmailOtp(input), (error: any) => error instanceof OtpError && error.code === 'OTP_DELIVERY_FAILED');
  const active = await prisma.otpChallenge.count({
    where: { subject: input.subject, consumedAt: null, invalidatedAt: null, deliveryStatus: 'SENT' }
  });
  assert.equal(active, 0);
});

test('PostgreSQL recipient lock enforces the rolling cap across concurrent subjects', async () => {
  const originalMax = process.env.OTP_MAX_SENDS_PER_WINDOW;
  const originalWindow = process.env.OTP_RATE_LIMIT_WINDOW_SECONDS;
  let deliveries = 0;
  try {
    process.env.OTP_MAX_SENDS_PER_WINDOW = '2';
    process.env.OTP_RATE_LIMIT_WINDOW_SECONDS = '3600';
    (emailService as any).sendAuthEmail = async () => ({ messageId: `mock-rate-${++deliveries}` });
    const base = {
      destination: 'postgres-rate-limit@example.test',
      purpose: 'EMAIL_VERIFICATION' as const
    };

    await issueEmailOtp({ ...base, subject: 'postgres-rehearsal-rate-a' });
    const serviceModulePath = require.resolve('./otpService');
    delete require.cache[serviceModulePath];
    const isolatedServiceA = require('./otpService') as typeof import('./otpService');
    delete require.cache[serviceModulePath];
    const isolatedServiceB = require('./otpService') as typeof import('./otpService');
    const boundary = await Promise.allSettled([
      isolatedServiceA.issueEmailOtp({ ...base, subject: 'postgres-rehearsal-rate-b' }),
      isolatedServiceB.issueEmailOtp({ ...base, subject: 'postgres-rehearsal-rate-c' })
    ]);

    assert.equal(boundary.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(boundary.filter((result) => result.status === 'rejected'
      && (result.reason as any).code === 'OTP_RATE_LIMITED').length, 1);
    assert.equal(deliveries, 2);
  } finally {
    if (originalMax === undefined) delete process.env.OTP_MAX_SENDS_PER_WINDOW;
    else process.env.OTP_MAX_SENDS_PER_WINDOW = originalMax;
    if (originalWindow === undefined) delete process.env.OTP_RATE_LIMIT_WINDOW_SECONDS;
    else process.env.OTP_RATE_LIMIT_WINDOW_SECONDS = originalWindow;
  }
});

test('PostgreSQL singleton reserves at most one provider attempt across independent instances and retention', async () => {
  const originalEnv = process.env.DEPLOYMENT_ENV;
  const originalAllowed = process.env.STAGING_OTP_ALLOWED_EMAILS;
  let deliveries = 0;
  try {
    // This test's startup guard confines all fixture writes to a local database.
    await prisma.$executeRaw`DELETE FROM staging_otp_email_reservation WHERE slot = 1`;
    process.env.DEPLOYMENT_ENV = 'staging';
    process.env.STAGING_OTP_ALLOWED_EMAILS = 'postgres-budget-a@example.test,postgres-budget-b@example.test';
    (emailService as any).sendAuthEmail = async () => { deliveries += 1; throw new Error('mock provider timeout'); };
    const servicePath = require.resolve('./otpService');
    delete require.cache[servicePath];
    const a = require('./otpService') as typeof import('./otpService');
    delete require.cache[servicePath];
    const b = require('./otpService') as typeof import('./otpService');
    const results = await Promise.allSettled([
      a.issueEmailOtp({ destination: 'postgres-budget-a@example.test', purpose: 'REGISTRATION', subject: 'postgres-rehearsal-budget-a' }),
      b.issueEmailOtp({ destination: 'postgres-budget-b@example.test', purpose: 'REGISTRATION', subject: 'postgres-rehearsal-budget-b' })
    ]);
    assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'OTP_DELIVERY_FAILED').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'OTP_RATE_LIMITED').length, 1);
    assert.equal(deliveries, 1);
    await prisma.otpChallenge.deleteMany({ where: { subject: { in: ['postgres-rehearsal-budget-a', 'postgres-rehearsal-budget-b'] } } });
    delete require.cache[servicePath];
    const restarted = require('./otpService') as typeof import('./otpService');
    await assert.rejects(restarted.issueEmailOtp({ destination: 'postgres-budget-a@example.test', purpose: 'REGISTRATION', subject: 'postgres-rehearsal-budget-retry' }),
      (error: any) => error.code === 'OTP_RATE_LIMITED');
    assert.equal(deliveries, 1);
  } finally {
    if (originalEnv === undefined) delete process.env.DEPLOYMENT_ENV; else process.env.DEPLOYMENT_ENV = originalEnv;
    if (originalAllowed === undefined) delete process.env.STAGING_OTP_ALLOWED_EMAILS; else process.env.STAGING_OTP_ALLOWED_EMAILS = originalAllowed;
  }
});
