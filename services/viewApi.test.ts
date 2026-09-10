import assert from 'node:assert/strict';
import test from 'node:test';

let moduleId = 0;
async function fixture() {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key)
    } });
    const client = await import(`./api.ts?viewTest=${moduleId++}`);
    return { ...client, values };
}
const view = { source: 'FEED', deviceType: 'WEB' };

test('concurrent first guest views await one bootstrap and use cookie credentials with explicit actor', async () => {
    const { api } = await fixture();
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    let initializations = 0;
    const calls: any[] = [];
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (_url: unknown, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        assert.equal(init.credentials, 'include'); assert.equal(body.expectedActorId, null); assert.equal(body.guestSessionId, undefined);
        if (body.initialize) { initializations++; await ready; return Response.json({ initialized: true }); }
        calls.push(body); return Response.json({ recorded: true, viewCount: 1 });
    } });
    const pending = Promise.all(Array.from({ length: 10 }, (_, i) => api.recordPostView(`post-${i}`, view)));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(initializations, 1); assert.equal(calls.length, 0);
    release(); await pending; assert.equal(calls.length, 10); assert.equal(initializations, 1);
});

test('expired guest proof gets one renewed bootstrap and a bounded retry', async () => {
    const { api } = await fixture(); let initializations = 0, views = 0;
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (_url: unknown, init: RequestInit) => {
        if (JSON.parse(String(init.body)).initialize) { initializations++; return Response.json({ initialized: true }); }
        views++; return views === 1 ? Response.json({ code: 'VIEW_PROOF_REQUIRED' }, { status: 428 }) : Response.json({ recorded: false, viewCount: 4 });
    } });
    assert.equal((await api.recordPostView('post', view)).viewCount, 4); assert.equal(initializations, 2); assert.equal(views, 2);
});

test('persistently rejected proof does not create an unbounded retry loop', async () => {
    const { api } = await fixture(); let views = 0;
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (_url: unknown, init: RequestInit) => {
        if (JSON.parse(String(init.body)).initialize) return Response.json({ initialized: true });
        views++; return Response.json({ code: 'VIEW_PROOF_REQUIRED' }, { status: 428 });
    } });
    await assert.rejects(api.recordPostView('post', view), (error: any) => error.status === 428); assert.equal(views, 2);
});

test('account switching during guest initialization prevents reassignment of the pending view', async () => {
    const { api, values } = await fixture(); let views = 0;
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (_url: unknown, init: RequestInit) => {
        if (JSON.parse(String(init.body)).initialize) { values.set('si_auth_identity', 'new-account'); return Response.json({ initialized: true }); }
        views++; return Response.json({ recorded: true });
    } });
    await assert.rejects(api.recordPostView('post', view), (error: any) => error.code === 'VIEW_ACTOR_CHANGED'); assert.equal(views, 0);
});

test('registered views skip guest bootstrap and send remembered actor and CSRF metadata', async () => {
    const { api, values } = await fixture(); values.set('si_auth_identity', 'account'); values.set('si_csrf_token', 'synthetic-csrf-proof'); let calls = 0;
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (_url: unknown, init: RequestInit) => {
        const body = JSON.parse(String(init.body)); calls++;
        assert.equal(body.expectedActorId, 'account'); assert.equal(body.initialize, undefined);
        assert.equal(new Headers(init.headers).get('X-CSRF-Token'), 'synthetic-csrf-proof');
        return Response.json({ recorded: true, viewCount: 1 });
    } });
    await api.recordPostView('post', view); assert.equal(calls, 1);
});
