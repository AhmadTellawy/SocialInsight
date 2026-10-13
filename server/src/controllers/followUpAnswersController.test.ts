import test from 'node:test';
import assert from 'node:assert/strict';
import { getPostFollowUpAnswers, getPageManagedFollowUpAnswers } from './followUpAnswersController';
import * as pages from '../pages/pageService';
import * as visibility from '../services/postVisibilitySql';
import { PagePolicyError } from '../pages/pagePolicy';
import { guestCookieName, readGuestParticipationHash } from '../services/guestParticipationService';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const postId = id(1), optionId = id(2), questionId = id(3), pageId = id(4);
const post = { id: postId, authorId: 'owner', pageId: null, sharedFromId: null, forceAnonymous: false };

test('follow-up answers enforce owner/participant/guest/page boundaries and anonymous DTOs', async t => {
  const originals = new Map<string, any>();
  const patch = (module: any, name: string, value: any) => { originals.set(name, [module, module[name]]); module[name] = value; };
  const enabled = process.env.PAGES_ENABLED, hashSecret = process.env.AUTH_SESSION_HASH_SECRET;
  process.env.PAGES_ENABLED = 'true'; process.env.AUTH_SESSION_HASH_SECRET = 'follow-up-test-secret-only-not-production';
  let target: any = post, visible = true, sourceVisible = true, role: any = 'ANALYST', blocked = false;
  let optionExists = true, answerReads = 0, countReads = 0, seen: any, isolation: string | undefined, locked = false;
  const guestRequest: any = { headers: { cookie: `${guestCookieName()}=${'a'.repeat(64)}` } };
  const guestHash = readGuestParticipationHash(guestRequest);
  let responses = [
    { id: id(10), postId, userId: 'participant', isAnonymous: true, user: { name: 'Hidden name', status: 'ACTIVE' }, guestProofHash: null, guestProofExpiresAt: null },
    { id: id(11), postId, userId: 'named', isAnonymous: false, user: { name: 'Visible name', status: 'ACTIVE' }, guestProofHash: null, guestProofExpiresAt: null },
    { id: id(12), postId, userId: null, isAnonymous: true, user: null, guestProofHash: guestHash, guestProofExpiresAt: new Date('2099-01-01') },
  ];
  const matches = (where: any, row: any) => row.postId === where.postId &&
    (!('userId' in where) || row.userId === where.userId) &&
    (!where.guestProofHash || row.guestProofHash === where.guestProofHash) &&
    (!where.guestProofExpiresAt || !!row.guestProofExpiresAt && row.guestProofExpiresAt > where.guestProofExpiresAt.gt);
  let many = false;
  const tx: any = {
    response: { findFirst: async ({ where }: any) => responses.find(row => matches(where, row)) || null },
    option: { findMany: async ({ where }: any) => { assert.equal(where.withFollowUp, true); assert.deepEqual(where.question.OR, [{ postId }, { section: { postId } }]); return optionExists && (!where.id || where.id === optionId) ? [{ id: optionId, text: 'Beach', followUpLabel: 'Why?', questionId, question: { text: 'Where?' } }] : []; } },
    answer: {
      groupBy: async ({ where }: any) => { countReads++; seen = where; return [{ optionId, questionId, _count: { _all: responses.filter(row => matches(where.response, row)).length } }]; },
      findMany: async (input: any) => {
        answerReads++; seen = input; assert.equal(input.take, 21); assert.deepEqual(input.orderBy, { id: 'asc' });
        const rows = (many ? Array.from({ length: 25 }, (_, i) => ({ id: id(100 + i), textValue: 'Long answer ' + i, response: responses[0] })) : responses.map((response, i) => ({ id: id(100 + i), textValue: 'Private answer ' + i, response })))
          .filter(row => matches(input.where.response, row.response) && (!input.where.id || row.id > input.where.id.gt));
        return rows.slice(0, input.take);
      },
    },
    post: { findFirst: async ({ where }: any) => where.id === postId && where.pageId === target.pageId ? target : null },
  };
  patch(pages, 'pageTransaction', async (work: any, level: string) => { isolation = level; locked = false; return work(tx); });
  patch(visibility, 'loadVisiblePostScalars', async (_tx: any, { ids }: any) => visible && (ids[0] !== id(9) || sourceVisible) ? [{ ...target, id: ids[0], ...(ids[0] === id(9) ? { authorId: 'source-owner', sharedFromId: null } : {}) }] : []);
  patch(pages, 'lockPageForAnalytics', async () => { locked = true; return { id: pageId }; });
  patch(pages, 'activePageActor', async () => ({}));
  patch(pages, 'pageRole', async () => { assert.equal(locked, true); return role; });
  patch(pages, 'requirePageCapability', async (_tx: any, _page: any, _user: any, capability: string) => { assert.equal(locked, true); assert.equal(capability, 'analytics'); if (!role) throw new PagePolicyError('PAGE_PERMISSION_DENIED', 403); });
  patch(pages, 'pageIsBlocked', async () => blocked);
  const invoke = async (userId?: string, query: any = {}, managed = false, cookie?: string) => {
    const result: any = { status: 200, headers: {} };
    const res: any = { setHeader(k: string, v: string) { result.headers[k] = v; }, status(s: number) { result.status = s; return res; }, json(body: any) { result.body = body; return res; } };
    await (managed ? getPageManagedFollowUpAnswers : getPostFollowUpAnswers)({ params: managed ? { id: pageId, postId } : { id: postId }, query, headers: { cookie }, ...(userId ? { user: { userId } } : {}) } as any, res);
    assert.equal(result.headers['Cache-Control'], 'private, no-store'); assert.match(result.headers.Vary, /Cookie/);
    return result;
  };
  try {
    await t.test('public result access and forged role flags do not grant raw answer access', async () => {
      const result = await invoke('stranger', { scope: 'all', userId: 'owner', role: 'OWNER' });
      assert.equal(result.body.scope, 'none'); assert.deepEqual(result.body.groups, []); assert.equal(countReads, 0);
      assert.equal((await invoke('stranger', { optionId })).status, 403); assert.equal(answerReads, 0);
    });
    await t.test('owner sees grouped answers but anonymous identity never leaves the server', async () => {
      assert.equal((await invoke('owner')).body.totalAnswers, 3);
      const result = await invoke('owner', { optionId });
      assert.equal(result.body.items.length, 3); assert.equal(result.body.items[0].displayName, null);
      assert.equal(result.body.items[1].displayName, 'Visible name');
      assert.doesNotMatch(JSON.stringify(result.body), /Hidden name|userId|guestProof|responseId|ipAddress/);
      assert.deepEqual(seen.where.OR, [{ optionId, questionId }]); assert.equal(seen.where.textValue.not, '');
      target = { ...post, forceAnonymous: true };
      assert.ok((await invoke('owner', { optionId })).body.items.every((item: any) => item.displayName === null && item.isAnonymous)); target = post;
    });
    await t.test('participant sees only their own response even when anonymous', async () => {
      const summary = await invoke('participant'); assert.equal(summary.body.scope, 'own'); assert.equal(summary.body.totalAnswers, 1);
      const result = await invoke('participant', { optionId }); assert.equal(result.body.items.length, 1); assert.equal(result.body.items[0].text, 'Private answer 0');
      assert.equal(seen.where.response.userId, 'participant');
    });
    await t.test('guest requires unexpired server cookie proof; client guest ID is ignored', async () => {
      assert.equal((await invoke(undefined, { guestId: 'forged' })).body.scope, 'none');
      assert.equal((await invoke(undefined, { optionId }, false, guestRequest.headers.cookie)).body.items[0].text, 'Private answer 2');
      responses[2].guestProofExpiresAt = new Date('2000-01-01');
      assert.equal((await invoke(undefined, {}, false, guestRequest.headers.cookie)).body.scope, 'none');
    });
    await t.test('bounded pagination keeps the authorization and option scope', async () => {
      many = true; const first = await invoke('owner', { optionId }); assert.equal(first.body.items.length, 20);
      const next = await invoke('owner', { optionId, cursor: first.body.nextCursor }); assert.equal(next.body.items.length, 5); assert.equal(next.body.nextCursor, null);
      assert.equal((await invoke('stranger', { optionId, cursor: first.body.nextCursor })).status, 403);
      assert.equal((await invoke('owner', { cursor: id(10) })).status, 400); assert.equal((await invoke('owner', { optionId: ['bad'] })).status, 400);
      assert.equal((await invoke('owner', { optionId: id(99) })).status, 404); many = false;
    });
    await t.test('removed/hidden posts and invisible shared sources are denied', async () => {
      visible = false; assert.equal((await invoke('owner')).status, 404); visible = true;
      target = { ...post, sharedFromId: id(9) }; sourceVisible = false; assert.equal((await invoke('owner')).status, 404);
      sourceVisible = true; assert.equal((await invoke('owner')).body.scope, 'none'); target = post;
    });
    await t.test('page author ID cannot bypass revoked team membership', async () => {
      target = { ...post, pageId }; role = null;
      assert.equal((await invoke('owner')).body.scope, 'none'); assert.equal((await invoke('owner', {}, true)).status, 403);
      for (const granted of ['OWNER', 'ADMIN', 'EDITOR', 'ANALYST']) { role = granted; assert.equal((await invoke('team')).body.scope, 'all'); assert.equal((await invoke('team', {}, true)).body.scope, 'all'); }
      assert.equal(isolation, 'ReadCommitted'); role = null;
      assert.equal((await invoke('team', { optionId }, true)).status, 403);
      role = 'ANALYST'; blocked = true; assert.equal((await invoke('team', {}, true)).status, 404); blocked = false;
      target = { ...target, sharedFromId: id(9) }; assert.equal((await invoke('team', {}, true)).status, 403);
    });
  } finally {
    for (const [name, [module, original]] of originals) module[name] = original;
    if (enabled === undefined) delete process.env.PAGES_ENABLED; else process.env.PAGES_ENABLED = enabled;
    if (hashSecret === undefined) delete process.env.AUTH_SESSION_HASH_SECRET; else process.env.AUTH_SESSION_HASH_SECRET = hashSecret;
  }
});
