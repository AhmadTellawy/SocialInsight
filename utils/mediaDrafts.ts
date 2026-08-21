import { MediaDraft, MediaPresentation, MediaPurpose } from '../types';
import { mediaApi } from '../services/mediaApi';
import { mediaUploadRegistry } from './mediaUploadRegistry';

export const createPersistedMediaDraft = (
  presentation: MediaPresentation,
  purpose: MediaPurpose,
  fallbackUrl = ''
): MediaDraft => ({
  clientId: `persisted-${presentation.id}`,
  file: null,
  previewUrl: presentation.src || fallbackUrl,
  purpose,
  status: 'ready',
  progress: 100,
  aspectRatio: presentation.aspectRatio,
  assetId: presentation.id,
  presentation,
  persisted: true
});

export const createPersistedMediaDraftFromId = (
  assetId: string,
  purpose: MediaPurpose,
  fallbackUrl = '',
  aspectRatio = 1
): MediaDraft => createPersistedMediaDraft({
  id: assetId,
  access: 'RESTRICTED',
  aspectRatio,
  width: 1,
  height: 1,
  src: fallbackUrl || undefined
}, purpose, fallbackUrl);

export const readyMediaAssetIds = (drafts: MediaDraft[]): string[] => drafts
  .filter((draft) => draft.status === 'ready' && draft.assetId)
  .map((draft) => draft.assetId!);

export const mediaDraftsAreReady = (drafts: MediaDraft[]): boolean => drafts.every(
  (draft) => draft.status === 'ready' && Boolean(draft.assetId)
);

export const mediaDraftsHaveErrors = (drafts: MediaDraft[]): boolean => drafts.some(
  (draft) => draft.status === 'error'
);

export const cancelTemporaryMediaDrafts = async (drafts: MediaDraft[]): Promise<void> => {
  const allDrafts = Array.from(new Map<string, MediaDraft>(
    drafts.flatMap((draft) => draft.replacedDraft ? [draft, draft.replacedDraft] : [draft])
      .map((draft): [string, MediaDraft] => [draft.clientId, draft])
  ).values());
  allDrafts.forEach((draft) => {
    mediaUploadRegistry.cancel(draft.clientId);
    if (draft.previewUrl.startsWith('blob:')) URL.revokeObjectURL(draft.previewUrl);
  });
  const ids = allDrafts
    .filter((draft) => draft.assetId && !draft.persisted)
    .map((draft) => draft.assetId!);
  await Promise.all(ids.map((id) => mediaApi.cancel(id).catch(() => undefined)));
};
