import test from 'node:test';
import assert from 'node:assert/strict';
import { shareWithFileFallback } from './nativeShare.ts';

const data = { title: 'Post', text: 'Hello', url: 'https://example.com/post/1' };
const file = new File(['image'], 'card.png', { type: 'image/png' });

test('native cancellation never retries or reopens a second picker', async () => {
  const calls: ShareData[] = [];
  const result = await shareWithFileFallback({ canShare: () => true, share: async value => {
    calls.push(value); throw new DOMException('Cancelled', 'AbortError');
  } }, data, file);
  assert.equal(result, 'cancelled');
  assert.equal(calls.length, 1);
});

test('unsupported file capability sends a link once', async () => {
  const calls: ShareData[] = [];
  assert.equal(await shareWithFileFallback({ canShare: () => false, share: async value => { calls.push(value); } }, data, file), 'shared');
  assert.deepEqual(calls, [data]);
});

test('file data rejection falls back once to a link', async () => {
  const calls: ShareData[] = [];
  assert.equal(await shareWithFileFallback({ canShare: () => true, share: async value => {
    calls.push(value); if (calls.length === 1) throw new TypeError('Files unsupported');
  } }, data, file), 'shared');
  assert.deepEqual(calls[0].files, [file]);
  assert.deepEqual(calls[1], data);
});

test('cancelling the capability fallback is terminal', async () => {
  let count = 0;
  const result = await shareWithFileFallback({ canShare: () => true, share: async () => {
    count++; if (count === 1) throw new TypeError();
    throw new DOMException('Cancelled', 'AbortError');
  } }, data, file);
  assert.equal(result, 'cancelled');
  assert.equal(count, 2);
});

test('permission and network failures propagate without reopening', async () => {
  let count = 0;
  await assert.rejects(shareWithFileFallback({ canShare: () => true, share: async () => {
    count++; throw new DOMException('Denied', 'NotAllowedError');
  } }, data, file), { name: 'NotAllowedError' });
  assert.equal(count, 1);
});

test('browsers without canShare use text and URL', async () => {
  const calls: ShareData[] = [];
  const nav = { share: async (value: ShareData) => { calls.push(value); } } as Navigator;
  await shareWithFileFallback(nav, data, file);
  assert.deepEqual(calls, [data]);
});
