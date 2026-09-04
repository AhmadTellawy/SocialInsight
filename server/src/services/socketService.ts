import { Server as HttpServer, IncomingMessage } from 'http';
import type { Request } from 'express';
import { Server, Socket } from 'socket.io';
import {
    AuthenticatedSession,
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
    return { userId: session.userId, sessionId: session.id };
};

export const authenticateSocketRequest = async (
    request: IncomingMessage,
    dependencies: SocketAuthDependencies = defaultSocketAuthDependencies
): Promise<string> => {
    return (await authenticateSocketIdentityRequest(request, dependencies)).userId;
};

interface SocketServerOptions {
    authenticate?: (request: IncomingMessage) => Promise<string | SocketIdentity>;
}

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
        cors: {
            origin: (origin, callback) => callback(null, isConfiguredOriginTrusted(origin)),
            methods: ['GET', 'POST'],
            credentials: true,
        }
    });

    const authenticate = options.authenticate || authenticateSocketIdentityRequest;

    io.use(async (socket, next) => {
        try {
            const identity = await authenticate(socket.request);
            socket.data.userId = typeof identity === 'string' ? identity : identity.userId;
            socket.data.sessionId = typeof identity === 'string' ? undefined : identity.sessionId;
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
        console.info(JSON.stringify({ event: 'socket_connected' }));

        socket.on('disconnect', () => {
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
