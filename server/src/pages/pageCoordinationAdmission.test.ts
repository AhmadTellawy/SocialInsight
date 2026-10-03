import assert from 'node:assert/strict';
import test from 'node:test';
import { withPageCoordinationAdmission } from './pageService';

const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
};

test('local Page admission is shared, writer-fair, and releases after failures', async () => {
  const pageId = '00000000-0000-4000-8000-000000000001';
  const firstRelease = deferred();
  const secondRelease = deferred();
  const writerRelease = deferred();
  const events: string[] = [];

  const first = withPageCoordinationAdmission([{ pageId, mode: 'shared' }], async () => {
    events.push('shared-1'); await firstRelease.promise;
  });
  const second = withPageCoordinationAdmission([{ pageId, mode: 'shared' }], async () => {
    events.push('shared-2'); await secondRelease.promise;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['shared-1', 'shared-2']);

  const writer = withPageCoordinationAdmission([{ pageId, mode: 'exclusive' }], async () => {
    events.push('writer'); await writerRelease.promise;
  });
  const lateReader = withPageCoordinationAdmission([{ pageId, mode: 'shared' }], async () => {
    events.push('late-reader');
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['shared-1', 'shared-2']);

  firstRelease.release(); secondRelease.release();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['shared-1', 'shared-2', 'writer']);
  writerRelease.release();
  await Promise.all([first, second, writer, lateReader]);
  assert.deepEqual(events, ['shared-1', 'shared-2', 'writer', 'late-reader']);

  await assert.rejects(withPageCoordinationAdmission([{ pageId, mode: 'exclusive' }], async () => {
    throw new Error('expected');
  }), /expected/);
  await withPageCoordinationAdmission([{ pageId, mode: 'shared' }], async () => undefined);
});
