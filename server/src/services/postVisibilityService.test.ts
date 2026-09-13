import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVisiblePublishedPostWhere, evaluatePostResultsAccess } from './postVisibilityService';

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

const resultPost = (overrides: Partial<Parameters<typeof evaluatePostResultsAccess>[1]> = {}) => ({
  id: 'post-1',
  authorId: 'author-1',
  resultsWho: 'Public',
  resultsTiming: 'AnyTime',
  expiresAt: new Date('2026-09-20T00:00:00.000Z'),
  ...overrides
});

test('results audience requires ACTIVE followers and rejects pending relationships', async () => {
  const db = {
    follow: { findUnique: async () => ({ status: 'PENDING' }) },
    response: { findFirst: async () => null }
  };
  const decision = await evaluatePostResultsAccess(db, resultPost({ resultsWho: 'Followers' }), 'viewer-1');
  assert.deepEqual(decision, { allowed: false, viewerParticipated: false, reason: 'audience' });
});

test('immediate participant results require a matching authenticated response', async () => {
  const db = {
    follow: { findUnique: async () => null },
    response: { findFirst: async ({ where }: any) => where.userId === 'viewer-1' ? { id: 'response-1' } : null }
  };
  const decision = await evaluatePostResultsAccess(
    db,
    resultPost({ resultsWho: 'Participants', resultsTiming: 'Immediately' }),
    'viewer-1'
  );
  assert.deepEqual(decision, { allowed: true, viewerParticipated: true });
});

test('post author retains results access without follower or response queries', async () => {
  const db = {
    follow: { findUnique: async () => { throw new Error('unexpected follow query'); } },
    response: { findFirst: async () => { throw new Error('unexpected response query'); } }
  };
  assert.deepEqual(
    await evaluatePostResultsAccess(db, resultPost({ resultsWho: 'OnlyMe', resultsTiming: 'AfterEnd' }), 'author-1'),
    { allowed: true, viewerParticipated: false }
  );
});
