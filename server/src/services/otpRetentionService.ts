import prisma from '../prisma';

const retentionHours = (): number => {
    const parsed = Number.parseInt(process.env.OTP_RETENTION_HOURS || '', 10);
    return Number.isFinite(parsed) ? Math.max(24, Math.min(24 * 30, parsed)) : 24;
};

export const cleanupExpiredOtpChallenges = async (now = new Date()): Promise<number> => {
    const retentionBoundary = new Date(now.getTime() - retentionHours() * 60 * 60 * 1000);
    const result = await prisma.otpChallenge.deleteMany({
        where: {
            createdAt: { lt: retentionBoundary },
            OR: [
                { expiresAt: { lt: now } },
                { consumedAt: { not: null } },
                { invalidatedAt: { not: null } }
            ]
        }
    });
    return result.count;
};
