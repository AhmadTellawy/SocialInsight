import { NextFunction, Request, Response } from 'express';
import { CSRF_COOKIE_NAME, csrfMatchesSession, readCookies } from '../services/sessionService';

const allowedOrigins = (): Set<string> => new Set(
    (process.env.AUTH_ALLOWED_ORIGINS || process.env.CLIENT_URL || 'http://localhost:3000')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => {
            try { return new URL(value).origin; } catch { return ''; }
        })
        .filter(Boolean)
);

export const isTrustedOrigin = (req: Request): boolean => {
    const origin = req.header('origin');
    return Boolean(origin && allowedOrigins().has(origin));
};

export const hasValidCsrf = (req: Request): boolean => {
    const headerToken = req.header('x-csrf-token') || '';
    const cookieToken = readCookies(req)[CSRF_COOKIE_NAME] || '';
    return Boolean(req.authSession && headerToken && headerToken === cookieToken && csrfMatchesSession(req.authSession, headerToken));
};

export const requireTrustedOrigin = (req: Request, res: Response, next: NextFunction): void => {
    if (!isTrustedOrigin(req)) {
        res.status(403).json({ error: 'Request could not be verified', code: 'ORIGIN_REJECTED' });
        return;
    }
    next();
};

export const requireCsrf = (req: Request, res: Response, next: NextFunction): void => {
    if (!isTrustedOrigin(req)) {
        res.status(403).json({ error: 'Request could not be verified', code: 'ORIGIN_REJECTED' });
        return;
    }

    if (!hasValidCsrf(req)) {
        res.status(403).json({ error: 'Request could not be verified', code: 'CSRF_REJECTED' });
        return;
    }
    next();
};
