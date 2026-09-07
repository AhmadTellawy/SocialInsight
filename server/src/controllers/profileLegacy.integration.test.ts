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

test('private legacy avatar is removable by its owner without exposing the URL or existence flag to visitors', async () => {
  const id = randomUUID(), password = 'FixturePass1!', legacyUrl = 'https://legacy-image.example.invalid/private-avatar.png';
  await prisma.user.create({ data: { id, name: 'Legacy avatar fixture', handle: 'legacy_' + id.slice(0, 8), email: id + '@example.invalid', passwordHash: await bcrypt.hash(password, 4), status: 'ACTIVE', isPrivate: true, avatar: legacyUrl, avatarMediaId: null } });
  const owner = new Browser(), visitor = new Browser();
  assert.equal((await owner.request('/auth/login', 'POST', { identifier: id + '@example.invalid', password })).status, 200);
  const me = await owner.request('/users/me');
  assert.equal(me.status, 200); assert.equal(me.body.hasLegacyAvatar, true); assert.equal(me.body.avatar, '');
  assert.equal(me.body.avatarMediaId, null); assert.equal(JSON.stringify(me.body).includes(legacyUrl), false);

  for (const browser of [visitor, owner]) {
    const profile = await browser.request('/users/' + id + '?viewAs=visitor');
    assert.equal(profile.status, 200); assert.equal('hasLegacyAvatar' in profile.body, false);
    assert.equal(profile.body.avatar, ''); assert.equal(JSON.stringify(profile.body).includes(legacyUrl), false);
  }
  const edited = await owner.request('/users/' + id, 'PUT', { name: 'Updated legacy avatar fixture', expectedUpdatedAt: me.body.updatedAt });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.hasLegacyAvatar, true); assert.equal(edited.body.avatar, '');
  const removed = await owner.request('/users/' + id, 'PUT', { avatarMediaId: null, expectedUpdatedAt: edited.body.updatedAt });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(removed.body.hasLegacyAvatar, false); assert.equal(removed.body.avatarMediaId, null);
  const stored = await prisma.user.findUniqueOrThrow({ where: { id }, select: { avatar: true, avatarMediaId: true } });
  assert.deepEqual(stored, { avatar: null, avatarMediaId: null });
  assert.equal((await owner.request('/users/me')).body.hasLegacyAvatar, false);
});
