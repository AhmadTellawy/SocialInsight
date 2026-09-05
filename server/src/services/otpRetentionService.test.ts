import assert from 'node:assert/strict';
import test from 'node:test';

const prisma = require('../prisma').default as any;
const { cleanupExpiredOtpChallenges } = require('./otpRetentionService') as typeof import('./otpRetentionService');

test('OTP retention deletes only old terminal or expired challenges', async () => {
  const original = prisma.otpChallenge.deleteMany;
  let where: any;
  try {
    prisma.otpChallenge.deleteMany = async (input: any) => { where = input.where; return { count: 3 }; };
    const now = new Date('2026-09-05T12:00:00.000Z');
    const count = await cleanupExpiredOtpChallenges(now);
    assert.equal(count, 3);
    assert.equal(where.createdAt.lt.toISOString(), '2026-09-04T12:00:00.000Z');
    assert.deepEqual(where.OR, [
      { expiresAt: { lt: now } },
      { consumedAt: { not: null } },
      { invalidatedAt: { not: null } }
    ]);
  } finally {
    prisma.otpChallenge.deleteMany = original;
  }
});
