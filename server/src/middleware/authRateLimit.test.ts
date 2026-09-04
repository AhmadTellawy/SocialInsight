import assert from 'node:assert/strict';
import test from 'node:test';

process.env.AUTH_SESSION_HASH_SECRET = process.env.AUTH_SESSION_HASH_SECRET || 'rate-limit-test-secret-at-least-32-bytes';

const prisma = require('../prisma').default as any;
const { authRateLimit } = require('./authRateLimit') as typeof import('./authRateLimit');

test('database-backed auth throttling limits by signed client capability and normalized identity', async () => {
    const originalUpsert = prisma.authRateLimit.upsert;
    const counts = new Map<string, number>();
    prisma.authRateLimit.upsert = async ({ where }: any) => {
        const count = (counts.get(where.keyHash) || 0) + 1;
        counts.set(where.keyHash, count);
        return { count };
    };
    try {
        const middleware = authRateLimit('login-test', 2, ['identifier']);
        const invoke = async (ip: string, identifier: string, cookie = '') => {
            const state: any = { status: 200, body: null, next: 0, headers: {} };
            const res: any = {
                setHeader: (name: string, value: string) => { state.headers[name] = value; },
                getHeader: (name: string) => state.headers[name],
                status: (status: number) => { state.status = status; return res; },
                json: (body: unknown) => { state.body = body; return res; }
            };
            await middleware({ ip, socket: {}, headers: cookie ? { cookie } : {}, body: { identifier }, params: {} } as any, res, () => { state.next += 1; });
            return state;
        };

        const first = await invoke('203.0.113.10', 'User@Example.Test');
        assert.equal(first.next, 1);
        const cookie = String(first.headers['Set-Cookie'][0]).split(';')[0];
        assert.equal((await invoke('203.0.113.10', 'user@example.test', cookie)).next, 1);
        const blocked = await invoke('203.0.113.10', 'USER@example.test', cookie);
        assert.equal(blocked.status, 429);
        assert.equal(blocked.body.code, 'RATE_LIMITED');
        assert.ok(Number(blocked.headers['Retry-After']) > 0);
        assert.equal(counts.size, 3, 'network, signed client, and identifier values are represented only by separate hashes');
    } finally {
        prisma.authRateLimit.upsert = originalUpsert;
    }
});

test('deleting the device cookie cannot bypass the independent server-observed network ceiling', async () => {
    const originalUpsert = prisma.authRateLimit.upsert;
    const counts = new Map<string, number>();
    prisma.authRateLimit.upsert = async ({ where }: any) => {
        const count = (counts.get(where.keyHash) || 0) + 1;
        counts.set(where.keyHash, count);
        return { count };
    };
    try {
        const middleware = authRateLimit('oauth-cookie-reset-test', 1, [], 2);
        const invoke = async () => {
            const state: any = { status: 200, next: 0 };
            const res: any = { setHeader() {}, status(code: number) { state.status = code; return res; }, json() { return res; } };
            await middleware({ ip: '203.0.113.30', socket: {}, headers: {}, params: {}, body: {} } as any, res, () => { state.next += 1; });
            return state;
        };
        assert.equal((await invoke()).next, 1);
        assert.equal((await invoke()).next, 1);
        const blocked = await invoke();
        assert.equal(blocked.next, 0);
        assert.equal(blocked.status, 429);
        assert.equal(counts.size, 3, 'network rejection happens before a fresh client row can be created');
    } finally {
        prisma.authRateLimit.upsert = originalUpsert;
    }
});

test('OAuth provider names never create a global cross-user throttle bucket', async () => {
    const originalUpsert = prisma.authRateLimit.upsert;
    const counts = new Map<string, number>();
    prisma.authRateLimit.upsert = async ({ where }: any) => {
        const count = (counts.get(where.keyHash) || 0) + 1;
        counts.set(where.keyHash, count);
        return { count };
    };
    try {
        const middleware = authRateLimit('oauth-start-test', 1);
        const invoke = async (ip: string) => {
            let nextCalls = 0;
            const res: any = { setHeader() {}, status() { return res; }, json() { return res; } };
            await middleware({ ip, socket: {}, headers: {}, params: { provider: 'google' }, body: {} } as any, res, () => { nextCalls += 1; });
            return nextCalls;
        };
        assert.equal(await invoke('203.0.113.20'), 1);
        assert.equal(await invoke('203.0.113.21'), 1, 'a second client must not share a provider-global counter');
        assert.equal(counts.size, 4);
    } finally {
        prisma.authRateLimit.upsert = originalUpsert;
    }
});
