import assert from 'node:assert/strict';
import test from 'node:test';
import { captureInteractionVersions, reconcilePostCommentCounts, clearInteractions, evictInteraction, freshInteraction, interactionGeneration, interactionKey, readInteraction, writeInteraction } from './interactionCache.ts';

test('comments are isolated by account and post, and session reset invalidates in-flight generations', () => {
  clearInteractions();
  const first = interactionKey('a', 'comments', 'post');
  const other = interactionKey('b', 'comments', 'post');
  writeInteraction(first, { items: [{ id: 'private' }], totalCount: 1, nextCursor: null });
  assert.equal(readInteraction(other), undefined);
  const generation = interactionGeneration(); clearInteractions();
  assert.equal(readInteraction(first), undefined); assert.notEqual(generation, interactionGeneration());
});
test('confirmed mutations advance version and revocation removes cached content/count together', () => {
  const key = interactionKey('a', 'comments', 'p');
  writeInteraction(key, { items: [], totalCount: 0, nextCursor: null });
  const requestVersion = readInteraction(key)?.version;
  writeInteraction(key, { items: [{ id: 'saved' }], totalCount: 1, nextCursor: null });
  assert.notEqual(requestVersion, readInteraction(key)?.version);
  evictInteraction(key); assert.equal(readInteraction(key), undefined);
});
test('only fresh pages qualify for instant reopen', () => {
  const key = interactionKey('a', 'comments', 'p');
  writeInteraction(key, { items: [], totalCount: 0, nextCursor: null });
  assert.ok(freshInteraction(key));
  readInteraction(key)!.updatedAt = Date.now() - 30_001;
  assert.equal(freshInteraction(key), undefined);
});

test('fresh post counts reconcile without letting late reads erase confirmed mutations', () => {
  clearInteractions(); const key = interactionKey('a', 'comments', 'p');
  writeInteraction(key, { items: [], totalCount: 1, nextCursor: null });
  const oldRead = captureInteractionVersions();
  writeInteraction(key, { items: [{ id: 'saved' }], totalCount: 2, nextCursor: null });
  reconcilePostCommentCounts('a', [{ id: 'p', commentsCount: 1 }], oldRead);
  assert.equal(readInteraction(key)?.totalCount, 2);
  const freshRead = captureInteractionVersions();
  reconcilePostCommentCounts('a', [{ id: 'p', commentsCount: 3 }], freshRead);
  assert.equal(readInteraction(key)?.totalCount, 3);
  assert.deepEqual(readInteraction(key)?.items, [{ id: 'saved' }]);
  clearInteractions(); writeInteraction(key, { items: [], totalCount: 5, nextCursor: null });
  reconcilePostCommentCounts('a', [{ id: 'p', commentsCount: 3 }], freshRead);
  assert.equal(readInteraction(key)?.totalCount, 5);
});
