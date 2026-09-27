import assert from 'node:assert/strict';
import test from 'node:test';
import type { BusinessPage } from '../services/pagesApi';
import { pagePublisherEligibility } from '../utils/pagePublisherEligibility.ts';

const page = (changes: Partial<BusinessPage> = {}) => ({
  capabilities: ['manageContent'], publicationState: 'PUBLISHED', platformState: 'NONE',
  safetyHidden: false, deletionRequestedAt: null, ...changes,
} as BusinessPage);

test('Page destination follows server draft and public publication boundaries', () => {
  assert.deepEqual(pagePublisherEligibility(page()), { canDraft: true, canPublish: true });
  for (const changes of [{ publicationState: 'DRAFT' }, { publicationState: 'UNPUBLISHED' },
    { platformState: 'RESTRICTED' }, { safetyHidden: true }] as Partial<BusinessPage>[]) {
    assert.deepEqual(pagePublisherEligibility(page(changes)), { canDraft: true, canPublish: false });
  }
  for (const changes of [{ platformState: 'SUSPENDED' }, { deletionRequestedAt: new Date().toISOString() },
    { capabilities: ['readManagement'] }] as Partial<BusinessPage>[]) {
    assert.deepEqual(pagePublisherEligibility(page(changes)), { canDraft: false, canPublish: false });
  }
});
