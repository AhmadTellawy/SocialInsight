import { NextFunction, Request, Response } from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';
import prisma from '../prisma';
import { hashSessionSecret, readCookies } from '../services/sessionService';

const db = prisma as any;
const WINDOW_MS = 15 * 60 * 1000;
const DEVICE_COOKIE_NAME = process.env.AUTH_DEVICE_COOKIE_NAME?.trim() || 'si_auth_device';

const appendCookie = (res: Response, cookie: string): void => {
    const current = typeof res.getHeader === 'function' ? res.getHeader('Set-Cookie') : undefined;
    const values = Array.isArray(current) ? current.map(String) : current ? [String(current)] : [];
    res.setHeader('Set-Cookie', [...values, cookie]);
};

const signDeviceId = (id: string): string => hashSessionSecret(`auth-device:${id}`);
const readOrCreateDeviceId = (req: Request, res: Response): string => {
    const value = readCookies(req)[DEVICE_COOKIE_NAME] || '';
    const [id = '', signature = ''] = value.split('.');
    if (id.length >= 32 && signature.length === 64) {
        const expected = Buffer.from(signDeviceId(id), 'hex');
        const actual = Buffer.from(signature, 'hex');
        if (actual.length === expected.length && timingSafeEqual(actual, expected)) return id;
    }
    const freshId = randomBytes(24).toString('base64url');
    const secure = process.env.AUTH_COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
    appendCookie(res, [
        `${DEVICE_COOKIE_NAME}=${freshId}.${signDeviceId(freshId)}`,
        'Path=/api/auth',
        `Max-Age=${365 * 24 * 60 * 60}`,
        'HttpOnly',
        'SameSite=Lax',
        ...(secure ? ['Secure'] : [])
    ].join('; '));
    return freshId;
};

const normalizedValue = (value: unknown): string => typeof value === 'string'
    ? value.trim().toLowerCase().slice(0, 320)
    : '';

const identitiesFor = (req: Request, fields: string[]): string[] => {
    const identities: string[] = [];
    for (const field of fields) {
        if (field === 'authenticatedUserId' && req.user?.userId) {
            identities.push(`user:${req.user.userId}`);
            continue;
        }
        const value = normalizedValue((req.body as Record<string, unknown> | undefined)?.[field]
            ?? (req.params as Record<string, string> | undefined)?.[field]);
        if (value) identities.push(`${field}:${value}`);
    }
    return [...new Set(identities)];
};

const increment = async (scope: string, dimension: string, nowMs: number): Promise<number> => {
    const windowStartedAt = new Date(Math.floor(nowMs / WINDOW_MS) * WINDOW_MS);
    const expiresAt = new Date(windowStartedAt.getTime() + WINDOW_MS * 2);
    const keyHash = hashSessionSecret(`auth-rate:${scope}:${windowStartedAt.toISOString()}:${dimension}`);
    const row = await db.authRateLimit.upsert({
        where: { keyHash },
        create: { keyHash, count: 1, windowStartedAt, expiresAt },
        update: { count: { increment: 1 }, expiresAt },
        select: { count: true }
    });
    return row.count;
};

export const authRateLimit = (scope: string, limit: number, identityFields: string[] = [], networkLimit = Math.max(500, limit * 50)) =>
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const now = Date.now();
            const observedHop = normalizedValue(req.ip || req.socket.remoteAddress || 'unknown');
            const networkCount = await increment(scope, `network:${observedHop}`, now);
            if (networkCount > networkLimit) {
                res.setHeader('Retry-After', String(Math.ceil(WINDOW_MS / 1000)));
                res.status(429).json({ error: 'Too many attempts. Please try again later.', code: 'RATE_LIMITED' });
                return;
            }
            const deviceId = readOrCreateDeviceId(req, res);
            // A signed browser capability prevents an upstream proxy address from
            // becoming a global bucket; the observed hop still contributes to the
            // HMAC key without ever being stored or logged in raw form.
            const clientKey = `client:${observedHop}:${deviceId}`;
            const identityKeys = identitiesFor(req, identityFields);
            const counts = await Promise.all([increment(scope, clientKey, now), ...identityKeys.map((key) => increment(scope, key, now))]);
            if (counts.some((count) => count > limit)) {
                res.setHeader('Retry-After', String(Math.ceil(WINDOW_MS / 1000)));
                res.status(429).json({ error: 'Too many attempts. Please try again later.', code: 'RATE_LIMITED' });
                return;
            }
            next();
        } catch {
            res.status(503).json({ error: 'Authentication is temporarily unavailable', code: 'AUTH_RATE_LIMIT_UNAVAILABLE' });
        }
    };
