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
const prisma = require('../prisma').default as any;
const noBudget = async () => true;

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
    forwardedFor?: string;
}

const clientOptions = (credentials: ClientCredentials) => ({
    auth: credentials.authToken ? { token: credentials.authToken } : {},
    query: credentials.query,
    extraHeaders: {
        Origin: credentials.origin || trustedOrigin,
        ...(credentials.cookie ? { Cookie: credentials.cookie } : {}),
        ...(credentials.forwardedFor ? { 'X-Forwarded-For': credentials.forwardedFor } : {})
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
    const socketServer = socketService.initSocket(httpServer, { authenticate, consumeHandshakeBudget: noBudget });

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

test('an established socket is disconnected when its session expires', async () => {
    const httpServer = createServer();
    const socketServer = socketService.initSocket(httpServer, {authenticate: async () => ({userId:'expiry-user',sessionId:'expiry-session',expiresAt:new Date(Date.now()+350)}),consumeHandshakeBudget:noBudget});
    await new Promise<void>(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
    const url=`http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
    const client=await connect(url,{});
    try {
        await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Expired socket stayed connected')),1500);client.once('disconnect',()=>{clearTimeout(timer);resolve();});});
        assert.equal(client.connected,false);
    } finally {client.disconnect();await new Promise<void>(resolve=>socketServer.close(()=>resolve()));}
});

test('notification delivery rechecks durable sessions and disconnects revoked sockets', async () => {
    const original=prisma.authSession.findMany;
    const httpServer=createServer();let counter=0;
    const socketServer=socketService.initSocket(httpServer,{authenticate:async()=>({userId:'recipient',sessionId:`delivery-${++counter}`,expiresAt:new Date(Date.now()+60000)}),consumeHandshakeBudget:noBudget});
    await new Promise<void>(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
    const url=`http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`, active=await connect(url,{}),revoked=await connect(url,{});
    try {
        let query:any,revokedReceived=false;
        prisma.authSession.findMany=async(args:any)=>{query=args;return[{id:'delivery-1',lastUsedAt:new Date()}];};
        revoked.on('newNotification',()=>{revokedReceived=true;});
        const got=new Promise<void>(resolve=>active.once('newNotification',()=>resolve()));
        const disconnected=new Promise<void>(resolve=>revoked.once('disconnect',()=>resolve()));
        await socketService.emitToAuthorizedUserNotifications('recipient','newNotification',{id:'safe'});
        await Promise.all([got,disconnected]);
        assert.equal(query.where.userId,'recipient');assert.equal(query.where.user.status,'ACTIVE');assert.equal(query.where.revokedAt,null);assert.ok(query.where.expiresAt.gt instanceof Date);assert.equal(revokedReceived,false);
    } finally {prisma.authSession.findMany=original;active.disconnect();revoked.disconnect();await new Promise<void>(resolve=>socketServer.close(()=>resolve()));}
});

test('Socket handshake budgets use the first untrusted forwarded address', async () => {
    const previousTrustedHops = process.env.TRUST_PROXY_HOPS;
    process.env.TRUST_PROXY_HOPS = '1';
    const httpServer = createServer();
    const observed: Array<{ stage: string; network: string }> = [];
    const socketServer = socketService.initSocket(httpServer, {
        authenticate: async () => ({ userId: 'proxy-user', sessionId: 'proxy-session', expiresAt: new Date(Date.now() + 60_000) }),
        consumeHandshakeBudget: async (stage, identity) => {
            observed.push({ stage, network: identity.network });
            return true;
        }
    });
    let client: ClientSocket | undefined;
    try {
        await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
        const url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
        client = await connect(url, { forwardedFor: '198.51.100.250, 203.0.113.99' });
        assert.deepEqual(observed, [
            { stage: 'network', network: '203.0.113.99' },
            { stage: 'identity', network: '203.0.113.99' }
        ]);
    } finally {
        client?.disconnect();
        await new Promise<void>((resolve) => socketServer.close(() => resolve()));
        if (previousTrustedHops === undefined) delete process.env.TRUST_PROXY_HOPS;
        else process.env.TRUST_PROXY_HOPS = previousTrustedHops;
    }
});

test('Socket server disables compression and applies a bounded payload and heartbeat policy', async () => {
    const httpServer = createServer();
    const socketServer = socketService.initSocket(httpServer, {authenticate: async () => ({userId:'policy-user',sessionId:'policy-session',expiresAt:new Date(Date.now()+60000)}), consumeHandshakeBudget:noBudget});
    try {
        await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
        const options = (socketServer as any).engine.opts;
        assert.equal(options.maxHttpBufferSize, 64 * 1024);
        assert.equal(options.perMessageDeflate, false);
        assert.equal(options.pingInterval, 25_000);
        assert.equal(options.pingTimeout, 20_000);
    } finally { await new Promise<void>((resolve) => socketServer.close(() => resolve())); }
});

test('database handshake budgets reject bursts and fail closed on store outage', async () => {
    const original = prisma.authRateLimit.upsert;
    const previousLimit = process.env.SOCKET_HANDSHAKE_NETWORK_PER_MINUTE;
    process.env.SOCKET_HANDSHAKE_NETWORK_PER_MINUTE = '10';
    const counts = new Map<string, number>();
    try {
        prisma.authRateLimit.upsert = async ({where}: any) => {
            const next = (counts.get(where.keyHash) || 0) + 1;
            counts.set(where.keyHash, next);
            return {count: next};
        };
        for (let attempt = 1; attempt <= 10; attempt += 1) {
            assert.equal(await socketService.consumeSocketHandshakeBudget('network', {network:'fixture-network'}), true);
        }
        assert.equal(await socketService.consumeSocketHandshakeBudget('network', {network:'fixture-network'}), false);
        prisma.authRateLimit.upsert = async () => { throw new Error('database unavailable'); };
        await assert.rejects(socketService.consumeSocketHandshakeBudget('identity', {network:'n',userId:'u',sessionId:'s'}), /database unavailable/);
    } finally {
        prisma.authRateLimit.upsert = original;
        if (previousLimit === undefined) delete process.env.SOCKET_HANDSHAKE_NETWORK_PER_MINUTE;
        else process.env.SOCKET_HANDSHAKE_NETWORK_PER_MINUTE = previousLimit;
    }
});

test('local connection reservations release capacity for reconnects', () => {
    const previous = process.env.SOCKET_OPEN_USER_LIMIT;
    process.env.SOCKET_OPEN_USER_LIMIT = '1';
    try {
        const first = socketService.reserveLocalSocketConnection({network:'n-reconnect',userId:'u-reconnect',sessionId:'s-reconnect'});
        assert.equal(typeof first, 'function');
        assert.equal(socketService.reserveLocalSocketConnection({network:'n-reconnect',userId:'u-reconnect',sessionId:'s-reconnect'}), null);
        first!();
        const reconnected = socketService.reserveLocalSocketConnection({network:'n-reconnect',userId:'u-reconnect',sessionId:'s-reconnect'});
        assert.equal(typeof reconnected, 'function');
        reconnected!();
    } finally {
        if (previous === undefined) delete process.env.SOCKET_OPEN_USER_LIMIT; else process.env.SOCKET_OPEN_USER_LIMIT = previous;
    }
});

test('periodic session revalidation disconnects on idle/revoked state and database outage', async () => {
    const originalFind = prisma.authSession.findMany;
    const originalUpdate = prisma.authSession.updateMany;
    let disconnected = 0;
    const socket: any = {data:{sessionId:'session-revalidate',userId:'user-revalidate'},disconnect:()=>{disconnected += 1;}};
    try {
        prisma.authSession.findMany = async () => [];
        assert.equal(await socketService.revalidateSocketSession(socket), false);
        prisma.authSession.findMany = async () => { throw new Error('database unavailable'); };
        assert.equal(await socketService.revalidateSocketSession(socket), false);
        assert.equal(disconnected, 2);
    } finally { prisma.authSession.findMany = originalFind; prisma.authSession.updateMany = originalUpdate; }
});
