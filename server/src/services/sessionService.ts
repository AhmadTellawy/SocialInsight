import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Request, Response } from 'express';
import prisma from '../prisma';
import { Prisma } from '@prisma/client';

const db = prisma as any;

export const coarseDeviceLabel = (userAgent?: string): string => {
    const value = (userAgent || '').slice(0, 512);
    const browser = /Edg\//.test(value) ? 'Edge' : /Firefox\//.test(value) ? 'Firefox' : /Chrome\//.test(value) ? 'Chrome' : /Safari\//.test(value) ? 'Safari' : 'Browser';
    const device = /Android/.test(value) ? 'Android' : /iPhone|iPad/.test(value) ? 'iOS' : /Windows/.test(value) ? 'Windows' : /Macintosh/.test(value) ? 'macOS' : /Linux/.test(value) ? 'Linux' : 'device';
    return `${browser} · ${device}`;
};

export interface SessionRevocationEvent {
    sessionId?: string;
    userId?: string;
}

const revocationListeners = new Set<(event: SessionRevocationEvent) => void>();

export const onSessionRevocation = (listener: (event: SessionRevocationEvent) => void): (() => void) => {
    revocationListeners.add(listener);
    return () => revocationListeners.delete(listener);
};

export const publishSessionRevocation = (event: SessionRevocationEvent): void => {
    for (const listener of revocationListeners) {
        try { listener(event); } catch { /* revocation remains authoritative in the database */ }
    }
};

export const notifyUserSessionsRevoked = (userId: string): void => publishSessionRevocation({ userId });

const boundedInt = (name: string, fallback: number, min: number, max: number): number => {
    const parsed = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
};

const signingSecret = (): string => process.env.AUTH_SESSION_HASH_SECRET?.trim()
    || process.env.JWT_SECRET?.trim()
    || (() => { throw new Error('AUTH_SESSION_HASH_SECRET must be configured'); })();

export const hashSessionSecret = (value: string): string => createHmac('sha256', signingSecret()).update(value).digest('hex');

export const SESSION_COOKIE_NAME = process.env.AUTH_SESSION_COOKIE_NAME?.trim() || 'si_session';
export const CSRF_COOKIE_NAME = process.env.AUTH_CSRF_COOKIE_NAME?.trim() || 'si_csrf';

const isSecureCookie = (): boolean => process.env.AUTH_COOKIE_SECURE === 'true'
    || (process.env.AUTH_COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production');

const sameSite = (): 'Strict' | 'Lax' | 'None' => {
    const configured = process.env.AUTH_COOKIE_SAME_SITE?.trim().toLowerCase();
    if (configured === 'strict') return 'Strict';
    if (configured === 'none') return isSecureCookie() ? 'None' : 'Lax';
    // Production traffic is same-origin through the frontend API proxy, so Lax
    // is the secure default. Cross-site deployments must explicitly opt into
    // None and can do so only with Secure enabled.
    return 'Lax';
};

const serializeCookie = (name: string, value: string, options: { httpOnly: boolean; maxAgeSeconds: number }): string => {
    const parts = [
        `${name}=${encodeURIComponent(value)}`,
        'Path=/',
        `Max-Age=${options.maxAgeSeconds}`,
        `SameSite=${sameSite()}`
    ];
    if (options.httpOnly) parts.push('HttpOnly');
    if (isSecureCookie()) parts.push('Secure');
    return parts.join('; ');
};

export const readCookies = (req: Request): Record<string, string> => {
    const header = req.headers.cookie;
    if (!header) return {};
    return header.split(';').reduce<Record<string, string>>((cookies, pair) => {
        const index = pair.indexOf('=');
        if (index <= 0) return cookies;
        const name = pair.slice(0, index).trim();
        try { cookies[name] = decodeURIComponent(pair.slice(index + 1).trim()); } catch { /* malformed cookie */ }
        return cookies;
    }, {});
};

export interface AuthenticatedSession {
    id: string;
    userId: string;
    csrfHash: string;
    expiresAt: Date;
    createdAt: Date;
    recentAuthenticatedAt?: Date;
    user: { status: string };
}

export const createSession = async (userId: string, res: Response, request?: Request, proof?: { mfaVerified?: boolean; expectedAuthInvalidatedAt?: Date | null; expectedPasswordUpdatedAt?: Date | null }): Promise<{ sessionId: string; csrfToken: string }> => {
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const ttlSeconds = boundedInt('AUTH_SESSION_TTL_SECONDS', 30 * 24 * 60 * 60, 300, 90 * 24 * 60 * 60);
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + ttlSeconds * 1000);
    const session = await db.$transaction(async (tx: any) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`account-security:${userId}`}, 0))`);
        const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true, authInvalidatedAt: true, passwordUpdatedAt: true, mfa: { select: { enabledAt: true } } } });
        if (user?.status !== 'ACTIVE' || (user.mfa?.enabledAt && !proof?.mfaVerified)) throw new Error('Authentication proof changed; sign in again');
        const sameEpoch = (left?: Date | null, right?: Date | null) => (left?.getTime() ?? null) === (right?.getTime() ?? null);
        if (!sameEpoch(user.authInvalidatedAt, proof?.expectedAuthInvalidatedAt) || !sameEpoch(user.passwordUpdatedAt, proof?.expectedPasswordUpdatedAt)) throw new Error('Authentication proof expired; sign in again');
        return tx.authSession.create({
            data: { userId, deviceLabel: coarseDeviceLabel(request?.headers?.['user-agent']), createdAt: issuedAt, updatedAt: issuedAt, recentAuthenticatedAt: issuedAt, tokenHash: hashSessionSecret(token), csrfHash: hashSessionSecret(csrfToken), expiresAt, lastUsedAt: issuedAt },
            select: { id: true }
        });
    });

    res.setHeader('Set-Cookie', [
        serializeCookie(SESSION_COOKIE_NAME, token, { httpOnly: true, maxAgeSeconds: ttlSeconds }),
        serializeCookie(CSRF_COOKIE_NAME, csrfToken, { httpOnly: false, maxAgeSeconds: ttlSeconds })
    ]);
    return { sessionId: session.id, csrfToken };
};

export const clearSessionCookies = (res: Response): void => {
    res.setHeader('Set-Cookie', [
        serializeCookie(SESSION_COOKIE_NAME, '', { httpOnly: true, maxAgeSeconds: 0 }),
        serializeCookie(CSRF_COOKIE_NAME, '', { httpOnly: false, maxAgeSeconds: 0 })
    ]);
};

export const resolveSession = async (req: Request): Promise<AuthenticatedSession | null> => {
    const token = readCookies(req)[SESSION_COOKIE_NAME];
    if (!token || token.length < 32 || token.length > 256) return null;
    const session = await db.authSession.findUnique({
        where: { tokenHash: hashSessionSecret(token) },
        select: {
            id: true, userId: true, csrfHash: true, expiresAt: true, revokedAt: true, lastUsedAt: true, createdAt: true, recentAuthenticatedAt: true,
            user: { select: { status: true } }
        }
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user?.status !== 'ACTIVE') return null;
    if (!session.lastUsedAt || Date.now() - session.lastUsedAt.getTime() > 5 * 60 * 1000) {
        db.authSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    }
    return session;
};

export const revokeSession = async (sessionId: string): Promise<void> => {
    const session = await db.authSession.findUnique({ where: { id: sessionId }, select: { userId: true } });
    if (!session) return;
    await db.$transaction(async (tx: any) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`account-security:${session.userId}`}, 0))`);
        await tx.authSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    publishSessionRevocation({ sessionId });
};

export const revokeAllUserSessions = async (userId: string): Promise<void> => {
    await db.$transaction(async (tx: any) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`account-security:${userId}`}, 0))`);
        await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    publishSessionRevocation({ userId });
};

export const csrfMatchesSession = (session: AuthenticatedSession, token: string): boolean => {
    const expected = Buffer.from(session.csrfHash, 'hex');
    const actual = Buffer.from(hashSessionSecret(token), 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
};
