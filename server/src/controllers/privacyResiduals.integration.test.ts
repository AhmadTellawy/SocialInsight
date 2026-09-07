import assert from 'node:assert/strict';
import test, { before, after, mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
  const target = new URL(process.env[name] || 'http://invalid');
  assert.equal(target.protocol, 'postgresql:');
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.port, '55447');
  assert.equal(target.pathname, '/settings_test');
}
process.env.NODE_ENV = 'test';
process.env.AUTH_ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.AUTH_SESSION_HASH_SECRET = 'private-avatar-isolated-fixture-key';
process.env.AUTH_COOKIE_SECURE = 'false';
process.env.AUTH_LEGACY_BEARER_COMPAT = 'false';
const prisma = require('../prisma').default as typeof import('../prisma').default;
const bcrypt = require('bcryptjs') as typeof import('bcryptjs');
const cron = require('../services/cronService'); mock.method(cron, 'initCronJobs', () => {});
const sockets = require('../services/socketService'); mock.method(sockets, 'initSocket', () => undefined);
const transitions = require('../services/mediaPrivacyTransitionService'); mock.method(transitions, 'resumeMediaPrivacyTransitions', async () => 0);
const cleanup = require('../services/accountCleanupService'); mock.method(cleanup, 'resumeAccountCleanupJobs', async () => 0);
const app = require('../app').default;
let server: Server, base: string;
class Browser {
  cookies = new Map<string, string>(); csrf = '';
  async request(path: string, method = 'GET', body?: unknown) {
    const headers: Record<string, string> = { Origin: 'http://localhost:3000', Cookie: [...this.cookies].map(([key, value]) => key + '=' + value).join('; ') };
    if (this.csrf) headers['X-CSRF-Token'] = this.csrf;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + '/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0], index = pair.indexOf('=');
      const key = pair.slice(0, index), value = pair.slice(index + 1);
      if (value) this.cookies.set(key, value); else this.cookies.delete(key);
    }
    const payload = await response.json().catch(() => null);
    if (payload?.csrfToken) this.csrf = payload.csrfToken;
    return { status: response.status, body: payload };
  }
}
before(async () => {
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  base = 'http://127.0.0.1:' + (server.address() as any).port;
});
after(async () => {
  await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  await prisma.$disconnect(); mock.restoreAll();
});

async function person(extra: Record<string, unknown> = {}) {
  const id = randomUUID(), password = 'FixturePass1!';
  const user = await prisma.user.create({ data: { id, name: 'Privacy fixture', handle: 'privacy_' + id.slice(0, 8), email: id + '@example.invalid', passwordHash: await bcrypt.hash(password, 4), status: 'ACTIVE', ...extra } });
  const browser = new Browser();
  assert.equal((await browser.request('/auth/login', 'POST', { identifier: id + '@example.invalid', password })).status, 200);
  return { user, browser };
}
const makePost = (authorId: string, status = 'PUBLISHED') => prisma.post.create({ data: { authorId, status, title: 'Privacy fixture', description: '', type: 'Survey', targetAudience: 'Public', expiresAt: new Date(Date.now() + 86400000) } });

// Public identity cards exclude private profile details for guests and nonfollowers.
test('finding-resolution:SI-AS-E05-001', async () => {
  const { user: target } = await person({ isPrivate: true, bio: 'secret biography', location: 'secret residence', website: 'https://private.example.invalid', country: 'Jordan', followersCount: 2000000000 });
  const { user: subject } = await person(); const { user: viewer, browser } = await person();
  const asset = await prisma.mediaAsset.create({ data: { ownerId: target.id, purpose: 'PROFILE_AVATAR', status: 'ATTACHED', accessScope: 'RESTRICTED', aspectRatio: 1, altText: 'secret avatar description', variants: { create: { kind: 'SMALL', storageBucket: 'fixture', storageKey: randomUUID(), width: 100, height: 100, mime: 'image/webp', byteSize: 100, isPublic: false } } } });
  await prisma.user.update({ where: { id: target.id }, data: { avatarMediaId: asset.id } });
  await prisma.follow.createMany({ data: [{ followerId: target.id, followingId: subject.id, status: 'ACTIVE' }, { followerId: subject.id, followingId: target.id, status: 'ACTIVE' }] });
  for (const client of [new Browser(), browser]) {
   for (const path of ['/users', '/users/' + viewer.id + '/suggested', '/users/' + subject.id + '/followers', '/users/' + subject.id + '/following']) {
    const response = await client.request(path);
    if (client !== browser && path.endsWith('/suggested')) { assert.equal(response.status, 401); continue; }
    assert.equal(response.status, 200, path);
    const card = response.body.find((value: any) => value.id === target.id); assert.ok(card, path);
    for (const key of ['bio', 'location', 'website', 'country', 'birthday', 'demographics', 'hasLegacyAvatar']) assert.equal(key in card, false, path + ':' + key);
    assert.equal(card.avatar, ''); assert.equal(card.avatarMedia.altText, null); assert.equal(card.avatarMedia.src, undefined);
    assert.equal(JSON.stringify(card).includes('secret'), false);
   }
  }
});

// Repeated responses, four people, a single-person cell, and guests cannot meet the threshold.
test('finding-resolution:SI-AS-E05-002', async () => {
  const { user: owner, browser } = await person();
  const participant = await person({ country: 'Jordan', birthday: new Date('2000-01-01') });
  await prisma.userDemographics.create({ data: { userId: participant.user.id, gender: 'Female' } });
  const posts = await Promise.all([1, 2, 3, 4, 5].map(() => makePost(owner.id)));
  await prisma.response.createMany({ data: posts.map(post => ({ postId: post.id, userId: participant.user.id })) });
  const before = await browser.request('/users/' + owner.id + '/analytics');
  assert.equal(before.status, 200); assert.equal(before.body.totalResponses, 5);
  for (const key of ['byCountry', 'byGender', 'byAge']) assert.deepEqual(before.body[key].counts, {});
  const people = await Promise.all([1, 2, 3, 4].map(() => person({ country: 'Jordan', birthday: new Date('2000-01-01') })));
  for (const value of people) await prisma.userDemographics.create({ data: { userId: value.user.id, gender: 'Female' } });
  for (const value of people.slice(0, 3)) await prisma.response.create({ data: { postId: posts[0].id, userId: value.user.id } });
  const fourPeople = await browser.request('/users/' + owner.id + '/analytics');
  assert.equal(fourPeople.body.totalResponses, 8);
  for (const key of ['byCountry', 'byGender', 'byAge']) assert.deepEqual(fourPeople.body[key].counts, {});
  await prisma.response.create({ data: { postId: posts[0].id, userId: people[3].user.id } });
  const positive = await browser.request('/users/' + owner.id + '/analytics');
  assert.equal(positive.body.totalResponses, 9); assert.deepEqual(positive.body.byGender.counts, { Male: 0, Female: 9 }); assert.deepEqual(positive.body.byCountry.counts, { Jordan: 9 });
  for (const value of [participant, ...people]) assert.equal(JSON.stringify(positive.body).includes(value.user.id), false);
  const singleCell = await person({ country: 'Jordan', birthday: new Date('2000-01-01') });
  await prisma.userDemographics.create({ data: { userId: singleCell.user.id, gender: 'Male' } });
  await prisma.response.create({ data: { postId: posts[0].id, userId: singleCell.user.id } });
  const complementary = await browser.request('/users/' + owner.id + '/analytics');
  assert.equal(complementary.body.totalResponses, 10);
  assert.deepEqual(complementary.body.byGender.counts, {});
  assert.deepEqual(complementary.body.byCountry.counts, { Jordan: 10 });
  assert.equal(complementary.body.byCountry.suppressionReason, null);
  await prisma.response.createMany({ data: posts.map(post => ({ postId: post.id, guestId: randomUUID() })) });
  const withGuests = await browser.request('/users/' + owner.id + '/analytics');
  assert.equal(withGuests.body.totalResponses, 15); assert.deepEqual(withGuests.body.byGender.counts, {}); assert.deepEqual(withGuests.body.byCountry.counts, {});
});

// Deletion removes private questionnaire and mention text, and minimizes media metadata.
test('finding-resolution:SI-AS-E05-003', async () => {
  const { user, browser } = await person(), other = await person();
  const published = await makePost(user.id), draft = await makePost(user.id, 'DRAFT');
  const section = await prisma.section.create({ data: { postId: draft.id, title: 'private section' } });
  const question = await prisma.question.create({ data: { sectionId: section.id, text: 'private question', type: 'SingleChoice', options: { create: { text: 'private option' } } }, include: { options: true } });
  await prisma.response.create({ data: { postId: draft.id, userId: other.user.id, answers: { create: { questionId: question.id, optionId: question.options[0].id, textValue: 'private answer' } } } });
  const mentions = await Promise.all([
    prisma.mention.create({ data: { actorUserId: user.id, targetUserId: other.user.id, profileUserId: user.id, sourceType: 'PROFILE', occurrences: { create: { surface: 'PROFILE_BIO', startOffset: 0, endOffset: 8, rawText: '@private' } } } }),
    prisma.mention.create({ data: { actorUserId: user.id, targetUserId: other.user.id, postId: draft.id, sourceType: 'POST', occurrences: { create: { surface: 'POST_TITLE', startOffset: 0, endOffset: 8, rawText: '@private' } } } })
  ]);
  const media = await prisma.mediaAsset.create({ data: { ownerId: user.id, purpose: 'POST', status: 'READY', altText: 'private image', checksum: 'identifying-checksum', moderationMetadata: { description: 'private image review' } } });
  const deleted = await browser.request('/account', 'DELETE'); assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  assert.equal(await prisma.post.count({ where: { id: draft.id } }), 0); assert.equal(await prisma.post.count({ where: { id: published.id } }), 1);
  assert.equal(await prisma.section.count({ where: { id: section.id } }), 0); assert.equal(await prisma.question.count({ where: { id: question.id } }), 0); assert.equal(await prisma.option.count({ where: { questionId: question.id } }), 0);
  assert.equal(await prisma.answer.count({ where: { questionId: question.id } }), 0); assert.equal(await prisma.mentionOccurrence.count({ where: { mentionId: { in: mentions.map(value => value.id) } } }), 0);
  const pending = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: media.id } }); assert.equal(pending.altText, null); assert.equal(pending.checksum, null); assert.equal(pending.moderationMetadata, null);
  // No storage objects are attached to this fixture; purge proves final database minimization without external I/O.
  await require('../services/mediaService').purgeMediaAsset(media.id);
  const purged = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: media.id } }); assert.equal(purged.status, 'DELETED'); assert.equal(purged.altText, null); assert.equal(purged.checksum, null); assert.equal(purged.moderationMetadata, null);
});

test('post create and update queued before account deletion cannot recreate private content afterward', async () => {
  const { user, browser } = await person(); const draft = await makePost(user.id, 'DRAFT');
  const security = require('../services/mfaService') as typeof import('../services/mfaService');
  const originalLock = security.lockAccountSecurity;
  let release!: () => void, ready!: () => void, waiting = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const reached = new Promise<void>(resolve => { ready = resolve; });
  const mocked = mock.method(security, 'lockAccountSecurity', async (tx: any, userId: string) => {
    if (userId === user.id && waiting < 2) { waiting++; if (waiting === 2) ready(); await gate; }
    await originalLock(tx, userId);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const create = browser.request('/posts', 'POST', { title: 'Queued private draft', type: 'Survey', status: 'DRAFT', targetAudience: 'Public' });
    const update = browser.request('/posts/' + draft.id, 'PUT', { title: 'Queued private edit' });
    await Promise.race([reached, new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error('Post writes did not reach their authorization lock')), 5000); })]);
    clearTimeout(timer);
    const deletion = await browser.request('/account', 'DELETE'); assert.equal(deletion.status, 200, JSON.stringify(deletion.body));
    release();
    const outcomes = await Promise.all([create, update]);
    assert.deepEqual(outcomes.map(value => value.status), [401, 401]);
    assert.equal(await prisma.post.count({ where: { authorId: user.id, status: { not: 'PUBLISHED' } } }), 0);
  } finally { release(); clearTimeout(timer); mocked.mock.restore(); }
});


