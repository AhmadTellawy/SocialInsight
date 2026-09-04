import assert from 'node:assert/strict';
import test from 'node:test';
import type { MediaDraft, MediaPurpose, UserProfile } from '../types.ts';
import { profileEditHasChanges, profileMediaDraftHasChanged } from './profileEditState.ts';

const mediaDraft = (
  overrides: Partial<MediaDraft> = {},
  purpose: MediaPurpose = 'PROFILE_AVATAR'
): MediaDraft => ({
  clientId: 'draft-1',
  file: null,
  previewUrl: '',
  purpose,
  status: 'editing',
  progress: 0,
  aspectRatio: 1,
  ...overrides
});

const persistedProfile = {
  name: 'Profile User',
  bio: 'Bio',
  birthday: '2000-01-02',
  avatarMediaId: undefined,
  coverMediaId: undefined
} satisfies Pick<UserProfile, 'name' | 'bio' | 'birthday' | 'avatarMediaId' | 'coverMediaId'>;

test('a provisional picker draft stays clean until the crop is applied', () => {
  assert.equal(profileMediaDraftHasChanged([], null), false);
  assert.equal(profileMediaDraftHasChanged([mediaDraft()], null), false);
  assert.equal(profileMediaDraftHasChanged([
    mediaDraft({
      status: 'queued',
      crop: { aspectRatio: 1, crop: { x: 0, y: 0, width: 1, height: 1 }, focalX: 0.5, focalY: 0.5 }
    })
  ], null), true);
});

test('persisted media is clean while replacement and removal are dirty', () => {
  const persisted = mediaDraft({
    clientId: 'persisted-avatar',
    status: 'ready',
    progress: 100,
    assetId: 'avatar-1',
    persisted: true
  });
  assert.equal(profileMediaDraftHasChanged([persisted], 'avatar-1'), false);
  assert.equal(profileMediaDraftHasChanged([
    mediaDraft({ clientId: 'provisional-replacement', replacedDraft: persisted })
  ], 'avatar-1'), false);
  const adoptedReplacement = mediaDraft({
    clientId: 'adopted-replacement',
    status: 'ready',
    progress: 100,
    assetId: 'avatar-2'
  });
  assert.equal(profileMediaDraftHasChanged([
    mediaDraft({ clientId: 'second-provisional-replacement', replacedDraft: adoptedReplacement })
  ], 'avatar-1'), true);
  assert.equal(profileMediaDraftHasChanged([], 'avatar-1'), true);
  assert.equal(profileMediaDraftHasChanged([
    mediaDraft({ assetId: 'avatar-2', status: 'ready', progress: 100 })
  ], 'avatar-1'), true);
});

test('profile and adopted media changes are composed consistently', () => {
  assert.equal(profileEditHasChanges(persistedProfile, persistedProfile, [], []), false);
  assert.equal(profileEditHasChanges({ ...persistedProfile, bio: 'Changed' }, persistedProfile, [], []), true);
  assert.equal(profileEditHasChanges(
    persistedProfile,
    persistedProfile,
    [mediaDraft({
      status: 'uploading',
      crop: { aspectRatio: 1, crop: { x: 0, y: 0, width: 1, height: 1 }, focalX: 0.5, focalY: 0.5 }
    })],
    []
  ), true);
});

test('nullable API text fields are equivalent to empty editable fields', () => {
  const nullablePersisted = { ...persistedProfile, bio: null } as unknown as typeof persistedProfile;
  assert.equal(profileEditHasChanges({ ...persistedProfile, bio: '' }, nullablePersisted, [], []), false);
});
