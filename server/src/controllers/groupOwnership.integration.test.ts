import assert from 'node:assert/strict';
import test, { before, after, mock } from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
for (const key of ['DATABASE_URL', 'DIRECT_URL']) { const url = new URL(process.env[key] || 'http://invalid'); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55447'); assert.equal(url.pathname, '/settings_test'); }
process.env.NODE_ENV = 'test'; process.env.AUTH_ALLOWED_ORIGINS = 'http://localhost:3000'; process.env.AUTH_SESSION_HASH_SECRET = 'guest-group-isolated-fixture-key'; process.env.AUTH_COOKIE_SECURE = 'false'; process.env.AUTH_LEGACY_BEARER_COMPAT = 'false';
const prisma = require('../prisma').default as typeof import('../prisma').default;
const cron = require('../services/cronService'); mock.method(cron, 'initCronJobs', () => {});
const sockets = require('../services/socketService'); mock.method(sockets, 'initSocket', () => undefined);
const transitions = require('../services/mediaPrivacyTransitionService'); mock.method(transitions, 'resumeMediaPrivacyTransitions', async () => 0);
const app = require('../app').default;
const prefix = 'privacy_' + randomUUID().replace(/-/g, '').slice(0, 9);
let server: Server, base: string;
class Browser {
  cookies = new Map<string, string>(); csrf = '';
  async request(path: string, method = 'GET', body?: unknown) {
    const headers: Record<string, string> = { Origin: 'http://localhost:3000', Cookie: [...this.cookies].map(([key, value]) => key + '=' + value).join('; ') };
    if (this.csrf) headers['X-CSRF-Token'] = this.csrf;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + '/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(';')[0], index = pair.indexOf('='); const key = pair.slice(0, index), value = pair.slice(index + 1); if (value) this.cookies.set(key, value); else this.cookies.delete(key); }
    const payload = await response.json().catch(() => null); if (payload?.csrfToken) this.csrf = payload.csrfToken;
    return { status: response.status, body: payload, headers: response.headers };
  }
}
before(async () => { server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); }); base = 'http://127.0.0.1:' + (server.address() as any).port; });
after(async () => { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); await prisma.$disconnect(); mock.restoreAll(); });

const bcrypt = require('bcryptjs');
async function groupFixture() {
  const ids = [randomUUID(), randomUUID(), randomUUID()]; const password = 'FixturePass1!'; const hash = await bcrypt.hash(password, 4);
  await prisma.user.createMany({ data: ids.map((id, index) => ({ id, name: 'Group owner fixture', handle: prefix + '_' + id.slice(0, 8), email: id + '@example.invalid', passwordHash: hash, status: 'ACTIVE' })) });
  const group = await prisma.group.create({ data: { name: 'Ownership fixture', description: '', category: 'General', memberCount: 3, members: { create: ids.map((userId, index) => ({ userId, role: index < 2 ? 'Owner' : 'Member', status: 'JOINED' })) } } });
  const browsers = await Promise.all(ids.slice(0, 2).map(async id => { const browser = new Browser(); const login = await browser.request('/auth/login', 'POST', { identifier: id + '@example.invalid', password }); assert.equal(login.status, 200); return browser; }));
  return { ids, group, browsers };
}
const activeOwners = (groupId: string) => prisma.groupMember.count({ where: { groupId, status: 'JOINED', role: 'Owner', user: { status: 'ACTIVE' }, group: { isDeleted: false } } });
test('after one owner deactivates the remaining owner cannot leave or demote itself', async () => {
  const { ids, group, browsers } = await groupFixture();
  const deactivation = await browsers[0].request('/account/deactivate', 'POST', {}); assert.equal(deactivation.status, 200, JSON.stringify(deactivation.body));
  const leave = await browsers[1].request('/groups/' + group.id + '/leave', 'POST', {}); assert.equal(leave.status, 409); assert.equal(leave.body.code, 'GROUP_OWNERSHIP_REQUIRED');
  const demote = await browsers[1].request('/groups/' + group.id + '/members/' + ids[1] + '/role', 'PUT', { role: 'Member' }); assert.equal(demote.status, 409); assert.equal(await activeOwners(group.id), 1);
});
test('simultaneous active-owner departures serialize and preserve one operable owner', async () => {
  const { group, browsers } = await groupFixture();
  const results = await Promise.all(browsers.map(browser => browser.request('/groups/' + group.id + '/leave', 'POST', {})));
  assert.deepEqual(results.map(value => value.status).sort(), [200, 409]); assert.equal(await activeOwners(group.id), 1);
});
test('deactivation racing the other owner leaving cannot orphan a populated group', async () => {
  const { group, browsers } = await groupFixture();
  const results = await Promise.all([browsers[0].request('/account/deactivate', 'POST', {}), browsers[1].request('/groups/' + group.id + '/leave', 'POST', {})]);
  assert.equal(results.filter(value => value.status === 200).length, 1, JSON.stringify(results.map(value => ({ status: value.status, body: value.body }))));
  assert.ok(results.some(value => value.status === 409)); assert.equal(await activeOwners(group.id), 1);
});
test('simultaneous self-demotions and kick versus promotion cannot remove the final active owner', async () => {
  const { ids, group, browsers } = await groupFixture();
  const changes = await Promise.all(browsers.map((browser, index) => browser.request('/groups/' + group.id + '/members/' + ids[index] + '/role', 'PUT', { role: 'Member' })));
  assert.deepEqual(changes.map(value => value.status).sort(), [200, 409]); assert.equal(await activeOwners(group.id), 1);
  const ownerIndex = changes[0].status === 409 ? 0 : 1;
  const promoteAndKick = await Promise.all([browsers[ownerIndex].request('/groups/' + group.id + '/members/' + ids[2] + '/role', 'PUT', { role: 'Owner' }), browsers[ownerIndex].request('/groups/' + group.id + '/members/' + ids[2] + '/kick', 'POST', {})]);
  assert.equal(promoteAndKick.filter(value => value.status === 200).length, 1); assert.ok(await activeOwners(group.id) >= 1);
});
