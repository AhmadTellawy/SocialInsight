import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';
import prisma from '../prisma';
import { PrivacyService } from './privacyService';
import { GroupPermissionService } from './groupPermissionService';
import { buildVisiblePublishedPostWhere } from './postVisibilityService';
import { isProfileAndGroups, validateProfileAndGroupsInput, canInteractWithProfileAndGroups } from './postAudienceService';

const prismaRestores: Array<() => void> = [];
function stubMethod(target: any, key: string, implementation: (...args: any[]) => any) {
  // Prisma delegates are proxies without method descriptors for mock.method.
  const original = target[key];
  const replacement = mock.fn(implementation);
  target[key] = replacement;
  prismaRestores.push(() => { target[key] = original; });
  return replacement;
}
afterEach(() => {
  while (prismaRestores.length) prismaRestores.pop()!();
  mock.restoreAll();
});

// A deliberately bounded evaluator for the Prisma operators used by visibility.
// Unknown operators fail the test rather than silently treating a guard as true.
function matches(record: any, where: any): boolean {
  if (where === null || typeof where !== 'object') return record === where;
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'AND') return (Array.isArray(value) ? value : [value]).every(item => matches(record, item));
    if (key === 'OR') return value.some((item: any) => matches(record, item));
    if (key === 'NOT') return (Array.isArray(value) ? value : [value]).every(item => !matches(record, item));
    const actual = record?.[key];
    if (value === null || typeof value !== 'object') return actual === value;
    if ('some' in value) return Array.isArray(actual) && actual.some(item => matches(item, value.some));
    if ('none' in value) return Array.isArray(actual) && !actual.some(item => matches(item, value.none));
    if ('is' in value) return actual != null && matches(actual, value.is);
    if ('equals' in value) return value.mode === 'insensitive'
      ? typeof actual === 'string' && actual.toLowerCase() === value.equals.toLowerCase()
      : actual === value.equals;
    if ('in' in value) return value.in.includes(actual);
    assert.ok(!['not', 'isNot', 'every', 'contains', 'startsWith', 'endsWith'].some(operator => operator in value), 'Unsupported evaluator operator');
    return actual != null && matches(actual, value);
  });
}

const privateGroup = (members: any[] = []) => ({ id: 'group-1', isPublic: false, isDeleted: false, members });
function post(overrides: any = {}) {
  const group = privateGroup();
  return {
    id: 'post-1', authorId: 'author-1', targetAudience: 'ProfileAndGroups',
    status: 'PUBLISHED', isDeleted: false, hiddenBy: [], sharedFromId: null,
    groupId: group.id, group, targetedGroups: [group],
    author: { isPrivate: false, mediaPrivacyTarget: false, following: [], blockedBy: [], blocking: [] },
    ...overrides,
  };
}

test('union recognition is explicit and legacy audiences are not reinterpreted', () => {
  assert.equal(isProfileAndGroups('ProfileAndGroups'), true);
  for (const audience of [undefined, null, '', 'Public', 'Followers', 'Groups', 'Custom Audience', 'Custom Domain', 'Public,Groups']) {
    assert.equal(isProfileAndGroups(audience), false);
  }
});

test('published union requires valid nonempty group IDs while empty drafts remain saveable', () => {
  assert.equal(validateProfileAndGroupsInput('ProfileAndGroups', ['group-1'], false), null);
  assert.equal(validateProfileAndGroupsInput('ProfileAndGroups', [], true), null);
  for (const groups of [undefined, null, [], '', [''], ['   '], [23], ['group-1', 'group-1']]) {
    assert.equal(typeof validateProfileAndGroupsInput('ProfileAndGroups', groups as any, false), 'string');
  }
  for (const audience of ['Public', 'Followers', 'Groups', 'Custom Audience', 'Custom Domain']) {
    assert.equal(validateProfileAndGroupsInput(audience, [], false), null);
  }
});

test('union media stays restricted instead of being promoted to public storage', () => {
  const { resolvePostMediaScopeFromState } = require('./mediaService') as typeof import('./mediaService');
  assert.equal(resolvePostMediaScopeFromState('PUBLISHED', ['group-1'], 'ProfileAndGroups', false), 'INHERITED_GROUP');
  assert.equal(resolvePostMediaScopeFromState('PUBLISHED', ['group-1'], 'ProfileAndGroups', true), 'INHERITED_GROUP');
  assert.equal(resolvePostMediaScopeFromState('DRAFT', ['group-1'], 'ProfileAndGroups', false), 'OWNER_ONLY');
  assert.equal(resolvePostMediaScopeFromState('PENDING_APPROVAL', ['group-1'], 'ProfileAndGroups', false), 'OWNER_ONLY');
});

const scenarios: Array<{ name: string; viewer?: string; value: any; allowed: boolean }> = [
  { name: 'public profile grants a guest access despite a private group', value: post(), allowed: true },
  { name: 'private profile denies guest with private group', value: post({ author: { isPrivate: true, mediaPrivacyTarget: false, following: [], blockedBy: [], blocking: [] } }), allowed: false },
  { name: 'private profile allows ACTIVE follower outside selected groups', viewer: 'viewer', value: post({ author: { isPrivate: true, mediaPrivacyTarget: false, following: [{ followerId: 'viewer', status: 'ACTIVE' }], blockedBy: [], blocking: [] } }), allowed: true },
  { name: 'private profile rejects pending follower outside selected groups', viewer: 'viewer', value: post({ author: { isPrivate: true, mediaPrivacyTarget: false, following: [{ followerId: 'viewer', status: 'PENDING' }], blockedBy: [], blocking: [] } }), allowed: false },
  { name: 'media privacy restriction also protects the profile branch', value: post({ author: { isPrivate: false, mediaPrivacyTarget: true, following: [], blockedBy: [], blocking: [] } }), allowed: false },
  { name: 'joined group member can read private author union', viewer: 'viewer', value: post({ author: { isPrivate: true, mediaPrivacyTarget: false, following: [], blockedBy: [], blocking: [] }, targetedGroups: [privateGroup([{ userId: 'viewer', status: 'JOINED' }])] }), allowed: true },
  { name: 'public group remains readable independent of private author', value: post({ author: { isPrivate: true, mediaPrivacyTarget: false, following: [], blockedBy: [], blocking: [] }, targetedGroups: [{ ...privateGroup(), isPublic: true }] }), allowed: true },
  { name: 'outgoing block excludes both profile and group branches', viewer: 'viewer', value: post({ author: { isPrivate: false, mediaPrivacyTarget: false, following: [], blockedBy: [{ blockerId: 'viewer' }], blocking: [] }, targetedGroups: [{ ...privateGroup(), isPublic: true }] }), allowed: false },
  { name: 'incoming block excludes both profile and group branches', viewer: 'viewer', value: post({ author: { isPrivate: false, mediaPrivacyTarget: false, following: [], blockedBy: [], blocking: [{ blockedId: 'viewer' }] }, targetedGroups: [{ ...privateGroup(), isPublic: true }] }), allowed: false },
  { name: 'deleted group does not eliminate an allowed profile audience', value: post({ group: { ...privateGroup(), isDeleted: true }, targetedGroups: [{ ...privateGroup(), isDeleted: true }] }), allowed: true },
  { name: 'pending group approval does not publish the profile branch', value: post({ status: 'PENDING_APPROVAL' }), allowed: false },
  { name: 'draft profile union is excluded from discovery', value: post({ status: 'DRAFT' }), allowed: false },
  { name: 'deleted post is excluded from both union branches', value: post({ isDeleted: true }), allowed: false },
  { name: 'hidden post remains hidden', viewer: 'viewer', value: post({ hiddenBy: [{ userId: 'viewer' }] }), allowed: false },
  { name: 'legacy Public with private groups does not gain profile visibility', value: post({ targetAudience: 'Public' }), allowed: false },
  { name: 'legacy Groups stays group-only', value: post({ targetAudience: 'Groups' }), allowed: false },
  { name: 'legacy group-free public post remains public', value: post({ targetAudience: 'Public', groupId: null, group: null, targetedGroups: [] }), allowed: true },
  { name: 'legacy custom audience remains unavailable to unrelated readers', value: post({ targetAudience: 'Custom Audience', groupId: null, group: null, targetedGroups: [] }), allowed: false },
  { name: 'inaccessible shared source cannot be exposed through the union wrapper', value: post({ sharedFromId: 'source', sharedFrom: post({ id: 'source', targetAudience: 'Groups' }) }), allowed: false },
];

for (const scenario of scenarios) {
  test(`visibility: ${scenario.name}`, () => {
    assert.equal(matches(scenario.value, buildVisiblePublishedPostWhere(scenario.viewer)), scenario.allowed);
  });
}

test('GroupPermission uses the same published union policy even when all groups were deleted', async () => {
  const record = post({ group: { ...privateGroup(), isDeleted: true }, targetedGroups: [{ ...privateGroup(), isDeleted: true }] });
  stubMethod(prisma.post, 'findUnique', async () => record);
  const count = stubMethod(prisma.post, 'count', async ({ where }: any) => matches(record, where) ? 1 : 0);
  assert.equal(await GroupPermissionService.canViewPost('post-1', undefined), true);
  assert.equal(count.mock.callCount(), 1);
});

test('interaction denies an invisible union before profile or membership grants', async () => {
  stubMethod(prisma.post, 'count', async () => 0);
  const profile = mock.method(PrivacyService, 'canViewUserContent', async () => true);
  const membership = stubMethod(prisma.groupMember, 'findFirst', async () => ({ id: 'member' }));
  assert.equal(await canInteractWithProfileAndGroups('post-1', 'author-1', 'viewer', ['group-1']), false);
  assert.equal(profile.mock.callCount(), 0);
  assert.equal(membership.mock.callCount(), 0);
});

test('interaction permits profile audience without selected-group membership', async () => {
  stubMethod(prisma.post, 'count', async ({ where }: any) => matches(post(), where) ? 1 : 0);
  mock.method(PrivacyService, 'canViewUserContent', async () => true);
  const membership = stubMethod(prisma.groupMember, 'findFirst', async () => null);
  assert.equal(await canInteractWithProfileAndGroups('post-1', 'author-1', undefined, ['group-1']), true);
  assert.equal(membership.mock.callCount(), 0);
});

test('public group visibility alone does not grant guest interaction with a private profile', async () => {
  stubMethod(prisma.post, 'count', async () => 1);
  mock.method(PrivacyService, 'canViewUserContent', async () => false);
  const membership = stubMethod(prisma.groupMember, 'findFirst', async () => ({ id: 'member' }));
  assert.equal(await canInteractWithProfileAndGroups('post-1', 'author-1', undefined, ['group-1']), false);
  assert.equal(membership.mock.callCount(), 0);
});

for (const [name, member, allowed] of [
  ['joined member', { userId: 'viewer', groupId: 'group-1', status: 'JOINED', group: { isDeleted: false } }, true],
  ['pending member', { userId: 'viewer', groupId: 'group-1', status: 'PENDING', group: { isDeleted: false } }, false],
  ['member of another group', { userId: 'viewer', groupId: 'other', status: 'JOINED', group: { isDeleted: false } }, false],
  ['member of deleted group', { userId: 'viewer', groupId: 'group-1', status: 'JOINED', group: { isDeleted: true } }, false],
] as const) {
  test(`interaction group branch: ${name}`, async () => {
    stubMethod(prisma.post, 'count', async () => 1);
    mock.method(PrivacyService, 'canViewUserContent', async () => false);
    stubMethod(prisma.groupMember, 'findFirst', async ({ where }: any) => matches(member, where) ? member : null);
    assert.equal(await canInteractWithProfileAndGroups('post-1', 'author-1', 'viewer', ['group-1']), allowed);
  });
}

function controllers(): typeof import('../controllers/postController') {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'profile-union-local-test-secret';
  return require('../controllers/postController');
}
function responseState() {
  const state = { status: 200, body: undefined as any };
  const response: any = {
    status(code: number) { state.status = code; return response; },
    json(body: any) { state.body = body; return response; },
  };
  return { state, response };
}

test('create controller rejects malformed union before any database write', async () => {
  const write = stubMethod(prisma, '$transaction', async () => { throw new Error('Unexpected database write'); });
  const { state, response } = responseState();
  await controllers().createPost({ body: { targetAudience: 'ProfileAndGroups', targetGroups: [] }, user: { userId: 'author-1' } } as any, response);
  assert.equal(state.status, 400);
  assert.equal(state.body.code, 'INVALID_POST_AUDIENCE');
  assert.equal(write.mock.callCount(), 0);
});

for (const [name, group] of [['missing', null], ['deleted', { postingPermissions: 'AllMembers', isDeleted: true }]] as const) {
  test(`create controller rejects ${name} union group`, async () => {
    stubMethod(prisma.group, 'findUnique', async () => group);
    const write = stubMethod(prisma, '$transaction', async () => { throw new Error('Unexpected database write'); });
    const { state, response } = responseState();
    await controllers().createPost({ body: { title: 'Test', targetAudience: 'ProfileAndGroups', targetGroups: ['group-1'] }, user: { userId: 'author-1' } } as any, response);
    assert.equal(state.status, 403);
    assert.equal(write.mock.callCount(), 0);
  });
}

test('create union retains the one-group restriction when approval is required', async () => {
  stubMethod(prisma.group, 'findUnique', async () => ({ postingPermissions: 'ApprovalNeeded', isDeleted: false }));
  stubMethod(prisma.groupMember, 'findUnique', async () => ({ status: 'JOINED', role: 'Member' }));
  const write = stubMethod(prisma, '$transaction', async () => { throw new Error('Unexpected database write'); });
  const { state, response } = responseState();
  await controllers().createPost({ body: { title: 'Test', targetAudience: 'ProfileAndGroups', targetGroups: ['group-1', 'group-2'] }, user: { userId: 'author-1' } } as any, response);
  assert.equal(state.status, 400);
  assert.match(state.body.error, /approval.*one group/i);
  assert.equal(write.mock.callCount(), 0);
});

const editablePost = () => ({ ...post(), createdAt: new Date(), title: 'Test', description: '', responseCount: 0, media: [], questions: [], sections: [] });

test('update controller validates the effective union when audience is omitted', async () => {
  stubMethod(prisma.post, 'findUnique', async () => editablePost());
  const write = stubMethod(prisma, '$transaction', async () => { throw new Error('Unexpected database write'); });
  const { state, response } = responseState();
  await controllers().updatePost({ params: { id: 'post-1' }, body: { targetGroups: [] }, user: { userId: 'author-1' } } as any, response);
  assert.equal(state.status, 400);
  assert.equal(state.body.code, 'INVALID_POST_AUDIENCE');
  assert.equal(write.mock.callCount(), 0);
});

test('published post switched to approval-needed union is held pending at the transaction boundary', async () => {
  stubMethod(prisma.post, 'findUnique', async () => ({ ...editablePost(), targetAudience: 'Public', groupId: null, targetedGroups: [] }));
  stubMethod(prisma.group, 'findUnique', async () => ({ postingPermissions: 'ApprovalNeeded', isDeleted: false }));
  stubMethod(prisma.groupMember, 'findUnique', async () => ({ status: 'JOINED', role: 'Member' }));
  let captured: any;
  stubMethod(prisma, '$transaction', async (callback: any) => callback({ post: { update: async ({ data }: any) => {
    captured = data;
    // Stop at the persistence boundary: this test never commits or calls a database.
    throw new Error('TEST_TRANSACTION_BOUNDARY');
  } } }));
  mock.method(console, 'error', () => {});
  const { response } = responseState();
  await controllers().updatePost({ params: { id: 'post-1' }, body: { targetAudience: 'ProfileAndGroups', targetGroups: ['group-1'] }, user: { userId: 'author-1' } } as any, response);
  assert.ok(captured, 'Controller must reach the mocked persistence boundary');
  assert.equal(captured.status, 'PENDING_APPROVAL');
  assert.equal(captured.approvedAt, null);
  assert.equal(captured.approvedById, null);
});

test('saving a union draft for an approval-needed group remains DRAFT at the transaction boundary', async () => {
  stubMethod(prisma.group, 'findUnique', async () => ({ postingPermissions: 'ApprovalNeeded', isDeleted: false }));
  stubMethod(prisma.groupMember, 'findUnique', async () => ({ status: 'JOINED', role: 'Member' }));
  let captured: any;
  stubMethod(prisma, '$transaction', async (callback: any) => callback({ post: { create: async ({ data }: any) => {
    captured = data;
    throw new Error('TEST_TRANSACTION_BOUNDARY');
  } } }));
  mock.method(console, 'error', () => {});
  const { response } = responseState();
  await controllers().createPost({ body: { title: 'Draft', status: 'DRAFT', targetAudience: 'ProfileAndGroups', targetGroups: ['group-1'] }, user: { userId: 'author-1' } } as any, response);
  assert.ok(captured, 'Controller must reach the mocked persistence boundary');
  assert.equal(captured.status, 'DRAFT');
});
