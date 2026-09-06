import assert from 'node:assert/strict';
import test, { before, after, mock } from 'node:test';
import { randomUUID } from 'node:crypto';

// This explicit-only suite must never connect to a shared or production target.
for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
  const value = process.env[name];
  assert.ok(value, `${name} must name the dedicated local integration database`);
  const url = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.equal(url.port, '55439');
  assert.equal(url.pathname, '/creator_test');
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'local-creator-integration-secret';

const prisma = require('../prisma').default as typeof import('../prisma').default;
const { buildVisiblePublishedPostWhere } = require('./postVisibilityService') as typeof import('./postVisibilityService');
const { GroupPermissionService } = require('./groupPermissionService') as typeof import('./groupPermissionService');
const { getMediaReadPresentation } = require('./mediaService') as typeof import('./mediaService');
const storageModule = require('./mediaStorage') as typeof import('./mediaStorage');
const notificationModule = require('./notificationService') as typeof import('./notificationService');
const { createPost, updatePost, getPostById, votePost, createComment } = require('../controllers/postController') as typeof import('../controllers/postController');

const prefix = `creator_union_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const id = (suffix: string) => `${prefix}_${suffix}`;
const users = ['public_author', 'private_author', 'follower', 'member', 'outsider'].map(id);
const groups = ['private_group', 'public_group', 'approval_group'].map(id);
const ids = { pub: users[0], priv: users[1], follower: users[2], member: users[3], outsider: users[4], group: groups[0], openGroup: groups[1], approval: groups[2] };
const postIds: string[] = [];

function responseState() {
  const state = { status: 200, body: undefined as any, headers: {} as Record<string, string> };
  const response: any = {
    status(code: number) { state.status = code; return response; },
    json(body: any) { state.body = body; return response; },
    setHeader(name: string, value: any) { state.headers[name] = String(value); },
  };
  return { state, response };
}
function request(userId: string | undefined, postId = '', body: any = {}) {
  return { user: userId ? { userId } : undefined, params: { id: postId }, body, query: {}, headers: {}, method: 'TEST', path: '/local-integration' } as any;
}
async function seedPost(suffix: string, authorId: string, targetAudience = 'ProfileAndGroups', status = 'PUBLISHED', groupId = ids.group) {
  const result = await prisma.post.create({ data: {
    id: id(suffix), title: 'Synthetic creator integration', description: 'Local fixture', type: 'Post', authorId,
    expiresAt: new Date(Date.now() + 86400000), targetAudience, status,
    groupId, targetedGroups: { connect: [{ id: groupId }] },
  } });
  postIds.push(result.id);
  return result.id;
}

before(async () => {
  mock.method(notificationModule, 'dispatchNotificationIds', async () => {});
  mock.method(notificationModule, 'notify', async () => undefined as any);
  const unexpectedStorage = async (): Promise<any> => { throw new Error('Unexpected external storage operation'); };
  storageModule.setMediaStorageForTests({
    createSignedReadUrl: async (_bucket, key) => `https://example.invalid/${encodeURIComponent(key)}`,
    createSignedUpload: unexpectedStorage, download: unexpectedStorage, upload: unexpectedStorage,
    copy: unexpectedStorage, remove: unexpectedStorage, provisionBuckets: unexpectedStorage,
    getPublicUrl: () => { throw new Error('Union media must not use public URLs'); },
  });
  await prisma.user.createMany({ data: users.map((userId, index) => ({ id: userId, handle: userId, name: 'Synthetic local user', isPrivate: index === 1 })) });
  await prisma.group.createMany({ data: groups.map((groupId, index) => ({ id: groupId, name: 'Synthetic local group', description: '', category: 'Test', isPublic: index === 1, postingPermissions: index === 2 ? 'ApprovalNeeded' : 'AllMembers' })) });
  await prisma.groupMember.createMany({ data: [
    ...groups.map(groupId => ({ userId: ids.pub, groupId, role: 'Member', status: 'JOINED' })),
    { userId: ids.priv, groupId: ids.group, role: 'Member', status: 'JOINED' },
    { userId: ids.member, groupId: ids.group, role: 'Member', status: 'JOINED' },
  ] });
  await prisma.follow.create({ data: { followerId: ids.follower, followingId: ids.priv, status: 'ACTIVE' } });
  await seedPost('public_union', ids.pub);
  await seedPost('private_union', ids.priv);
  await seedPost('legacy_group', ids.pub, 'Groups');
  await seedPost('pending', ids.pub, 'ProfileAndGroups', 'PENDING_APPROVAL');
});

after(async () => {
  // Exact synthetic author IDs keep cleanup bounded even if a controller created an ID.
  const owned = await prisma.post.findMany({ where: { authorId: { in: users } }, select: { id: true } });
  const ownedIds = owned.map(post => post.id);
  const questions = await prisma.question.findMany({ where: { postId: { in: ownedIds } }, select: { id: true } });
  await prisma.answer.deleteMany({ where: { response: { postId: { in: ownedIds } } } });
  await prisma.response.deleteMany({ where: { postId: { in: ownedIds } } });
  await prisma.comment.deleteMany({ where: { postId: { in: ownedIds } } });
  await prisma.option.deleteMany({ where: { questionId: { in: questions.map(question => question.id) } } });
  await prisma.question.deleteMany({ where: { postId: { in: ownedIds } } });
  await prisma.post.deleteMany({ where: { id: { in: ownedIds } } });
  await prisma.mediaAsset.deleteMany({ where: { ownerId: { in: users } } });
  await prisma.groupMember.deleteMany({ where: { groupId: { in: groups } } });
  await prisma.group.deleteMany({ where: { id: { in: groups } } });
  await prisma.follow.deleteMany({ where: { OR: [{ followerId: { in: users } }, { followingId: { in: users } }] } });
  await prisma.userBlock.deleteMany({ where: { OR: [{ blockerId: { in: users } }, { blockedId: { in: users } }] } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  mock.restoreAll();
  await prisma.$disconnect();
});

test('actual PostgreSQL enforces profile/group union, private followers, approval and legacy boundaries', async () => {
  const visible = async (postId: string, viewer?: string) => (await prisma.post.count({ where: { id: postId, ...buildVisiblePublishedPostWhere(viewer) } })) === 1;
  assert.equal(await visible(id('public_union')), true);
  assert.equal(await visible(id('private_union')), false);
  assert.equal(await visible(id('private_union'), ids.follower), true);
  assert.equal(await visible(id('private_union'), ids.member), true);
  assert.equal(await visible(id('private_union'), ids.outsider), false);
  assert.equal(await visible(id('legacy_group')), false);
  assert.equal(await visible(id('pending')), false);
  const block = await prisma.userBlock.create({ data: { blockerId: ids.pub, blockedId: ids.outsider } });
  assert.equal(await visible(id('public_union'), ids.outsider), false);
  assert.equal(await GroupPermissionService.canViewPost(id('public_union'), ids.outsider), false);
  await prisma.userBlock.delete({ where: { id: block.id } });
  await prisma.group.update({ where: { id: ids.group }, data: { isDeleted: true } });
  assert.equal(await visible(id('public_union')), true);
  assert.equal(await GroupPermissionService.canViewPost(id('public_union'), undefined), true);
  assert.equal(await visible(id('private_union'), ids.member), false);
  await prisma.group.update({ where: { id: ids.group }, data: { isDeleted: false } });
});

test('actual post detail serialization hides private group identifiers from profile-only readers', async () => {
  const { state, response } = responseState();
  await getPostById(request(ids.outsider, id('public_union')), response);
  assert.equal(state.status, 200);
  assert.equal(state.body.id, id('public_union'));
  assert.equal(state.body.groupId, null);
  assert.deepEqual(state.body.targetGroups, []);
  assert.ok(!JSON.stringify(state.body).includes(ids.group), 'No private group identifier may survive another serialized property');
});

test('actual media resolver allows profile/group readers and denies outsiders before signing', async () => {
  await prisma.mediaAsset.create({ data: {
    id: id('asset'), ownerId: ids.priv, purpose: 'POST', status: 'ATTACHED', accessScope: 'INHERITED_GROUP', aspectRatio: 1,
    variants: { create: { kind: 'MEDIUM', storageBucket: 'local-fixture-private', storageKey: id('image'), width: 300, height: 300, mime: 'image/webp', byteSize: 1, isPublic: false } },
    postAttachment: { create: { postId: id('private_union'), sortOrder: 0 } },
  } });
  assert.equal((await getMediaReadPresentation(id('asset'), ids.follower)).access, 'RESTRICTED');
  assert.equal((await getMediaReadPresentation(id('asset'), ids.member)).access, 'RESTRICTED');
  await assert.rejects(getMediaReadPresentation(id('asset'), ids.outsider), (error: any) => error.statusCode === 404);
});

test('actual create/update persists union and retains draft/approval constraints', async () => {
  const created = responseState();
  await createPost(request(ids.pub, '', { title: 'Synthetic created post', type: 'Post', targetAudience: 'ProfileAndGroups', targetGroups: [ids.group] }), created.response);
  assert.equal(created.state.status, 200);
  const createdId = created.state.body.id;
  const persisted = await prisma.post.findUniqueOrThrow({ where: { id: createdId }, include: { targetedGroups: true } });
  assert.equal(persisted.targetAudience, 'ProfileAndGroups');
  assert.deepEqual(persisted.targetedGroups.map(group => group.id), [ids.group]);
  const updated = responseState();
  await updatePost(request(ids.pub, createdId, { targetGroups: [ids.approval] }), updated.response);
  assert.equal(updated.state.status, 200);
  assert.equal((await prisma.post.findUniqueOrThrow({ where: { id: createdId } })).status, 'PENDING_APPROVAL');
  const draft = responseState();
  await createPost(request(ids.pub, '', { title: 'Synthetic draft', type: 'Post', status: 'DRAFT', targetAudience: 'ProfileAndGroups', targetGroups: [ids.approval] }), draft.response);
  assert.equal(draft.state.status, 200);
  assert.equal((await prisma.post.findUniqueOrThrow({ where: { id: draft.state.body.id } })).status, 'DRAFT');
  const published = responseState();
  await updatePost(request(ids.pub, draft.state.body.id, { status: 'PUBLISHED' }), published.response);
  assert.equal(published.state.status, 200);
  assert.equal((await prisma.post.findUniqueOrThrow({ where: { id: draft.state.body.id } })).status, 'PENDING_APPROVAL');

  const profileDraft = responseState();
  await createPost(request(ids.pub, '', { title: 'Synthetic profile conversion', type: 'Post', status: 'DRAFT', targetAudience: 'ProfileAndGroups', targetGroups: [ids.group] }), profileDraft.response);
  assert.equal(profileDraft.state.status, 200);
  const profileOnly = responseState();
  await updatePost(request(ids.pub, profileDraft.state.body.id, { targetAudience: 'Public', targetGroups: [] }), profileOnly.response);
  assert.equal(profileOnly.state.status, 200);
  const detached = await prisma.post.findUniqueOrThrow({ where: { id: profileDraft.state.body.id }, include: { targetedGroups: true } });
  assert.equal(detached.targetAudience, 'Public');
  assert.equal(detached.status, 'DRAFT');
  assert.equal(detached.groupId, null);
  assert.deepEqual(detached.targetedGroups, []);
});

test('denied actual vote/comment requests leave persisted response and option counts unchanged', async () => {
  await prisma.question.create({ data: { id: id('question'), postId: id('private_union'), text: 'Synthetic question', type: 'SingleChoice', options: { create: { id: id('option'), text: 'Synthetic option' } } } });
  const beforeResponses = await prisma.response.count({ where: { postId: id('private_union') } });
  const beforeComments = await prisma.comment.count({ where: { postId: id('private_union') } });
  const vote = responseState();
  await votePost(request(ids.outsider, id('private_union'), { optionIds: [id('option')] }), vote.response);
  assert.equal(vote.state.status, 403);
  const comment = responseState();
  await createComment(request(ids.outsider, id('private_union'), { text: 'Denied synthetic comment' }), comment.response);
  assert.equal(comment.state.status, 403);
  assert.equal(await prisma.response.count({ where: { postId: id('private_union') } }), beforeResponses);
  assert.equal(await prisma.comment.count({ where: { postId: id('private_union') } }), beforeComments);
  assert.equal((await prisma.option.findUniqueOrThrow({ where: { id: id('option') } })).votes, 0);
});

test('eligible profile follower and group member persist actual votes and comments', async () => {
  const postId = await seedPost('interaction_union', ids.priv);
  await prisma.post.update({ where: { id: postId }, data: { type: 'Poll', allowComments: true } });
  const questionId = id('interaction_question');
  const optionId = id('interaction_option');
  await prisma.question.create({ data: { id: questionId, postId, text: 'Synthetic eligible question', type: 'SingleChoice', options: { create: { id: optionId, text: 'Synthetic eligible option' } } } });
  for (const userId of [ids.follower, ids.member]) {
    const vote = responseState();
    await votePost(request(userId, postId, { optionIds: [optionId] }), vote.response);
    assert.equal(vote.state.status, 200, JSON.stringify(vote.state.body));
    const persisted = await prisma.response.findFirstOrThrow({ where: { postId, userId }, include: { answers: true } });
    assert.equal(persisted.answers.length, 1);
    assert.equal(persisted.answers[0].optionId, optionId);
    const comment = responseState();
    const text = `Eligible synthetic comment ${userId}`;
    await createComment(request(userId, postId, { text }), comment.response);
    assert.equal(comment.state.status, 200, JSON.stringify(comment.state.body));
    assert.equal(await prisma.comment.count({ where: { postId, userId, text } }), 1);
  }
  assert.equal(await prisma.response.count({ where: { postId } }), 2);
  assert.equal(await prisma.comment.count({ where: { postId } }), 2);
  assert.equal((await prisma.option.findUniqueOrThrow({ where: { id: optionId } })).votes, 2);
  const counters = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  assert.equal(counters.responseCount, 2);
  assert.equal(counters.commentsCount, 2);
});
