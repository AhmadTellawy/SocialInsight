import assert from 'node:assert/strict';
import test, { after, before, mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

// Deliberately fail closed before importing Prisma or the application.
for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
  const target = new URL(process.env[name] || 'http://invalid');
  assert.equal(target.protocol, 'postgresql:');
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.port, '55447');
  assert.equal(target.pathname, '/settings_test');
}
process.env.NODE_ENV = 'test';
process.env.AUTH_ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.AUTH_SESSION_HASH_SECRET = 'isolated-settings-qa-session-key';
process.env.AUTH_COOKIE_SECURE = 'false';
process.env.AUTH_LEGACY_BEARER_COMPAT = 'false';
process.env.AUTH_RECENT_TTL_SECONDS = '600';
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;

const prisma = require('../prisma').default as typeof import('../prisma').default;
const bcrypt = require('bcryptjs') as typeof import('bcryptjs');
const cron = require('../services/cronService');
const sockets = require('../services/socketService');
const cleanup = require('../services/accountCleanupService') as typeof import('../services/accountCleanupService');
const actualCleanup = cleanup.resumeAccountCleanupJobs;
mock.method(cron, 'initCronJobs', () => {});
mock.method(sockets, 'initSocket', () => undefined);
// Explicitly driven below, so no unrelated pending job or storage is touched.
mock.method(cleanup, 'resumeAccountCleanupJobs', async () => 0);
const webpush = require('web-push') as typeof import('web-push');
const deliveries: string[] = [];
mock.method(webpush, 'sendNotification', async (subscription: any) => {
  deliveries.push(subscription.endpoint);
  return { statusCode: 201, body: '', headers: {} };
});
const app = require('../app').default;
const userIds: string[] = [], postIds: string[] = [], responseIds: string[] = [];
const prefix = `qa_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
const password = 'FixturePass1!';
let server: Server, base: string, passwordHash: string;

class Browser {
  cookies = new Map<string, string>();
  csrf = '';
  async request(path: string, method = 'GET', body?: unknown) {
    const headers: Record<string, string> = {
      Origin: 'http://localhost:3000',
      Cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '),
      'X-CSRF-Token': this.csrf
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${base}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';'), separator = pair.indexOf('=');
      const key = pair.slice(0, separator), value = pair.slice(separator + 1);
      if (value) this.cookies.set(key, value); else this.cookies.delete(key);
    }
    const payload = await response.json().catch(() => null);
    if (payload?.csrfToken) this.csrf = payload.csrfToken;
    return { status: response.status, body: payload, headers: response.headers };
  }
}
async function fixture(name: string) {
  const id = randomUUID(); userIds.push(id);
  const user = await prisma.user.create({ data: { id, name: `Synthetic ${name}`, handle: `${prefix}_${name}`, email: `${prefix}_${name}@example.invalid`, emailVerifiedAt: new Date(), passwordHash, status: 'ACTIVE' } });
  const client = new Browser();
  const login = await client.request('/auth/login', 'POST', { identifier: user.email, password });
  assert.equal(login.status, 200, `fixture login failed: ${login.body?.code}`);
  return { user, client };
}
const subscription = (suffix: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${prefix}_${suffix}`, keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) } });
async function post(owner: string, suffix: string) {
  const row = await prisma.post.create({ data: { authorId: owner, title: `${prefix}_${suffix}`, description: 'Synthetic retained contribution', type: 'POLL', expiresAt: new Date(Date.now() + 86_400_000) } });
  postIds.push(row.id); return row;
}
before(async () => {
  passwordHash = await bcrypt.hash(password, 4);
  server = await new Promise<Server>(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(async () => {
  if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  // Exact UUID ownership, including rows deliberately retained by account deletion.
  try {
    await prisma.$transaction(async tx => {
      await tx.answer.deleteMany({ where: { responseId: { in: responseIds } } });
      await tx.response.deleteMany({ where: { OR: [{ id: { in: responseIds } }, { userId: { in: userIds } }] } });
      await tx.comment.deleteMany({ where: { userId: { in: userIds } } });
      await tx.postView.deleteMany({ where: { postId: { in: postIds } } });
      await tx.interactionEvent.deleteMany({ where: { OR: [{ actor_user_id: { in: userIds } }, { target_user_id: { in: userIds } }] } });
      await tx.userLike.deleteMany({ where: { userId: { in: userIds } } });
      await tx.follow.deleteMany({ where: { OR: [{ followerId: { in: userIds } }, { followingId: { in: userIds } }] } });
      await tx.userBlock.deleteMany({ where: { OR: [{ blockerId: { in: userIds } }, { blockedId: { in: userIds } }] } });
      await tx.userDemographics.deleteMany({ where: { userId: { in: userIds } } });
      await tx.otpChallenge.deleteMany({ where: { subject: { in: userIds } } });
      await tx.accountCleanupJob.deleteMany({ where: { userId: { in: userIds } } });
      await tx.post.deleteMany({ where: { id: { in: postIds } } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    }, { timeout: 20_000 });
    assert.equal(await prisma.user.count({ where: { id: { in: userIds } } }), 0);
    assert.equal(await prisma.post.count({ where: { id: { in: postIds } } }), 0);
  } finally { mock.restoreAll(); await prisma.$disconnect(); }
});

test('stale recent authentication denies export, deactivation and deletion without changing the account', async () => {
  const { user, client } = await fixture('stale');
  await prisma.authSession.updateMany({ where: { userId: user.id }, data: { recentAuthenticatedAt: new Date(Date.now() - 700_000), createdAt: new Date(Date.now() - 700_000) } });
  for (const [path, method] of [['/account/export', 'GET'], ['/account/deactivate', 'POST'], ['/account', 'DELETE']]) {
    const result = await client.request(path, method);
    assert.equal(result.status, 401); assert.equal(result.body.code, 'REAUTHENTICATION_REQUIRED');
  }
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status, 'ACTIVE');
  assert.equal(await prisma.accountCleanupJob.count({ where: { userId: user.id } }), 0);
});

test('export crosses its 250-record page boundary exactly and excludes other owners and security data', async () => {
  const owner = await fixture('export'), other = await fixture('outsider');
  const rows = Array.from({ length: 503 }, (_, index) => ({ id: randomUUID(), authorId: owner.user.id, title: `${prefix}_record_${index}`, description: '', type: 'POLL', expiresAt: new Date(Date.now() + 86_400_000) }));
  postIds.push(...rows.map(row => row.id)); await prisma.post.createMany({ data: rows });
  const outside = await post(other.user.id, 'outside');
  const result = await owner.client.request('/account/export');
  assert.equal(result.status, 200); assert.equal(result.body.posts.length, 503);
  assert.deepEqual(new Set(result.body.posts.map((row: any) => row.id)), new Set(rows.map(row => row.id)));
  const serialized = JSON.stringify(result.body);
  for (const forbidden of [outside.id, other.user.email!, 'passwordHash', 'tokenHash', 'csrfHash', 'encryptedSecret', 'ipAddress']) assert.equal(serialized.includes(forbidden), false);
  assert.match(result.headers.get('content-disposition')!, /attachment/);
  assert.match(result.headers.get('cache-control')!, /no-store/);
});

test('push device unsubscribe is owner-scoped and browser endpoint rebinding preserves the other device', async () => {
  const a = await fixture('devices'), b = await fixture('rebind');
  const first = subscription('first'), second = subscription('second');
  for (const entry of [first, second]) assert.equal((await a.client.request('/push/subscribe', 'POST', { subscription: entry })).status, 201);
  assert.equal((await b.client.request('/push/unsubscribe', 'POST', { endpoint: first.endpoint })).status, 200);
  assert.equal(await prisma.pushSubscription.count({ where: { userId: a.user.id } }), 2);
  assert.equal((await b.client.request('/push/subscribe', 'POST', { subscription: first })).status, 201);
  assert.equal((await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: first.endpoint } })).userId, b.user.id);
  assert.equal((await a.client.request('/push/unsubscribe', 'POST', { endpoint: first.endpoint })).status, 200);
  assert.equal(await prisma.pushSubscription.count({ where: { userId: b.user.id } }), 1);
  assert.equal((await a.client.request('/push/unsubscribe', 'POST', { endpoint: second.endpoint })).status, 200);
  assert.equal(await prisma.pushSubscription.count({ where: { userId: a.user.id } }), 0);
  assert.equal(await prisma.pushSubscription.count({ where: { userId: b.user.id } }), 1);
});

test('controlled push delivery removes 404/410 subscriptions while preserving transient failures and in-app records', async () => {
  const { user } = await fixture('delivery');
  const preferences = structuredClone(require('../services/notificationPolicy').defaultNotificationSettings);
  preferences.toggles.pushNotifications = true;
  await prisma.notificationSettings.create({ data: { userId: user.id, settings: JSON.stringify(preferences) } });
  const entries = ['404', '410', '503', 'ok'].map(subscription);
  await prisma.pushSubscription.createMany({ data: entries.map(entry => ({ userId: user.id, endpoint: entry.endpoint, ...entry.keys })) });
  const sender = mock.method(webpush, 'sendNotification', async (entry: any) => {
    deliveries.push(entry.endpoint);
    const statusCode = Number(entry.endpoint.split('_').at(-1));
    if (statusCode) throw Object.assign(new Error('Synthetic transport response'), { statusCode });
    return { statusCode: 201, body: '', headers: {} };
  });
  try {
    const record = await prisma.notification.create({ data: { userId: user.id, type: 'like', message: 'Synthetic in-app notification' } });
    await require('../services/pushService').sendPushNotification(user.id, { title: 'Fixture', body: 'Fixture' });
    assert.deepEqual((await prisma.pushSubscription.findMany({ where: { userId: user.id } })).map(row => row.endpoint).sort(), entries.slice(2).map(row => row.endpoint).sort());
    assert.ok(await prisma.notification.findUnique({ where: { id: record.id } }));
    const count = deliveries.length;
    await prisma.user.update({ where: { id: user.id }, data: { status: 'DEACTIVATED' } });
    await require('../services/pushService').sendPushNotification(user.id, { title: 'Fixture', body: 'Fixture' });
    assert.equal(deliveries.length, count);
  } finally { sender.mock.restore(); }
});

test('deletion removes private residual fixtures, retains deidentified contributions and retries failed media cleanup', async () => {
  const { user, client } = await fixture('residual'), other = await fixture('residual_other');
  const contribution = await post(user.id, 'retained');
  const response = await prisma.response.create({ data: { userId: user.id, guestId: 'synthetic-linked-guest', guestProofHash: 'a'.repeat(64), guestProofExpiresAt: new Date(Date.now() + 60_000), ipAddress: '192.0.2.7', postId: contribution.id } });
  responseIds.push(response.id);
  const media = await prisma.mediaAsset.create({ data: { ownerId: user.id, purpose: 'PROFILE_AVATAR', status: 'READY' } });
  await prisma.userDemographics.create({ data: { userId: user.id, gender: 'Female', ageGroup: '25-34' } });
  await prisma.userMfa.create({ data: { userId: user.id, pendingSecret: 'synthetic-pending-secret', recoveryCodeHashes: ['synthetic-recovery-hash'] } });
  await prisma.otpChallenge.create({ data: { destination: user.email!, destinationHash: 'd'.repeat(64), purpose: 'EMAIL_VERIFICATION', subject: user.id, codeHash: 'synthetic-hash', expiresAt: new Date(Date.now() + 60_000), cooldownUntil: new Date(Date.now() + 20_000) } });
  await prisma.profileLink.create({ data: { userId: user.id, title: 'Fixture', url: 'https://example.invalid', normalizedUrl: 'https://example.invalid/', sortOrder: 0 } });
  await prisma.follow.createMany({ data: [{ followerId: user.id, followingId: other.user.id, status: 'ACTIVE' }, { followerId: other.user.id, followingId: user.id, status: 'ACTIVE' }] });
  await prisma.user.update({ where: { id: other.user.id }, data: { followersCount: 1, followingCount: 1 } });
  await prisma.userBlock.createMany({ data: [{ blockerId: user.id, blockedId: other.user.id }, { blockerId: other.user.id, blockedId: user.id }] });
  await prisma.interactionEvent.createMany({ data: [{ actor_user_id: user.id, target_user_id: other.user.id }, { actor_user_id: other.user.id, target_user_id: user.id }].map(row => ({ ...row, event_type: 'PROFILE_VIEW', source_surface: 'PROFILE', session_id: prefix, device_type: 'WEB' })) });
  await prisma.postView.create({ data: { postId: contribution.id, viewerKey: `user:${user.id}`, ipHash: 'synthetic-ip-hash' } });
  const removed = await client.request('/account', 'DELETE');
  assert.equal(removed.status, 200); assert.equal(removed.body.mediaCleanupPending, true);
  const stored = await prisma.response.findUniqueOrThrow({ where: { id: response.id } });
  assert.equal(stored.userId, null); assert.equal(stored.guestId, null); assert.equal(stored.ipAddress, null); assert.equal(stored.isAnonymous, true);
  assert.equal(stored.guestProofHash, null); assert.equal(stored.guestProofExpiresAt, null);
  assert.ok(await prisma.post.findUnique({ where: { id: contribution.id } }));
  for (const model of [prisma.userDemographics, prisma.userMfa, prisma.profileLink, prisma.authSession] as any[]) assert.equal(await model.count({ where: { userId: user.id } }), 0);
  assert.equal(await prisma.otpChallenge.count({ where: { subject: user.id } }), 0);
  assert.equal(await prisma.follow.count({ where: { OR: [{ followerId: user.id }, { followingId: user.id }] } }), 0);
  assert.equal(await prisma.userBlock.count({ where: { OR: [{ blockerId: user.id }, { blockedId: user.id }] } }), 0);
  assert.equal(await prisma.interactionEvent.count({ where: { OR: [{ actor_user_id: user.id }, { target_user_id: user.id }] } }), 0);
  assert.equal(await prisma.postView.count({ where: { viewerKey: `user:${user.id}` } }), 0);
  const counter = await prisma.user.findUniqueOrThrow({ where: { id: other.user.id } });
  assert.equal(counter.followersCount, 0); assert.equal(counter.followingCount, 0);
  const originalJobQuery = prisma.accountCleanupJob.findMany;
  prisma.accountCleanupJob.findMany = (async () => [await prisma.accountCleanupJob.findUniqueOrThrow({ where: { userId: user.id } })]) as typeof originalJobQuery;
  const mediaService = require('../services/mediaService');
  let attempts = 0;
  const storage = mock.method(mediaService, 'scheduleMediaDeletion', async (ids: string[]) => {
    assert.deepEqual(ids, [media.id]);
    if (++attempts === 1) throw new Error('Synthetic storage outage');
    await prisma.mediaAsset.update({ where: { id: media.id }, data: { status: 'DELETED', deletedAt: new Date() } });
  });
  try {
    await actualCleanup();
    let job = await prisma.accountCleanupJob.findUniqueOrThrow({ where: { userId: user.id } });
    assert.equal(job.completedAt, null); assert.equal(job.attempts, 1); assert.deepEqual(job.mediaIds, [media.id]);
    assert.equal((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: media.id } })).status, 'PENDING_DELETE');
    await actualCleanup();
    job = await prisma.accountCleanupJob.findUniqueOrThrow({ where: { userId: user.id } });
    assert.ok(job.completedAt); assert.equal(job.attempts, 2); assert.deepEqual(job.mediaIds, []);
  } finally { storage.mock.restore(); prisma.accountCleanupJob.findMany = originalJobQuery; }
});

test('settings, push and profile-link requests admitted before deletion cannot recreate private data after deletion commits', async () => {
  const { user, client } = await fixture('queued');
  const preferences = await client.request('/notification-settings');
  const security = require('../services/mfaService') as typeof import('../services/mfaService');
  const original = security.lockAccountSecurity;
  let admitted = 0, resume!: () => void, reached!: () => void;
  const held = new Promise<void>(resolve => { resume = resolve; });
  const ready = new Promise<void>(resolve => { reached = resolve; });
  const lock = mock.method(security, 'lockAccountSecurity', async (tx: any, userId: string) => {
    if (userId === user.id && ++admitted <= 3) { if (admitted === 3) reached(); await held; }
    return original(tx, userId);
  });
  const writes = [
    client.request('/notification-settings', 'PUT', { settings: preferences.body.settings, expectedUpdatedAt: preferences.body.updatedAt }),
    client.request('/push/subscribe', 'POST', { subscription: subscription('queued') }),
    client.request('/users/me/profile-links', 'POST', { title: 'Queued fixture', url: 'https://example.invalid/queued' })
  ];
  try {
    await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Requests did not reach transaction lock')), 5000))]);
    assert.equal((await client.request('/account', 'DELETE')).status, 200);
    resume();
    const results = await Promise.all(writes);
    assert.deepEqual(results.map(result => result.status), [401, 401, 401]);
    assert.equal(await prisma.notificationSettings.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.pushSubscription.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.profileLink.count({ where: { userId: user.id } }), 0);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status, 'DELETED');
  } finally { resume(); await Promise.allSettled(writes); lock.mock.restore(); }
});

test('lifecycle rechecks recent-auth proof after waiting for its account lock', async () => {
  for (const action of ['deactivate', 'delete']) {
    const { user, client } = await fixture(`expiry_${action}`);
    const security = require('../services/mfaService') as typeof import('../services/mfaService');
    const original = security.lockAccountSecurity;
    let resume!: () => void, reached!: () => void;
    const held = new Promise<void>(resolve => { resume = resolve; });
    const ready = new Promise<void>(resolve => { reached = resolve; });
    const lock = mock.method(security, 'lockAccountSecurity', async (tx: any, userId: string) => {
      if (userId === user.id) { reached(); await held; }
      return original(tx, userId);
    });
    const request = action === 'delete' ? client.request('/account', 'DELETE') : client.request('/account/deactivate', 'POST');
    try {
      await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Lifecycle did not reach lock')), 5000))]);
      await prisma.authSession.updateMany({ where: { userId: user.id }, data: { recentAuthenticatedAt: new Date(Date.now() - 700_000) } });
      resume();
      const result = await request;
      assert.equal(result.status, 401); assert.equal(result.body.code, 'REAUTHENTICATION_REQUIRED');
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status, 'ACTIVE');
      assert.equal(await prisma.accountCleanupJob.count({ where: { userId: user.id } }), 0);
    } finally { resume(); await request; lock.mock.restore(); }
  }
});

test('blocking hides both profiles, owner-scopes the list and unblocking never restores follows or private access', async () => {
  const owner = await fixture('block_owner'), target = await fixture('block_target'), stranger = await fixture('block_stranger');
  await prisma.user.update({ where: { id: target.user.id }, data: { isPrivate: true, bio: 'Synthetic private biography', followersCount: 1, followingCount: 1 } });
  await prisma.user.update({ where: { id: owner.user.id }, data: { followersCount: 1, followingCount: 1 } });
  await prisma.follow.createMany({ data: [
    { followerId: owner.user.id, followingId: target.user.id, status: 'ACTIVE' },
    { followerId: target.user.id, followingId: owner.user.id, status: 'ACTIVE' }
  ] });
  assert.equal((await owner.client.request(`/users/${target.user.id}`)).body.bio, 'Synthetic private biography');
  const block = await owner.client.request('/users/me/blocks', 'POST', { blockedId: target.user.id });
  assert.equal(block.status, 200);
  for (const [client, id] of [[owner.client, target.user.id], [target.client, owner.user.id]] as const) assert.equal((await client.request(`/users/${id}`)).status, 404);
  const list = await owner.client.request('/users/me/blocks');
  assert.deepEqual(list.body.items.map((row: any) => row.id), [target.user.id]);
  for (const key of ['email', 'birthday', 'demographics', 'avatarMedia', 'passwordHash']) assert.equal(key in list.body.items[0], false);
  assert.deepEqual((await stranger.client.request('/users/me/blocks')).body.items, []);
  await stranger.client.request(`/users/me/blocks/${target.user.id}`, 'DELETE', { blockerId: owner.user.id });
  assert.equal(await prisma.userBlock.count({ where: { blockerId: owner.user.id, blockedId: target.user.id } }), 1);
  assert.equal((await owner.client.request(`/users/me/blocks/${target.user.id}`, 'DELETE')).status, 200);
  assert.equal(await prisma.follow.count({ where: { OR: [{ followerId: owner.user.id, followingId: target.user.id }, { followerId: target.user.id, followingId: owner.user.id }] } }), 0);
  const publicAfter = await owner.client.request(`/users/${target.user.id}`);
  assert.equal(publicAfter.status, 200); assert.equal(publicAfter.body.bio, '');
  for (const id of [owner.user.id, target.user.id]) {
    const row = await prisma.user.findUniqueOrThrow({ where: { id } });
    assert.equal(row.followersCount, 0); assert.equal(row.followingCount, 0);
  }
});
