import assert from 'node:assert/strict';
import test from 'node:test';
import { getPostOptionCapabilities } from './postOptions.ts';

test('original post owners can edit and delete but cannot hide or report', () => {
  const capabilities = getPostOptionCapabilities({
    isAuthenticated: true,
    isPostOwner: true,
    isSourceOwner: true,
    isRepost: false,
    hasViewerPeopleTag: false
  });

  assert.equal(capabilities.canEdit, true);
  assert.equal(capabilities.canDelete, true);
  assert.equal(capabilities.canHide, false);
  assert.equal(capabilities.canReport, false);
});

test('repost owners can delete the repost but cannot edit its source', () => {
  const capabilities = getPostOptionCapabilities({
    isAuthenticated: true,
    isPostOwner: true,
    isSourceOwner: false,
    isRepost: true,
    hasViewerPeopleTag: false
  });

  assert.equal(capabilities.canEdit, false);
  assert.equal(capabilities.canDelete, true);
  assert.equal(capabilities.canFollowAuthor, true);
});

test('other users receive moderation and tag-removal actions', () => {
  const capabilities = getPostOptionCapabilities({
    isAuthenticated: true,
    isPostOwner: false,
    isSourceOwner: false,
    isRepost: false,
    hasViewerPeopleTag: true
  });

  assert.equal(capabilities.canHide, true);
  assert.equal(capabilities.canReport, true);
  assert.equal(capabilities.canRemovePeopleTag, true);
});

test('signed-out users can only copy the link', () => {
  const capabilities = getPostOptionCapabilities({
    isAuthenticated: false,
    isPostOwner: false,
    isSourceOwner: false,
    isRepost: false,
    hasViewerPeopleTag: false
  });

  assert.deepEqual(Object.entries(capabilities).filter(([, enabled]) => enabled).map(([name]) => name), ['canCopyLink']);
});
