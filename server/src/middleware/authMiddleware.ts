import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../prisma';
import { AuthenticatedSession, resolveSession } from '../services/sessionService';
import { hasValidCsrf, isTrustedOrigin } from './csrfProtection';

// Deprecated compatibility export for legacy tests/importers. HTTP and Socket.IO
// authentication use opaque AuthSession records and never accept this value.
export const JWT_SECRET: string = process.env.JWT_SECRET?.trim() || '';

const legacyCompatEnabled = (): boolean => process.env.AUTH_LEGACY_BEARER_COMPAT === 'true' && Boolean(JWT_SECRET);
const legacyTtlSeconds = (): number => {
    const parsed = Number.parseInt(process.env.AUTH_LEGACY_BEARER_TTL_SECONDS || '', 10);
    return Math.max(300, Math.min(86_400, Number.isFinite(parsed) ? parsed : 3600));
};

export const createLegacyBearerToken = (userId: string): string | null => {
    if (!legacyCompatEnabled()) return null;
    return jwt.sign({ userId }, JWT_SECRET, { expiresIn: legacyTtlSeconds() });
};

const resolveLegacyBearer = async (req: Request): Promise<string | null> => {
    if (!legacyCompatEnabled()) return null;
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    try {
        const decoded = jwt.verify(header.slice(7), JWT_SECRET);
        if (typeof decoded !== 'object' || typeof decoded.userId !== 'string' || typeof decoded.iat !== 'number') return null;
        if (decoded.iat * 1000 < Date.now() - legacyTtlSeconds() * 1000) return null;
        const user = await prisma.user.findUnique({ where: { id: decoded.userId }, select: { status: true, passwordUpdatedAt: true, authInvalidatedAt: true } });
        if (user?.status !== 'ACTIVE') return null;
        if (user.passwordUpdatedAt && decoded.iat * 1000 < user.passwordUpdatedAt.getTime()) return null;
        if (user.authInvalidatedAt && decoded.iat * 1000 < user.authInvalidatedAt.getTime()) return null;
        return decoded.userId;
    } catch {
        return null;
    }
};

declare global {
    namespace Express {
        interface Request {
            user?: { userId: string; authMode?: 'session' | 'legacy_bearer' };
            authSession?: AuthenticatedSession;
        }
    }
}

export const requireAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let session: AuthenticatedSession | null;
    try {
        session = await resolveSession(req);
    } catch {
        res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED', requestId: req.requestId });
        return;
    }
    // During the explicitly enabled rollout window, an Authorization header is
    // treated as an intentional legacy-client signal even if the browser also
    // received the new cookie. Bearer auth is not CSRF-prone because the browser
    // cannot attach that header cross-site automatically.
    const legacyUserId = await resolveLegacyBearer(req);
    if (legacyUserId) {
        req.user = { userId: legacyUserId, authMode: 'legacy_bearer' };
        if (session) req.authSession = session;
        next();
        return;
    }
    if (session) {
        req.user = { userId: session.userId, authMode: 'session' };
        req.authSession = session;
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())
            && (!isTrustedOrigin(req) || !hasValidCsrf(req))) {
            res.status(403).json({ error: 'Request could not be verified', code: 'CSRF_REJECTED', requestId: req.requestId });
            return;
        }
        next();
        return;
    }
    res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED', requestId: req.requestId });
};

export const requireRecentAuth = (req: Request, res: Response, next: NextFunction): void => {
    const parsed = Number.parseInt(process.env.AUTH_RECENT_TTL_SECONDS || '', 10);
    const ttlSeconds = Number.isFinite(parsed) ? Math.max(60, Math.min(3600, parsed)) : 10 * 60;
    const createdAt = req.authSession?.createdAt;
    if (!createdAt || Date.now() - createdAt.getTime() > ttlSeconds * 1000) {
        res.status(401).json({
            error: 'Please sign in again before changing sign-in methods',
            code: 'REAUTHENTICATION_REQUIRED',
            requestId: req.requestId
        });
        return;
    }
    next();
};

export const optionalAuth = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
        const session = await resolveSession(req);
        if (session) {
            req.user = { userId: session.userId, authMode: 'session' };
            req.authSession = session;
        } else {
            const legacyUserId = await resolveLegacyBearer(req);
            if (legacyUserId) req.user = { userId: legacyUserId, authMode: 'legacy_bearer' };
        }
    } catch {
        // Anonymous access remains anonymous when an optional session is invalid.
    }
    next();
};
