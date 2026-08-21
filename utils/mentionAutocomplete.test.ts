import assert from 'node:assert/strict';
import test from 'node:test';
import { createMentionSearchScheduler } from './mentionAutocomplete.ts';

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('debounces fast typing and executes only the latest query', async () => {
  const queries: string[] = [];
  const rendered: string[][] = [];
  const scheduler = createMentionSearchScheduler<string>(async (query) => {
    queries.push(query);
    return [query];
  }, 15);

  scheduler.schedule('a', { onSuccess: (results) => rendered.push(results) });
  await wait(5);
  scheduler.schedule('ah', { onSuccess: (results) => rendered.push(results) });
  await wait(30);

  assert.deepEqual(queries, ['ah']);
  assert.deepEqual(rendered, [['ah']]);
});

test('aborts the previous request and ignores a stale late response', async () => {
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
  await wait(5);
  scheduler.schedule('ah', { onSuccess: (results) => rendered.push(results) });
  await wait(5);
  resolveFirst?.(['stale-a']);
  await wait(5);

  assert.equal(firstSignal?.aborted, true);
  assert.deepEqual(rendered, [['ah']]);
});
