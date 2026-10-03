import assert from 'node:assert/strict';
import test, { after } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.RESTORE_MAINTENANCE = 'false';
process.env.DISABLE_BACKGROUND_JOBS = 'false';

const prisma = require('../prisma').default as typeof import('../prisma').default;
const { initializeRuntimeServices } = require('../app') as typeof import('../app');

after(async () => prisma.$disconnect());

test('runtime role verification fences every timer-backed worker', async () => {
    const failed: string[] = [];
    await assert.rejects(initializeRuntimeServices({
        verifyDatabaseRole: async () => { failed.push('verify'); throw new Error('unsafe runtime role'); },
        startCronJobs: () => { failed.push('cron'); },
        loadOutboxWorker: async () => ({ startPageOutboxWorker: () => { failed.push('outbox'); } }),
        loadLifecycleWorker: async () => ({ startPageLifecycleWorker: () => { failed.push('lifecycle'); } })
    }), /unsafe runtime role/);
    assert.deepEqual(failed, ['verify']);

    const importFailed: string[] = [];
    await assert.rejects(initializeRuntimeServices({
        verifyDatabaseRole: async () => { importFailed.push('verify'); },
        startCronJobs: () => { importFailed.push('cron'); },
        loadOutboxWorker: async () => { importFailed.push('load-outbox'); throw new Error('worker import failed'); },
        loadLifecycleWorker: async () => ({ startPageLifecycleWorker: () => { importFailed.push('lifecycle'); } })
    }), /worker import failed/);
    assert.deepEqual(importFailed, ['verify', 'load-outbox']);

    const passed: string[] = [];
    await initializeRuntimeServices({
        verifyDatabaseRole: async () => { passed.push('verify'); },
        startCronJobs: () => { passed.push('cron'); },
        loadOutboxWorker: async () => ({ startPageOutboxWorker: () => { passed.push('outbox'); } }),
        loadLifecycleWorker: async () => ({ startPageLifecycleWorker: () => { passed.push('lifecycle'); } })
    });
    assert.equal(passed[0], 'verify');
    assert.deepEqual(new Set(passed.slice(1)), new Set(['cron', 'outbox', 'lifecycle']));
});
