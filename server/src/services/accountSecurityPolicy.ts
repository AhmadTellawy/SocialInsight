import { Request } from 'express';
import { AccountSecurityError } from './mfaService';

// Call after acquiring account-security:<userId>. Middleware proof may have expired or been revoked while this request waited for the lock.
export const assertActiveAccountSession = async (tx: any, req: Request, requireRecent = true): Promise<void> => {
    if (!req.authSession || !req.user || req.user.authMode !== 'session' || req.authSession.userId !== req.user.userId) throw new AccountSecurityError('AUTH_REQUIRED', 401);
    const session = await tx.authSession.findFirst({ where: {
        id: req.authSession.id, userId: req.user.userId, revokedAt: null, expiresAt: { gt: new Date() }, user: { status: 'ACTIVE' }
    }, select: { id: true, recentAuthenticatedAt: true, createdAt: true } });
    if (!session) throw new AccountSecurityError('AUTH_REQUIRED', 401);
    const stamp = session.recentAuthenticatedAt || session.createdAt;
    const ttl = Math.max(60, Math.min(3600, Number(process.env.AUTH_RECENT_TTL_SECONDS) || 600));
    if (requireRecent && (!stamp || Date.now() - stamp.getTime() > ttl * 1000)) throw new AccountSecurityError('REAUTHENTICATION_REQUIRED', 401);
};

export const invalidateAccountOtps = async (tx: any, userId: string): Promise<void> => {
    await tx.otpChallenge.updateMany({ where: { subject: userId, purpose: { in: ['PASSWORD_RESET', 'EMAIL_CHANGE', 'EMAIL_VERIFICATION'] }, consumedAt: null, invalidatedAt: null }, data: { invalidatedAt: new Date() } });
};
