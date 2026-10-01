import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../prisma';
import { attachPagePublishers } from './pagePostService';
import { hasPageCapability, PageCapability, PageRole } from './pagePolicy';

const capabilities: PageCapability[] = ['manageContent', 'reply', 'moderateComments', 'analytics'];
const page = { id: 'business', ownerId: 'private-owner', name: 'Public business', handle: 'business', avatarMediaId: 'avatar', _viewerRole: null as string | null, _isFollowing: false };
async function fixture(run: (state: { queries: any[]; rows: typeof page[] }) => Promise<void>) {
  const original = prisma.$queryRaw;
  const state = { queries: [] as any[], rows: [{ ...page }] };
  (prisma as any).$queryRaw = async (query: any) => { state.queries.push(query); return state.rows; };
  try { await run(state); } finally { prisma.$queryRaw = original; }
}

test('Personal posts keep their author and avoid Page queries', async () => fixture(async state => {
  const post = { authorId: 'person', author: { id: 'person', name: 'Person' } };
  await attachPagePublishers([post], 'viewer');
  assert.deepEqual(post, { authorId: 'person', author: { id: 'person', name: 'Person' } });
  assert.equal(state.queries.length, 0);
}));

test('Publisher query binds IDs and viewer values; private actor fields never reach presentation', async () => fixture(async state => {
  const id = "business' OR 1=1 --", viewer = "viewer' OR 1=1 --";
  state.rows = [{ ...page, id, _isFollowing: true }];
  const post: any = { pageId: id, authorId: 'employee', lastPageActorId: 'employee', pageCreateKey: 'private-key', approvedById: 'reviewer', rejectedById: 'reviewer', taggedUsers: [{ taggedByUserId: 'employee', userId: 'tagged' }] };
  await attachPagePublishers([post], viewer);
  assert.equal(state.queries.length, 1);
  for (const value of [id, viewer]) { assert.ok(state.queries[0].values.includes(value)); assert.ok(!state.queries[0].sql.includes(value)); }
  assert.deepEqual(post.author, { id, kind: 'PAGE', name: page.name, handle: page.handle, avatar: '', avatarMediaId: page.avatarMediaId, verifiedBadge: false, isPrivate: false, isFollowing: true });
  assert.equal(post.authorId, id); assert.deepEqual(post.pageCapabilities, []);
  for (const key of ['lastPageActorId', 'pageCreateKey', 'approvedById', 'rejectedById']) assert.equal(key in post, false);
  assert.equal('taggedByUserId' in post.taggedUsers[0], false);
  assert.equal('ownerId' in post.author, false);
}));

for (const role of ['OWNER', 'ADMIN', 'EDITOR', 'ANALYST', null] as (PageRole | null)[]) {
  test(`Publisher capabilities preserve ${role || 'guest'} presentation`, async () => fixture(async state => {
    state.rows = [{ ...page, _viewerRole: role === 'OWNER' ? 'ANALYST' : role }];
    const post: any = { pageId: page.id };
    await attachPagePublishers([post], role === 'OWNER' ? page.ownerId : role ? 'viewer' : undefined);
    assert.deepEqual(post.pageCapabilities, capabilities.filter(capability => hasPageCapability(role, capability)));
    assert.equal(post.author.isFollowing, false);
  }));
}

test('Shared Page source and repeated Page posts share one lookup without changing personal wrapper identity', async () => fixture(async state => {
  const source: any = { pageId: page.id, authorId: 'employee' };
  const wrapper: any = { authorId: 'person', author: { id: 'person' }, sharedFrom: source };
  const direct: any = { pageId: page.id };
  await attachPagePublishers([wrapper, direct], 'viewer');
  assert.equal(state.queries.length, 1);
  assert.equal(state.queries[0].values.filter((value: string) => value === page.id).length, 1);
  assert.equal(wrapper.authorId, 'person'); assert.deepEqual(wrapper.author, { id: 'person' });
  assert.deepEqual(source.author, direct.author);
}));

test('Current membership/follow changes are read afresh on each attachment', async () => fixture(async state => {
  state.rows = [{ ...page, _viewerRole: 'ADMIN', _isFollowing: true }];
  const first: any = { pageId: page.id }; await attachPagePublishers([first], 'viewer');
  state.rows = [{ ...page, _viewerRole: null, _isFollowing: false }];
  const second: any = { pageId: page.id }; await attachPagePublishers([second], 'viewer');
  assert.ok(first.pageCapabilities.length > 0); assert.deepEqual(second.pageCapabilities, []);
  assert.equal(first.author.isFollowing, true); assert.equal(second.author.isFollowing, false);
  assert.equal(state.queries.length, 2);
}));

test('A missing Page remains a 404 instead of exposing the employee identity', async () => fixture(async state => {
  state.rows = [];
  await assert.rejects(attachPagePublishers([{ pageId: 'missing', authorId: 'employee' }], 'viewer'), { code: 'PAGE_NOT_FOUND', status: 404 });
}));
