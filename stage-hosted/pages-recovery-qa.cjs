// Isolated migration/feature-off recovery rehearsal on synthetic PostgreSQL only.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const serverRequire = createRequire(path.resolve(__dirname, '../server/package.json'));
const prisma = new (serverRequire('@prisma/client').PrismaClient)();
const jwt = serverRequire('jsonwebtoken');
const api = 'http://127.0.0.1:3001/api';
let child;
const reportPath = path.resolve(__dirname, '../recovery-receipt.json');

async function request(pathname, method = 'GET', token, body) {
  const response = await fetch(api + pathname, { method, signal: AbortSignal.timeout(15000),
    headers: { ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
async function start(enabled) {
  assert.equal(child, undefined);
  child = spawn(process.execPath, [path.resolve(__dirname, '../server/dist/app.js')], {
    cwd: path.resolve(__dirname, '../server'), stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, PAGES_ENABLED: String(enabled), DISABLE_BACKGROUND_JOBS: 'true', PORT: '3001' },
  });
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error('API_EXITED');
    try { if ((await request('/health')).status === 200) return; } catch { /* wait for bind */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('API_NOT_HEALTHY');
}
async function stop() {
  if (!child) return;
  const owned = child; child = undefined;
  if (owned.exitCode === null) {
    owned.kill();
    await new Promise(resolve => owned.once('exit', resolve));
  }
}
async function main() {
  const user = await prisma.user.create({ data: { name: 'Recovery QA', handle: 'qa_recovery_' + crypto.randomBytes(4).toString('hex'),
    email: 'qa_recovery_' + crypto.randomBytes(4).toString('hex') + '@example.test',
    status: 'ACTIVE', emailVerifiedAt: new Date() } });
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '10m' });
  await start(true);
  const page = await request('/pages', 'POST', token, { requestId: crypto.randomUUID(), name: 'Recovery QA Page',
    handle: 'qa_recovery_page_' + crypto.randomBytes(4).toString('hex'), category: 'company',
    bio: 'Synthetic migration recovery fixture', representationConfirmed: true });
  assert.equal(page.status, 201);
  assert.equal((await request('/pages/manage/' + page.body.id + '/lifecycle', 'POST', token, { action: 'publish' })).status, 200);
  const post = await request('/posts', 'POST', token, { pageId: page.body.id, pageCreateKey: crypto.randomUUID(),
    title: 'Synthetic recovery poll', description: 'Safe feature fallback', type: 'Poll', category: 'General',
    status: 'PUBLISHED', targetAudience: 'Public', expiresAt: new Date(Date.now() + 86400000).toISOString(),
    options: [{ id: crypto.randomUUID(), text: 'Yes' }, { id: crypto.randomUUID(), text: 'No' }] });
  assert.equal(post.status, 200);
  const baseline = { pages: await prisma.page.count(), posts: await prisma.post.count(),
    media: await prisma.mediaAsset.count(), migrations: await prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL` };
  assert.equal((await request('/pages/' + page.body.handle)).status, 200);
  assert.equal((await request('/posts/' + post.body.id)).status, 200);
  await stop();

  // Safe operational fallback: keep a Page-aware build and migrated schema,
  // disable the feature instead of rolling back to a personal-only build.
  await start(false);
  assert.equal((await request('/health')).status, 200);
  assert.notEqual((await request('/pages/' + page.body.handle)).status, 200);
  await stop();
  assert.deepEqual({ pages: await prisma.page.count(), posts: await prisma.post.count(),
    media: await prisma.mediaAsset.count(), migrations: await prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL` }, baseline);

  await start(true);
  assert.equal((await request('/health')).status, 200);
  assert.equal((await request('/pages/' + page.body.handle)).status, 200);
  assert.equal((await request('/posts/' + post.body.id)).status, 200);
  assert.deepEqual({ pages: await prisma.page.count(), posts: await prisma.post.count(),
    media: await prisma.mediaAsset.count(), migrations: await prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL` }, baseline);
  const receipt = { result: 'PASS', sourceCommit: process.env.RELEASE_COMMIT,
    migratedDatabaseWithPageRows: true, featureOffHealth: 200, pageHiddenWhileOff: true,
    dataUnchanged: true, featureRestored: true, rollbackMode: 'feature-off-and-forward-fix' };
  fs.writeFileSync(reportPath, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
}
main().catch(error => { fs.writeFileSync(reportPath, JSON.stringify({ result: 'FAIL',
  sourceCommit: process.env.RELEASE_COMMIT, error: error.name, message: error.message }, null, 2));
  console.error(error.name, error.message); process.exitCode = 1; })
  .finally(async () => { await stop(); await prisma.$disconnect(); });
