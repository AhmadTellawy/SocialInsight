import type { MediaDraft, Option, OptionPresentation } from '../types';

export type OptionWithMediaDrafts = {
  id: string;
  text?: string;
  image?: string | null;
  imageMediaId?: string;
  mediaDrafts: MediaDraft[];
};

export const optionHasImage = (option: Pick<Option, 'image' | 'imageMediaId' | 'imageMedia'>): boolean =>
  Boolean(option.imageMediaId || option.imageMedia || option.image);

export const draftOptionHasImage = (option: OptionWithMediaDrafts): boolean =>
  option.mediaDrafts.length > 0 || Boolean(option.imageMediaId || option.image);

export const resolveOptionPresentation = (
  presentation: OptionPresentation | undefined,
  options: Array<Pick<Option, 'image' | 'imageMediaId' | 'imageMedia'>> | undefined
): OptionPresentation => {
  if (presentation === 'image' || presentation === 'text') return presentation;
  return options?.some(optionHasImage) ? 'image' : 'text';
};

export const shouldShowOptionNames = (
  presentation: OptionPresentation | undefined,
  showNames: boolean | undefined
): boolean => presentation !== 'image' || showNames !== false;

export const reconcileOptionMediaDrafts = <T extends OptionWithMediaDrafts>(
  options: T[],
  nextDrafts: MediaDraft[],
  createOption: () => T,
  preferredOptionId?: string | null,
  selectionCommitted = false
): T[] => {
  const nextById = new Map(nextDrafts.map((draft) => [draft.clientId, draft]));
  const claimedDraftIds = new Set<string>();

  let nextOptions = options.map((option) => {
    const current = option.mediaDrafts[0];
    if (!current) return option;

    const restored = current.replacedDraft && nextById.get(current.replacedDraft.clientId);
    if (restored) {
      claimedDraftIds.add(restored.clientId);
      return { ...option, mediaDrafts: [restored] };
    }

    const replacement = nextDrafts.find((draft) => draft.replacesClientId === current.clientId);
    if (replacement) {
      claimedDraftIds.add(replacement.clientId);
      return { ...option, mediaDrafts: [replacement] };
    }

    const updated = nextById.get(current.clientId);
    if (updated) {
      claimedDraftIds.add(updated.clientId);
      return { ...option, mediaDrafts: [updated] };
    }

    if ((option.image || option.imageMediaId) && current.status !== 'ready') {
      return { ...option, mediaDrafts: [] };
    }

    return { ...option, image: undefined, imageMediaId: undefined, mediaDrafts: [] };
  });

  const unclaimed = nextDrafts.filter((draft) => !claimedDraftIds.has(draft.clientId));
  for (const draft of unclaimed) {
    let targetIndex = -1;
    if (preferredOptionId) {
      targetIndex = nextOptions.findIndex((option) => option.id === preferredOptionId && option.mediaDrafts.length === 0);
      preferredOptionId = null;
    }
    if (targetIndex < 0) {
      targetIndex = nextOptions.findIndex((option) => option.mediaDrafts.length === 0 && !option.imageMediaId && !option.image);
    }

    if (targetIndex >= 0) {
      nextOptions = nextOptions.map((option, index) => index === targetIndex ? { ...option, mediaDrafts: [draft] } : option);
    } else {
      nextOptions = [...nextOptions, { ...createOption(), mediaDrafts: [draft] }];
    }
  }

  if (!selectionCommitted) return nextOptions;
  // Selection order owns image rows; keep each existing name attached to its
  // image. Discard only empty rows created for photos that were deselected.
  const selectedOptions = nextDrafts.flatMap(draft => nextOptions.filter(option => option.mediaDrafts[0]?.clientId === draft.clientId));
  const remaining = nextOptions.filter(option => !option.mediaDrafts.length && (
    option.text?.trim() || option.image || option.imageMediaId || !options.find(old => old.id === option.id)?.mediaDrafts.length
  ));
  const committed = [...selectedOptions, ...remaining];
  while (committed.length < 2) committed.push(createOption());
  return committed;
};
