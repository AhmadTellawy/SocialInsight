import assert from 'node:assert/strict';
import { createServer, IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { Request } from 'express';
import { io as createClient, Socket as ClientSocket } from 'socket.io-client';

const trustedOrigin = 'https://app.example.test';
process.env.AUTH_ALLOWED_ORIGINS = trustedOrigin;
process.env.AUTH_SESSION_HASH_SECRET = process.env.AUTH_SESSION_HASH_SECRET || 'socket-test-secret-with-sufficient-length';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'legacy-test-secret-with-sufficient-length';

const socketService = require('./socketService') as typeof import('./socketService');
const sessionService = require('./sessionService') as typeof import('./sessionService');

const requestWith = (cookie?: string, origin: string = trustedOrigin): IncomingMessage => ({
    headers: {
        ...(cookie ? { cookie } : {}),
        origin
    }
} as IncomingMessage);

const session = (userId: string, status: string = 'ACTIVE'): import('./sessionService').AuthenticatedSession => ({
    id: `session-${userId}`,
    userId,
    csrfHash: 'csrf-hash',
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    user: { status }
});

const cookieFor = (value: string): string => `${sessionService.SESSION_COOKIE_NAME}=${value}`;

test('rejects untrusted origins before disclosing whether a session exists', async () => {
    let resolverCalled = false;
    await assert.rejects(
        () => socketService.authenticateSocketRequest(requestWith(undefined, 'https://attacker.example'), {
            isRequestOriginTrusted: () => false,
            resolveRequestSession: async () => {
                resolverCalled = true;
                return null;
            }
        }),
        (error: any) => error?.code === 'untrusted_origin'
    );
    assert.equal(resolverCalled, false);
});

test('rejects missing, invalid, expired, revoked, and inactive session fixtures', async () => {
    const trusted = () => true;
    const fixtures = [
        { name: 'invalid', cookie: cookieFor('unknown-session-value-that-is-long-enough'), value: null },
        { name: 'expired', cookie: cookieFor('expired-session-value-that-is-long-enough'), value: null },
        { name: 'revoked', cookie: cookieFor('revoked-session-value-that-is-long-enough'), value: null }
    ];

    await assert.rejects(
        () => socketService.authenticateSocketRequest(requestWith(), {
            isRequestOriginTrusted: trusted,
            resolveRequestSession: async () => { throw new Error('resolver must not run without a cookie'); }
        }),
        (error: any) => error?.code === 'missing_session'
    );

    for (const fixture of fixtures) {
        await assert.rejects(
            () => socketService.authenticateSocketRequest(requestWith(fixture.cookie), {
                isRequestOriginTrusted: trusted,
                resolveRequestSession: async () => fixture.value
            }),
            (error: any) => error?.code === 'invalid_session',
            `${fixture.name} session must be rejected`
        );
    }

    await assert.rejects(
        () => socketService.authenticateSocketRequest(requestWith(cookieFor('inactive-session-value-that-is-long-enough')), {
            isRequestOriginTrusted: trusted,
            resolveRequestSession: async () => session('inactive-user', 'DISABLED')
        }),
        (error: any) => error?.code === 'inactive_account'
    );
});

test('derives identity from the HttpOnly session cookie and ignores auth/query identities', async () => {
    const resolved = session('session-user');
    const userId = await socketService.authenticateSocketRequest(
        requestWith(cookieFor('active-session-value-that-is-long-enough')),
        {
            isRequestOriginTrusted: (request: Request) => request.header('origin') === trustedOrigin,
            resolveRequestSession: async (request: Request) => {
                assert.equal(sessionService.readCookies(request)[sessionService.SESSION_COOKIE_NAME], 'active-session-value-that-is-long-enough');
                return resolved;
            }
        }
    );
    assert.equal(userId, 'session-user');
});

interface ClientCredentials {
    cookie?: string;
    origin?: string;
    authToken?: string;
    query?: Record<string, string>;
}

const clientOptions = (credentials: ClientCredentials) => ({
    auth: credentials.authToken ? { token: credentials.authToken } : {},
    query: credentials.query,
    extraHeaders: {
        Origin: credentials.origin || trustedOrigin,
        ...(credentials.cookie ? { Cookie: credentials.cookie } : {})
    },
    transports: ['polling'] as ['polling'],
    forceNew: true,
    reconnection: false,
    withCredentials: true
});

const connect = (url: string, credentials: ClientCredentials): Promise<ClientSocket> => {
    const client = createClient(url, clientOptions(credentials));
    return new Promise((resolve, reject) => {
        client.once('connect', () => resolve(client));
        client.once('connect_error', reject);
    });
};

const expectRejected = (url: string, credentials: ClientCredentials): Promise<void> => {
    const client = createClient(url, clientOptions(credentials));
    return new Promise((resolve, reject) => {
        client.once('connect', () => reject(new Error('Expected socket connection to be rejected')));
        client.once('connect_error', (error) => {
            client.disconnect();
            if (error.message === 'unauthorized') {
                resolve();
            } else {
                reject(error);
            }
        });
    });
};

test('cookie-authenticated sockets preserve room isolation across reconnects', async () => {
    const httpServer = createServer();
    const sessions = new Map<string, import('./sessionService').AuthenticatedSession | null>([
        ['active-a-session-value-that-is-long-enough', session('user-a')],
        ['active-b-session-value-that-is-long-enough', session('user-b')],
        ['inactive-session-value-that-is-long-enough', session('inactive-user', 'DISABLED')],
        ['expired-session-value-that-is-long-enough', null],
        ['revoked-session-value-that-is-long-enough', null]
    ]);
    const authenticate = (request: IncomingMessage) => socketService.authenticateSocketRequest(request, {
        isRequestOriginTrusted: (authRequest) => authRequest.header('origin') === trustedOrigin,
        resolveRequestSession: async (authRequest) => {
            const token = sessionService.readCookies(authRequest)[sessionService.SESSION_COOKIE_NAME];
            return sessions.get(token) ?? null;
        }
    });
    const socketServer = socketService.initSocket(httpServer, { authenticate });

    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const port = (httpServer.address() as AddressInfo).port;
    const url = `http://127.0.0.1:${port}`;

    await expectRejected(url, { authToken: 'legacy-jwt-must-not-work' });
    await expectRejected(url, { cookie: cookieFor('unknown-session-value-that-is-long-enough') });
    await expectRejected(url, { cookie: cookieFor('expired-session-value-that-is-long-enough') });
    await expectRejected(url, { cookie: cookieFor('revoked-session-value-that-is-long-enough') });
    await expectRejected(url, { cookie: cookieFor('inactive-session-value-that-is-long-enough') });
    await expectRejected(url, {
        cookie: cookieFor('active-a-session-value-that-is-long-enough'),
        origin: 'https://attacker.example'
    });

    const credentialsA = {
        cookie: cookieFor('active-a-session-value-that-is-long-enough'),
        authToken: 'forged-user-b-token',
        query: { userId: 'user-b' }
    };
    let userA = await connect(url, credentialsA);
    const userB = await connect(url, { cookie: cookieFor('active-b-session-value-that-is-long-enough') });

    assert.equal(socketServer.sockets.adapter.rooms.get(socketService.getUserNotificationRoom('user-a'))?.size, 1);
    assert.equal(socketServer.sockets.adapter.rooms.get(socketService.getUserNotificationRoom('user-b'))?.size, 1);
    assert.equal(socketServer.sockets.adapter.rooms.has('user-b'), false);

    userA.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 25));
    userA = await connect(url, credentialsA);
    assert.equal(socketServer.sockets.adapter.rooms.get(socketService.getUserNotificationRoom('user-a'))?.size, 1);
    assert.equal(socketServer.sockets.adapter.rooms.get(socketService.getUserNotificationRoom('user-b'))?.size, 1);

    let userAReceived = false;
    userA.on('newNotification', () => { userAReceived = true; });
    const userBReceived = new Promise<void>((resolve) => userB.once('newNotification', () => resolve()));
    socketServer.to(socketService.getUserNotificationRoom('user-b')).emit('newNotification', { id: 'notification-b' });
    await userBReceived;
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(userAReceived, false);

    const userADisconnected = new Promise<void>((resolve) => userA.once('disconnect', () => resolve()));
    sessionService.notifyUserSessionsRevoked('user-a');
    await userADisconnected;
    assert.equal(userA.connected, false);
    assert.equal(userB.connected, true);

    userB.disconnect();
    await new Promise<void>((resolve) => socketServer.close(() => resolve()));
});
