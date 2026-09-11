import assert from 'node:assert/strict';
import test, { before, after, mock } from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import type { Server } from 'node:http';

for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
  const target = new URL(process.env[name] || 'http://invalid');
  assert.equal(target.protocol, 'postgresql:'); assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.port, '55447'); assert.equal(target.pathname, '/settings_test');
  for (const key of target.searchParams.keys()) assert.ok(['schema', 'connection_limit', 'pool_timeout'].includes(key));
  assert.equal(target.searchParams.get('schema') || 'public', 'public');
}
process.env.NODE_ENV = 'test'; process.env.AUTH_ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.AUTH_SESSION_HASH_SECRET = 'isolated-view-integrity-fixture-key';
process.env.AUTH_COOKIE_SECURE = 'false'; process.env.AUTH_LEGACY_BEARER_COMPAT = 'false';
const prisma = require('../prisma').default as typeof import('../prisma').default;
const { hashSessionSecret } = require('../services/sessionService') as typeof import('../services/sessionService');
const { lockAccountSecurity } = require('../services/mfaService') as typeof import('../services/mfaService');
mock.method(require('../services/cronService'), 'initCronJobs', () => {});
mock.method(require('../services/socketService'), 'initSocket', () => {});
const app = require('../app').default;
const bcrypt = require('bcryptjs');
const users = [randomUUID(), randomUUID(), randomUUID()], posts: string[] = [], groups: string[] = [];
const prefix = 'vi_' + randomUUID().replace(/-/g, '').slice(0, 12), password = 'SyntheticView123!';
let server: Server, base: string;
class Browser {
  cookies = new Map<string, string>(); csrf = ''; actor: string | null = null;
  async request(path: string, method = 'POST', body?: unknown, options: { discardCookies?: boolean; csrf?: boolean; origin?: string } = {}) {
    const headers: Record<string, string> = { Cookie: [...this.cookies].map(([key, value]) => key + '=' + value).join('; ') };
    if (options.origin !== 'NONE') headers.Origin = options.origin || 'http://localhost:3000';
    if (this.csrf && options.csrf !== false) headers['X-CSRF-Token'] = this.csrf;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + '/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!options.discardCookies) for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0], equal = pair.indexOf('='), key = pair.slice(0, equal), value = pair.slice(equal + 1);
      if (value) this.cookies.set(key, value); else this.cookies.delete(key);
    }
    const payload = await response.json().catch(() => null);
    if (payload?.csrfToken) this.csrf = payload.csrfToken;
    return { status: response.status, body: payload, cookies: response.headers.getSetCookie() };
  }
  async login(index = 1) {
    const result = await this.request('/auth/login', 'POST', { identifier: prefix + index + '@example.invalid', password });
    assert.equal(result.status, 200, JSON.stringify(result.body)); this.actor = users[index];
  }
  view(postId: string, overrides: Record<string, unknown> = {}, options: { discardCookies?: boolean; csrf?: boolean; origin?: string } = {}) {
    return this.request('/posts/' + postId + '/views', 'POST', { source: 'FEED', deviceType: 'WEB', expectedActorId: this.actor, ...overrides }, options);
  }
  initialize(postId: string, overrides: Record<string, unknown> = {}, discardCookies = false) {
    return this.request('/posts/' + postId + '/views', 'POST', { initialize: true, expectedActorId: this.actor, ...overrides }, { discardCookies });
  }
}
before(async () => {
  const hash = await bcrypt.hash(password, 4);
  await prisma.user.createMany({ data: users.map((id, index) => ({ id, handle: prefix + index, name: 'Synthetic view fixture', email: prefix + index + '@example.invalid', emailVerifiedAt: new Date(), passwordHash: hash, status: 'ACTIVE' })) });
  server = await new Promise<Server>(resolve => { const active = app.listen(0, '127.0.0.1', () => resolve(active)); });
  base = 'http://127.0.0.1:' + (server.address() as any).port;
});
after(async () => {
  if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  await prisma.post.updateMany({ where: { id: { in: posts } }, data: { sharedFromId: null } });
  await prisma.hiddenPost.deleteMany({ where: { postId: { in: posts } } });
  await prisma.post.deleteMany({ where: { id: { in: posts } } });
  await prisma.groupMember.deleteMany({ where: { groupId: { in: groups } } });
  await prisma.group.deleteMany({ where: { id: { in: groups } } });
  await prisma.userBlock.deleteMany({ where: { OR: [{ blockerId: { in: users } }, { blockedId: { in: users } }] } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect(); mock.restoreAll();
});
async function fixture() {
  const post = await prisma.post.create({ data: { authorId: users[0], title: 'Synthetic view post', description: 'Fixture', type: 'Poll', status: 'PUBLISHED', targetAudience: 'Public', expiresAt: new Date(Date.now() + 86400000) } });
  posts.push(post.id); return post;
}
async function counts(postId: string) {
  const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  return { rows: await prisma.postView.count({ where: { postId } }), views: post.viewCount, unique: post.uniqueViewCount };
}

test('registered concurrent requests and retries after a lost response count exactly one server user', async () => {
  const post = await fixture(), browser = new Browser(); await browser.login();
  const results = await Promise.all(Array.from({ length: 24 }, () => browser.view(post.id, { guestSessionId: randomUUID() }, { discardCookies: true })));
  assert.deepEqual(results.map(result => result.status), Array(24).fill(200));
  assert.equal(results.filter(result => result.body.recorded).length, 1);
  assert.deepEqual(await counts(post.id), { rows: 1, views: 1, unique: 1 });
  assert.equal((await prisma.postView.findFirstOrThrow({ where: { postId: post.id } })).viewerKey, 'user:' + users[1]);
  assert.equal((await browser.view(post.id)).body.recorded, false);
});

test('missing guest proof never counts or mints a cookie; explicit initialization survives lost replies', async () => {
  const post = await fixture(), browser = new Browser();
  const bare = await Promise.all(Array.from({ length: 8 }, () => browser.view(post.id, { guestSessionId: randomUUID() })));
  assert.ok(bare.every(result => result.status === 428 && result.body.code === 'VIEW_PROOF_REQUIRED' && !result.cookies.length));
  assert.deepEqual(await counts(post.id), { rows: 0, views: 0, unique: 0 });
  assert.equal((await browser.initialize(post.id, {}, true)).status, 200);
  assert.equal(browser.cookies.size, 0);
  const initialized = await browser.initialize(post.id);
  assert.deepEqual(initialized.body, { initialized: true });
  assert.ok(initialized.cookies.some(value => value.startsWith('si_view_proof=') && value.includes('HttpOnly') && value.includes('SameSite=Lax')));
  assert.deepEqual(await counts(post.id), { rows: 0, views: 0, unique: 0 });
  const original = browser.cookies.get('si_view_proof');
  assert.equal((await browser.initialize(post.id)).cookies.length, 0);
  assert.equal(browser.cookies.get('si_view_proof'), original);
  const results = await Promise.all(Array.from({ length: 12 }, () => browser.view(post.id, { guestSessionId: randomUUID() })));
  assert.ok(results.every(result => result.status === 200)); assert.equal(results.filter(result => result.body.recorded).length, 1);
  assert.deepEqual(await counts(post.id), { rows: 1, views: 1, unique: 1 });
  assert.match((await prisma.postView.findFirstOrThrow({ where: { postId: post.id } })).viewerKey, /^guest:[a-f0-9]{64}$/);
});

test('forged and correctly signed expired guest proofs reject without minting or counting', async () => {
  const post = await fixture(), browser = new Browser();
  const nonce = randomBytes(32).toString('hex'), expiry = Date.now() - 1000;
  const signature = hashSessionSecret('post-view-proof:v1:' + nonce + ':' + expiry);
  for (const proof of ['v1.' + nonce + '.' + (Date.now() + 100000) + '.' + '0'.repeat(64), 'v1.' + nonce + '.' + expiry + '.' + signature, randomUUID()]) {
    browser.cookies.set('si_view_proof', proof);
    const result = await browser.view(post.id);
    assert.equal(result.status, 428); assert.equal(result.body.code, 'VIEW_PROOF_REQUIRED'); assert.equal(result.cookies.length, 0);
  }
  assert.deepEqual(await counts(post.id), { rows: 0, views: 0, unique: 0 });
});

test('metadata, expected actor, Origin and session CSRF reject before any counter change', async () => {
  const post = await fixture(), browser = new Browser(); await browser.login();
  for (const payload of [{ source: 'UNKNOWN' }, { source: {} }, { deviceType: ['WEB'] }, { deviceType: 'FAKE' }, { count: 100 }, { guestSessionId: 'x'.repeat(129) }]) {
    assert.equal((await browser.view(post.id, payload)).status, 400);
  }
  for (const expectedActorId of [users[0], null, undefined]) {
    const result = await browser.view(post.id, { expectedActorId });
    assert.equal(result.status, 409); assert.equal(result.body.code, 'VIEW_ACTOR_CHANGED');
  }
  assert.equal((await browser.initialize(post.id, { expectedActorId: users[0] })).status, 409);
  assert.equal((await browser.view(post.id, {}, { csrf: false })).status, 403);
  assert.equal((await browser.view(post.id, {}, { origin: 'NONE' })).status, 403);
  const guest = new Browser();
  assert.equal((await guest.initialize(post.id, { expectedActorId: users[1] })).status, 409);
  assert.deepEqual(await counts(post.id), { rows: 0, views: 0, unique: 0 });
});

test('private, transitional, inactive, draft and deleted content cannot initialize or record guest views', async () => {
  const post = await fixture(), browser = new Browser(); await browser.initialize(post.id);
  for (const data of [{ isPrivate: true }, { isPrivate: false, mediaPrivacyTarget: true }, { mediaPrivacyTarget: null, status: 'DEACTIVATED' }, { status: 'DELETED' }]) {
    await prisma.user.update({ where: { id: users[0] }, data });
    assert.equal((await browser.initialize(post.id)).status, 403);
    assert.equal((await browser.view(post.id)).status, 403);
  }
  await prisma.user.update({ where: { id: users[0] }, data: { status: 'ACTIVE', isPrivate: false, mediaPrivacyTarget: null } });
  await prisma.post.update({ where: { id: post.id }, data: { status: 'DRAFT' } });
  assert.equal((await browser.view(post.id)).status, 403);
  await prisma.post.update({ where: { id: post.id }, data: { status: 'PUBLISHED', isDeleted: true } });
  assert.equal((await browser.view(post.id)).status, 403);
  assert.deepEqual(await counts(post.id), { rows: 0, views: 0, unique: 0 });
});

test('current block, hidden status and unavailable shared source override a previously cached view', async () => {
  const post = await fixture(), shared = await fixture(), browser = new Browser(); await browser.login();
  assert.equal((await browser.view(post.id)).status, 200);
  await prisma.userBlock.create({ data: { blockerId: users[0], blockedId: users[1] } });
  assert.equal((await browser.view(post.id)).status, 403);
  await prisma.userBlock.deleteMany({ where: { blockerId: users[0], blockedId: users[1] } });
  await prisma.hiddenPost.create({ data: { userId: users[1], postId: post.id } });
  assert.equal((await browser.view(post.id)).status, 403);
  await prisma.hiddenPost.deleteMany({ where: { userId: users[1], postId: post.id } });
  await prisma.post.update({ where: { id: shared.id }, data: { sharedFromId: post.id } });
  assert.equal((await browser.view(shared.id)).status, 200);
  await prisma.post.update({ where: { id: post.id }, data: { isDeleted: true } });
  assert.equal((await browser.view(shared.id)).status, 403);
  assert.deepEqual(await counts(post.id), { rows: 1, views: 1, unique: 1 });
  assert.deepEqual(await counts(shared.id), { rows: 1, views: 1, unique: 1 });
});

test('public-group readers may count views; private and deleted groups require current visible membership', async () => {
  const post = await fixture(), guest = new Browser(), browser = new Browser(); await browser.login();
  const group = await prisma.group.create({ data: { name: 'Synthetic view group', category: 'test', description: 'Fixture', isPublic: true } }); groups.push(group.id);
  await prisma.post.update({ where: { id: post.id }, data: { groupId: group.id, targetAudience: 'Groups' } });
  assert.equal((await guest.initialize(post.id)).status, 200); assert.equal((await guest.view(post.id)).status, 200);
  await prisma.group.update({ where: { id: group.id }, data: { isPublic: false } });
  assert.equal((await guest.view(post.id)).status, 403); assert.equal((await browser.view(post.id)).status, 403);
  await prisma.groupMember.create({ data: { userId: users[1], groupId: group.id, status: 'JOINED' } });
  assert.equal((await browser.view(post.id)).status, 200);
  await prisma.groupMember.update({ where: { userId_groupId: { userId: users[1], groupId: group.id } }, data: { status: 'REMOVED' } });
  assert.equal((await browser.view(post.id)).status, 403);
  await prisma.group.update({ where: { id: group.id }, data: { isPublic: true, isDeleted: true } });
  assert.equal((await guest.view(post.id)).status, 403);
  assert.deepEqual(await counts(post.id), { rows: 2, views: 2, unique: 2 });
});

test('a new sixty-minute window increments total views without incrementing prior viewer uniqueness', async () => {
  const post = await fixture(), browser = new Browser(); await browser.login();
  await prisma.postView.create({ data: { postId: post.id, viewerKey: 'user:' + users[1], source: 'PROFILE', deviceType: 'WEB', viewedAt: new Date(Date.now() - 61 * 60 * 1000) } });
  await prisma.post.update({ where: { id: post.id }, data: { viewCount: 1, uniqueViewCount: 1 } });
  assert.equal((await browser.view(post.id)).body.recorded, true);
  assert.equal((await browser.view(post.id)).body.recorded, false);
  assert.deepEqual(await counts(post.id), { rows: 2, views: 2, unique: 1 });
});

test('trending and group detail surfaces preserve their actual source labels', async () => {
  const browser = new Browser(); await browser.login();
  for (const source of ['TRENDING', 'GROUP']) {
    const post = await fixture();
    const result = await browser.view(post.id, { source });
    assert.equal(result.status, 200); assert.equal(result.body.recorded, true);
    assert.equal((await prisma.postView.findFirstOrThrow({ where: { postId: post.id } })).source, source);
  }
});

test('privacy changed during a post-lock wait is rechecked before insertion', async () => {
  const post = await fixture(), browser = new Browser(); await browser.initialize(post.id);
  let unlock!: () => void, ready!: () => void;
  const locked = new Promise<void>(resolve => ready = resolve), release = new Promise<void>(resolve => unlock = resolve);
  const holder = prisma.$transaction(async tx => { await tx.$queryRawUnsafe('SELECT id FROM "Post" WHERE id=$1 FOR UPDATE', post.id); ready(); await release; await tx.post.update({ where: { id: post.id }, data: { isDeleted: true } }); });
  await locked; const request = browser.view(post.id); await new Promise(resolve => setTimeout(resolve, 100)); unlock(); await holder;
  assert.equal((await request).status, 403); assert.deepEqual(await counts(post.id), { rows: 0, views: 0, unique: 0 });
});

test('session revoked during its account-lock wait cannot record or downgrade into a guest view', async () => {
  const post = await fixture(), browser = new Browser(); await browser.login(2);
  let unlock!: () => void, ready!: () => void;
  const locked = new Promise<void>(resolve => ready = resolve), release = new Promise<void>(resolve => unlock = resolve);
  const holder = prisma.$transaction(async tx => { await lockAccountSecurity(tx, users[2]); ready(); await release; await tx.authSession.updateMany({ where: { userId: users[2] }, data: { revokedAt: new Date() } }); });
  await locked; const request = browser.view(post.id); await new Promise(resolve => setTimeout(resolve, 100)); unlock(); await holder;
  const result = await request; assert.equal(result.status, 401); assert.equal(result.cookies.length, 0);
  assert.equal((await browser.initialize(post.id)).status, 401);
  assert.deepEqual(await counts(post.id), { rows: 0, views: 0, unique: 0 });
});
