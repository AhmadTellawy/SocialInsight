import prisma from '../prisma';
import { cleanupSecurityNotifications } from './securityNotificationService';

const db = prisma as any;

export interface AuthRetentionResult {
    sessions: number;
    oauthStates: number;
    otpChallenges: number;
    legacyOtpCodes: number;
    pendingRegistrations: number;
    rateLimits: number;
    authChallenges: number;
    pendingMfa: number;
    guestProofs: number;
    completedCleanupJobs: number;
    securityEmails: number;
}

const retentionHours = (name: string, fallback: number, min: number, max: number): number => {
    const parsed = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
};

/**
 * Deletes expired authentication artifacts after a short recovery window.
 * No live session, active OAuth transaction, or unexpired OTP is eligible.
 */
export const cleanupExpiredAuthArtifacts = async (now = new Date()): Promise<AuthRetentionResult> => {
    const terminalCutoff = new Date(now.getTime() - retentionHours('AUTH_TERMINAL_RETENTION_HOURS', 24, 1, 24 * 30) * 3_600_000);
    const pendingCutoff = new Date(now.getTime() - retentionHours('AUTH_PENDING_REGISTRATION_RETENTION_HOURS', 24, 1, 24 * 7) * 3_600_000);

    // Completed retry ledgers have no further recovery purpose after 24h.
    // Pending jobs are never aged out, even during a prolonged storage outage.
    const cleanupCutoff = new Date(now.getTime() - 24 * 3_600_000);
    const [sessions, oauthStates, otpChallenges, legacyOtpCodes, pendingRegistrations, rateLimits, authChallenges, pendingMfa, guestProofs, completedCleanupJobs] = await db.$transaction([
        db.authSession.deleteMany({
            where: {
                OR: [
                    { expiresAt: { lt: terminalCutoff } },
                    { revokedAt: { not: null, lt: terminalCutoff } }
                ]
            }
        }),
        db.oAuthState.deleteMany({
            where: {
                OR: [
                    { expiresAt: { lt: terminalCutoff } },
                    { consumedAt: { not: null, lt: terminalCutoff } }
                ]
            }
        }),
        db.otpChallenge.deleteMany({
            where: {
                AND: [
                    { createdAt: { lt: terminalCutoff } },
                    {
                        OR: [
                            { expiresAt: { lt: now } },
                            { consumedAt: { not: null } },
                            { invalidatedAt: { not: null } },
                            { deliveryStatus: 'FAILED' }
                        ]
                    }
                ]
            }
        }),
        db.oTPCode.deleteMany({ where: { expiresAt: { lt: terminalCutoff } } }),
        db.pendingRegistration.deleteMany({ where: { updatedAt: { lt: pendingCutoff } } }),
        db.authRateLimit.deleteMany({ where: { expiresAt: { lt: now } } }),
        db.authChallenge.deleteMany({ where: { OR: [{ expiresAt: { lt: terminalCutoff } }, { consumedAt: { lt: terminalCutoff } }] } }),
        db.userMfa.updateMany({ where: { pendingExpiresAt: { lt: now } }, data: { pendingSecret: null, pendingExpiresAt: null, pendingSessionId: null } }),
        db.response.updateMany({ where: { guestProofExpiresAt: { lte: now } }, data: { guestProofHash: null, guestProofExpiresAt: null } }),
        db.accountCleanupJob.deleteMany({ where: { completedAt: { lt: cleanupCutoff } } })
    ]);

    return {
        sessions: sessions.count,
        oauthStates: oauthStates.count,
        otpChallenges: otpChallenges.count,
        legacyOtpCodes: legacyOtpCodes.count,
        pendingRegistrations: pendingRegistrations.count,
        rateLimits: rateLimits.count,
        authChallenges: authChallenges.count,
        pendingMfa: pendingMfa.count,
        guestProofs: guestProofs.count,
        completedCleanupJobs: completedCleanupJobs.count,
        securityEmails: await cleanupSecurityNotifications(now)
    };
};
