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

test('owner can observe and cancel a pending public privacy transition without stale publication', async t => {
  const attachedPrivateAvatar = async (retainedPublicKeys: boolean) => {
    const value = await fixture(), asset = await uploadFixture(value);
    assert.equal((await value.browser.request('/media/' + asset.id + '/finalize', 'POST', {})).status, 200);
    if (retainedPublicKeys) { await media.promoteMediaAsset(asset.id); await media.restrictMediaAsset(asset.id); }
    await prisma.$transaction([
      prisma.mediaAsset.update({ where: { id: asset.id }, data: { status: 'ATTACHED', accessScope: 'RESTRICTED' } }),
      prisma.user.update({ where: { id: value.id }, data: { isPrivate: true, avatarMediaId: asset.id } })
    ]);
    return { ...value, asset };
  };
  await t.test('failed publication remains owner-visible and can be cancelled', async () => {
    const value = await attachedPrivateAvatar(true), before = await value.browser.request('/users/me');
    const changed = await value.browser.request('/users/' + value.id, 'PUT', { isPrivate: false, expectedUpdatedAt: before.body.updatedAt });
    assert.equal(changed.status, 409, JSON.stringify(changed.body)); assert.equal(changed.body.code, 'MEDIA_BUSY');
    const pending = await value.browser.request('/users/me');
    assert.equal(pending.body.isPrivate, true); assert.equal(pending.body.mediaPrivacyTarget, false);
    const visitor = await new Browser().request('/users/' + value.id + '?viewAs=visitor');
    assert.equal(visitor.status, 200); assert.equal('mediaPrivacyTarget' in visitor.body, false);
    const old = await prisma.mediaPrivacyTransition.findFirstOrThrow({ where: { userId: value.id, targetIsPrivate: false } });
    assert.equal(old.status, 'FAILED');
    const cancelled = await value.browser.request('/users/' + value.id, 'PUT', { isPrivate: true, expectedUpdatedAt: pending.body.updatedAt });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    assert.equal(cancelled.body.isPrivate, true); assert.equal(cancelled.body.mediaPrivacyTarget, null);
    await transitions.processMediaPrivacyTransition(old.id);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: value.id } });
    assert.equal(stored.isPrivate, true); assert.equal(stored.mediaPrivacyTarget, null);
    assert.equal((await prisma.mediaPrivacyTransition.findUniqueOrThrow({ where: { id: old.id } })).failureReason, 'SUPERSEDED');
    assert.equal((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: value.asset.id } })).accessScope, 'RESTRICTED');
  });
  await t.test('an already running public worker cannot overwrite a later private cancellation', async () => {
    const value = await attachedPrivateAvatar(false), before = await value.browser.request('/users/me'), gate = pause();
    const follower = await fixture();
    const follow = await prisma.follow.create({ data: { followerId: follower.id, followingId: value.id, status: 'PENDING' } });
    const original = media.promoteMediaAsset;
    const mocked = mock.method(media, 'promoteMediaAsset', async (...args: Parameters<typeof original>) => { await original(...args); await gate.hook(); });
    const publishing = value.browser.request('/users/' + value.id, 'PUT', { isPrivate: false, expectedUpdatedAt: before.body.updatedAt });
    try {
      await gate.ready;
      const pending = await value.browser.request('/users/me');
      assert.equal(pending.body.mediaPrivacyTarget, false);
      const cancelled = await value.browser.request('/users/' + value.id, 'PUT', { isPrivate: true, expectedUpdatedAt: pending.body.updatedAt });
      assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
      assert.equal(cancelled.body.isPrivate, true); assert.equal(cancelled.body.mediaPrivacyTarget, null);
    } finally { gate.release(); }
    try { await publishing; } finally { mocked.mock.restore(); }
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: value.id } });
    assert.equal(stored.isPrivate, true); assert.equal(stored.mediaPrivacyTarget, null);
    assert.equal((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: value.asset.id } })).accessScope, 'RESTRICTED');
    const old = await prisma.mediaPrivacyTransition.findFirstOrThrow({ where: { userId: value.id, targetIsPrivate: false } });
    assert.equal(old.status, 'COMPLETE'); assert.equal(old.failureReason, 'SUPERSEDED');
    assert.equal((await prisma.follow.findUniqueOrThrow({ where: { id: follow.id } })).status, 'PENDING');
    assert.equal(stored.followersCount, 0);
  });
  await t.test('a settled public expansion still accepts pending follows', async () => {
    const value = await attachedPrivateAvatar(false), follower = await fixture();
    const follow = await prisma.follow.create({ data: { followerId: follower.id, followingId: value.id, status: 'PENDING' } });
    const before = await value.browser.request('/users/me');
    const changed = await value.browser.request('/users/' + value.id, 'PUT', { isPrivate: false, expectedUpdatedAt: before.body.updatedAt });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal(changed.body.isPrivate, false); assert.equal(changed.body.mediaPrivacyTarget, null);
    assert.equal((await prisma.follow.findUniqueOrThrow({ where: { id: follow.id } })).status, 'ACTIVE');
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: value.id } })).followersCount, 1);
  });
  await t.test('retrying a private transition removes public keys even after its scope was already restricted', async () => {
    const value = await attachedPrivateAvatar(false);
    await prisma.user.update({ where: { id: value.id }, data: { isPrivate: false } });
    await media.promoteMediaAsset(value.asset.id);
    const before = await value.browser.request('/users/me');
    failRemove = true;
    try {
      const changed = await value.browser.request('/users/' + value.id, 'PUT', { isPrivate: true, expectedUpdatedAt: before.body.updatedAt });
      assert.ok(changed.status >= 500);
    } finally { failRemove = false; }
    const job = await prisma.mediaPrivacyTransition.findFirstOrThrow({ where: { userId: value.id, targetIsPrivate: true } });
    assert.equal(job.status, 'FAILED');
    assert.equal((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: value.asset.id } })).accessScope, 'RESTRICTED');
    await transitions.processMediaPrivacyTransition(job.id);
    const current = await value.browser.request('/users/me');
    assert.equal(current.body.isPrivate, true); assert.equal(current.body.mediaPrivacyTarget, null);
    for (const variant of await prisma.mediaVariant.findMany({ where: { mediaAssetId: value.asset.id, isPublic: true } })) {
      assert.equal(objects.has(variant.storageBucket + ':' + variant.storageKey), false);
    }
  });
});
after(async () => {
  await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  await prisma.$disconnect(); mock.restoreAll();
});

const storageModule = require('../services/mediaStorage') as typeof import('../services/mediaStorage');
const media = require('../services/mediaService') as typeof import('../services/mediaService');
const objects = new Map<string, Buffer>();
let onDownload: (() => Promise<void>) | undefined, onUpload: (() => Promise<void>) | undefined, onSign: (() => Promise<void>) | undefined, onRemove: (() => Promise<void>) | undefined, failRemove = false;
const storage: import('../services/mediaStorage').MediaStorage = {
  createSignedUpload: async (_bucket, key) => { if (onSign) await onSign(); return { path: key, token: 'fixture-token', signedUrl: 'https://storage.example.invalid/' + key }; },
  download: async (bucket, key) => { const bytes = objects.get(bucket + ':' + key); if (onDownload) await onDownload(); if (!bytes) throw new Error('Fixture source missing'); return bytes; },
  upload: async (bucket, key, bytes) => { if (onUpload) await onUpload(); objects.set(bucket + ':' + key, bytes); },
  remove: async (bucket, keys) => { if (onRemove) await onRemove(); if (failRemove) throw new Error('Synthetic retryable storage outage'); keys.forEach(key => objects.delete(bucket + ':' + key)); },
  createSignedReadUrl: async (_bucket, key) => 'https://storage.example.invalid/' + key,
  getPublicUrl: (_bucket, key) => 'https://storage.example.invalid/' + key,
  copy: async () => { throw new Error('Unexpected copy'); }, provisionBuckets: async () => {}
};
before(() => { storageModule.setMediaStorageForTests(storage); });
after(() => { storageModule.setMediaStorageForTests(); });
const pause = () => {
  let release!: () => void, reached!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Expected suspended media operation was not reached')), 10_000);
    timer.unref(); reached = () => { clearTimeout(timer); resolve(); };
  });
  return { release, ready, hook: async () => { reached(); await wait; } };
};
async function fixture() {
  onDownload = onUpload = onSign = onRemove = undefined; failRemove = false;
  const id = randomUUID(), password = 'FixturePass1!';
  await prisma.user.create({ data: { id, name: 'Media lifecycle fixture', handle: 'media_' + id.slice(0, 8), email: id + '@example.invalid', passwordHash: await bcrypt.hash(password, 4), status: 'ACTIVE' } });
  const browser = new Browser(); assert.equal((await browser.request('/auth/login', 'POST', { identifier: id + '@example.invalid', password })).status, 200);
  const source = await require('sharp')({ create: { width: 256, height: 256, channels: 3, background: '#456789' } }).png().toBuffer() as Buffer;
  return { id, browser, source };
}
async function uploadFixture(value: Awaited<ReturnType<typeof fixture>>, purpose: 'PROFILE_AVATAR' | 'GROUP_IMAGE' = 'PROFILE_AVATAR') {
  const start = await value.browser.request('/media/uploads', 'POST', { purpose, mime: 'image/png', size: value.source.length, altText: 'Private original caption' });
  assert.equal(start.status, 201, JSON.stringify(start.body));
  const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: start.body.assetId } });
  objects.set(asset.uploadBucket! + ':' + asset.uploadKey!, value.source);
  return asset;
}
async function expireAndPurge(assetId: string) {
  await prisma.mediaAsset.update({ where: { id: assetId }, data: { storageCleanupNotBefore: new Date(Date.now() - 1000) } });
  await media.purgeMediaAsset(assetId);
  const result = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
  assert.equal(result.status, 'DELETED'); assert.equal(result.altText, null); assert.equal(result.checksum, null);
  assert.equal(await prisma.mediaVariant.count({ where: { mediaAssetId: assetId } }), 0);
  assert.equal([...objects.keys()].some(key => key.includes(assetId)), false);
}
async function deleteFixtureAccount(browser: Browser) {
  // Serializable lifecycle writes can conflict with other concurrent account
  // activity. Retry only the explicit recoverable conflict while I/O stays paused.
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await browser.request('/account', 'DELETE');
    if (result.status === 409 && result.body?.code === 'ACCOUNT_CONFLICT' && attempt < 2) continue;
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return;
  }
}

test('finding-resolution:SI-AS-E04-008', async t => {
  await t.test('normal authorized upload finalizes and retains the source capability cleanup key', async () => {
    const value = await fixture(), asset = await uploadFixture(value);
    const result = await value.browser.request('/media/' + asset.id + '/finalize', 'POST', {});
    assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.status, 'READY');
    const stored = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    assert.ok(stored.uploadKey); assert.ok(stored.storageCleanupNotBefore!.getTime() > Date.now());
    assert.ok(await prisma.mediaVariant.count({ where: { mediaAssetId: asset.id } }));
  });
  await t.test('private active accounts can publish group identity images while deletion still fences promotion', async () => {
    const value = await fixture();
    await prisma.user.update({ where: { id: value.id }, data: { isPrivate: true, mediaPrivacyTarget: true } });
    const asset = await uploadFixture(value, 'GROUP_IMAGE');
    const finalized = await value.browser.request('/media/' + asset.id + '/finalize', 'POST', {});
    assert.equal(finalized.status, 200, JSON.stringify(finalized.body));
    await media.promoteMediaAsset(asset.id);
    assert.equal((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).accessScope, 'PUBLIC');
    assert.ok((await prisma.mediaVariant.findMany({ where: { mediaAssetId: asset.id, isPublic: true } })).length);
    await deleteFixtureAccount(value.browser);
    await assert.rejects(() => media.promoteMediaAsset(asset.id), (error: any) => error?.code === 'AUTH_REQUIRED');
    assert.equal((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).status, 'PENDING_DELETE');
    await expireAndPurge(asset.id);
  });
  await t.test('finalize paused before processing cannot restore metadata after deletion and purge', async () => {
    const value = await fixture(), asset = await uploadFixture(value), gate = pause(); onDownload = gate.hook;
    const result = value.browser.request('/media/' + asset.id + '/finalize', 'POST', { altText: 'Private edited caption' });
    try { await gate.ready; await deleteFixtureAccount(value.browser); await media.purgeMediaAsset(asset.id); }
    finally { onDownload = undefined; gate.release(); }
    assert.equal((await result).status, 401);
    const pending = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    assert.equal(pending.status, 'PENDING_DELETE'); assert.equal(pending.altText, null); assert.equal(pending.checksum, null);
    assert.equal(await prisma.mediaVariant.count({ where: { mediaAssetId: asset.id } }), 0);
    await expireAndPurge(asset.id);
  });
  await t.test('late uploaded variants remain recorded when compensation fails and are removed by retry', async () => {
    const value = await fixture(), asset = await uploadFixture(value), gate = pause(); onUpload = gate.hook;
    const result = value.browser.request('/media/' + asset.id + '/finalize', 'POST', {});
    try {
      await gate.ready; assert.ok(await prisma.mediaVariant.count({ where: { mediaAssetId: asset.id } }));
      await deleteFixtureAccount(value.browser); await media.purgeMediaAsset(asset.id); failRemove = true;
    } finally { onUpload = undefined; gate.release(); }
    assert.equal((await result).status, 401);
    assert.equal((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).status, 'PENDING_DELETE');
    assert.ok(await prisma.mediaVariant.count({ where: { mediaAssetId: asset.id } }));
    failRemove = false; await expireAndPurge(asset.id);
  });
  await t.test('queued creation after deletion creates neither asset nor signed capability', async () => {
    const value = await fixture(), gate = pause(), security = require('../services/mfaService') as typeof import('../services/mfaService');
    const original = security.lockAccountSecurity; let intercepted = false;
    const mocked = mock.method(security, 'lockAccountSecurity', async (tx: any, id: string) => { if (id === value.id && !intercepted) { intercepted = true; await gate.hook(); } await original(tx, id); });
    const result = value.browser.request('/media/uploads', 'POST', { purpose: 'POST', mime: 'image/png', size: value.source.length });
    try { await gate.ready; await deleteFixtureAccount(value.browser); }
    finally { gate.release(); }
    try { assert.equal((await result).status, 401); assert.equal(await prisma.mediaAsset.count({ where: { ownerId: value.id } }), 0); }
    finally { mocked.mock.restore(); }
  });
  await t.test('signing paused across deletion retains its exact source key for late writes', async () => {
    const value = await fixture(), gate = pause(); onSign = gate.hook;
    const result = value.browser.request('/media/uploads', 'POST', { purpose: 'POST', mime: 'image/png', size: value.source.length });
    await gate.ready;
    const asset = await prisma.mediaAsset.findFirstOrThrow({ where: { ownerId: value.id } });
    try { await deleteFixtureAccount(value.browser); await media.purgeMediaAsset(asset.id); }
    finally { onSign = undefined; gate.release(); }
    assert.equal((await result).status, 401);
    objects.set(asset.uploadBucket! + ':' + asset.uploadKey!, value.source);
    await media.purgeMediaAsset(asset.id);
    assert.equal(objects.has(asset.uploadBucket! + ':' + asset.uploadKey!), false);
    assert.equal((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).status, 'PENDING_DELETE');
    await expireAndPurge(asset.id);
  });
  await t.test('public promotion paused during upload cannot recreate a public object after deletion', async () => {
    const value = await fixture(), asset = await uploadFixture(value);
    assert.equal((await value.browser.request('/media/' + asset.id + '/finalize', 'POST', {})).status, 200);
    const gate = pause(); onUpload = gate.hook;
    const promoted = media.promoteMediaAsset(asset.id).then(() => null, error => error);
    try { await gate.ready; await deleteFixtureAccount(value.browser); await media.purgeMediaAsset(asset.id); failRemove = true; }
    finally { onUpload = undefined; gate.release(); }
    assert.ok(await promoted);
    const pending = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    assert.equal(pending.status, 'PENDING_DELETE'); assert.notEqual(pending.accessScope, 'PUBLIC');
    failRemove = false; await expireAndPurge(asset.id);
  });
  await t.test('revoked sessions cannot commit a finalize operation already admitted by middleware', async () => {
    const value = await fixture(), asset = await uploadFixture(value), gate = pause(); onDownload = gate.hook;
    const result = value.browser.request('/media/' + asset.id + '/finalize', 'POST', { altText: 'Unapproved caption' });
    try { await gate.ready; await prisma.authSession.updateMany({ where: { userId: value.id }, data: { revokedAt: new Date() } }); }
    finally { onDownload = undefined; gate.release(); }
    assert.equal((await result).status, 401);
    const stored = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    assert.notEqual(stored.status, 'READY'); assert.notEqual(stored.altText, 'Unapproved caption');
  });
  await t.test('privacy restriction invalidates an in-flight public promotion', async () => {
    const value = await fixture(), asset = await uploadFixture(value);
    assert.equal((await value.browser.request('/media/' + asset.id + '/finalize', 'POST', {})).status, 200);
    const gate = pause(); onUpload = gate.hook;
    const promoted = media.promoteMediaAsset(asset.id).then(() => null, error => error);
    try {
      await gate.ready;
      await prisma.user.update({ where: { id: value.id }, data: { isPrivate: true, mediaPrivacyTarget: true } });
      await media.restrictMediaAsset(asset.id);
    } finally { onUpload = undefined; gate.release(); }
    assert.ok(await promoted);
    assert.equal((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).accessScope, 'RESTRICTED');
    const publicVariants = await prisma.mediaVariant.findMany({ where: { mediaAssetId: asset.id, isPublic: true } });
    for (const variant of publicVariants) assert.equal(objects.has(variant.storageBucket + ':' + variant.storageKey), false);
  });
  await t.test('restriction finishing after deletion cannot change a deleted asset', async () => {
    const value = await fixture(), asset = await uploadFixture(value);
    assert.equal((await value.browser.request('/media/' + asset.id + '/finalize', 'POST', {})).status, 200);
    await media.promoteMediaAsset(asset.id);
    const gate = pause(); let first = true;
    onRemove = async () => { if (first) { first = false; await gate.hook(); } };
    const restricted = media.restrictMediaAsset(asset.id);
    try { await gate.ready; await deleteFixtureAccount(value.browser); await media.purgeMediaAsset(asset.id); }
    finally { onRemove = undefined; gate.release(); }
    await restricted;
    assert.equal((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).status, 'PENDING_DELETE');
    await expireAndPurge(asset.id);
  });
});


