import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { io as createClient, Socket as ClientSocket } from 'socket.io-client';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'socket-test-secret-with-sufficient-length';

const socketService = require('./socketService') as typeof import('./socketService');
const secret = 'socket-integration-secret';

const connect = (url: string, token?: string, query?: Record<string, string>): Promise<ClientSocket> => {
    const client = createClient(url, {
        auth: token ? { token } : {},
        query,
        transports: ['websocket'],
        forceNew: true,
        reconnection: false
    });
    return new Promise((resolve, reject) => {
        client.once('connect', () => resolve(client));
        client.once('connect_error', reject);
    });
};

const expectRejected = (url: string, token?: string): Promise<void> => {
    const client = createClient(url, {
        auth: token ? { token } : {},
        transports: ['websocket'],
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

    await expectRejected(url);
    await expectRejected(url, 'invalid-token');
    await expectRejected(url, expired);

    let userA = await connect(url, tokenA, { userId: 'user-b' });
    const userB = await connect(url, tokenB);

    assert.equal(socketServer.sockets.adapter.rooms.get(socketService.getUserNotificationRoom('user-a'))?.size, 1);
    assert.equal(socketServer.sockets.adapter.rooms.get(socketService.getUserNotificationRoom('user-b'))?.size, 1);
    assert.equal(socketServer.sockets.adapter.rooms.has('user-b'), false);

    userA.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 25));
    userA = await connect(url, tokenA, { userId: 'user-b' });
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
