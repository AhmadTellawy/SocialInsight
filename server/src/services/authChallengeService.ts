import { randomBytes } from 'crypto';
import { Request, Response } from 'express';
import prisma from '../prisma';
import { hashSessionSecret, readCookies } from './sessionService';
import { AccountSecurityError, lockAccountSecurity } from './mfaService';

const db = prisma as any;
const CHALLENGE_COOKIE = 'si_auth_challenge';
const CHALLENGE_BINDING_COOKIE = 'si_auth_challenge_binding';
const TTL_SECONDS = 300;

const appendCookie = (res: Response, name: string, value: string, ttl: number): void => {
    const current = res.getHeader('Set-Cookie');
    const cookies = Array.isArray(current) ? current.map(String) : current ? [String(current)] : [];
    const secure = process.env.AUTH_COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
    cookies.push(`${name}=${encodeURIComponent(value)}; Path=/api/auth; Max-Age=${ttl}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
    res.setHeader('Set-Cookie', cookies);
};
export const clearAuthChallengeCookies = (res: Response): void => {
    appendCookie(res, CHALLENGE_COOKIE, '', 0);
    appendCookie(res, CHALLENGE_BINDING_COOKIE, '', 0);
};
export const challengeSummary = (challenge: any) => ({
    challengeRequired: true,
    challenge: { kind: ['REACTIVATE', 'MFA_REACTIVATE'].includes(challenge.purpose) ? 'reactivation' : 'mfa', expiresAt: challenge.expiresAt.toISOString() }
});

export const issueAuthChallenge = async (userId: string, purpose: 'LOGIN_MFA' | 'REAUTH_MFA' | 'REACTIVATE', res: Response, sessionId?: string, client: any = db): Promise<any> => {
    const token = randomBytes(32).toString('base64url'), binding = randomBytes(32).toString('base64url');
    const challenge = await client.authChallenge.create({ data: {
        tokenHash: hashSessionSecret(`auth-challenge:${token}`), cookieBindingHash: hashSessionSecret(`auth-binding:${binding}`),
        userId, purpose, sessionId: sessionId || null, expiresAt: new Date(Date.now() + TTL_SECONDS * 1000)
    } });
    appendCookie(res, CHALLENGE_COOKIE, token, TTL_SECONDS);
    appendCookie(res, CHALLENGE_BINDING_COOKIE, binding, TTL_SECONDS);
    return challengeSummary(challenge);
};

export const readAuthChallenge = async (req: Request, client: any = db): Promise<any> => {
    const cookies = readCookies(req), token = cookies[CHALLENGE_COOKIE], binding = cookies[CHALLENGE_BINDING_COOKIE];
    if (!token || token.length !== 43 || !binding || binding.length !== 43) throw new AccountSecurityError('AUTH_CHALLENGE_EXPIRED', 401);
    const challenge = await client.authChallenge.findUnique({ where: { tokenHash: hashSessionSecret(`auth-challenge:${token}`) } });
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date() || challenge.attempts >= 5
        || challenge.cookieBindingHash !== hashSessionSecret(`auth-binding:${binding}`)) throw new AccountSecurityError('AUTH_CHALLENGE_EXPIRED', 401);
    return challenge;
};

// Called only after primary credential proof. Deactivated accounts must still complete MFA before explicit reactivation.
export const challengeAfterPrimaryProof = async (user: any, res: Response, reauthSessionId?: string): Promise<any | null> => {
    return db.$transaction(async (tx: any) => {
        await lockAccountSecurity(tx, user.id);
        const current = await tx.user.findUnique({ where: { id: user.id }, select: { status: true, authInvalidatedAt: true, passwordUpdatedAt: true, mfa: { select: { enabledAt: true } } } });
        const epoch = (value?: Date | null) => value?.getTime() ?? null;
        if (!current || !['ACTIVE', 'DEACTIVATED'].includes(current.status) || epoch(current.authInvalidatedAt) !== epoch(user.authInvalidatedAt)
            || epoch(current.passwordUpdatedAt) !== epoch(user.passwordUpdatedAt)) throw new AccountSecurityError('AUTH_PROOF_EXPIRED', 401);
        if (current.mfa?.enabledAt) return issueAuthChallenge(user.id, reauthSessionId ? 'REAUTH_MFA' : 'LOGIN_MFA', res, reauthSessionId, tx);
        if (current.status === 'DEACTIVATED') return issueAuthChallenge(user.id, 'REACTIVATE', res, undefined, tx);
        return null;
    });
};
