import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../prisma';
import { clearSessionCookies, createSession, publishSessionRevocation, resolveSession } from '../services/sessionService';
import { AccountSecurityError, consumeMfaProof, encryptMfaSecret, findTotpStep, generateMfaSecret, generateRecoveryCodes, isMfaConfigured, lockAccountSecurity, decryptMfaSecret, normalizeSecurityCode } from '../services/mfaService';
import { challengeAfterPrimaryProof, challengeSummary, clearAuthChallengeCookies, readAuthChallenge } from '../services/authChallengeService';
import { authenticationResponse, SAFE_USER_SELECT } from './authController';
import { assertActiveAccountSession, invalidateAccountOtps } from '../services/accountSecurityPolicy';
import { enqueueSecurityNotification } from '../services/securityNotificationService';

const db = prisma as any;
const passwordSchema = z.string().min(8).max(128).regex(/[A-Z]/).regex(/[a-z]/).regex(/\d/).regex(/[!@#$%^&*]/);
const proofSchema = z.object({ code: z.string().min(1).max(40) }).strict();
const noStore = (res: Response) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Pragma', 'no-cache'); };
const handler = (work: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response): Promise<void> => {
    noStore(res);
    try { await work(req, res); } catch (error) {
        if (error instanceof AccountSecurityError) { res.status(error.status).json({ error: 'Account security action could not be completed', code: error.code }); return; }
        if (error instanceof z.ZodError) { res.status(400).json({ error: 'Invalid request', code: 'INVALID_REQUEST' }); return; }
        console.error(JSON.stringify({ event: 'account_security_action_failed', requestId: req.requestId }));
        res.status(500).json({ error: 'Account security action could not be completed', code: 'ACCOUNT_SECURITY_FAILED' });
    }
};

export const getSignInMethods = handler(async (req, res) => {
    const user = await db.user.findUnique({ where: { id: req.user!.userId }, select: { passwordHash: true, emailVerifiedAt: true, oauthAccounts: { select: { provider: true } }, mfa: { select: { enabledAt: true } } } });
    if (!user) throw new AccountSecurityError('AUTH_REQUIRED', 401);
    const ttl = Math.max(60, Math.min(3600, Number(process.env.AUTH_RECENT_TTL_SECONDS) || 600));
    const authenticatedAt = req.authSession?.recentAuthenticatedAt || req.authSession?.createdAt;
    res.json({ hasPassword: Boolean(user.passwordHash), emailVerified: Boolean(user.emailVerifiedAt),
        providers: ['GOOGLE', 'FACEBOOK'].map((provider) => ({ provider: provider.toLowerCase(), linked: user.oauthAccounts.some((item: any) => item.provider === provider) })),
        mfa: { enabled: Boolean(user.mfa?.enabledAt), available: isMfaConfigured() },
        recentAuthUntil: req.user!.authMode === 'session' && authenticatedAt ? new Date(authenticatedAt.getTime() + ttl * 1000).toISOString() : null });
});

export const reauthenticate = handler(async (req, res) => {
    const { password } = z.object({ password: z.string().min(1).max(128) }).strict().parse(req.body);
    if (!req.authSession || req.user!.authMode !== 'session') throw new AccountSecurityError('AUTH_REQUIRED', 401);
    const user = await db.user.findUnique({ where: { id: req.user!.userId } });
    if (!user?.passwordHash || !await bcrypt.compare(password, user.passwordHash)) throw new AccountSecurityError('INVALID_CREDENTIALS', 401);
    const challenge = await challengeAfterPrimaryProof(user, res, req.authSession.id);
    if (challenge) { res.json(challenge); return; }
    const changed = await db.$transaction(async (tx: any) => {
        await lockAccountSecurity(tx, user.id);
        await assertActiveAccountSession(tx, req, false);
        const current = await tx.user.findUnique({ where: { id: user.id }, select: { status: true, authInvalidatedAt: true, passwordHash: true, mfa: { select: { enabledAt: true } } } });
        if (current?.status !== 'ACTIVE' || current.mfa?.enabledAt || current.passwordHash !== user.passwordHash || (current.authInvalidatedAt?.getTime() ?? null) !== (user.authInvalidatedAt?.getTime() ?? null)) throw new AccountSecurityError('AUTH_PROOF_EXPIRED', 401);
        return tx.authSession.updateMany({ where: { id: req.authSession!.id, userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { recentAuthenticatedAt: new Date() } });
    });
    if (changed.count !== 1) throw new AccountSecurityError('AUTH_REQUIRED', 401);
    res.json({ success: true });
});

export const unlinkSignInMethod = handler(async (req, res) => {
    const provider = z.enum(['google', 'facebook']).parse(req.params.provider).toUpperCase(), userId = req.user!.userId;
    await db.$transaction(async (tx: any) => {
        await lockAccountSecurity(tx, userId);
        await assertActiveAccountSession(tx, req);
        const user = await tx.user.findUnique({ where: { id: userId }, select: { passwordHash: true, status: true } });
        const methods = await tx.oAuthAccount.findMany({ where: { userId }, select: { provider: true } });
        if (user?.status !== 'ACTIVE') throw new AccountSecurityError('AUTH_REQUIRED', 401);
        if (!methods.some((method: any) => method.provider === provider)) return;
        if (!user.passwordHash && !methods.some((method: any) => method.provider !== provider)) throw new AccountSecurityError('LAST_SIGN_IN_METHOD', 409);
        await tx.oAuthAccount.deleteMany({ where: { userId, provider } });
        await tx.user.update({ where: { id: userId }, data: { authInvalidatedAt: new Date() } });
        await tx.oAuthState.updateMany({ where: { linkingUserId: userId, consumedAt: null }, data: { consumedAt: new Date() } });
    });
    res.json({ success: true });
});

export const changeAccountPassword = handler(async (req, res) => {
    const input = z.object({ currentPassword: z.string().max(128).optional(), password: passwordSchema }).strict().parse(req.body), userId = req.user!.userId;
    const passwordHash = await bcrypt.hash(input.password, 12);
    const revoked = await db.$transaction(async (tx: any) => {
        await lockAccountSecurity(tx, userId);
        await assertActiveAccountSession(tx, req);
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (user?.status !== 'ACTIVE') throw new AccountSecurityError('AUTH_REQUIRED', 401);
        if (user.passwordHash && (!input.currentPassword || !await bcrypt.compare(input.currentPassword, user.passwordHash))) throw new AccountSecurityError('INVALID_CREDENTIALS', 401);
        if (!user.passwordHash && (!user.email || !user.emailVerifiedAt)) throw new AccountSecurityError('VERIFIED_EMAIL_REQUIRED', 409);
        await invalidateAccountOtps(tx, userId);
        const now = new Date();
        await tx.user.update({ where: { id: userId }, data: { passwordHash, password: null, passwordUpdatedAt: now, authInvalidatedAt: now } });
        if (user.email && user.emailVerifiedAt) await enqueueSecurityNotification(tx, userId, 'PASSWORD_CHANGED', [user.email]);
        const sessions = await tx.authSession.findMany({ where: { userId, revokedAt: null, id: { not: req.authSession!.id } }, select: { id: true } });
        await tx.authSession.updateMany({ where: { userId, revokedAt: null, id: { not: req.authSession!.id } }, data: { revokedAt: now } });
        await tx.authChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
        return sessions;
    });
    revoked.forEach((session: any) => publishSessionRevocation({ sessionId: session.id }));
    res.json({ success: true });
});

export const listAccountSessions = handler(async (req, res) => {
    const sessions = await db.authSession.findMany({ where: { userId: req.user!.userId, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, deviceLabel: true, createdAt: true, lastUsedAt: true, expiresAt: true }, orderBy: { lastUsedAt: 'desc' }, take: 100 });
    res.json({ sessions: sessions.map((session: any) => ({ ...session, current: session.id === req.authSession?.id, deviceLabel: session.deviceLabel || 'Browser' })) });
});
export const revokeAccountSession = handler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    // Include ownership in the mutation itself; unknown IDs are indistinguishable from already revoked sessions.
    const revoked = await db.$transaction(async (tx: any) => {
        await lockAccountSecurity(tx, req.user!.userId);
        await assertActiveAccountSession(tx, req);
        return tx.authSession.updateMany({ where: { id, userId: req.user!.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    if (revoked.count) publishSessionRevocation({ sessionId: id });
    const currentRevoked = req.authSession?.id === id;
    if (currentRevoked) clearSessionCookies(res);
    res.json({ success: true, currentRevoked });
});
export const revokeOtherAccountSessions = handler(async (req, res) => {
    if (!req.authSession) throw new AccountSecurityError('AUTH_REQUIRED', 401);
    const userId = req.user!.userId, where = { userId, id: { not: req.authSession.id }, revokedAt: null };
    const sessions = await db.$transaction(async (tx: any) => {
        await lockAccountSecurity(tx, userId);
        await assertActiveAccountSession(tx, req);
        const current = await tx.authSession.findFirst({ where: { id: req.authSession!.id, userId, revokedAt: null, expiresAt: { gt: new Date() } } });
        if (!current) throw new AccountSecurityError('AUTH_REQUIRED', 401);
        const records = await tx.authSession.findMany({ where, select: { id: true } });
        await tx.authSession.updateMany({ where, data: { revokedAt: new Date() } });
        await tx.user.update({ where: { id: userId }, data: { authInvalidatedAt: new Date() } });
        return records;
    });
    sessions.forEach((session: any) => publishSessionRevocation({ sessionId: session.id }));
    res.json({ success: true });
});

export const beginMfaEnrollment = handler(async (req, res) => {
    const userId = req.user!.userId, secret = generateMfaSecret(), expiresAt = new Date(Date.now() + 300_000);
    const encrypted = encryptMfaSecret(secret, userId);
    await db.$transaction(async (tx: any) => {
        await lockAccountSecurity(tx, userId);
        await assertActiveAccountSession(tx, req);
        const mfa = await tx.userMfa.findUnique({ where: { userId } });
        if (mfa?.enabledAt) throw new AccountSecurityError('MFA_ALREADY_ENABLED', 409);
        const data = { pendingSecret: encrypted, pendingExpiresAt: expiresAt, pendingSessionId: req.authSession!.id };
        await tx.userMfa.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    });
    const user = await db.user.findUnique({ where: { id: userId }, select: { handle: true } });
    const uri = `otpauth://totp/${encodeURIComponent(`Opiniup:${user.handle}`)}?secret=${secret}&issuer=Opiniup&algorithm=SHA1&digits=6&period=30`;
    res.json({ secret, otpauthUri: uri, expiresAt: expiresAt.toISOString() });
});

export const confirmMfaEnrollment = handler(async (req, res) => {
    const { code } = proofSchema.parse(req.body), userId = req.user!.userId, recovery = generateRecoveryCodes(userId);
    const revoked = await db.$transaction(async (tx: any) => {
        await lockAccountSecurity(tx, userId);
        await assertActiveAccountSession(tx, req);
        const mfa = await tx.userMfa.findUnique({ where: { userId } });
        if (mfa?.enabledAt || !mfa?.pendingSecret || mfa.pendingSessionId !== req.authSession!.id || mfa.pendingExpiresAt <= new Date()) throw new AccountSecurityError('MFA_ENROLLMENT_EXPIRED');
        const step = findTotpStep(decryptMfaSecret(mfa.pendingSecret, userId), code);
        if (step === null) throw new AccountSecurityError('MFA_CODE_INVALID');
        await tx.userMfa.update({ where: { userId }, data: { encryptedSecret: mfa.pendingSecret, enabledAt: new Date(), lastAcceptedStep: step, recoveryCodeHashes: recovery.hashes, pendingSecret: null, pendingExpiresAt: null, pendingSessionId: null } });
        const sessions = await tx.authSession.findMany({ where: { userId, id: { not: req.authSession!.id }, revokedAt: null }, select: { id: true } });
        await tx.authSession.updateMany({ where: { userId, id: { not: req.authSession!.id }, revokedAt: null }, data: { revokedAt: new Date() } });
        await tx.user.update({ where: { id: userId }, data: { authInvalidatedAt: new Date() } });
        await tx.authChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: new Date() } });
        return sessions;
    });
    revoked.forEach((session: any) => publishSessionRevocation({ sessionId: session.id }));
    res.json({ success: true, recoveryCodes: recovery.codes });
});

export const replaceMfaRecoveryCodes = handler(async (req, res) => {
    const { code } = proofSchema.parse(req.body), userId = req.user!.userId, recovery = generateRecoveryCodes(userId);
    await db.$transaction(async (tx: any) => {
        await lockAccountSecurity(tx, userId);
        await assertActiveAccountSession(tx, req);
        if (!await consumeMfaProof(tx, userId, code)) throw new AccountSecurityError('MFA_CODE_INVALID');
        await tx.userMfa.update({ where: { userId }, data: { recoveryCodeHashes: recovery.hashes } });
    });
    res.json({ success: true, recoveryCodes: recovery.codes });
});
export const disableMfa = handler(async (req, res) => {
    const { code } = proofSchema.parse(req.body), userId = req.user!.userId;
    await db.$transaction(async (tx: any) => {
        await lockAccountSecurity(tx, userId);
        await assertActiveAccountSession(tx, req);
        if (!await consumeMfaProof(tx, userId, code)) throw new AccountSecurityError('MFA_CODE_INVALID');
        await tx.userMfa.delete({ where: { userId } });
        await tx.user.update({ where: { id: userId }, data: { authInvalidatedAt: new Date() } });
        await tx.authChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: new Date() } });
    });
    res.json({ success: true });
});

export const getAuthChallenge = handler(async (req, res) => { res.json(challengeSummary(await readAuthChallenge(req))); });
export const completeAuthChallenge = handler(async (req, res) => {
    const input = z.object({ code: z.string().max(40).optional(), reactivate: z.literal(true).optional() }).strict().parse(req.body);
    const initial = await readAuthChallenge(req), session = await resolveSession(req);
    const result = await db.$transaction(async (tx: any) => {
        await lockAccountSecurity(tx, initial.userId);
        const challenge = await readAuthChallenge(req, tx), user = await tx.user.findUnique({ where: { id: challenge.userId } });
        if (!user || !['ACTIVE', 'DEACTIVATED'].includes(user.status) || (user.authInvalidatedAt && user.authInvalidatedAt > challenge.createdAt)) throw new AccountSecurityError('AUTH_CHALLENGE_EXPIRED', 401);
        if (challenge.purpose === 'REAUTH_MFA' && (!session || session.id !== challenge.sessionId || session.userId !== challenge.userId)) throw new AccountSecurityError('AUTH_CHALLENGE_EXPIRED', 401);
        if (['REACTIVATE', 'MFA_REACTIVATE'].includes(challenge.purpose)) {
            if (user.status !== 'DEACTIVATED' || input.reactivate !== true) throw new AccountSecurityError('REACTIVATION_CONFIRMATION_REQUIRED');
            const transition = await tx.mediaPrivacyTransition.findFirst({ where: { userId: user.id, status: { in: ['PENDING', 'RUNNING', 'FAILED'] } }, select: { id: true } });
            if (user.mediaPrivacyTarget != null || transition) throw new AccountSecurityError('ACCOUNT_PRIVACY_TRANSITION_PENDING', 409);
            await tx.user.update({ where: { id: user.id }, data: { status: 'ACTIVE', deactivatedAt: null } });
        } else {
            // Commit failures/attempts so restarting the request cannot reset the counter.
            await tx.authChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
            if (!input.code || !await consumeMfaProof(tx, user.id, normalizeSecurityCode(input.code))) return { invalid: true };
            if (user.status === 'DEACTIVATED') {
                const next = await tx.authChallenge.update({ where: { id: challenge.id }, data: { purpose: 'MFA_REACTIVATE', attempts: 0 } });
                return { next };
            }
        }
        await tx.authChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
        if (challenge.purpose === 'REAUTH_MFA') {
            const updated = await tx.authSession.updateMany({ where: { id: session!.id, userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { recentAuthenticatedAt: new Date() } });
            if (updated.count !== 1) throw new AccountSecurityError('AUTH_REQUIRED', 401);
            return { reauthenticated: true };
        }
        return { userId: user.id, mfaVerified: ['LOGIN_MFA', 'MFA_REACTIVATE'].includes(challenge.purpose), expectedAuthInvalidatedAt: user.authInvalidatedAt, expectedPasswordUpdatedAt: user.passwordUpdatedAt };
    });
    if (result.invalid) throw new AccountSecurityError('MFA_CODE_INVALID', 401);
    if (result.next) { res.json(challengeSummary(result.next)); return; }
    if (result.reauthenticated) { clearAuthChallengeCookies(res); res.json({ success: true }); return; }
    const user = await db.user.findUnique({ where: { id: result.userId }, select: SAFE_USER_SELECT });
    const created = await createSession(result.userId, res, req, { mfaVerified: result.mfaVerified, expectedAuthInvalidatedAt: result.expectedAuthInvalidatedAt, expectedPasswordUpdatedAt: result.expectedPasswordUpdatedAt });
    clearAuthChallengeCookies(res);
    res.json(authenticationResponse(user, created.csrfToken));
});
