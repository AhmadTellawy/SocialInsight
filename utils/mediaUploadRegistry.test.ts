import assert from 'node:assert/strict';
import test from 'node:test';
import { mediaUploadRegistry } from './mediaUploadRegistry.ts';

test('canceling a draft aborts its active preparation controller and prevents late writes', () => {
  const controller = mediaUploadRegistry.create('draft-preparing');
  assert.equal(mediaUploadRegistry.isActive('draft-preparing', controller), true);

  mediaUploadRegistry.cancel('draft-preparing');

  assert.equal(controller.signal.aborted, true);
  assert.equal(mediaUploadRegistry.isActive('draft-preparing', controller), false);
});

test('a superseded attempt cannot become active again when it finishes late', () => {
  const first = mediaUploadRegistry.create('draft-retry');
  const second = mediaUploadRegistry.create('draft-retry');
  assert.equal(first.signal.aborted, true);
  assert.equal(mediaUploadRegistry.isActive('draft-retry', first), false);
  assert.equal(mediaUploadRegistry.isActive('draft-retry', second), true);

  mediaUploadRegistry.finish('draft-retry', first);
  assert.equal(mediaUploadRegistry.isActive('draft-retry', second), true);
  mediaUploadRegistry.cancel('draft-retry');
});
