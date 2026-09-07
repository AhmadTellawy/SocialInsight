import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../prisma';
import { getUser, getUserGroups, updateAccountSettings, unblockAccount } from './userController';
import { PrivacyService } from '../services/privacyService';

const restores: Array<() => void> = [];
const stub = (target: any, name: string, value: any) => { const original = target[name]; target[name] = value; restores.push(() => { target[name] = original; }); };
afterEach(() => { while (restores.length) restores.pop()!(); });
const response = () => {
  const state = { status: 200, body: undefined as any };
  const res: any = { status: (code: number) => { state.status = code; return res; }, json: (body: any) => { state.body = body; return res; }, setHeader: () => res };
  return { state, res };
};

test('stale settings write uses authenticated owner and version, returning conflict without replacing any profile', async () => {
  let write: any;
  stub(prisma.user, 'updateMany', async (args: any) => { write = args; return { count: 0 }; });
  stub(prisma, '$transaction', async (callback: any) => callback({ user: prisma.user, $executeRaw: async () => 1, authSession: { findFirst: async () => ({ id: 'session', createdAt: new Date() }) } }));
  stub(prisma.user, 'findUnique', async () => { throw new Error('must not read success DTO'); });
  const { state, res } = response();
  await updateAccountSettings({ user: { userId: 'owner', authMode: 'session' }, authSession: { id: 'session', userId: 'owner' }, body: { userId: 'victim', expectedUpdatedAt: '2026-09-07T00:00:00Z', changes: { searchVisibility: false } } } as any, res);
  assert.equal(state.status, 409);
  assert.equal(write.where.id, 'owner');
  assert.equal(write.where.updatedAt.toISOString(), '2026-09-07T00:00:00.000Z');
  assert.equal(write.data.searchVisibility, false);
  assert.equal(Object.prototype.hasOwnProperty.call(write.data, 'allowSharing'), false);
});

test('unknown setting prevents every database write', async () => {
  let writes = 0; stub(prisma.user, 'updateMany', async () => { writes++; return { count: 1 }; });
  const { state, res } = response();
  await updateAccountSettings({ user: { userId: 'owner' }, body: { expectedUpdatedAt: '2026-09-07T00:00:00Z', changes: { isAdmin: true } } } as any, res);
  assert.equal(state.status, 400); assert.equal(writes, 0);
});

test('a settings request queued behind revocation cannot write after its session is invalidated', async () => {
  let writes = 0;
  stub(prisma, '$transaction', async (callback: any) => callback({ $executeRaw: async () => 1, authSession: { findFirst: async () => null }, user: { updateMany: async () => { writes++; return { count: 1 }; } } }));
  const { state, res } = response();
  await updateAccountSettings({ user: { userId: 'owner', authMode: 'session' }, authSession: { id: 'revoked', userId: 'owner' }, body: { expectedUpdatedAt: '2026-09-07T00:00:00Z', changes: { language: 'ar' } } } as any, res);
  assert.equal(state.status, 401); assert.equal(writes, 0);
});

test('visitor preview cannot inherit owner access to a private profile', async () => {
  stub(prisma.user, 'findUnique', async () => ({ id: 'owner', status: 'ACTIVE', isPrivate: true, mediaPrivacyTarget: null, bio: 'PRIVATE BIO', location: 'PRIVATE LOCATION', website: 'https://private.example', avatar: 'https://private.example/photo', profileMentions: [], birthday: new Date('1990-01-01'), followersCount: 0, followingCount: 0 }));
  stub(prisma.post, 'count', async () => 0); stub(prisma.response, 'count', async () => 0);
  stub(prisma.profileLink, 'findMany', async () => { throw new Error('private links must not load'); });
  const { state, res } = response();
  await getUser({ params: { id: 'owner' }, user: { userId: 'owner' }, query: { viewAs: 'visitor' } } as any, res);
  assert.equal(state.status, 200); assert.equal(state.body.viewAs, 'visitor'); assert.equal(state.body.avatar, '');
  assert.equal(state.body.bio, ''); assert.equal(state.body.location, null); assert.deepEqual(state.body.profileLinks, []);
  assert.equal(JSON.stringify(state.body).includes('PRIVATE'), false);
});

test('Off group display prevents membership reads even for a public account', async () => {
  stub(prisma.user, 'findUnique', async () => ({ status: 'ACTIVE', isPrivate: false, mediaPrivacyTarget: null, groupPrivacy: 'Off' }));
  stub(prisma.groupMember, 'findMany', async () => { throw new Error('memberships are private'); });
  const { state, res } = response(); await getUserGroups({ params: { id: 'owner' }, query: {} } as any, res);
  assert.equal(state.status, 200); assert.deepEqual(state.body, []);
});

test('public group card carries viewer permissions, never the listed owner role', async () => {
  stub(prisma.user, 'findUnique', async () => ({ status: 'ACTIVE', isPrivate: false, mediaPrivacyTarget: null, groupPrivacy: 'Public' }));
  stub(prisma.groupMember, 'findMany', async () => [{ role: 'Owner', status: 'JOINED', group: { id: 'group', isPublic: true, isDeleted: false, postingPermissions: 'AllMembers', joinPolicy: 'OPEN', members: [], _count: { members: 10, targetedPosts: 4 } } }]);
  const { state, res } = response(); await getUserGroups({ params: { id: 'owner' }, query: {} } as any, res);
  assert.equal(state.status, 200); assert.equal(state.body[0].role, null); assert.equal(state.body[0].permissions.canManageSettings, false);
  assert.equal(state.body[0].permissions.canDeleteGroup, false);
});

test('deactivated accounts remain hidden from owners, followers and guests', async () => {
  stub(prisma.user, 'findUnique', async () => ({ status: 'DEACTIVATED', isPrivate: false, mediaPrivacyTarget: null }));
  stub(prisma.userBlock, 'findFirst', async () => null); stub(prisma.follow, 'findUnique', async () => ({ status: 'ACTIVE' }));
  for (const viewer of [undefined, 'owner', 'follower']) assert.equal(await PrivacyService.canViewUserContent(viewer, 'owner'), false);
});

test('unblock is owner-scoped and never recreates a previous follow', async () => {
  let deletion: any;
  stub(prisma.userBlock, 'deleteMany', async (args: any) => { deletion = args; return { count: 1 }; });
  stub(prisma.follow, 'create', async () => { throw new Error('must not restore follow'); });
  const { state, res } = response(); await unblockAccount({ user: { userId: 'owner' }, params: { blockedId: 'target' }, body: { blockerId: 'victim' } } as any, res);
  assert.equal(state.status, 200); assert.deepEqual(deletion.where, { blockerId: 'owner', blockedId: 'target' });
});
