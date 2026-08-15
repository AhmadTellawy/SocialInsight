import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaUploadScheduler } from './mediaUploadScheduler.ts';

test('limits parallel uploads to three while draining every queued task', async () => {
  const scheduler = new MediaUploadScheduler(3);
  let active = 0;
  let peak = 0;
  const completed: number[] = [];

  await Promise.all(Array.from({ length: 8 }, (_, index) => scheduler.schedule(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    completed.push(index);
    active -= 1;
  })));

  assert.equal(peak, 3);
  assert.equal(active, 0);
  assert.deepEqual(completed.slice().sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
});
