import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { io as createClient, Socket as ClientSocket } from 'socket.io-client';
import { Decoder } from 'socket.io-parser';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'socket-test-secret-with-sufficient-length';

const socketService = require('./socketService') as typeof import('./socketService');
const secret = 'socket-integration-secret';

type TestTransport = 'websocket' | 'polling';

const connect = (
    url: string,
    token?: string,
    query?: Record<string, string>,
    transports: TestTransport[] = ['websocket'],
    reconnection = false
): Promise<ClientSocket> => {
    const client = createClient(url, {
        auth: token ? { token } : {},
        query,
        transports,
        forceNew: true,
        reconnection
    });
    return new Promise((resolve, reject) => {
        client.once('connect', () => resolve(client));
        client.once('connect_error', reject);
    });
};

const expectRejected = (url: string, token?: string, transports: TestTransport[] = ['websocket']): Promise<void> => {
    const client = createClient(url, {
        auth: token ? { token } : {},
        transports,
        forceNew: true,
        reconnection: false
    });
    return new Promise((resolve, reject) => {
        client.once('connect', () => reject(new Error('Expected socket connection to be rejected')));
        client.once('connect_error', (error) => {
            try {
                assert.equal(error.message, 'unauthorized');
                client.disconnect();
                resolve();
            } catch (assertionError) {
                reject(assertionError);
            }
        });
    });
};

test('rejects missing, invalid, expired, and inactive socket identities', async () => {
    const activeToken = jwt.sign({ userId: 'active-user' }, secret, { expiresIn: '1h' });
    const expiredToken = jwt.sign({ userId: 'active-user', exp: Math.floor(Date.now() / 1000) - 10 }, secret);
    const dependencies = {
        verifyToken: (token: string) => socketService.verifySocketJwt(token, secret),
        findAccountStatus: async (userId: string) => userId === 'inactive-user' ? 'DISABLED' : 'ACTIVE'
    };

    await assert.rejects(
        () => socketService.authenticateSocketToken(undefined, dependencies),
        (error: any) => error?.code === 'missing_token'
    );
    await assert.rejects(
        () => socketService.authenticateSocketToken('invalid-token', dependencies),
        (error: any) => error?.code === 'invalid_token'
    );
    await assert.rejects(
        () => socketService.authenticateSocketToken(expiredToken, dependencies),
        (error: any) => error?.code === 'invalid_token'
    );
    await assert.rejects(
        () => socketService.authenticateSocketToken(jwt.sign({ userId: 'inactive-user' }, secret), dependencies),
        (error: any) => error?.code === 'inactive_account'
    );
    assert.equal(await socketService.authenticateSocketToken(activeToken, dependencies), 'active-user');
});

test('derives rooms from JWT identity and isolates User B notifications from User A', async () => {
    const httpServer = createServer();
    const statuses = new Map([['user-a', 'ACTIVE'], ['user-b', 'ACTIVE']]);
    const socketServer = socketService.initSocket(httpServer, {
        authenticate: (token) => socketService.authenticateSocketToken(token, {
            verifyToken: (value) => socketService.verifySocketJwt(value, secret),
            findAccountStatus: async (userId) => statuses.get(userId) || null
        })
    });

    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const port = (httpServer.address() as AddressInfo).port;
    const url = `http://127.0.0.1:${port}`;
    const tokenA = jwt.sign({ userId: 'user-a' }, secret, { expiresIn: '1h' });
    const tokenB = jwt.sign({ userId: 'user-b' }, secret, { expiresIn: '1h' });
    const expired = jwt.sign({ userId: 'user-a', exp: Math.floor(Date.now() / 1000) - 10 }, secret);
    const inactive = jwt.sign({ userId: 'inactive-user' }, secret, { expiresIn: '1h' });

    await expectRejected(url);
    await expectRejected(url, 'invalid-token');
    await expectRejected(url, expired);
    await expectRejected(url, inactive);

    const userA = await connect(url, tokenA, { userId: 'user-b' }, ['websocket'], true);
    const userB = await connect(url, tokenB);

    assert.equal(socketServer.sockets.adapter.rooms.get(socketService.getUserNotificationRoom('user-a'))?.size, 1);
    assert.equal(socketServer.sockets.adapter.rooms.get(socketService.getUserNotificationRoom('user-b'))?.size, 1);
    assert.equal(socketServer.sockets.adapter.rooms.has('user-b'), false);

    const reconnected = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Socket client did not reconnect')), 3000);
        userA.once('connect', () => {
            clearTimeout(timer);
            resolve();
        });
    });
    userA.io.engine?.close();
    await reconnected;
    assert.equal(socketServer.sockets.adapter.rooms.get(socketService.getUserNotificationRoom('user-a'))?.size, 1);
    assert.equal(socketServer.sockets.adapter.rooms.get(socketService.getUserNotificationRoom('user-b'))?.size, 1);

    let userAReceived = false;
    userA.on('newNotification', () => { userAReceived = true; });
    const userBReceived = new Promise<void>((resolve) => userB.once('newNotification', () => resolve()));
    socketServer.to(socketService.getUserNotificationRoom('user-b')).emit('newNotification', { id: 'notification-b' });
    await userBReceived;
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(userAReceived, false);

    userA.disconnect();
    userB.disconnect();
    await new Promise<void>((resolve) => socketServer.close(() => resolve()));
});

test('authenticates polling and websocket transports and does not retain rejected polling clients', async () => {
    const httpServer = createServer();
    const socketServer = socketService.initSocket(httpServer, {
        authenticate: async (token) => {
            if (token !== 'allowed') throw new socketService.SocketAuthenticationError('invalid_token');
            return 'transport-user';
        }
    });

    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const port = (httpServer.address() as AddressInfo).port;
    const url = `http://127.0.0.1:${port}`;
    let polling: ClientSocket | undefined;
    let websocket: ClientSocket | undefined;
    try {
        await Promise.all(Array.from({ length: 8 }, () => expectRejected(url, undefined, ['polling'])));
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(socketServer.engine.clientsCount, 0);

        polling = await connect(url, 'allowed', undefined, ['polling']);
        websocket = await connect(url, 'allowed', undefined, ['websocket']);
        assert.equal(socketServer.engine.clientsCount, 2);
        assert.equal(socketServer.sockets.adapter.rooms.get(socketService.getUserNotificationRoom('transport-user'))?.size, 2);
    } finally {
        polling?.disconnect();
        websocket?.disconnect();
        await new Promise<void>((resolve) => socketServer.close(() => resolve()));
    }
});

test('rejects the zero-attachment binary packet fixed by socket.io-parser 4.2.7', () => {
    const decoder = new Decoder();
    let decoded = false;
    decoder.on('decoded', () => { decoded = true; });

    assert.throws(() => decoder.add('50-["event"]'), /Illegal attachments/);
    assert.equal(decoded, false);
    decoder.destroy();
});

test('disconnects a client that exceeds the configured binary message limit', async () => {
    const httpServer = createServer();
    const socketServer = socketService.initSocket(httpServer, {
        authenticate: async () => 'bounded-user',
        maxHttpBufferSize: 1024
    });

    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const port = (httpServer.address() as AddressInfo).port;
    const client = await connect(`http://127.0.0.1:${port}`, 'allowed');
    const disconnected = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Oversized binary payload was not disconnected')), 3000);
        client.once('disconnect', () => {
            clearTimeout(timer);
            resolve();
        });
    });

    client.emit('oversized', Buffer.alloc(2048));
    await disconnected;
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(socketServer.engine.clientsCount, 0);

    await new Promise<void>((resolve) => socketServer.close(() => resolve()));
});
