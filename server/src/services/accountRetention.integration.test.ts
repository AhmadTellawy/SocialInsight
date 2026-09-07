import assert from 'node:assert/strict';
import test, { after, before, mock } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { setImmediate as yieldToIO } from 'node:timers/promises';
import type { AccountCleanupJob, Prisma } from '@prisma/client';

// Explicit-only integration suite: reject every target except the disposable
// settings fixture before importing Prisma or any service with database access.
for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
  const target = new URL(process.env[name] || 'http://invalid');
  assert.equal(target.protocol, 'postgresql:');
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.port, '55447');
  assert.equal(target.pathname, '/settings_test');
  for (const key of target.searchParams.keys()) {
    assert.ok(['schema', 'connection_limit', 'pool_timeout'].includes(key), 'No connection target overrides permitted');
  }
  assert.equal(target.searchParams.get('schema') || 'public', 'public');
}
process.env.NODE_ENV = 'test';
process.env.AUTH_COOKIE_SECURE = 'false';
const prisma = require('../prisma').default as typeof import('../prisma').default;
const { runAgeGroupComputation } = require('./cronService') as typeof import('./cronService');
const { cleanupExpiredAuthArtifacts } = require('./authRetentionService') as typeof import('./authRetentionService');
const { deleteAccount } = require('../controllers/accountLifecycleController') as typeof import('../controllers/accountLifecycleController');
const { calculateAgeGroupFromDate } = require('../utils/profileValidation') as typeof import('../utils/profileValidation');
const cleanupWorker = require('./accountCleanupService') as typeof import('./accountCleanupService');

const prefix = `0000_retention_${randomUUID().replace(/-/g, '')}`;
const userIds: string[] = [];
const postIds: string[] = [];
const cleanupUserIds: string[] = [];
const timeoutMs = 4_000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

async function bounded<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

// Probes only observe/defer calls to the real Prisma transaction. No SQL,
// transaction result, lock, or account state is replaced with a fake result.
function probeTransactions(decorate: (tx: Prisma.TransactionClient) => Promise<Prisma.TransactionClient>) {
  const original = prisma.$transaction;
  (prisma as any).$transaction = function (input: any, ...options: any[]) {
    const operation = typeof input === 'function'
      ? async (tx: Prisma.TransactionClient) => input(await decorate(tx))
      : input;
    return Reflect.apply(original, prisma, [operation, ...options]);
  };
  let restored = false;
  return { restore() { if (!restored) { (prisma as any).$transaction = original; restored = true; } } };
}

async function backendPid(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
  return rows[0].pid;
}

async function assertDatabaseBlocking(waiter: number, blocker: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT ${blocker}::integer = ANY(pg_blocking_pids(${waiter}::integer)) AS blocked
    `;
    if (rows[0].blocked) return;
    // Yield while polling the database's actual wait graph, never assume that
    // elapsed time means the competing transaction reached a particular query.
    await yieldToIO();
  }
  assert.fail('PostgreSQL never reported deletion blocked by the cron transaction');
}

async function createUser(suffix: string, birthday: Date | null = new Date('1996-01-01T00:00:00Z'), status = 'ACTIVE') {
  const id = `${prefix}_${suffix}`;
  userIds.push(id);
  await prisma.user.create({ data: { id, name: 'Synthetic retention fixture', handle: id, birthday, status } });
  return id;
}

async function deletionRequest(userId: string) {
  const session = await prisma.authSession.create({ data: {
    userId, tokenHash: randomBytes(32).toString('hex'), csrfHash: randomBytes(32).toString('hex'),
    expiresAt: new Date(Date.now() + 3_600_000), recentAuthenticatedAt: new Date(),
  } });
  return { user: { userId, authMode: 'session' }, authSession: session } as any;
}

async function deleteFixture(req: any) {
  const state = { status: 200, body: undefined as any };
  const response: any = {
    status(value: number) { state.status = value; return response; },
    json(value: any) { state.body = value; return response; },
    set() { return response; },
    setHeader() { return response; },
  };
  await deleteAccount(req, response);
  return state;
}

async function assertDeleted(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  assert.equal(user.status, 'DELETED');
  assert.equal(user.birthday, null);
  assert.equal(await prisma.userDemographics.count({ where: { userId } }), 0);
}

before(async () => {
  // No app/server import or scheduler: only this fixture's lifecycle is driven.
  // Background storage work has separate coverage; the durable job stays real.
  mock.method(cleanupWorker, 'resumeAccountCleanupJobs', async () => 0);
  const rows = await prisma.$queryRaw<Array<{ database: string; port: number }>>`
    SELECT current_database() AS database, inet_server_port() AS port
  `;
  assert.equal(rows[0].database, 'settings_test');
  assert.equal(rows[0].port, 55447);
});

after(async () => {
  mock.restoreAll();
  try {
    // Exact IDs, including partially constructed fixtures. No broad reset,
    // TRUNCATE, prefix deletion, or deletion of another suite's synthetic rows.
    await prisma.$transaction([
      prisma.answer.deleteMany({ where: { response: { postId: { in: postIds } } } }),
      prisma.response.deleteMany({ where: { postId: { in: postIds } } }),
      prisma.question.deleteMany({ where: { postId: { in: postIds } } }),
      prisma.post.deleteMany({ where: { id: { in: postIds } } }),
      prisma.userDemographics.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.authSession.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.accountCleanupJob.deleteMany({ where: { userId: { in: [...userIds, ...cleanupUserIds] } } }),
      prisma.user.deleteMany({ where: { id: { in: userIds } } }),
    ]);
    assert.equal(await prisma.user.count({ where: { id: { in: userIds } } }), 0);
    assert.equal(await prisma.post.count({ where: { id: { in: postIds } } }), 0);
    assert.equal(await prisma.accountCleanupJob.count({ where: { userId: { in: [...userIds, ...cleanupUserIds] } } }), 0);
  } finally { await prisma.$disconnect(); }
});

// Deletion must wait for an earlier age-cache user lock and must not leave
// resurrected demographics, including after a supported conflict/retry.
test('finding-resolution:SI-AS-D04-001', async t => {
  const userId = await createUser('a_cron_first');
  await prisma.userDemographics.create({ data: { userId, ageGroup: 'Under 18', nationality: 'Jordan' } });
  const req = await deletionRequest(userId);
  const locked = deferred<number>();
  const release = deferred<void>();
  let paused = false;
  const cronProbe = probeTransactions(async tx => new Proxy(tx, {
    get(target, property) {
      if (property === '$queryRaw') return async (...args: any[]) => {
        const rows = await Reflect.apply(target.$queryRaw, target, args);
        if (!paused && Array.isArray(rows) && rows.some(row => row.id === userId)) {
          paused = true;
          locked.resolve(await backendPid(target));
          await release.promise;
        }
        return rows;
      };
      return Reflect.get(target, property);
    },
  }));
  const cron = runAgeGroupComputation();
  void cron.catch(() => {});
  let deletion: ReturnType<typeof deleteFixture> | undefined;
  let deletionProbe: ReturnType<typeof probeTransactions> | undefined;
  try {
    const cronPid = await bounded(locked.promise, 'Cron did not select the target fixture');
    cronProbe.restore();
    const started = deferred<number>();
    deletionProbe = probeTransactions(async tx => { started.resolve(await backendPid(tx)); return tx; });
    deletion = deleteFixture(req);
    const deletionPid = await bounded(started.promise, 'Deletion did not begin its transaction');
    deletionProbe.restore();
    await assertDatabaseBlocking(deletionPid, cronPid);
    t.diagnostic('Observed pg_blocking_pids: deletion waited for the cron transaction before the age-cache write was released.');
    release.resolve();
    await cron;
    let result = await deletion;
    if (result.status === 409) {
      assert.equal(result.body.code, 'ACCOUNT_CONFLICT');
      t.diagnostic('PostgreSQL serializable conflict was surfaced as ACCOUNT_CONFLICT; retried the authorized deletion after cron committed.');
      result = await deleteFixture(req);
    }
    assert.equal(result.status, 200, JSON.stringify(result.body));
    await assertDeleted(userId);
    await runAgeGroupComputation();
    await assertDeleted(userId);
  } finally {
    cronProbe.restore();
    deletionProbe?.restore();
    release.resolve();
    await Promise.allSettled([cron, ...(deletion ? [deletion] : [])]);
  }
});

test('SI-AS-D04-001: cron skips a deletion-held user lock and does not rebuild demographics after deletion commits', async t => {
  const userId = await createUser('b_deletion_first');
  await prisma.userDemographics.create({ data: { userId, ageGroup: 'Under 18' } });
  const req = await deletionRequest(userId);
  const locked = deferred<number>();
  const release = deferred<void>();
  const deletionProbe = probeTransactions(async tx => new Proxy(tx, {
    get(target, property) {
      if (property === 'userDemographics') return new Proxy(target.userDemographics, {
        get(model, method) {
          if (method === 'deleteMany') return async (args: any) => {
            const result = await model.deleteMany(args);
            if (args.where?.userId === userId) {
              locked.resolve(await backendPid(target));
              await release.promise;
            }
            return result;
          };
          return Reflect.get(model, method);
        },
      });
      return Reflect.get(target, property);
    },
  }));
  const deletion = deleteFixture(req);
  let cron: ReturnType<typeof runAgeGroupComputation> | undefined;
  try {
    await bounded(locked.promise, 'Deletion did not reach its demographics deletion barrier');
    deletionProbe.restore();
    // MVCC still exposes the original active row to a separate connection.
    const visible = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assert.equal(visible.status, 'ACTIVE');
    assert.ok(visible.birthday);
    cron = runAgeGroupComputation();
    void cron.catch(() => {});
    await bounded(cron, 'Cron waited on a user row held by deletion instead of skipping it');
    t.diagnostic('Cron finished while deletion remained at an explicit pre-commit barrier; the committed ACTIVE/DOB row was still visible to other connections.');
    release.resolve();
    const result = await deletion;
    assert.equal(result.status, 200, JSON.stringify(result.body));
    await assertDeleted(userId);
    await runAgeGroupComputation();
    await assertDeleted(userId);
  } finally {
    deletionProbe.restore();
    release.resolve();
    await Promise.allSettled([deletion, ...(cron ? [cron] : [])]);
  }
});

test('SI-AS-D04-001: age refresh crosses the 500-user batch boundary, creates missing cache rows and preserves non-age demographics', async () => {
  const birthday = new Date('1996-01-01T00:00:00Z');
  const ids = Array.from({ length: 505 }, (_, index) => `${prefix}_z_bulk_${String(index).padStart(3, '0')}`);
  userIds.push(...ids);
  await prisma.user.createMany({ data: ids.map(id => ({ id, name: 'Synthetic age fixture', handle: id, birthday, status: 'ACTIVE' })) });
  await prisma.userDemographics.create({ data: { userId: ids[0], ageGroup: 'Under 18', nationality: 'Jordan', gender: 'Female' } });
  const excluded = await Promise.all([
    createUser('x_no_dob', null), createUser('x_deactivated', birthday, 'DEACTIVATED'),
    createUser('x_deleted', birthday, 'DELETED'), createUser('x_suspended', birthday, 'SUSPENDED'),
  ]);
  await runAgeGroupComputation();
  const cache = await prisma.userDemographics.findMany({ where: { userId: { in: ids } }, orderBy: { userId: 'asc' } });
  assert.equal(cache.length, 505);
  for (const row of cache) assert.equal(row.ageGroup, calculateAgeGroupFromDate(birthday));
  assert.equal(cache[0].nationality, 'Jordan');
  assert.equal(cache[0].gender, 'Female');
  assert.equal(await prisma.userDemographics.count({ where: { userId: { in: excluded } } }), 0);
  await runAgeGroupComputation();
  assert.deepEqual(await prisma.userDemographics.findMany({ where: { userId: { in: ids } }, orderBy: { userId: 'asc' } }), cache,
    'An unchanged second refresh must not rewrite the cache or its timestamps');
});

// Clear expired proofs (including exact expiry), retain valid proofs and the
// response/answer graph, and make an identical second cleanup a no-op.
test('finding-resolution:SI-AS-E05-004', async () => {
  const now = new Date();
  const authorId = await createUser('proof_author', null);
  const postId = `${prefix}_proof_post`;
  postIds.push(postId);
  const post = await prisma.post.create({ data: {
    id: postId, authorId, title: 'Synthetic guest proof retention', description: '', type: 'Survey',
    expiresAt: new Date(now.getTime() + 86_400_000), questions: { create: { text: 'Retained synthetic answer', type: 'Text' } },
  }, include: { questions: true } });
  const scenarios = [
    { name: 'expired', expiry: new Date(now.getTime() - 1), hash: randomBytes(32).toString('hex'), clear: true },
    { name: 'boundary', expiry: now, hash: randomBytes(32).toString('hex'), clear: true },
    { name: 'valid', expiry: new Date(now.getTime() + 1), hash: randomBytes(32).toString('hex'), clear: false },
    { name: 'already_clear', expiry: null, hash: null, clear: false },
  ];
  const responses = await Promise.all(scenarios.map(scenario => prisma.response.create({ data: {
    postId, guestId: `${prefix}_${scenario.name}`, guestProofHash: scenario.hash, guestProofExpiresAt: scenario.expiry,
    isAnonymous: true, answers: { create: { questionId: post.questions[0].id, textValue: `Synthetic ${scenario.name} answer` } },
  }, include: { answers: true } })));
  const first = await cleanupExpiredAuthArtifacts(now);
  assert.ok(first.guestProofs >= 2);
  for (let index = 0; index < responses.length; index++) {
    const before = responses[index];
    const current: typeof before = await prisma.response.findUniqueOrThrow({ where: { id: before.id }, include: { answers: true } });
    assert.deepEqual(current, { ...before, ...(scenarios[index].clear ? { guestProofHash: null, guestProofExpiresAt: null } : {}) });
  }
  const repeated = await cleanupExpiredAuthArtifacts(now);
  assert.equal(repeated.guestProofs, 0);
  assert.equal(await prisma.response.count({ where: { postId } }), scenarios.length);
  assert.equal(await prisma.answer.count({ where: { response: { postId } } }), scenarios.length);
});

test('SI-AS-E05-004: only cleanup jobs completed more than 24 hours ago are purged; pending jobs and exact-boundary completions survive', async () => {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 86_400_000);
  const scenarios = [
    { name: 'old_completed', completedAt: new Date(cutoff.getTime() - 1), purge: true },
    { name: 'boundary_completed', completedAt: cutoff, purge: false },
    { name: 'recent_completed', completedAt: new Date(cutoff.getTime() + 1), purge: false },
    { name: 'old_pending', completedAt: null, purge: false },
  ];
  const jobs: AccountCleanupJob[] = [];
  for (const scenario of scenarios) {
    const userId = `${prefix}_cleanup_${scenario.name}`;
    cleanupUserIds.push(userId);
    jobs.push(await prisma.accountCleanupJob.create({ data: {
      userId, completedAt: scenario.completedAt, mediaIds: scenario.completedAt ? [] : [`${prefix}_pending_media`],
      attempts: 8, createdAt: new Date(cutoff.getTime() - 7 * 86_400_000), updatedAt: new Date(cutoff.getTime() - 2 * 86_400_000),
    } }));
  }
  const first = await cleanupExpiredAuthArtifacts(now);
  assert.ok(first.completedCleanupJobs >= 1);
  for (let index = 0; index < jobs.length; index++) {
    const current: AccountCleanupJob | null = await prisma.accountCleanupJob.findUnique({ where: { id: jobs[index].id } });
    assert.deepEqual(current, scenarios[index].purge ? null : jobs[index]);
  }
  assert.equal((await cleanupExpiredAuthArtifacts(now)).completedCleanupJobs, 0);
});
