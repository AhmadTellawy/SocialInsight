import assert from 'node:assert/strict';
import test from 'node:test';
import { mock } from 'node:test';
import type { Server } from 'node:http';

process.env.NODE_ENV = 'test';
process.env.RESTORE_MAINTENANCE = 'true';
const sockets = mock.method(require('../services/socketService'), 'initSocket', () => {});
const jobs = mock.method(require('../services/cronService'), 'initCronJobs', () => {});
const app = require('../app').default;

test('restore maintenance prevents HTTP/static access and socket/worker initialization', async () => {
    assert.equal(sockets.mock.callCount(), 0);
    assert.equal(jobs.mock.callCount(), 0);
    const server = await new Promise<Server>(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const port = (server.address() as { port: number }).port;
    try {
        for (const path of ['/', '/api/health', '/api/users/me', '/uploads/restored.png', '/socket.io/?EIO=4&transport=polling']) {
            const response = await fetch(`http://127.0.0.1:${port}${path}`);
            assert.equal(response.status, 503, path);
            assert.equal(response.headers.get('cache-control'), 'no-store');
            assert.deepEqual(await response.json(), { status: 'maintenance' });
        }
        const mutation = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST' });
        assert.equal(mutation.status, 503);
    } finally {
        await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
        mock.restoreAll();
    }
});
