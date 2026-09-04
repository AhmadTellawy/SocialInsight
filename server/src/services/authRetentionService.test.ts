import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../prisma';
import { cleanupExpiredAuthArtifacts } from './authRetentionService';

test('authentication retention cleanup targets only expired or terminal artifacts', async () => {
    const original = (prisma as any).$transaction;
    const calls: unknown[] = [];
    const models = ['authSession', 'oAuthState', 'otpChallenge', 'oTPCode', 'pendingRegistration', 'authRateLimit'];
    const originals = new Map<string, unknown>();

    try {
        for (const model of models) {
            const target = (prisma as any)[model];
            originals.set(model, target.deleteMany);
            target.deleteMany = (args: unknown) => {
                calls.push({ model, args });
                return { count: 1 };
            };
        }
        (prisma as any).$transaction = async (operations: unknown[]) => operations;

        const result = await cleanupExpiredAuthArtifacts(new Date('2026-09-04T12:00:00.000Z'));
        assert.deepEqual(result, {
            sessions: 1,
            oauthStates: 1,
            otpChallenges: 1,
            legacyOtpCodes: 1,
            pendingRegistrations: 1,
            rateLimits: 1
        });
        assert.equal(calls.length, 6);
        assert.match(JSON.stringify(calls[0]), /expiresAt/);
        assert.match(JSON.stringify(calls[2]), /FAILED/);
    } finally {
        (prisma as any).$transaction = original;
        for (const [model, deleteMany] of originals) (prisma as any)[model].deleteMany = deleteMany;
    }
});
