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

let ownerId: string;
async function fixture() {
  if (!ownerId) { ownerId = randomUUID(); await prisma.user.create({ data: { id: ownerId, name: 'Guest results fixture', handle: prefix, status: 'ACTIVE' } }); }
  const post = await prisma.post.create({ data: { title: 'Fixture', description: '', type: 'Quiz', authorId: ownerId, status: 'PUBLISHED', targetAudience: 'Public', allowAnonymous: true, resultsWho: 'Participants', resultsTiming: 'Immediately', expiresAt: new Date(Date.now() + 86400000), questions: { create: [1, 2].map(order => ({ text: 'Question ' + order, type: 'multiple_choice', order, options: { create: [{ text: 'A', order: 0, isCorrect: true }, { text: 'B', order: 1, isCorrect: false }] } })) } }, include: { questions: { include: { options: true }, orderBy: { order: 'asc' } } } });
  return post;
}
test('guest results require a real browser proof, bind to the post and deny forged or expired receipts', async () => {
  const post = await fixture(), other = await fixture(), browser = new Browser(), attacker = new Browser(), guestId = randomUUID();
  assert.equal((await browser.request('/posts/' + post.id + '/results?guestId=' + guestId)).status, 403);
  const vote = await browser.request('/posts/' + post.id + '/vote', 'POST', { guestId, optionId: post.questions[0].options[0].id });
  assert.equal(vote.status, 200, JSON.stringify(vote.body));
  const cookie = vote.headers.getSetCookie().find(value => value.startsWith('si_guest_participation='));
  assert.ok(cookie?.includes('HttpOnly')); assert.ok(cookie?.includes('SameSite=Lax')); assert.ok(cookie?.includes('Max-Age=2592000'));
  const stored = await prisma.response.findFirstOrThrow({ where: { postId: post.id, guestId } });
  assert.ok(stored.guestProofHash); assert.notEqual(stored.guestProofHash, browser.cookies.get('si_guest_participation')); assert.ok(stored.guestProofExpiresAt!.getTime() > Date.now());
  const results = await browser.request('/posts/' + post.id + '/results'); assert.equal(results.status, 200); assert.equal(results.body.version, 2);
  const ownDetail = await browser.request('/posts/' + post.id); assert.equal(ownDetail.status, 200); assert.equal(ownDetail.body.hasParticipated, true);
  assert.equal(JSON.stringify(ownDetail.body).includes(stored.guestProofHash!), false);
  assert.equal((await browser.request('/posts/' + other.id + '/results')).status, 403);
  attacker.cookies.set('si_guest_participation', randomBytes(32).toString('hex'));
  assert.equal((await attacker.request('/posts/' + post.id + '/results?guestId=' + guestId)).status, 403);
  const detail = await attacker.request('/posts/' + post.id + '?guestId=' + guestId); assert.equal(detail.status, 200); assert.equal(detail.body.hasParticipated, false);
  await prisma.response.update({ where: { id: stored.id }, data: { guestProofExpiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await browser.request('/posts/' + post.id + '/results')).status, 403);
  assert.equal((await browser.request('/posts/' + post.id + '/vote', 'POST', { guestId, optionId: post.questions[1].options[0].id })).status, 403);
});
test('progressive guest quiz answers retain one proof-bound response under concurrent submissions', async () => {
  const post = await fixture(), browser = new Browser(), guestId = randomUUID();
  assert.equal((await browser.request('/posts/' + post.id + '/vote', 'POST', { guestId, optionId: post.questions[0].options[0].id })).status, 200);
  const results = await Promise.all([0, 1].map(() => browser.request('/posts/' + post.id + '/vote', 'POST', { guestId, optionId: post.questions[1].options[0].id })));
  assert.deepEqual(results.map(value => value.status), [200, 200]);
  const rows = await prisma.response.findMany({ where: { postId: post.id }, include: { answers: true } });
  assert.equal(rows.length, 1); assert.equal(rows[0].answers.length, 2);
  assert.equal((await browser.request('/posts/' + post.id + '/results')).status, 200);
  const attacker = new Browser(); const denied = await attacker.request('/posts/' + post.id + '/vote', 'POST', { guestId, optionId: post.questions[1].options[1].id });
  assert.equal(denied.status, 403); assert.equal(denied.body.code, 'GUEST_PARTICIPATION_PROOF_REQUIRED');
});
test('a legacy unbound guest response is never upgraded by knowledge of its guest identifier', async () => {
  const post = await fixture(), guestId = randomUUID(), browser = new Browser();
  const response = await prisma.response.create({ data: { postId: post.id, guestId, isAnonymous: true } });
  const vote = await browser.request('/posts/' + post.id + '/vote', 'POST', { guestId, optionId: post.questions[0].options[0].id });
  assert.equal(vote.status, 403); assert.equal(vote.body.code, 'GUEST_PARTICIPATION_PROOF_REQUIRED');
  assert.equal((await prisma.response.findUniqueOrThrow({ where: { id: response.id } })).guestProofHash, null);
  assert.equal(vote.headers.getSetCookie().length, 0);
});
