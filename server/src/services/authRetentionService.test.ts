import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../prisma';
import { cleanupExpiredAuthArtifacts } from './authRetentionService';
import * as securityNotifications from './securityNotificationService';

test('authentication retention cleanup targets only expired or terminal artifacts', async () => {
    const original = (prisma as any).$transaction;
    const originalNotifications = securityNotifications.cleanupSecurityNotifications;
    const calls: unknown[] = [];
    const models = ['authSession', 'oAuthState', 'otpChallenge', 'oTPCode', 'pendingRegistration', 'authRateLimit', 'authChallenge', 'accountCleanupJob'];
    const originals = new Map<string, unknown>();
    const mfaUpdate = (prisma as any).userMfa.updateMany;
    const responseUpdate = (prisma as any).response.updateMany;

    try {
        (securityNotifications as any).cleanupSecurityNotifications = async () => 0;
        (prisma as any).userMfa.updateMany = (args: unknown) => { calls.push({model: "userMfa", args}); return {count: 1}; };
        (prisma as any).response.updateMany = (args: unknown) => { calls.push({model: 'response', args}); return {count: 1}; };
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
            rateLimits: 1, authChallenges: 1, pendingMfa: 1, guestProofs: 1, completedCleanupJobs: 1, securityEmails: 0
        });
        assert.equal(calls.length, 10);
        assert.match(JSON.stringify(calls[0]), /expiresAt/);
        assert.match(JSON.stringify(calls[2]), /FAILED/);
        assert.match(JSON.stringify(calls[8]), /guestProofHash.*null/);
        assert.match(JSON.stringify(calls[9]), /completedAt/);
    } finally {
        (securityNotifications as any).cleanupSecurityNotifications = originalNotifications;
        (prisma as any).$transaction = original;
        (prisma as any).userMfa.updateMany = mfaUpdate;
        (prisma as any).response.updateMany = responseUpdate;
        for (const [model, deleteMany] of originals) (prisma as any)[model].deleteMany = deleteMany;
    }
});
