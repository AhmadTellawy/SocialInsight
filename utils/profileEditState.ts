import type { MediaDraft, UserProfile } from '../types';

export const profileMediaDraftHasChanged = (
  drafts: MediaDraft[],
  persistedAssetId?: string | null
): boolean => {
  const baselineId = persistedAssetId || null;
  if (drafts.length === 0) return baselineId !== null;
  if (drafts.length !== 1) return true;
  const draft = drafts[0];
  if (draft.status === 'editing' && !draft.crop) {
    return draft.replacedDraft
      ? profileMediaDraftHasChanged([draft.replacedDraft], baselineId)
      : baselineId !== null;
  }
  return !(draft.persisted === true && (draft.assetId || null) === baselineId);
};

export const profileEditHasChanges = (
  draft: Pick<UserProfile, 'name' | 'bio' | 'birthday'>,
  persisted: Pick<UserProfile, 'name' | 'bio' | 'birthday' | 'avatarMediaId' | 'coverMediaId'>,
  avatarDrafts: MediaDraft[],
  coverDrafts: MediaDraft[]
): boolean => (
  draft.name !== persisted.name
  || draft.bio !== persisted.bio
  || (draft.birthday || null) !== (persisted.birthday || null)
  || profileMediaDraftHasChanged(avatarDrafts, persisted.avatarMediaId)
  || profileMediaDraftHasChanged(coverDrafts, persisted.coverMediaId)
);
