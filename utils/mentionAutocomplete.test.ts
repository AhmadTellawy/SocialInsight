import assert from 'node:assert/strict';
import test from 'node:test';
import { createMentionSearchScheduler } from './mentionAutocomplete.ts';

test('debounces fast typing and executes only the latest query', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const queries: string[] = [];
  const rendered: string[][] = [];
  const scheduler = createMentionSearchScheduler<string>(async (query) => {
    queries.push(query);
    return [query];
  }, 15);

  scheduler.schedule('a', { onSuccess: (results) => rendered.push(results) });
  context.mock.timers.tick(5);
  scheduler.schedule('ah', { onSuccess: (results) => rendered.push(results) });
  context.mock.timers.tick(14);
  assert.deepEqual(queries, []);
  context.mock.timers.tick(1);
  await Promise.resolve();

  assert.deepEqual(queries, ['ah']);
  assert.deepEqual(rendered, [['ah']]);
});

test('aborts the previous request and ignores a stale late response', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let resolveFirst: ((value: string[]) => void) | undefined;
  let firstSignal: AbortSignal | undefined;
  const rendered: string[][] = [];
  const scheduler = createMentionSearchScheduler<string>((query, signal) => {
    if (query === 'a') {
      firstSignal = signal;
      return new Promise<string[]>((resolve) => { resolveFirst = resolve; });
    }
    return Promise.resolve([query]);
  }, 0);

  scheduler.schedule('a', { onSuccess: (results) => rendered.push(results) });
  context.mock.timers.tick(0);
  scheduler.schedule('ah', { onSuccess: (results) => rendered.push(results) });
  assert.equal(firstSignal?.aborted, true);
  context.mock.timers.tick(0);
  await Promise.resolve();
  resolveFirst?.(['stale-a']);
  await Promise.resolve();

  assert.equal(firstSignal?.aborted, true);
  assert.deepEqual(rendered, [['ah']]);
});
