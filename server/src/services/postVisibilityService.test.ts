import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVisiblePublishedPostWhere } from './postVisibilityService';

test('guest discovery allows only public audiences or public groups', () => {
  const where = buildVisiblePublishedPostWhere();
  assert.equal(where.isDeleted, false);
  assert.equal(where.status, 'PUBLISHED');
  const serialized = JSON.stringify(where);
  assert.match(serialized, /"isPublic":true/);
  assert.match(serialized, /"targetedGroups":\{"none":\{\}\}/);
  assert.doesNotMatch(JSON.stringify((where.OR as any[])[1]), /"isPrivate"/);
});

test('authenticated discovery carries private-group membership and both block directions', () => {
  const serialized = JSON.stringify(buildVisiblePublishedPostWhere('viewer-1'));
  assert.match(serialized, /"members":\{"some":\{"userId":"viewer-1","status":"JOINED"\}\}/);
  assert.match(serialized, /"blockedBy":\{"some":\{"blockerId":"viewer-1"\}\}/);
  assert.match(serialized, /"blocking":\{"some":\{"blockedId":"viewer-1"\}\}/);
  assert.match(serialized, /"targetAudience":\{"equals":"Followers"/);
  assert.match(serialized, /"sharedFromId":null/);
  assert.match(serialized, /"sharedFrom":\{"is":/);
  assert.match(serialized, /"hiddenBy":\{"some":\{"userId":"viewer-1"\}\}/);
});
