import { Server as HttpServer } from 'http';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { Server, Socket } from 'socket.io';
import prisma from '../prisma';
import { JWT_SECRET } from '../middleware/authMiddleware';

let io: Server;

type SocketAuthFailureCode = 'missing_token' | 'invalid_token' | 'inactive_account';

export class SocketAuthenticationError extends Error {
    constructor(public readonly code: SocketAuthFailureCode) {
        super('Socket authentication failed');
        this.name = 'SocketAuthenticationError';
    }
}

export interface SocketAuthDependencies {
    verifyToken: (token: string) => string;
    findAccountStatus: (userId: string) => Promise<string | null>;
}

export const verifySocketJwt = (token: string, secret: string = JWT_SECRET): string => {
    const decoded = jwt.verify(token, secret) as JwtPayload | string;
    if (typeof decoded === 'string' || typeof decoded.userId !== 'string' || !decoded.userId) {
        throw new SocketAuthenticationError('invalid_token');
    }
    return decoded.userId;
};

const defaultSocketAuthDependencies: SocketAuthDependencies = {
    verifyToken: verifySocketJwt,
    findAccountStatus: async (userId) => {
        const account = await prisma.user.findUnique({
            where: { id: userId },
            select: { status: true }
        });
        return account?.status || null;
    }
};

export const getUserNotificationRoom = (userId: string): string => `user:${userId}`;

export const authenticateSocketToken = async (
    token: unknown,
    dependencies: SocketAuthDependencies = defaultSocketAuthDependencies
): Promise<string> => {
    if (typeof token !== 'string' || !token.trim()) {
        throw new SocketAuthenticationError('missing_token');
    }

    let userId: string;
    try {
        userId = dependencies.verifyToken(token);
    } catch (error) {
        if (error instanceof SocketAuthenticationError) throw error;
        throw new SocketAuthenticationError('invalid_token');
    }

    const status = await dependencies.findAccountStatus(userId);
    if (status !== 'ACTIVE') {
        throw new SocketAuthenticationError('inactive_account');
    }

    return userId;
};

interface SocketServerOptions {
    authenticate?: (token: unknown) => Promise<string>;
    maxHttpBufferSize?: number;
}

export const DEFAULT_SOCKET_MAX_HTTP_BUFFER_BYTES = 1024 * 1024;

export const initSocket = (server: HttpServer, options: SocketServerOptions = {}) => {
    io = new Server(server, {
        maxHttpBufferSize: options.maxHttpBufferSize ?? DEFAULT_SOCKET_MAX_HTTP_BUFFER_BYTES,
        cors: {
            origin: process.env.CLIENT_URL || 'http://localhost:3000',
            methods: ['GET', 'POST'],
            credentials: true,
        }
    });

    const authenticate = options.authenticate || authenticateSocketToken;

    io.use(async (socket, next) => {
        try {
            const userId = await authenticate(socket.handshake.auth?.token);
            socket.data.userId = userId;
            next();
        } catch (error) {
            const reason = error instanceof SocketAuthenticationError ? error.code : 'invalid_token';
            console.warn(JSON.stringify({ event: 'socket_auth_failed', reason }));
            next(new Error('unauthorized'));
        }
    });

    io.on('connection', (socket: Socket) => {
        const userId = socket.data.userId as string;
        const room = getUserNotificationRoom(userId);
        socket.join(room);
        console.info(JSON.stringify({ event: 'socket_connected', userId }));

        socket.on('disconnect', () => {
            console.info(JSON.stringify({ event: 'socket_disconnected', userId }));
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) {
        console.warn('Socket.io has not been initialized yet!');
    }
    return io;
};
