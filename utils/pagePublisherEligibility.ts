import type { BusinessPage } from '../services/pagesApi';

/** Client hint only; the API rechecks these conditions under a Page lock. */
export function pagePublisherEligibility(page: BusinessPage) {
  const canDraft = !!page.capabilities?.includes('manageContent') &&
    !page.deletionRequestedAt && (page.platformState === 'NONE' || page.platformState === 'RESTRICTED');
  const canPublish = canDraft && page.publicationState === 'PUBLISHED' &&
    page.platformState === 'NONE' && !page.safetyHidden;
  return { canDraft, canPublish };
}
