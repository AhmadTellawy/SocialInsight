'use strict';

// Disposable RC3 correctness harness. It starts a loopback-only PostgreSQL 17
// cluster, applies the current migrations, provisions a restricted runtime
// login plus signed Page context, and runs the current uncommitted dist.
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
const { pathToFileURL } = require('node:url');

const checkout = path.resolve(__dirname, '..');
const server = path.join(checkout, 'server');
const mainRepo = path.resolve(checkout, '..', '..');
const task = path.join(mainRepo, '.ai-company', 'memory', 'tasks', 'SI-PAGES-20260914');
const embeddedPath = path.join(mainRepo, '.ai-company', 'memory', 'tasks',
  'SI-CREATE-TWO-STEPS-20260906', 'local-postgres', 'node_modules', 'embedded-postgres', 'dist', 'index.js');
const serverRequire = createRequire(path.join(server, 'package.json'));
const pgRequire = createRequire(path.join(mainRepo, '.ai-company', 'memory', 'tasks',
  'SI-CREATE-TWO-STEPS-20260906', 'local-postgres', 'package.json'));
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
const evidenceDir = path.join(task, 'docs', 'pages-rc3-race-matrix', runId);
const receiptPath = path.join(evidenceDir, 'receipt.json');
const apiLogPath = path.join(evidenceDir, 'api.log');
const report = {
  kind: 'PAGES_RC3_REAL_POSTGRES_RACE_MATRIX', runId,
  target: 'disposable loopback PostgreSQL + restricted loopback API',
  startedAt: new Date().toISOString(), status: 'RUNNING', checks: [], races: [], lockSamples: [],
  constraints: { production: false, fullP35: false, commit: false, push: false },
  source: {
    head: cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim(),
    postControllerDistSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(server, 'dist', 'controllers', 'postController.js'))).digest('hex'),
    pageServiceDistSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(server, 'dist', 'pages', 'pageService.js'))).digest('hex'),
  },
};
fs.mkdirSync(evidenceDir, { recursive: true });
const save = () => fs.writeFileSync(receiptPath, JSON.stringify(report, null, 2));
save();

const freePort = () => new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); });
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitForApi = (port, attempts = 90) => new Promise((resolve, reject) => {
  const probe = () => {
    const request = http.get(`http://127.0.0.1:${port}/`, response => {
      response.resume();
      if (response.statusCode >= 200 && response.statusCode < 300) return resolve();
      if (--attempts <= 0) return reject(new Error(`API_START_${response.statusCode}`));
      setTimeout(probe, 500);
    });
    request.on('error', () => attempts > 0 ? setTimeout(probe, 500) : reject(new Error('API_START_TIMEOUT')));
    request.setTimeout(1000, () => request.destroy());
  }; probe();
});
const command = (label, file, args, options = {}) => {
  const result = cp.spawnSync(file, args, { cwd: checkout, windowsHide: true, encoding: 'utf8', timeout: 300000, ...options });
  if (result.status !== 0) throw Object.assign(new Error(label), { detail: String(result.stderr || result.stdout || '').slice(-1000) });
  return result;
};
const safeError = error => ({ code: String(error?.code || error?.name || 'ERROR'),
  message: String(error?.message || error).replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[LOCAL_DSN]').slice(0, 500) });

class BrowserClient {
  constructor(api, ip) { this.api = api; this.ip = ip; this.cookies = ''; this.csrfToken = ''; this.agent = new http.Agent({ keepAlive: true, maxSockets: 2 }); }
  request(route, method = 'GET', body, timeoutMs = 20000) {
    const begun = performance.now(); const payload = body === undefined ? null : JSON.stringify(body);
    return new Promise(resolve => {
      let settled = false;
      const finish = (status, raw = '', transport = '') => {
        if (settled) return; settled = true; let value = {};
        try { value = JSON.parse(raw); } catch { value = { text: raw.slice(0, 200) }; }
        resolve({ status, body: value, transport, durationMs: Math.round((performance.now() - begun) * 100) / 100 });
      };
      const request = http.request(`${this.api}/api${route}`, { method, agent: this.agent, localAddress: this.ip,
        headers: { ...(this.cookies ? { cookie: this.cookies } : {}),
          ...(!['GET', 'HEAD', 'OPTIONS'].includes(method) ? { origin: this.api } : {}),
          ...(this.csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method) ? { 'x-csrf-token': this.csrfToken } : {}),
          ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}) } }, response => {
        if (response.headers['set-cookie']) this.cookies = response.headers['set-cookie'].map(v => v.split(';', 1)[0]).join('; ');
        const chunks = []; response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => finish(response.statusCode, Buffer.concat(chunks).toString()));
      });
      request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT' })));
      request.on('error', error => finish(0, '', String(error.code || error.name)));
      request.end(payload);
    });
  }
  async login(identifier, password) {
    const result = await this.request('/auth/login', 'POST', { identifier, password });
    assert.equal(result.status, 200, `login ${identifier}: ${result.status}`); this.csrfToken = result.body.csrfToken; assert.ok(this.csrfToken); return result;
  }
  close() { this.agent.destroy(); }
}

const postPayload = (prefix, status = 'DRAFT', extra = {}) => ({
  title: `${prefix} opinion`, description: 'RC3 disposable concurrency fixture', type: 'Poll', category: 'General', status,
  targetAudience: 'Public', expiresAt: new Date(Date.now() + 86400000).toISOString(), allowComments: true,
  allowAnonymous: true, forceAnonymous: false, resultsWho: 'Public', resultsTiming: 'AnyTime',
  options: [{ id: crypto.randomUUID(), text: 'Alpha' }, { id: crypto.randomUUID(), text: 'Beta' }], ...extra,
});
const expectStatus = (response, allowed, label) => {
  assert.ok(allowed.includes(response.status), `${label}: ${response.status} ${JSON.stringify(response.body).slice(0, 220)}`);
  return response;
};
const pageLockKey = pageId => crypto.createHash('sha256').update(`socialinsight:page:v1:${pageId.toLowerCase()}`, 'utf8').digest().readBigInt64BE(0);

async function waitForRuntimeAdvisoryWait(observer, minimum = 1, timeoutMs = 5000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const snapshot = await observer.query(`
      SELECT activity.pid, activity.state, activity.wait_event_type AS "waitEventType",
        activity.wait_event AS "waitEvent", lock_state.mode, lock_state.granted
      FROM pg_stat_activity activity
      LEFT JOIN pg_locks lock_state ON lock_state.pid = activity.pid AND lock_state.locktype = 'advisory'
      WHERE activity.usename = 'pages_rc3_runtime'
      ORDER BY activity.pid, lock_state.granted, lock_state.mode`);
    const waiting = snapshot.rows.filter(row => row.granted === false || row.waitEventType === 'Lock' && row.waitEvent === 'advisory');
    if (waiting.length >= minimum) return { observedAt: new Date().toISOString(), waiting: waiting.length,
      active: snapshot.rows.filter(row => row.state === 'active').length,
      idleInTransaction: snapshot.rows.filter(row => row.state === 'idle in transaction').length,
      rows: snapshot.rows.map(row => ({ state: row.state, waitEventType: row.waitEventType, waitEvent: row.waitEvent,
        mode: row.mode, granted: row.granted })) };
    await sleep(20);
  }
  throw new Error('RUNTIME_ADVISORY_WAIT_NOT_OBSERVED');
}

async function withPageBarrier(Pg, directUrl, observer, spec) {
  const blocker = new Pg.Client({ connectionString: directUrl, application_name: `rc3_barrier_${spec.name}` });
  await blocker.connect(); await blocker.query('BEGIN');
  const key = pageLockKey(spec.pageId);
  const sql = spec.blockerMode === 'shared' ? 'SELECT pg_advisory_xact_lock_shared($1)' : 'SELECT pg_advisory_xact_lock($1)';
  await blocker.query(sql, [key.toString()]);
  const startedAt = performance.now(); let first, second, snapshot, secondSnapshot = null;
  try {
    first = spec.first();
    snapshot = await waitForRuntimeAdvisoryWait(observer);
    second = spec.second();
    if ((spec.minimumWaiters || 1) > 1) {
      secondSnapshot = await waitForRuntimeAdvisoryWait(observer, spec.minimumWaiters);
    } else await sleep(50);
    const beforeRelease = await observer.query(`
      SELECT state, wait_event_type AS "waitEventType", wait_event AS "waitEvent", count(*)::int AS count
      FROM pg_stat_activity WHERE usename = 'pages_rc3_runtime'
      GROUP BY state, wait_event_type, wait_event ORDER BY state, wait_event_type, wait_event`);
    report.lockSamples.push({ race: spec.name, blockerMode: spec.blockerMode, keyOrder: key.toString(),
      firstWait: snapshot, secondWait: secondSnapshot, beforeRelease: beforeRelease.rows });
    await blocker.query('COMMIT');
    const [firstResult, secondResult] = await Promise.all([first, second]);
    return { first: firstResult, second: secondResult, durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      waitObserved: true };
  } catch (error) {
    await blocker.query('ROLLBACK').catch(() => {});
    if (first) await Promise.resolve(first).catch(() => {});
    if (second) await Promise.resolve(second).catch(() => {});
    throw error;
  } finally { await blocker.end().catch(() => {}); }
}

async function withAccountBarrier(Pg, directUrl, observer, spec) {
  const blocker = new Pg.Client({ connectionString: directUrl, application_name: `rc3_account_barrier_${spec.name}` });
  await blocker.connect(); await blocker.query('BEGIN');
  await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`account-security:${spec.userId}`]);
  const startedAt = performance.now(); let first, second, snapshot;
  try {
    first = spec.first();
    snapshot = await waitForRuntimeAdvisoryWait(observer);
    second = spec.second();
    // Page operations deliberately fail fast on a busy account lock, so the
    // contender is not expected to become a second PostgreSQL waiter.
    await sleep(100);
    report.lockSamples.push({ race: spec.name, blockerMode: 'account-exclusive',
      keyOrder: 'hashtextextended(account-security:<fixture-id>,0)', firstWait: snapshot });
    await blocker.query('COMMIT');
    const [firstResult, secondResult] = await Promise.all([first, second]);
    return { first: firstResult, second: secondResult,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100, waitObserved: true };
  } catch (error) {
    await blocker.query('ROLLBACK').catch(() => {});
    if (first) await Promise.resolve(first).catch(() => {});
    if (second) await Promise.resolve(second).catch(() => {});
    throw error;
  } finally { await blocker.end().catch(() => {}); }
}

async function main() {
  const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-pages-rc3-races-'));
  const dbPort = await freePort(), apiPort = await freePort(), apiPort2 = await freePort();
  const password = crypto.randomBytes(32).toString('hex'), runtimePassword = crypto.randomBytes(32).toString('hex');
  const directUrl = `postgresql://postgres:${password}@127.0.0.1:${dbPort}/postgres?schema=public&connection_limit=20`;
  const runtimeUrl = `postgresql://pages_rc3_runtime:${runtimePassword}@127.0.0.1:${dbPort}/postgres?schema=public&connection_limit=12`;
  const signingKey = crypto.randomBytes(32).toString('hex');
  const apiOrigin = `http://127.0.0.1:${apiPort}`, apiOrigin2 = `http://127.0.0.1:${apiPort2}`;
  const env = { ...process.env, DATABASE_URL: directUrl, DIRECT_URL: directUrl, NODE_ENV: 'production',
    TRUST_PROXY_HOPS: '1', AUTH_ALLOWED_ORIGINS: `${apiOrigin},${apiOrigin2}`, DISABLE_BACKGROUND_JOBS: 'true', PAGES_ENABLED: 'true',
    STAGE_ONLY: 'false', PAGES_LIFECYCLE_PAUSED: 'true', RENDER: 'false', PORT: String(apiPort),
    PAGES_RLS_CONTEXT_KEY_ID: 'rc3-ephemeral', PAGES_RLS_CONTEXT_SIGNING_KEY: signingKey,
    PAGES_PERF_TELEMETRY: 'true', JWT_SECRET: crypto.randomBytes(48).toString('hex') };
  let embedded, api, api2, apiLog, apiLog2, admin, observer; const clients = [];
  try {
    const { default: EmbeddedPostgres } = await import(pathToFileURL(embeddedPath).href);
    embedded = new EmbeddedPostgres({ databaseDir: path.join(databaseDir, 'pgdata'), port: dbPort, user: 'postgres', password,
      authMethod: 'scram-sha-256', persistent: true, createPostgresUser: false,
      initdbFlags: ['--encoding=UTF8', '--locale=C'], postgresFlags: ['-h', '127.0.0.1'], onLog: () => {}, onError: () => {} });
    await embedded.initialise(); await embedded.start(); report.postgres = { version: 17, port: 'ephemeral', forceRls: true };
    command('MIGRATION_FAILED', process.execPath, [path.join(server, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { cwd: server, env });
    const { PrismaClient } = serverRequire('@prisma/client'); admin = new PrismaClient({ datasourceUrl: directUrl });
    await admin.$executeRawUnsafe(`CREATE ROLE pages_rc3_runtime LOGIN PASSWORD '${runtimePassword}' IN ROLE socialinsight_runtime`);
    command('RLS_CONTEXT_PROVISION_FAILED', process.execPath, [path.join(server, 'dist/scripts/provisionPagesRlsContext.js')], { cwd: server, env });
    const Pg = pgRequire('pg'); observer = new Pg.Client({ connectionString: directUrl }); await observer.connect();
    const signedProbe = async (actorId, system, work) => {
      assert.equal(new URL(runtimeUrl).hostname, '127.0.0.1');
      const probe = new Pg.Client({ connectionString: runtimeUrl }); await probe.connect();
      try {
        await probe.query('BEGIN');
        const binding=(await probe.query('SELECT pg_backend_pid()::text AS pid,txid_current()::text AS txid,floor(extract(epoch FROM clock_timestamp()))::bigint AS epoch')).rows[0];
        const payload=['v1','rc3-ephemeral',actorId||'0','0',system?'1':'0','0',binding.epoch,Number(binding.epoch)+30,binding.pid,binding.txid,crypto.randomBytes(16).toString('hex')].join('.');
        const token=payload+'.'+crypto.createHmac('sha256',Buffer.from(signingKey,'hex')).update(payload).digest('hex');
        await probe.query("SELECT set_config('socialinsight.page_context',$1,true)",[token]);
        const result=await work(probe);await probe.query('COMMIT');return result;
      }catch(error){await probe.query('ROLLBACK');throw error;}finally{await probe.end();}
    };
    const decisionAcl=(await observer.query("SELECT count(*)::int AS n FROM pg_proc function CROSS JOIN LATERAL aclexplode(function.proacl) privilege WHERE function.oid='public.socialinsight_decide_page_invitation(text,text)'::regprocedure AND privilege.grantee<>function.proowner AND privilege.grantee<>(SELECT oid FROM pg_roles WHERE rolname='socialinsight_runtime')")).rows[0].n;
    assert.equal(decisionAcl,0);report.checks.push({name:'decision RPC has only owner/runtime EXECUTE, no PUBLIC/provider grant',pass:true});
    const forceRows = await observer.query(`SELECT relname, relforcerowsecurity FROM pg_class WHERE relname IN ('Page','PageMembership') ORDER BY relname`);
    assert.ok(forceRows.rows.length === 2 && forceRows.rows.every(row => row.relforcerowsecurity));
    report.checks.push({ name: 'current migrations + FORCE RLS', pass: true, tables: forceRows.rows.map(row => row.relname) });
    env.DATABASE_URL = runtimeUrl; apiLog = fs.openSync(apiLogPath, 'w');
    api = cp.spawn(process.execPath, [path.join(server, 'dist/app.js')], { cwd: server, env, windowsHide: true, stdio: ['ignore', apiLog, apiLog] });
    const apiLogPath2 = path.join(evidenceDir, 'api-secondary.log'); apiLog2 = fs.openSync(apiLogPath2, 'w');
    api2 = cp.spawn(process.execPath, [path.join(server, 'dist/app.js')], { cwd: server, env: { ...env, PORT: String(apiPort2) },
      windowsHide: true, stdio: ['ignore', apiLog2, apiLog2] });
    await Promise.all([waitForApi(apiPort), waitForApi(apiPort2)]);
    report.api = { processes: [{ pid: api.pid, origin: 'loopback-primary' }, { pid: api2.pid, origin: 'loopback-secondary' }],
      role: 'pages_rc3_runtime', sharedDatabase: true };

    const bcrypt = serverRequire('bcryptjs'); const fixturePassword = crypto.randomBytes(24).toString('hex');
    const actors = {};
    for (const [index, role] of ['owner','admin','editor','outsider','candidate','source2','voteFirst','erasureFirst'].entries()) {
      const id = crypto.randomUUID(), email = `rc3_${runId}_${role}@example.test`, handle = `rc3_${crypto.randomBytes(5).toString('hex')}`;
      await admin.user.create({ data: { id, name: `RC3 ${role}`, handle, email, passwordHash: bcrypt.hashSync(fixturePassword, 8),
        status: 'ACTIVE', emailVerifiedAt: new Date(), isPrivate: false, mediaPrivacyTarget: false } });
      const client = new BrowserClient(apiOrigin, `127.2.0.${index + 1}`), secondary = new BrowserClient(apiOrigin2, `127.3.0.${index + 1}`);
      await client.login(email, fixturePassword); await secondary.login(email, fixturePassword); clients.push(client, secondary);
      actors[role] = { id, email, client, secondary };
    }

    const draftPage = expectStatus(await actors.owner.client.request('/pages', 'POST', { requestId: crypto.randomUUID(),
      name: 'RC3 Draft Matrix', handle: `rc3draft${crypto.randomBytes(4).toString('hex')}`, category: 'company', bio: 'draft matrix', representationConfirmed: true }), [201], 'create draft page').body;
    if (process.env.SI_PAGES_ROLE_BATCH === '1') {
      report.kind = 'PAGES_BOUNDED_ROLE_HTTP_POSTGRES_MATRIX';
      report.source.workingTree = cp.execFileSync('git', ['status', '--porcelain'], { cwd: checkout, encoding: 'utf8' }).trim() ? 'DIRTY' : 'CLEAN';
      report.source.diffSha256 = crypto.createHash('sha256').update(cp.execFileSync('git', ['diff', 'HEAD'], { cwd: checkout })).digest('hex');
      await require('./pages-role-http-matrix.cjs')({ actors, draftPage, admin, observer, signedProbe, report, save, postPayload, fixturePassword, BrowserClient, apiOrigin, clients });
      return;
    }
    // Live CP89 exposed a missing API/RLS boundary: direct fixture membership
    // seeding never exercises an unprivileged recipient's Draft acceptance.
    const invitationChecks = [];
    for (const [actor, role] of [['admin','ADMIN'],['editor','EDITOR'],['candidate','ANALYST']]) {
      // Model an independent stale team-safety hide. Acceptance may repair only
      // that derived flag, not Draft/publication/platform state or ownership.
      await signedProbe(null,true,probe=>probe.query('UPDATE public."Page" SET "safetyHiddenAt"=CURRENT_TIMESTAMP,"platformState"=$1 WHERE id=$2',[actor==='admin'?'SUSPENDED':'NONE',draftPage.id]));
      const invitation = expectStatus(await actors.owner.client.request(`/pages/manage/${draftPage.id}/invitations`, 'POST',
        { recipientId: actors[actor].id, role }), [201], `Draft invitation ${role}`).body;
      expectStatus(await actors.outsider.client.request(`/pages/invitations/${invitation.id}/accept`, 'POST', {}), [404], 'stranger invitation denial');
      const inbox = expectStatus(await actors[actor].client.request('/pages/invitations'), [200], `Draft invitation inbox ${role}`).body;
      assert.ok(inbox.items.some(item => item.id === invitation.id && item.page.id === draftPage.id));
      expectStatus(await actors[actor].client.request(`/pages/manage/${draftPage.id}`), [403,404], 'pre-membership management denial');
      await assert.rejects(signedProbe(actors.outsider.id,false,probe=>probe.query('SELECT * FROM public.socialinsight_decide_page_invitation($1,$2)',[invitation.id,'accept'])),error=>error.code==='42501');
      expectStatus(await actors[actor].client.request(`/pages/invitations/${invitation.id}/accept`, 'POST', {}), [200], `Draft invitation acceptance ${role}`);
      assert.equal((await admin.pageMembership.findUnique({ where: { pageId_userId: { pageId: draftPage.id, userId: actors[actor].id } } })).role, role);
      assert.equal(await admin.pageAuditEvent.count({ where: { pageId: draftPage.id, targetId: invitation.id, action: 'INVITATION_ACCEPTED' } }), 1);
      assert.equal(await admin.pageEvent.count({ where: { dedupeKey: `${invitation.id}:ACCEPTED` } }), 1);
      expectStatus(await actors[actor].client.request(`/pages/manage/${draftPage.id}`),[200],`${role} actual managed Page read`);
      expectStatus(await actors[actor].client.request(`/pages/manage/${draftPage.id}/content?status=DRAFT`),role==='ANALYST'?[403]:[200],`${role} Draft content read boundary`);
      expectStatus(await actors[actor].client.request(`/pages/manage/${draftPage.id}/analytics`),[200],`${role} analytics read boundary`);
      const acceptedPage=await admin.page.findUniqueOrThrow({where:{id:draftPage.id}});
      assert.equal(acceptedPage.safetyHiddenAt,null);assert.equal(acceptedPage.publicationState,'DRAFT');assert.equal(acceptedPage.ownerId,actors.owner.id);assert.equal(acceptedPage.platformState,actor==='admin'?'SUSPENDED':'NONE');
      assert.equal((await observer.query('SELECT count(*)::int AS n FROM public.socialinsight_page_transition_admissions WHERE page_id=$1',[draftPage.id])).rows[0].n,0);
      if(actor==='admin')await assert.rejects(signedProbe(actors.admin.id,false,probe=>probe.query('UPDATE public."Page" SET "publicationState"=$1 WHERE id=$2',['PUBLISHED',draftPage.id])),error=>error.code==='42501');
      else await signedProbe(actors[actor].id,false,async probe=>{const update=await probe.query('UPDATE public."Page" SET "publicationState"=$1 WHERE id=$2',['PUBLISHED',draftPage.id]);assert.equal(update.rowCount,0);});
      await signedProbe(null,true,probe=>probe.query('UPDATE public."Page" SET "platformState"=$1 WHERE id=$2',['NONE',draftPage.id]));
      expectStatus(await actors[actor].client.request(`/pages/invitations/${invitation.id}/accept`, 'POST', {}), [409], 'accept retry cannot duplicate');
      invitationChecks.push({role, action:'accept', pendingDraftInbox:true, outsiderDenied:true, rawSignedRpcStrangerDenied:true, auditAndEventExactlyOnce:true, derivedSafetyOnlyRestored:true, lifecycleAndOwnershipUnchanged:true, admissionConsumed:true, arbitraryLifecycleUpdateDenied:true, pass:true});
    }
    const rejection = expectStatus(await actors.owner.client.request(`/pages/manage/${draftPage.id}/invitations`, 'POST',
      { recipientId: actors.voteFirst.id, role: 'EDITOR' }), [201], 'Draft rejection invitation').body;
    expectStatus(await actors.voteFirst.client.request(`/pages/invitations/${rejection.id}/reject`, 'POST', {}), [200], 'Draft recipient rejection');
    assert.equal(await admin.pageMembership.count({where:{pageId:draftPage.id,userId:actors.voteFirst.id}}),0);
    assert.equal(await admin.pageAuditEvent.count({where:{targetId:rejection.id,action:'INVITATION_REJECTED'}}),1);
    assert.equal(await admin.pageEvent.count({where:{dedupeKey:`${rejection.id}:REJECTED`}}),1);
    expectStatus(await actors.voteFirst.client.request(`/pages/invitations/${rejection.id}/accept`, 'POST', {}), [409], 'rejected invitation cannot accept');
    invitationChecks.push({action:'reject', membershipAbsent:true, auditAndEventExactlyOnce:true, pass:true});
    const withdrawn = expectStatus(await actors.owner.client.request(`/pages/manage/${draftPage.id}/invitations`, 'POST',
      {recipientId:actors.erasureFirst.id,role:'EDITOR'}),[201],'withdrawal invitation').body;
    expectStatus(await actors.owner.client.request(`/pages/invitations/${withdrawn.id}/withdraw`,'POST',{}),[200],'owner withdrawal');
    expectStatus(await actors.erasureFirst.client.request(`/pages/invitations/${withdrawn.id}/accept`,'POST',{}),[409],'withdrawn invitation cannot accept');
    invitationChecks.push({action:'withdraw', recipientAcceptDenied:true, pass:true});
    const demotedSenderInvitation=expectStatus(await actors.admin.client.request(`/pages/manage/${draftPage.id}/invitations`,'POST',
      {recipientId:actors.outsider.id,role:'ANALYST'}),[201],'admin invitation before demotion').body;
    await signedProbe(null,true,probe=>probe.query('UPDATE public."PageMembership" SET role=$1 WHERE "pageId"=$2 AND "userId"=$3',['EDITOR',draftPage.id,actors.admin.id]));
    await assert.rejects(signedProbe(actors.outsider.id,false,probe=>probe.query('SELECT * FROM public.socialinsight_decide_page_invitation($1,$2)',[demotedSenderInvitation.id,'accept'])),error=>error.code==='42501');
    expectStatus(await actors.outsider.client.request(`/pages/invitations/${demotedSenderInvitation.id}/accept`,'POST',{}),[409],'demoted sender grant rejected');
    assert.equal(await admin.pageMembership.count({where:{pageId:draftPage.id,userId:actors.outsider.id}}),0);
    assert.equal(await admin.pageAuditEvent.count({where:{targetId:demotedSenderInvitation.id,action:'INVITATION_ACCEPTED'}}),0);
    await signedProbe(null,true,probe=>probe.query('UPDATE public."PageMembership" SET role=$1 WHERE "pageId"=$2 AND "userId"=$3',['ADMIN',draftPage.id,actors.admin.id]));
    expectStatus(await actors.owner.client.request(`/pages/invitations/${demotedSenderInvitation.id}/withdraw`,'POST',{}),[200],'withdraw demoted sender fixture');
    invitationChecks.push({action:'accept-after-sender-demotion', pendingGrantRevalidated:true, rawAndHttpDenied:true, noMembershipOrAudit:true, pass:true});
    report.invitationDecisions={status:'PASS',checks:invitationChecks};
    report.checks.push({name:'real Draft invitation inbox/ADMIN-EDITOR-ANALYST acceptance/rejection/withdrawal and atomic audit-outbox',pass:true});save();
    const draftCases = [];
    for (const role of ['owner','admin','editor']) {
      const response = await actors[role].client.request('/posts', 'POST', postPayload(`rc3-${role}-draft`, 'DRAFT',
        { pageId: draftPage.id, pageCreateKey: crypto.randomUUID() }));
      const passed = [200, 201].includes(response.status) && response.body.id && response.body.pageId === draftPage.id;
      draftCases.push({ actor: role, pageState: 'DRAFT', status: response.status, passed: !!passed, hydrated: !!passed,
        code: response.body.code || response.body.error || null });
    }
    const unauthorized = await actors.outsider.client.request('/posts', 'POST', postPayload('rc3-unauthorized', 'DRAFT',
      { pageId: draftPage.id, pageCreateKey: crypto.randomUUID() }));
    expectStatus(unauthorized, [403, 404], 'unauthorized draft');
    const earlyPublish = await actors.owner.client.request('/posts', 'POST', postPayload('rc3-early-publish', 'PUBLISHED',
      { pageId: draftPage.id, pageCreateKey: crypto.randomUUID() }));
    expectStatus(earlyPublish, [403, 404, 409], 'publish before Page published');
    await expectStatus(await actors.owner.client.request(`/pages/manage/${draftPage.id}/lifecycle`, 'POST', { action: 'publish' }), [200], 'publish Page');
    await expectStatus(await actors.owner.client.request(`/pages/manage/${draftPage.id}/lifecycle`, 'POST', { action: 'unpublish' }), [200], 'unpublish Page');
    for (const role of ['admin','editor']) {
      const response = await actors[role].client.request('/posts', 'POST', postPayload(`rc3-${role}-unpublished`, 'DRAFT',
        { pageId: draftPage.id, pageCreateKey: crypto.randomUUID() }));
      const passed = [200, 201].includes(response.status) && response.body.id && response.body.pageId === draftPage.id;
      draftCases.push({ actor: role, pageState: 'UNPUBLISHED', status: response.status, passed: !!passed, hydrated: !!passed,
        code: response.body.code || response.body.error || null });
    }
    const draftPass = draftCases.every(value => value.passed);
    report.draftMatrix = { status: draftPass ? 'PASS' : 'FAIL', cases: draftCases,
      unauthorized: { status: unauthorized.status, denied: [403, 404].includes(unauthorized.status) },
      publishBeforePublished: { status: earlyPublish.status, denied: [403, 404, 409].includes(earlyPublish.status) },
      signedHydration: draftCases.every(value => value.hydrated) };
    report.checks.push({ name: 'Draft owner/admin/editor + denial matrix under restricted FORCE RLS', pass: draftPass }); save();

    const createPublishedPage = async (actor, label) => {
      const created = expectStatus(await actor.client.request('/pages', 'POST', { requestId: crypto.randomUUID(),
        name: `RC3 ${label}`, handle: `rc3${label.toLowerCase()}${crypto.randomBytes(4).toString('hex')}`,
        category: 'company', bio: `RC3 ${label}`, representationConfirmed: true }), [201], `create ${label}`).body;
      expectStatus(await actor.client.request(`/pages/manage/${created.id}/lifecycle`, 'POST', { action: 'publish' }), [200], `publish ${label}`);
      return created;
    };
    const pageA = await createPublishedPage(actors.owner, 'SourceA');
    const pageB = await createPublishedPage(actors.admin, 'DestinationB');
    const pageC = await createPublishedPage(actors.source2, 'SourceC');
    await admin.pageMembership.create({ data: { pageId: pageB.id, userId: actors.editor.id, role: 'EDITOR' } });
    const sourceA = expectStatus(await actors.owner.client.request('/posts', 'POST', postPayload('rc3-source-a', 'PUBLISHED',
      { pageId: pageA.id, pageCreateKey: crypto.randomUUID() })), [200, 201], 'source A post').body;
    const sourceB = expectStatus(await actors.admin.client.request('/posts', 'POST', postPayload('rc3-source-b', 'PUBLISHED',
      { pageId: pageB.id, pageCreateKey: crypto.randomUUID() })), [200, 201], 'source B post').body;
    const sourceC = expectStatus(await actors.source2.client.request('/posts', 'POST', postPayload('rc3-source-c', 'PUBLISHED',
      { pageId: pageC.id, pageCreateKey: crypto.randomUUID() })), [200, 201], 'source C post').body;
    const share = async (actor, sourceId, destinationId, label, client = actor.client) => {
      const requestKey = crypto.randomUUID();
      const response = await client.request(`/posts/${sourceId}/share`, 'POST', {
        pageId: destinationId, pageCreateKey: requestKey, caption: `RC3 ${label} ${crypto.randomBytes(3).toString('hex')}`,
      });
      return { ...response, requestKey };
    };
    const auditExists = async requestKey => !!await admin.pageAuditEvent.findUnique({ where: { id: requestKey } });
    const addRace = async (name, work) => {
      const started = performance.now();
      try {
        const outcome = await work();
        report.races.push({ name, pass: !!outcome.pass, durationMs: Math.round((performance.now() - started) * 100) / 100, ...outcome });
      } catch (error) {
        report.races.push({ name, pass: false, durationMs: Math.round((performance.now() - started) * 100) / 100, error: safeError(error) });
      }
      save();
    };

    const baselineOfficial = expectStatus(await actors.owner.client.request(`/posts/${sourceA.id}/comments`, 'POST',
      { text: 'RC3 baseline official comment', pageId: pageA.id }), [200, 201], 'baseline official comment').body;
    await addRace('official Page comment create/update concurrency', async () => {
      const outcome = await withPageBarrier(Pg, directUrl, observer, {
        name: 'official_comment_create_update', pageId: pageA.id, blockerMode: 'exclusive', minimumWaiters: 2,
        first: () => actors.owner.client.request(`/posts/${sourceA.id}/comments`, 'POST',
          { text: 'RC3 concurrent official comment', pageId: pageA.id }),
        second: () => actors.owner.secondary.request(`/posts/comments/${baselineOfficial.id}`, 'PUT',
          { text: 'RC3 concurrently updated official comment' }),
      });
      const safeConflict = outcome.second.status === 409 && outcome.second.body.code === 'PAGE_ACCOUNT_BUSY';
      const retry = safeConflict
        ? await actors.owner.secondary.request(`/posts/comments/${baselineOfficial.id}`, 'PUT',
          { text: 'RC3 concurrently updated official comment' })
        : outcome.second;
      const created = outcome.first.body.id
        ? await admin.comment.findUnique({ where: { id: outcome.first.body.id } }) : null;
      const updated = await admin.comment.findUnique({ where: { id: baselineOfficial.id } });
      return { pass: [200, 201].includes(outcome.first.status) &&
          (outcome.second.status === 200 || safeConflict) && retry.status === 200 &&
          !outcome.first.transport && !outcome.second.transport && created?.pageId === pageA.id &&
          updated?.text === 'RC3 concurrently updated official comment',
        waitObserved: outcome.waitObserved, safeConflict,
        first: { status: outcome.first.status, code: outcome.first.body.code || null },
        second: { status: outcome.second.status, code: outcome.second.body.code || null },
        retry: { status: retry.status, code: retry.body.code || null },
        createdOfficial: created?.pageId === pageA.id,
        updatedOfficial: updated?.text === 'RC3 concurrently updated official comment' };
    });

    await addRace('official comment response hydrates before Page unpublish', async () => {
      const before = await admin.comment.count({ where: { postId: sourceA.id } });
      const outcome = await withPageBarrier(Pg, directUrl, observer, {
        name: 'official_comment_before_unpublish', pageId: pageA.id, blockerMode: 'exclusive', minimumWaiters: 2,
        first: () => actors.owner.client.request(`/posts/${sourceA.id}/comments`, 'POST',
          { text: 'RC3 comment commits before unpublish', pageId: pageA.id }),
        second: () => actors.owner.secondary.request(`/pages/manage/${pageA.id}/lifecycle`, 'POST', { action: 'unpublish' }),
      });
      const after = await admin.comment.count({ where: { postId: sourceA.id } });
      const republish = await actors.owner.client.request(`/pages/manage/${pageA.id}/lifecycle`, 'POST', { action: 'publish' });
      return { pass: outcome.first.status === 200 && outcome.second.status === 200 &&
          outcome.first.body.author?.id === pageA.id && after === before + 1 && republish.status === 200,
        waitObserved: outcome.waitObserved, hydratedPageIdentity: outcome.first.body.author?.id === pageA.id,
        first: { status: outcome.first.status, code: outcome.first.body.code || null },
        second: { status: outcome.second.status, code: outcome.second.body.code || null },
        commentDelta: after - before, republishStatus: republish.status };
    });
    await addRace('Page unpublish rejects official comment before persistence', async () => {
      const before = await admin.comment.count({ where: { postId: sourceA.id } });
      const outcome = await withPageBarrier(Pg, directUrl, observer, {
        name: 'unpublish_before_official_comment', pageId: pageA.id, blockerMode: 'shared', minimumWaiters: 2,
        first: () => actors.owner.client.request(`/pages/manage/${pageA.id}/lifecycle`, 'POST', { action: 'unpublish' }),
        second: () => actors.owner.secondary.request(`/posts/${sourceA.id}/comments`, 'POST',
          { text: 'RC3 comment must lose after unpublish', pageId: pageA.id }),
      });
      const after = await admin.comment.count({ where: { postId: sourceA.id } });
      const republish = await actors.owner.client.request(`/pages/manage/${pageA.id}/lifecycle`, 'POST', { action: 'publish' });
      return { pass: outcome.first.status === 200 && outcome.second.status === 404 &&
          outcome.second.body.code === 'PAGE_NOT_FOUND' && after === before && republish.status === 200,
        waitObserved: outcome.waitObserved,
        first: { status: outcome.first.status, code: outcome.first.body.code || null },
        second: { status: outcome.second.status, code: outcome.second.body.code || null },
        commentDelta: after - before, republishStatus: republish.status };
    });

    const voteOptionA = await admin.option.findFirst({ where: { question: { postId: sourceA.id } }, select: { id: true } });
    const voteOptionC = await admin.option.findFirst({ where: { question: { postId: sourceC.id } }, select: { id: true } });
    assert.ok(voteOptionA?.id && voteOptionC?.id, 'vote options missing');
    await addRace('vote commits before account erasure', async () => {
      const first = await actors.voteFirst.client.request(`/posts/${sourceA.id}/vote`, 'POST', { optionId: voteOptionA.id });
      const second = await actors.voteFirst.secondary.request('/account', 'DELETE', {});
      const retained = await admin.response.findFirst({ where: { postId: sourceA.id }, select: { userId: true, isAnonymous: true } });
      return { pass: first.status === 200 && second.status === 200 && retained?.userId === null && retained?.isAnonymous === true,
        ordering: 'explicit response boundary: vote commit then erasure request',
        first: { status: first.status, code: first.body.code || null },
        second: { status: second.status, code: second.body.code || null }, retainedResponseAnonymized: retained?.userId === null && retained?.isAnonymous === true };
    });
    await addRace('account erasure wins against concurrent vote', async () => {
      const outcome = await withAccountBarrier(Pg, directUrl, observer, {
        name: 'account_erasure_before_vote', userId: actors.erasureFirst.id,
        first: () => actors.erasureFirst.client.request('/account', 'DELETE', {}),
        second: () => actors.erasureFirst.secondary.request(`/posts/${sourceC.id}/vote`, 'POST', { optionId: voteOptionC.id }),
      });
      const retry = await actors.erasureFirst.secondary.request(`/posts/${sourceC.id}/vote`, 'POST', { optionId: voteOptionC.id });
      const losingRows = await admin.response.count({ where: { postId: sourceC.id } });
      return { pass: outcome.first.status === 200 && outcome.second.status === 409 &&
          outcome.second.body.code === 'PAGE_ACCOUNT_BUSY' && [400, 401, 403].includes(retry.status) && losingRows === 0,
        waitObserved: outcome.waitObserved, safeConflict: outcome.second.body.code === 'PAGE_ACCOUNT_BUSY',
        first: { status: outcome.first.status, code: outcome.first.body.code || null },
        second: { status: outcome.second.status, code: outcome.second.body.code || null },
        postCommitRetry: { status: retry.status, code: retry.body.code || null, error: retry.body.error || null },
        losingResponseRows: losingRows };
    });

    await addRace('cross-Page A-to-B share', async () => {
      const result = await share(actors.admin, sourceA.id, pageB.id, 'cross-page');
      const persisted = await auditExists(result.requestKey);
      return { pass: result.status === 200 && persisted && result.body.pageId === pageB.id,
        status: result.status, code: result.body.code || null, persisted, hydrated: !!result.body.id };
    });
    await addRace('multiple simultaneous shares from same source', async () => {
      const results = await Promise.all(Array.from({ length: 4 }, (_, index) => share(actors.admin, sourceA.id, pageB.id,
        `same-source-${index}`, index % 2 ? actors.admin.secondary : actors.admin.client)));
      const audits = await admin.pageAuditEvent.count({ where: { id: { in: results.map(result => result.requestKey) } } });
      const ids = results.map(result => result.body.id).filter(Boolean);
      const winners = results.filter(result => result.status === 200).length;
      const safeLosers = results.filter(result => result.status === 409 && result.body.code === 'PAGE_SHARE_CONFLICT').length;
      return { pass: winners >= 1 && winners + safeLosers === results.length && audits === winners && new Set(ids).size === winners,
        statuses: results.map(result => result.status), codes: results.map(result => result.body.code || result.body.error || null),
        winners, safeLosers, auditRows: audits, uniquePostIds: new Set(ids).size };
    });
    await addRace('simultaneous operations against same destination', async () => {
      const results = await Promise.all([
        share(actors.admin, sourceA.id, pageB.id, 'same-destination-a'),
        share(actors.admin, sourceC.id, pageB.id, 'same-destination-c', actors.admin.secondary),
      ]);
      const audits = await admin.pageAuditEvent.count({ where: { id: { in: results.map(result => result.requestKey) } } });
      const winners = results.filter(result => result.status === 200).length;
      const safeLosers = results.filter(result => result.status === 409 && result.body.code === 'PAGE_SHARE_CONFLICT').length;
      return { pass: winners >= 1 && winners + safeLosers === results.length && audits === winners,
        statuses: results.map(result => result.status), codes: results.map(result => result.body.code || result.body.error || null), auditRows: audits };
    });
    await addRace('opposite Page lock order A-to-B and B-to-A', async () => {
      const results = await Promise.all([
        share(actors.admin, sourceA.id, pageB.id, 'opposite-a-b'),
        share(actors.owner, sourceB.id, pageA.id, 'opposite-b-a', actors.owner.secondary),
      ]);
      const winners = results.filter(result => result.status === 200).length;
      const safeLosers = results.filter(result => result.status === 409 && result.body.code === 'PAGE_SHARE_CONFLICT').length;
      return { pass: winners >= 1 && winners + safeLosers === results.length && results.every(result => !result.transport),
        statuses: results.map(result => result.status), codes: results.map(result => result.body.code || result.body.error || null),
        transports: results.map(result => result.transport || null) };
    });

    Object.assign(process.env, { DATABASE_URL: runtimeUrl, DIRECT_URL: directUrl, NODE_ENV: 'test', PAGES_ENABLED: 'true',
      PAGES_RLS_CONTEXT_KEY_ID: 'rc3-ephemeral', PAGES_RLS_CONTEXT_SIGNING_KEY: signingKey, PAGES_PERF_TELEMETRY: 'true' });
    const { runWithPageSystemContext } = serverRequire('./dist/pages/pageDatabaseContext.js');
    const { pageTransaction, lockPage } = serverRequire('./dist/pages/pageService.js');
    const runtimePrisma = serverRequire('./dist/prisma.js').default;
    const systemPageMutation = (pageId, mutate) => runWithPageSystemContext(() => pageTransaction(async tx => {
      await lockPage(tx, pageId); return mutate(tx);
    }, 'ReadCommitted'));
    const resetPage = async pageId => systemPageMutation(pageId, tx => tx.page.update({ where: { id: pageId }, data: {
      publicationState: 'PUBLISHED', platformState: 'NONE', safetyHiddenAt: null, deletionRequestedAt: null, purgedAt: null,
    } }));
    const recordOrderedRace = async (name, spec, evaluate) => addRace(name, async () => {
      const outcome = await withPageBarrier(Pg, directUrl, observer, spec);
      const evaluated = await evaluate(outcome);
      return { ...evaluated, waitObserved: outcome.waitObserved, orderedDurationMs: outcome.durationMs,
        first: { status: outcome.first?.status ?? 'SIGNED_TX', code: outcome.first?.body?.code || outcome.first?.body?.error || null },
        second: { status: outcome.second?.status ?? 'SIGNED_TX', code: outcome.second?.body?.code || outcome.second?.body?.error || null } };
    });

    await resetPage(pageB.id);
    await recordOrderedRace('share wins before destination PUBLISHED-to-UNPUBLISHED', {
      name: 'share_before_destination_unpublish', pageId: pageB.id, blockerMode: 'exclusive',
      first: () => share(actors.admin, sourceA.id, pageB.id, 'before-unpublish'),
      second: () => actors.admin.secondary.request(`/pages/manage/${pageB.id}/lifecycle`, 'POST', { action: 'unpublish' }),
    }, async ({ first, second }) => ({ pass: first.status === 200 && second.status === 200 &&
      (await admin.page.findUnique({ where: { id: pageB.id }, select: { publicationState: true } })).publicationState === 'UNPUBLISHED' }));
    await resetPage(pageB.id);
    await recordOrderedRace('destination unpublish wins before share', {
      name: 'destination_unpublish_before_share', pageId: pageB.id, blockerMode: 'shared',
      first: () => actors.admin.client.request(`/pages/manage/${pageB.id}/lifecycle`, 'POST', { action: 'unpublish' }),
      second: () => share(actors.admin, sourceA.id, pageB.id, 'after-unpublish', actors.admin.secondary),
    }, async ({ first, second }) => ({ pass: first.status === 200 && [403, 404, 409].includes(second.status) && !await auditExists(second.requestKey) }));

    await resetPage(pageB.id); await resetPage(pageA.id); await admin.pageBlock.deleteMany({ where: { pageId: pageA.id, userId: actors.admin.id } });
    await recordOrderedRace('share wins before source Page block', {
      name: 'share_before_block', pageId: pageA.id, blockerMode: 'exclusive',
      first: () => share(actors.admin, sourceA.id, pageB.id, 'before-block'),
      second: () => actors.owner.secondary.request(`/pages/manage/${pageA.id}/blocks`, 'POST', { userId: actors.admin.id, blocked: true }),
    }, async ({ first, second }) => ({ pass: first.status === 200 && second.status === 200 && await auditExists(first.requestKey) }));
    await admin.pageBlock.deleteMany({ where: { pageId: pageA.id, userId: actors.admin.id } });
    await recordOrderedRace('source Page block wins before share', {
      name: 'block_before_share', pageId: pageA.id, blockerMode: 'shared',
      first: () => actors.owner.client.request(`/pages/manage/${pageA.id}/blocks`, 'POST', { userId: actors.admin.id, blocked: true }),
      second: () => share(actors.admin, sourceA.id, pageB.id, 'after-block', actors.admin.secondary),
    }, async ({ first, second }) => ({ pass: first.status === 200 && [403, 404].includes(second.status) && !await auditExists(second.requestKey) }));
    await recordOrderedRace('source Page unblock wins before share', {
      name: 'unblock_before_share', pageId: pageA.id, blockerMode: 'shared',
      first: () => actors.owner.client.request(`/pages/manage/${pageA.id}/blocks`, 'POST', { userId: actors.admin.id, blocked: false }),
      second: () => share(actors.admin, sourceA.id, pageB.id, 'after-unblock', actors.admin.secondary),
    }, async ({ first, second }) => ({ pass: first.status === 200 && second.status === 200 && await auditExists(second.requestKey) }));
    await actors.owner.client.request(`/pages/manage/${pageA.id}/blocks`, 'POST', { userId: actors.admin.id, blocked: true });
    await recordOrderedRace('blocked share loses before subsequent unblock', {
      name: 'blocked_share_before_unblock', pageId: pageA.id, blockerMode: 'exclusive',
      first: () => share(actors.admin, sourceA.id, pageB.id, 'blocked-before-unblock'),
      second: () => actors.owner.secondary.request(`/pages/manage/${pageA.id}/blocks`, 'POST', { userId: actors.admin.id, blocked: false }),
    }, async ({ first, second }) => ({ pass: [403, 404].includes(first.status) && second.status === 200 && !await auditExists(first.requestKey) }));

    await admin.pageMembership.upsert({ where: { pageId_userId: { pageId: pageB.id, userId: actors.editor.id } },
      create: { pageId: pageB.id, userId: actors.editor.id, role: 'EDITOR' }, update: { role: 'EDITOR' } });
    await recordOrderedRace('member share wins before removal', {
      name: 'share_before_member_removal', pageId: pageB.id, blockerMode: 'exclusive',
      first: () => share(actors.editor, sourceA.id, pageB.id, 'before-member-removal'),
      second: () => actors.admin.secondary.request(`/pages/manage/${pageB.id}/team/${actors.editor.id}`, 'PATCH', { role: null }),
    }, async ({ first, second }) => ({ pass: first.status === 200 && second.status === 200 && await auditExists(first.requestKey) }));
    await admin.pageMembership.upsert({ where: { pageId_userId: { pageId: pageB.id, userId: actors.editor.id } },
      create: { pageId: pageB.id, userId: actors.editor.id, role: 'EDITOR' }, update: { role: 'EDITOR' } });
    await recordOrderedRace('member removal wins before share', {
      name: 'member_removal_before_share', pageId: pageB.id, blockerMode: 'shared',
      first: () => actors.admin.client.request(`/pages/manage/${pageB.id}/team/${actors.editor.id}`, 'PATCH', { role: null }),
      second: () => share(actors.editor, sourceA.id, pageB.id, 'after-member-removal', actors.editor.secondary),
    }, async ({ first, second }) => ({ pass: first.status === 200 && [403, 404].includes(second.status) && !await auditExists(second.requestKey) }));

    await admin.pageMembership.deleteMany({ where: { pageId: pageB.id, userId: actors.candidate.id } });
    await recordOrderedRace('member addition wins before share', {
      name: 'member_addition_before_share', pageId: pageB.id, blockerMode: 'shared',
      first: () => systemPageMutation(pageB.id, tx => tx.pageMembership.create({ data: { pageId: pageB.id, userId: actors.candidate.id, role: 'EDITOR' } })),
      second: () => share(actors.candidate, sourceA.id, pageB.id, 'after-member-addition', actors.candidate.secondary),
    }, async ({ second }) => ({ pass: second.status === 200 && await auditExists(second.requestKey) }));
    await admin.pageMembership.deleteMany({ where: { pageId: pageB.id, userId: actors.candidate.id } });
    await recordOrderedRace('unauthorized share loses before member addition', {
      name: 'share_before_member_addition', pageId: pageB.id, blockerMode: 'exclusive',
      first: () => share(actors.candidate, sourceA.id, pageB.id, 'before-member-addition'),
      second: () => systemPageMutation(pageB.id, tx => tx.pageMembership.create({ data: { pageId: pageB.id, userId: actors.candidate.id, role: 'EDITOR' } })),
    }, async ({ first }) => ({ pass: [403, 404].includes(first.status) && !await auditExists(first.requestKey) }));

    await admin.pageMembership.upsert({ where: { pageId_userId: { pageId: pageB.id, userId: actors.editor.id } },
      create: { pageId: pageB.id, userId: actors.editor.id, role: 'EDITOR' }, update: { role: 'EDITOR' } });
    await recordOrderedRace('role downgrade wins before editor share', {
      name: 'role_downgrade_before_share', pageId: pageB.id, blockerMode: 'shared',
      first: () => actors.admin.client.request(`/pages/manage/${pageB.id}/team/${actors.editor.id}`, 'PATCH', { role: 'ANALYST' }),
      second: () => share(actors.editor, sourceA.id, pageB.id, 'after-role-downgrade', actors.editor.secondary),
    }, async ({ first, second }) => ({ pass: first.status === 200 && [403, 404].includes(second.status) && !await auditExists(second.requestKey) }));
    await admin.pageMembership.update({ where: { pageId_userId: { pageId: pageB.id, userId: actors.editor.id } }, data: { role: 'EDITOR' } });
    await recordOrderedRace('editor share wins before role downgrade', {
      name: 'share_before_role_downgrade', pageId: pageB.id, blockerMode: 'exclusive',
      first: () => share(actors.editor, sourceA.id, pageB.id, 'before-role-downgrade'),
      second: () => actors.admin.secondary.request(`/pages/manage/${pageB.id}/team/${actors.editor.id}`, 'PATCH', { role: 'ANALYST' }),
    }, async ({ first, second }) => ({ pass: first.status === 200 && second.status === 200 && await auditExists(first.requestKey) }));

    await resetPage(pageA.id);
    await recordOrderedRace('source visibility change wins before share', {
      name: 'source_visibility_before_share', pageId: pageA.id, blockerMode: 'shared',
      first: () => systemPageMutation(pageA.id, tx => tx.post.update({ where: { id: sourceA.id }, data: { status: 'DRAFT' } })),
      second: () => share(actors.admin, sourceA.id, pageB.id, 'after-source-draft', actors.admin.secondary),
    }, async ({ second }) => ({ pass: [403, 404].includes(second.status) && !await auditExists(second.requestKey) }));
    await admin.post.update({ where: { id: sourceA.id }, data: { status: 'PUBLISHED', isDeleted: false } });

    const deletionSourcePage = await createPublishedPage(actors.owner, 'DeleteSource');
    const deletionSourcePost = expectStatus(await actors.owner.client.request('/posts', 'POST', postPayload('rc3-delete-source', 'PUBLISHED',
      { pageId: deletionSourcePage.id, pageCreateKey: crypto.randomUUID() })), [200, 201], 'delete source post').body;
    await recordOrderedRace('source Page deletion wins before share', {
      name: 'source_delete_before_share', pageId: deletionSourcePage.id, blockerMode: 'shared',
      first: () => actors.owner.client.request(`/pages/manage/${deletionSourcePage.id}/lifecycle`, 'POST', { action: 'delete' }),
      second: () => share(actors.admin, deletionSourcePost.id, pageB.id, 'after-source-delete', actors.admin.secondary),
    }, async ({ first, second }) => ({ pass: first.status === 200 && [403, 404, 409].includes(second.status) && !await auditExists(second.requestKey) }));

    const deletionDestination = await createPublishedPage(actors.admin, 'DeleteDestination');
    await recordOrderedRace('destination Page deletion wins before share', {
      name: 'destination_delete_before_share', pageId: deletionDestination.id, blockerMode: 'shared',
      first: () => actors.admin.client.request(`/pages/manage/${deletionDestination.id}/lifecycle`, 'POST', { action: 'delete' }),
      second: () => share(actors.admin, sourceA.id, deletionDestination.id, 'after-destination-delete', actors.admin.secondary),
    }, async ({ first, second }) => ({ pass: first.status === 200 && [403, 404, 409].includes(second.status) && !await auditExists(second.requestKey) }));

    const suspendedSource = await createPublishedPage(actors.owner, 'SuspendSource');
    const suspendedSourcePost = expectStatus(await actors.owner.client.request('/posts', 'POST', postPayload('rc3-suspend-source', 'PUBLISHED',
      { pageId: suspendedSource.id, pageCreateKey: crypto.randomUUID() })), [200, 201], 'suspend source post').body;
    await recordOrderedRace('source Page deactivation/suspension wins before share', {
      name: 'source_suspend_before_share', pageId: suspendedSource.id, blockerMode: 'shared',
      first: () => systemPageMutation(suspendedSource.id, tx => tx.page.update({ where: { id: suspendedSource.id }, data: { platformState: 'SUSPENDED' } })),
      second: () => share(actors.admin, suspendedSourcePost.id, pageB.id, 'after-source-suspend', actors.admin.secondary),
    }, async ({ second }) => ({ pass: [403, 404, 409].includes(second.status) && !await auditExists(second.requestKey) }));
    const suspendedDestination = await createPublishedPage(actors.admin, 'SuspendDestination');
    await recordOrderedRace('destination Page deactivation/suspension wins before share', {
      name: 'destination_suspend_before_share', pageId: suspendedDestination.id, blockerMode: 'shared',
      first: () => systemPageMutation(suspendedDestination.id, tx => tx.page.update({ where: { id: suspendedDestination.id }, data: { platformState: 'SUSPENDED' } })),
      second: () => share(actors.admin, sourceA.id, suspendedDestination.id, 'after-destination-suspend', actors.admin.secondary),
    }, async ({ second }) => ({ pass: [403, 404, 409].includes(second.status) && !await auditExists(second.requestKey) }));

    const allRacePass = report.races.every(race => race.pass);
    report.checks.push({ name: 'real PostgreSQL share/comment/vote-erasure/lifecycle/block/membership/delete/deactivate race matrix', pass: allRacePass,
      passed: report.races.filter(race => race.pass).length, total: report.races.length });
    const sourceACounters = await admin.post.findUnique({ where: { id: sourceA.id }, select: { sharesCount: true } });
    const sourceAActualShares = await admin.post.count({ where: { sharedFromId: sourceA.id, isDeleted: false } });
    report.integrity = {
      duplicateAuditRequestKeys: (await observer.query(`SELECT count(*)::int AS count FROM (SELECT id FROM "PageAuditEvent" GROUP BY id HAVING count(*) > 1) duplicates`)).rows[0].count,
      idleInTransactionAtEnd: (await observer.query(`SELECT count(*)::int AS count FROM pg_stat_activity WHERE usename='pages_rc3_runtime' AND state='idle in transaction'`)).rows[0].count,
      deadlocks: Number((await observer.query(`SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()`)).rows[0].deadlocks),
      sourceASharesCount: sourceACounters?.sharesCount ?? null, sourceAActualShares,
    };
    report.checks.push({ name: 'no duplicate audit keys, no idle transaction leak, no deadlock', pass:
      report.integrity.duplicateAuditRequestKeys === 0 && report.integrity.idleInTransactionAtEnd === 0 &&
      report.integrity.deadlocks === 0 && report.integrity.sourceASharesCount === report.integrity.sourceAActualShares });
    report.boundedPrecheck = draftPass && allRacePass && report.checks.at(-1).pass
      ? { status: 'ELIGIBLE_NOT_STARTED_BY_MATRIX_HARNESS' }
      : { status: 'NOT_RUN_CORRECTNESS_GATE_RED', users10: 'NOT_RUN', users25: 'NOT_RUN' };
    report.fullP35 = { status: 'NOT_RUN', justified: report.checks.every(check=>check.pass),
      reason: 'This isolated correctness/recovery harness does not run hosted P35; exact final-SHA GitHub receipt is required separately.' };
    await runtimePrisma.$disconnect();

    const log = `${fs.readFileSync(apiLogPath, 'utf8')}\n${fs.readFileSync(path.join(evidenceDir, 'api-secondary.log'), 'utf8')}`;
    const events = log.split(/\r?\n/).flatMap(line => { try { const value = JSON.parse(line); return value?.event ? [value] : []; } catch { return []; } });
    const metric = (event, field) => {
      const values = events.filter(row => row.event === event && Number.isFinite(row[field])).map(row => row[field]).sort((a, b) => a - b);
      return { count: values.length, p50Ms: values.length ? values[Math.ceil(values.length * .5) - 1] : null,
        p95Ms: values.length ? values[Math.ceil(values.length * .95) - 1] : null, maxMs: values.at(-1) ?? null };
    };
    report.performancePhases = {
      poolAcquisition: metric('pages_transaction_phase', 'acquireWaitMs'), rlsSetup: metric('pages_transaction_phase', 'rlsSetupMs'),
      protectedBody: metric('pages_transaction_phase', 'protectedBodyMs'), commitEnd: metric('pages_transaction_phase', 'commitEndMs'),
      transactionTotal: metric('pages_transaction_phase', 'totalMs'), advisoryWait: metric('pages_advisory_lock', 'durationMs'),
      localAdmissionWait: metric('pages_local_admission', 'waitMs'), postCommitHydration: metric('pages_share_hydration', 'durationMs'),
      requestTotal: metric('http_request_completed', 'durationMs'),
    };
  } finally {
    for (const client of clients) client.close();
    if (observer) await observer.end().catch(() => {});
    if (admin) await admin.$disconnect().catch(() => {});
    if (api && !api.killed) api.kill();
    if (api2 && !api2.killed) api2.kill();
    if (apiLog !== undefined) fs.closeSync(apiLog);
    if (apiLog2 !== undefined) fs.closeSync(apiLog2);
    if (embedded) await embedded.stop().catch(error => { report.cleanupError = safeError(error); });
    report.cleanup = 'OWN_DISPOSABLE_CLUSTER_STOPPED';
  }
}

main().then(() => { report.status = report.checks.every(check => check.pass) ? 'PASS' : 'FAIL'; if (report.status === 'FAIL') process.exitCode = 1; })
  .catch(error => { report.status = 'FAIL'; report.failure = { ...safeError(error), detail: String(error?.detail || '').slice(0, 1000) }; process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString(); save(); process.stdout.write(`${JSON.stringify({ status: report.status, receipt: receiptPath })}\n`); });
