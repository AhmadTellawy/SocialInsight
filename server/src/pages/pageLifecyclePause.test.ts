import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../prisma';
import { startPageLifecycleWorker } from './pageLifecycleWorker';

test('scheduled Page lifecycle touches no data while disabled or paused and resumes when enabled', async () => {
  const names = ['PAGES_ENABLED', 'PAGES_TEST_USERS', 'PAGES_LIFECYCLE_PAUSED'] as const;
  const previous = names.map(name => process.env[name]);
  const originalInterval = global.setInterval, originalClear = global.clearInterval;
  let tick: (() => Promise<void>) | undefined, reads = 0, stopped = false;
  const timer = { unref() { return this; } };
  global.setInterval = ((callback: () => Promise<void>) => { tick = callback; return timer; }) as any;
  global.clearInterval = ((value: unknown) => { assert.equal(value, timer); stopped = true; }) as any;
  const restore: Array<() => void> = [];
  const replace = (target: any, key: string) => {
    const original = target[key]; target[key] = async () => { reads++; return []; };
    restore.push(() => { target[key] = original; });
  };
  replace(prisma.page, 'findMany'); replace(prisma, '$queryRaw');
  replace(prisma.pageInvitation, 'findMany'); replace(prisma.pageOwnershipTransfer, 'findMany');
  replace(prisma.pageAuditEvent, 'findMany');
  let stop: (() => void) | undefined;
  try {
    process.env.PAGES_ENABLED = 'false'; process.env.PAGES_TEST_USERS = 'pilot-only';
    delete process.env.PAGES_LIFECYCLE_PAUSED;
    stop = startPageLifecycleWorker(); assert.ok(tick);
    await tick(); assert.equal(reads, 0, 'pilot does not admit global erasure');
    process.env.PAGES_ENABLED = 'true'; process.env.PAGES_LIFECYCLE_PAUSED = 'true';
    await tick(); assert.equal(reads, 0, 'operational pause performs no DB work');
    process.env.PAGES_LIFECYCLE_PAUSED = 'false';
    await tick(); assert.equal(reads, 6, 'enabled cycle reads admission, jobs and retention');
    process.env.PAGES_ENABLED = 'false';
    await tick(); assert.equal(reads, 6, 'rollback stops subsequent cycles');
    stop(); stop = undefined; assert.equal(stopped, true);
  } finally {
    stop?.(); restore.reverse().forEach(reset => reset());
    global.setInterval = originalInterval; global.clearInterval = originalClear;
    names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
  }
});
