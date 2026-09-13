import { Server as HttpServer, IncomingMessage } from 'http';
import type { Request } from 'express';
import { Server, Socket } from 'socket.io';
import { resolveTrustedClientAddress } from '../config/trustedProxy';
import {
    AuthenticatedSession,
    findActiveSessionIds,
    hashSessionSecret,
    isSessionIdentityActive,
    onSessionRevocation,
    readCookies,
    resolveSession,
    SESSION_COOKIE_NAME
} from './sessionService';

let io: Server;
let removeRevocationListener: (() => void) | undefined;

type SocketAuthFailureCode = 'untrusted_origin' | 'missing_session' | 'invalid_session' | 'inactive_account';

export class SocketAuthenticationError extends Error {
    constructor(public readonly code: SocketAuthFailureCode) {
        super('Socket authentication failed');
        this.name = 'SocketAuthenticationError';
    }
}

export interface SocketAuthDependencies {
    resolveRequestSession: (request: Request) => Promise<AuthenticatedSession | null>;
    isRequestOriginTrusted: (request: Request) => boolean;
}

const toAuthRequest = (request: IncomingMessage): Request => ({
    headers: request.headers,
    header: (name: string) => {
        const value = request.headers[name.toLowerCase()];
        return Array.isArray(value) ? value[0] : value;
    }
} as unknown as Request);

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

const isSocketOriginTrusted = (request: Request): boolean => {
    const origin = request.header('origin');
    return Boolean(origin && allowedOrigins().has(origin));
};

const defaultSocketAuthDependencies: SocketAuthDependencies = {
    resolveRequestSession: resolveSession,
    isRequestOriginTrusted: isSocketOriginTrusted
};

export const getUserNotificationRoom = (userId: string): string => `user:${userId}`;

interface SocketIdentity {
    userId: string;
    sessionId?: string;
    expiresAt?: Date;
}

const authenticateSocketIdentityRequest = async (
    request: IncomingMessage,
    dependencies: SocketAuthDependencies = defaultSocketAuthDependencies
): Promise<SocketIdentity> => {
    const authRequest = toAuthRequest(request);

    if (!dependencies.isRequestOriginTrusted(authRequest)) {
        throw new SocketAuthenticationError('untrusted_origin');
    }
    if (!readCookies(authRequest)[SESSION_COOKIE_NAME]) {
        throw new SocketAuthenticationError('missing_session');
    }

    let session: AuthenticatedSession | null;
    try { session = await dependencies.resolveRequestSession(authRequest); } catch {
        throw new SocketAuthenticationError('invalid_session');
    }
    if (!session) throw new SocketAuthenticationError('invalid_session');
    if (session.user.status !== 'ACTIVE') throw new SocketAuthenticationError('inactive_account');
    return { userId: session.userId, sessionId: session.id, expiresAt: session.expiresAt };
};

export const authenticateSocketRequest = async (
    request: IncomingMessage,
    dependencies: SocketAuthDependencies = defaultSocketAuthDependencies
): Promise<string> => {
    return (await authenticateSocketIdentityRequest(request, dependencies)).userId;
};

interface SocketServerOptions {
    authenticate?: (request: IncomingMessage) => Promise<string | SocketIdentity>;
    consumeHandshakeBudget?: (stage: 'network' | 'identity', identity: { network: string; userId?: string; sessionId?: string }) => Promise<boolean>;
}

const socketBoundedInt = (name: string, fallback: number, min: number, max: number): number => {
    const parsed = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
};

const incrementSocketBudget = async (scope: string, dimension: string, windowMs: number): Promise<number> => {
    const now = Date.now();
    const windowStartedAt = new Date(Math.floor(now / windowMs) * windowMs);
    const expiresAt = new Date(windowStartedAt.getTime() + windowMs * 2);
    const keyHash = hashSessionSecret(`socket-rate:${scope}:${windowStartedAt.toISOString()}:${dimension}`);
    const row = await (prismaDb as any).authRateLimit.upsert({
        where: { keyHash },
        create: { keyHash, count: 1, windowStartedAt, expiresAt },
        update: { count: { increment: 1 }, expiresAt },
        select: { count: true }
    });
    return row.count;
};

// Database-backed handshake budgets survive restarts and apply across replicas.
export const consumeSocketHandshakeBudget = async (
    stage: 'network' | 'identity',
    identity: { network: string; userId?: string; sessionId?: string }
): Promise<boolean> => {
    const windowMs = 60_000;
    if (stage === 'network') {
        return await incrementSocketBudget('handshake-network', identity.network, windowMs)
            <= socketBoundedInt('SOCKET_HANDSHAKE_NETWORK_PER_MINUTE', 120, 10, 10_000);
    }
    const checks: Array<Promise<boolean>> = [];
    if (identity.userId) checks.push(incrementSocketBudget('handshake-user', identity.userId, windowMs)
        .then((count) => count <= socketBoundedInt('SOCKET_HANDSHAKE_USER_PER_MINUTE', 60, 5, 1_000)));
    if (identity.sessionId) checks.push(incrementSocketBudget('handshake-session', identity.sessionId, windowMs)
        .then((count) => count <= socketBoundedInt('SOCKET_HANDSHAKE_SESSION_PER_MINUTE', 30, 5, 500)));
    return (await Promise.all(checks)).every(Boolean);
};

const prismaDb = require('../prisma').default;
const openConnections = new Map<string, number>();

export const reserveLocalSocketConnection = (identity: { network: string; userId: string; sessionId?: string }): (() => void) | null => {
    const entries: Array<[string, number]> = [
        [`network:${identity.network}`, socketBoundedInt('SOCKET_OPEN_NETWORK_LIMIT', 50, 5, 10_000)],
        [`user:${identity.userId}`, socketBoundedInt('SOCKET_OPEN_USER_LIMIT', 5, 1, 100)]
    ];
    if (identity.sessionId) entries.push([`session:${identity.sessionId}`, socketBoundedInt('SOCKET_OPEN_SESSION_LIMIT', 2, 1, 20)]);
    if (entries.some(([key, limit]) => (openConnections.get(key) || 0) >= limit)) return null;
    entries.forEach(([key]) => openConnections.set(key, (openConnections.get(key) || 0) + 1));
    let released = false;
    return () => {
        if (released) return;
        released = true;
        entries.forEach(([key]) => {
            const next = (openConnections.get(key) || 1) - 1;
            if (next <= 0) openConnections.delete(key);
            else openConnections.set(key, next);
        });
    };
};

const isConfiguredOriginTrusted = (origin: string | undefined): boolean => {
    if (!origin) return false;
    const request = {
        headers: { origin },
        header: (name: string) => name.toLowerCase() === 'origin' ? origin : undefined
    } as unknown as Request;
    return isSocketOriginTrusted(request);
};

export const initSocket = (server: HttpServer, options: SocketServerOptions = {}) => {
    io = new Server(server, {
        maxHttpBufferSize: socketBoundedInt('SOCKET_MAX_HTTP_BUFFER_BYTES', 64 * 1024, 1024, 256 * 1024),
        perMessageDeflate: false,
        pingInterval: socketBoundedInt('SOCKET_PING_INTERVAL_MS', 25_000, 5_000, 60_000),
        pingTimeout: socketBoundedInt('SOCKET_PING_TIMEOUT_MS', 20_000, 5_000, 60_000),
        cors: {
            origin: (origin, callback) => callback(null, isConfiguredOriginTrusted(origin)),
            methods: ['GET', 'POST'],
            credentials: true,
        }
    });

    const authenticate = options.authenticate || authenticateSocketIdentityRequest;
    const consumeHandshakeBudget = options.consumeHandshakeBudget || consumeSocketHandshakeBudget;

    io.use(async (socket, next) => {
        const network = resolveTrustedClientAddress(
            socket.request.socket.remoteAddress || socket.handshake.address,
            socket.request.headers['x-forwarded-for']
        );
        try {
            if (!await consumeHandshakeBudget('network', { network })) return next(new Error('rate_limited'));
            const identity = await authenticate(socket.request);
            socket.data.userId = typeof identity === 'string' ? identity : identity.userId;
            socket.data.sessionId = typeof identity === 'string' ? undefined : identity.sessionId;
            socket.data.sessionExpiresAt = typeof identity === 'string' ? undefined : identity.expiresAt?.getTime();
            socket.data.network = network;
            if (!await consumeHandshakeBudget('identity', { network, userId: socket.data.userId, sessionId: socket.data.sessionId })) return next(new Error('rate_limited'));
            const releaseConnection = reserveLocalSocketConnection({ network, userId: socket.data.userId, sessionId: socket.data.sessionId });
            if (!releaseConnection) return next(new Error('connection_limit'));
            socket.data.releaseConnection = releaseConnection;
            next();
        } catch (error) {
            const reason = error instanceof SocketAuthenticationError ? error.code : 'invalid_session';
            console.warn(JSON.stringify({ event: 'socket_auth_failed', reason }));
            next(new Error('unauthorized'));
        }
    });

    io.on('connection', (socket: Socket) => {
        const userId = socket.data.userId as string;
        socket.join(getUserNotificationRoom(userId));
        let expiryTimer: ReturnType<typeof setTimeout> | undefined;
        let revalidationTimer: ReturnType<typeof setInterval> | undefined;
        let revalidationInFlight = false;
        const scheduleExpiry = () => {
            const remaining = Number(socket.data.sessionExpiresAt) - Date.now();
            if (!Number.isFinite(remaining)) return;
            if (remaining <= 0) { socket.disconnect(true); return; }
            expiryTimer = setTimeout(scheduleExpiry, Math.min(remaining, 2_147_000_000));
            expiryTimer.unref?.();
        };
        scheduleExpiry();
        if (socket.data.sessionId) {
            const configured = Number.parseInt(process.env.SOCKET_SESSION_REVALIDATE_SECONDS || '', 10);
            const intervalMs = Math.max(15, Math.min(300, Number.isFinite(configured) ? configured : 60)) * 1000;
            revalidationTimer = setInterval(async () => {
                if (revalidationInFlight || !socket.connected) return;
                revalidationInFlight = true;
                try {
                    await revalidateSocketSession(socket);
                } finally {
                    revalidationInFlight = false;
                }
            }, intervalMs);
            revalidationTimer.unref?.();
        }
        // This service is notification-only. Any application event arriving
        // from a client is outside the protocol and closes the connection.
        socket.onAny(() => socket.disconnect(true));
        console.info(JSON.stringify({ event: 'socket_connected' }));

        socket.on('disconnect', () => {
            if (expiryTimer) clearTimeout(expiryTimer);
            if (revalidationTimer) clearInterval(revalidationTimer);
            if (typeof socket.data.releaseConnection === 'function') socket.data.releaseConnection();
            console.info(JSON.stringify({ event: 'socket_disconnected' }));
        });
    });

    removeRevocationListener?.();
    removeRevocationListener = onSessionRevocation(({ sessionId, userId }) => {
        for (const socket of io.sockets.sockets.values()) {
            if ((sessionId && socket.data.sessionId === sessionId) || (userId && socket.data.userId === userId)) {
                socket.disconnect(true);
            }
        }
    });

    return io;
};

export const revalidateSocketSession = async (socket: Pick<Socket, 'data' | 'disconnect'>): Promise<boolean> => {
    try {
        const sessionId = socket.data.sessionId;
        const userId = socket.data.userId;
        if (typeof sessionId !== 'string' || typeof userId !== 'string' || !await isSessionIdentityActive(sessionId, userId)) {
            socket.disconnect(true);
            return false;
        }
        return true;
    } catch {
        socket.disconnect(true);
        return false;
    }
};

// Recheck durable authorization at delivery time, including revocations made by another process.
export const emitToAuthorizedUserNotifications = async (userId: string, event: string, payload: unknown): Promise<void> => {
    if (!io) return;
    const sockets = [...io.sockets.sockets.values()].filter(socket => socket.data.userId === userId);
    if (!sockets.length) return;
    const ids = sockets.map(socket => socket.data.sessionId).filter((id): id is string => typeof id === 'string');
    let allowed = new Set<string>();
    try {
        allowed = await findActiveSessionIds(ids, userId);
    } catch {
        // A database outage must not convert a stale connection into ongoing private access.
        sockets.forEach(socket => socket.disconnect(true));
        return;
    }
    for (const socket of sockets) {
        if (!allowed.has(socket.data.sessionId)) socket.disconnect(true);
        else socket.emit(event, payload);
    }
};

export const disconnectUserSockets = (userId: string): void => {
    if (!io) return;
    for (const socket of io.sockets.sockets.values()) {
        if (socket.data.userId === userId) socket.disconnect(true);
    }
};

export const getIO = () => {
    if (!io) {
        console.warn('Socket.io has not been initialized yet!');
    }
    return io;
};
