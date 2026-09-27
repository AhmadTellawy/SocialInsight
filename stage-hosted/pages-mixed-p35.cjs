// Synthetic Pages P35. The API/PG target and generator run in separate processes
// on a hosted runner; this script never contacts production or Stage accounts.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');

const serverRequire = createRequire(path.resolve(__dirname, '../server/package.json'));
const prisma = new (serverRequire('@prisma/client').PrismaClient)();
const bcrypt = serverRequire('bcryptjs');
const api = process.env.P35_API_URL || 'http://127.0.0.1:3001';
const reportPath = process.env.P35_REPORT || path.resolve(__dirname, 'p35-receipt.json');
const targetPid = Number(process.env.P35_API_PID || 0);
const prefix = `qa_p35_${crypto.randomBytes(4).toString('hex')}`;
const clients = [];
const pages = [];
const records = [];
const resourceSamples = [];
const report = {
  kind: 'HOSTED_MIXED_P35', sourceCommit: process.env.GITHUB_SHA || null,
  target: 'isolated hosted runner API + PostgreSQL service', generator: 'separate Node process on same hosted runner',
  startedAt: new Date().toISOString(), levelResults: [], checks: [],
  acceptance: { users: 100, durationSeconds: 600, mix: { read: 80, interaction: 10, vote: 5, manage: 5 },
    readP95MsMax: 800, writeP95MsMax: 1200, fiveXxPercentPerMinuteMaxExclusive: 1, transportErrorsMax: 0 },
  runner: { cpus: os.availableParallelism(), totalMemoryBytes: os.totalmem(), freeMemoryAtStartBytes: os.freemem() },
};
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pct = (sorted, p) => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
const stats = rows => {
  const latencies = rows.map(row => row.ms).sort((a, b) => a - b);
  return { requests: rows.length, success: rows.filter(row => row.status >= 200 && row.status < 300).length,
    errors: rows.filter(row => row.status < 200 || row.status >= 300).length,
    p50Ms: pct(latencies, .5), p95Ms: pct(latencies, .95), p99Ms: pct(latencies, .99),
    timeouts: rows.filter(row => row.timeout).length, transportErrors: rows.filter(row => row.status === 0).length,
    apiErrors: rows.filter(row => row.status >= 400).length, fiveXx: rows.filter(row => row.status >= 500).length,
    databaseErrorsVisible: rows.filter(row => /DATABASE|PRISMA|P20\d\d|CONNECTION|POOL/i.test(row.code)).length,
    successRate: rows.length ? rows.filter(row => row.status >= 200 && row.status < 300).length / rows.length : 0,
    errorRate: rows.length ? rows.filter(row => row.status < 200 || row.status >= 300).length / rows.length : 0 };
};

async function call(client, url, method = 'GET', body, kind, started = 0) {
  const begun = performance.now();
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise(resolve => {
    let done = false;
    const finish = (status, raw = '', error = '') => {
      if (done) return;
      done = true;
      let value = {};
      try { value = JSON.parse(raw); } catch { value = { text: raw.slice(0, 120) }; }
      const result = { status, value, error };
      if (kind) records.push({ kind, atMs: Math.round(begun - started), ms: Math.round((performance.now() - begun) * 100) / 100,
        status, timeout: error === 'TIMEOUT', code: String(value.code || error || '') });
      resolve(result);
    };
    const req = http.request(api + '/api' + url, { method, agent: client.agent, localAddress: client.ip,
      headers: { ...(client.token ? { authorization: `Bearer ${client.token}` } : {}),
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}) } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => finish(res.statusCode, Buffer.concat(chunks).toString()));
    });
    req.setTimeout(15000, () => req.destroy(Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT' })));
    req.on('error', error => finish(0, '', error.code || error.name));
    req.end(payload);
  });
}

async function ok(client, url, method = 'GET', body, expected = 200) {
  const response = await call(client, url, method, body);
  assert.equal(response.status, expected, `${method} ${url}: ${response.status} ${JSON.stringify(response.value).slice(0, 180)}`);
  return response.value;
}

function postPayload(type, extra = {}) {
  const options = [{ id: crypto.randomUUID(), text: 'Alpha' }, { id: crypto.randomUUID(), text: 'Beta' }];
  return { title: `${prefix} ${type} opinion`, description: 'Synthetic measured load fixture', type,
    category: 'General', status: 'PUBLISHED', targetAudience: 'Public', expiresAt: new Date(Date.now() + 86400000).toISOString(),
    allowComments: true, allowAnonymous: true, forceAnonymous: false, resultsWho: 'Public', resultsTiming: 'AnyTime',
    ...(['Quiz', 'Survey'].includes(type) ? { sections: [{ title: 'Section', questions: [{ text: 'Select', type: 'multiple_choice', correctOptionId: options[0].id, options }] }] } : { options }), ...extra };
}

async function pool(items, concurrency, work) {
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length) { const index = next++; await work(items[index], index); }
  }));
}

async function fixtures() {
  const password = crypto.randomBytes(24).toString('hex');
  const passwordHash = bcrypt.hashSync(password, 8);
  await pool(Array.from({ length: 100 }, (_, index) => index), 4, async index => {
    const email = `${prefix}_${index}@load.example.test`;
    const user = await prisma.user.create({ data: { name: `${prefix} user ${index}`, handle: `${prefix}_${index}`,
      email, passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date(), isPrivate: false, mediaPrivacyTarget: false } });
    const client = { index, id: user.id, ip: `127.1.0.${index + 1}`, step: index,
      agent: new http.Agent({ keepAlive: true, maxSockets: 1, timeout: 15000 }) };
    client.token = (await ok(client, '/auth/login', 'POST', { identifier: email, password })).token;
    assert.ok(client.token);
    clients[index] = client;
  });
  for (let i = 0; i < 5; i++) {
    const client = clients[i];
    const page = await ok(client, '/pages', 'POST', { requestId: crypto.randomUUID(), name: `${prefix} Page ${i}`,
      handle: `${prefix}_${i}`, category: 'company', bio: 'Synthetic load Page', representationConfirmed: true }, 201);
    await ok(client, `/pages/manage/${page.id}/lifecycle`, 'POST', { action: 'publish' });
    page.posts = [];
    pages.push(page);
    for (const type of ['Poll', 'Challenge', 'Survey', 'Quiz']) {
      page.posts.push(await ok(client, '/posts', 'POST', postPayload(type, { pageId: page.id, pageCreateKey: crypto.randomUUID() })));
    }
  }
  await prisma.pageMembership.createMany({ data: clients.filter(client => client.index >= 5).map(client =>
    ({ pageId: pages[client.index % 5].id, userId: client.id, role: 'ADMIN' })) });
  await pool(clients, 4, async client => {
    client.managedPost = await ok(client, '/posts', 'POST', postPayload('Poll',
      { pageId: pages[client.index % 5].id, pageCreateKey: crypto.randomUUID() }));
  });
  for (const page of pages) page.votePosts = [page.posts.find(post => post.type === 'Poll'),
    ...clients.filter(client => client.index % 5 === pages.indexOf(page)).map(client => client.managedPost)];
  report.fixtures = { users: clients.length, pages: pages.length, posts: pages.reduce((n, page) => n + page.posts.length, 0) + clients.length };
  save();
}

async function oneOperation(client, started, measured) {
  const step = client.step++;
  const slot = step % 20;
  const page = pages[client.index % 5];
  const post = page.posts[step % page.posts.length];
  const kind = slot < 16 ? 'read' : slot < 18 ? 'interaction' : slot === 18 ? 'vote' : 'manage';
  const recorded = measured ? kind : undefined;
  if (kind === 'read') {
    const choice = Math.floor(step / 20) % 4;
    if (choice === 0) return call(client, `/pages/${page.handle}`, 'GET', undefined, recorded, started);
    if (choice === 1) return call(client, `/posts?pageId=${page.id}&limit=10`, 'GET', undefined, recorded, started);
    return call(client, `/posts/${post.id}`, 'GET', undefined, recorded, started);
  }
  if (kind === 'interaction') {
    if (step % 2 === 0) return call(client, `/posts/${post.id}/like`, 'POST', {}, recorded, started);
    return call(client, `/posts/${post.id}/comments`, 'POST', { text: `${prefix} comment ${client.index} ${step}` }, recorded, started);
  }
  if (kind === 'vote') {
    const poll = page.votePosts[Math.floor(step / 20) % page.votePosts.length];
    return call(client, `/posts/${poll.id}/vote`, 'POST', { optionId: poll.options[Math.floor(step / 20) % 2].id }, recorded, started);
  }
  return call(client, `/pages/manage/${page.id}`, 'PATCH', { bio: `${prefix} managed ${client.index} ${step}` }, recorded, started);
}

function targetResources() {
  if (!targetPid) return;
  try {
    const status = fs.readFileSync(`/proc/${targetPid}/status`, 'utf8');
    const rssKb = Number(status.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1] || 0);
    const stat = fs.readFileSync(`/proc/${targetPid}/stat`, 'utf8');
    const afterName = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    resourceSamples.push({ at: Date.now(), rssBytes: rssKb * 1024, cpuTicks: Number(afterName[11]) + Number(afterName[12]) });
  } catch { /* Target process may have exited; the HTTP result records that failure. */ }
}

async function level(users, warmupMs, sampleMs, full = false) {
  const start = performance.now();
  const sampleStart = start + warmupMs;
  const end = sampleStart + sampleMs;
  const first = records.length;
  const firstResource = resourceSamples.length;
  const timer = setInterval(targetResources, 1000);
  await Promise.all(clients.slice(0, users).map(async client => {
    await sleep(client.index * 10);
    while (performance.now() < end) {
      const measured = performance.now() >= sampleStart;
      await oneOperation(client, sampleStart, measured);
      if (performance.now() < end) await sleep(1500 + Math.floor(Math.random() * 1001));
    }
  }));
  clearInterval(timer);
  const rows = records.slice(first);
  const seconds = (performance.now() - sampleStart) / 1000;
  const resources = resourceSamples.slice(firstResource);
  const deltas = resources.slice(1).map((item, index) => ({
    cpuPercentOfCore: Math.round((item.cpuTicks - resources[index].cpuTicks) / ((item.at - resources[index].at) / 1000) * 100 / 100),
    rssBytes: item.rssBytes }));
  const result = { users, warmupSeconds: warmupMs / 1000, sampleSeconds: Math.round(seconds),
    ...stats(rows), throughputRps: Math.round(rows.length / seconds * 100) / 100,
    byKind: Object.fromEntries(['read', 'interaction', 'vote', 'manage'].map(kind => [kind, stats(rows.filter(row => row.kind === kind))])),
    write: stats(rows.filter(row => row.kind !== 'read')),
    targetCpuPercentOfCoreP95: pct(deltas.map(item => item.cpuPercentOfCore).sort((a, b) => a - b), .95),
    targetMemoryBytesPeak: resources.length ? Math.max(...resources.map(item => item.rssBytes)) : null };
  if (full) {
    result.minuteWindows = Array.from({ length: 10 }, (_, minute) => {
      const batch = rows.filter(row => row.atMs >= minute * 60000 && row.atMs < (minute + 1) * 60000);
      return { minute: minute + 1, ...stats(batch) };
    });
    result.mixPercent = Object.fromEntries(Object.entries(result.byKind).map(([kind, value]) =>
      [kind, rows.length ? Math.round(value.requests / rows.length * 10000) / 100 : 0]));
    report.p35 = result;
  }
  report.levelResults.push(result);
  save();
  console.log(`P35_LEVEL ${JSON.stringify(result)}`);
}

async function integrity() {
  const ids = [...pages.flatMap(page => page.posts.map(post => post.id)), ...clients.map(client => client.managedPost.id)];
  const posts = await prisma.post.findMany({ where: { id: { in: ids } },
    select: { responseCount: true, likesCount: true, commentsCount: true,
      _count: { select: { responses: true, likes: true, comments: true } } } });
  const optionRows = await prisma.option.findMany({ where: { question: { postId: { in: ids } } },
    select: { votes: true, _count: { select: { answers: true } } } });
  const responses = await prisma.response.findMany({ where: { postId: { in: ids } }, select: { postId: true, userId: true } });
  const keys = responses.map(row => `${row.postId}:${row.userId}`);
  report.integrity = { postsChecked: posts.length,
    counterMismatches: posts.filter(row => row.responseCount !== row._count.responses || row.likesCount !== row._count.likes || row.commentsCount !== row._count.comments).length,
    optionMismatches: optionRows.filter(row => row.votes !== row._count.answers).length,
    duplicateResponses: keys.length - new Set(keys).size };
}

async function postLoadSecuritySmokes() {
  const source = await ok(clients[0], '/posts', 'POST', postPayload('Poll',
    { pageId: pages[0].id, pageCreateKey: crypto.randomUUID() }));
  const foreignShare = await ok(clients[1], `/posts/${source.id}/share`, 'POST',
    { pageId: pages[1].id, pageCreateKey: crypto.randomUUID() });
  assert.ok(foreignShare.id);
  await ok(clients[0], `/posts/${source.id}`, 'DELETE');
  const sourceAfter = await prisma.post.findUnique({ where: { id: source.id }, select: { isDeleted: true, title: true } });
  const shareAfter = await prisma.post.findUnique({ where: { id: foreignShare.id },
    select: { pageId: true, sharedFromId: true, isDeleted: true } });
  assert.deepEqual(sourceAfter, { isDeleted: true, title: '' });
  assert.deepEqual(shareAfter, { pageId: pages[1].id, sharedFromId: source.id, isDeleted: false });

  const actor = clients[98], recipient = clients[1], otherExcluded = clients[97];
  const actorEvent = await prisma.pageEvent.create({ data: { pageId: pages[0].id, recipientId: recipient.id,
    kind: 'PAGE_ACTIVITY_DELIVERY', targetId: source.id,
    context: { kind: 'like', actorId: actor.id, postId: source.id },
    dedupeKey: `${prefix}:actor-event`, deliveredAt: new Date() } });
  const excludedEvent = await prisma.pageEvent.create({ data: { pageId: pages[0].id, recipientId: recipient.id,
    kind: 'PAGE_ACTIVITY_DELIVERY', targetId: source.id,
    context: { kind: 'like', actorId: otherExcluded.id, postId: source.id, excludedRecipientIds: [actor.id, clients[96].id] },
    dedupeKey: `${prefix}:excluded-event`, deliveredAt: new Date() } });
  const addressedEvent = await prisma.pageEvent.create({ data: { pageId: pages[0].id, recipientId: actor.id,
    kind: 'PAGE_INVITATION', targetId: pages[0].id,
    dedupeKey: `${prefix}:addressed-event`, deliveredAt: new Date() } });
  await ok(actor, `/users/${actor.id}`, 'DELETE', { deleteOwnedPages: [] });
  assert.equal(await prisma.pageEvent.findUnique({ where: { id: actorEvent.id } }), null);
  assert.equal(await prisma.pageEvent.findUnique({ where: { id: addressedEvent.id } }), null);
  const excludedAfter = await prisma.pageEvent.findUniqueOrThrow({ where: { id: excludedEvent.id }, select: { context: true } });
  assert.deepEqual(excludedAfter.context.excludedRecipientIds, [clients[96].id]);
  report.securitySmokes = { externalSharePreserved: true, sourceTombstoned: true, accountOutboxErasure: true,
    otherRecipientExclusionsPreserved: true };
}

async function main() {
  save();
  assert.ok(report.runner.cpus >= 3 && report.runner.freeMemoryAtStartBytes >= 8 * 1024 ** 3,
    'RUNNER_CAPACITY_PREFLIGHT: need at least 3 CPUs and 8 GiB available; this is environment limitation, not Pages failure');
  await fixtures();
  for (const users of [1, 10, 25, 50]) await level(users, 10000, 30000);
  await level(100, 30000, 600000, true);
  await sleep(30000);
  await integrity();
  await postLoadSecuritySmokes();
  if (process.env.P35_API_LOG && fs.existsSync(process.env.P35_API_LOG)) {
    const log = fs.readFileSync(process.env.P35_API_LOG, 'utf8');
    report.targetLogSignals = {
      prismaOrDatabaseErrorLines: log.split('\n').filter(line => /PrismaClient|P20\d\d|database (error|unavailable)|connection pool|pool timeout/i.test(line)).length,
      httpFiveXxLines: log.split('\n').filter(line => /"event":"http_request_completed"/.test(line) && /"status":5\d\d/.test(line)).length,
    };
  }
  const p35 = report.p35;
  report.checks = [
    { name: 'Read p95 <= 800ms', pass: p35.byKind.read.p95Ms <= 800 },
    { name: 'Write p95 <= 1200ms', pass: p35.write.p95Ms <= 1200 },
    { name: 'Every minute HTTP 5xx < 1%', pass: p35.minuteWindows.every(window => !window.requests || window.fiveXx / window.requests < .01) },
    { name: 'No transport errors', pass: p35.transportErrors === 0 },
    { name: 'No unexpected HTTP 4xx', pass: p35.apiErrors === p35.fiveXx },
    { name: 'Counters and votes match actual database rows', pass: !report.integrity.counterMismatches && !report.integrity.optionMismatches && !report.integrity.duplicateResponses },
    { name: 'Cross-publisher deletion and account outbox cleanup', pass: Object.values(report.securitySmokes).every(Boolean) },
  ];
  report.status = report.checks.every(check => check.pass) ? 'PASS' : 'FAIL';
}

main().catch(error => {
  report.status = String(error.message).startsWith('RUNNER_CAPACITY_PREFLIGHT') ? 'TEST_ENVIRONMENT_LIMITATION' : 'FAIL';
  report.fatal = { code: error.code || error.name, message: String(error.message).slice(0, 300) };
}).finally(async () => {
  for (const client of clients) client?.agent.destroy();
  await prisma.$disconnect();
  report.finishedAt = new Date().toISOString();
  save();
  console.log(`P35_RECEIPT ${JSON.stringify({ status: report.status, path: reportPath, p35: report.p35 && {
    requests: report.p35.requests, readP95Ms: report.p35.byKind.read.p95Ms, errors: report.p35.errors } })}`);
  process.exit(report.status === 'PASS' ? 0 : 1);
});
