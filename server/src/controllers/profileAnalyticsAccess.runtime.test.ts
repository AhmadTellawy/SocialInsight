import assert from 'node:assert/strict';
import test, { after } from 'node:test';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'synthetic-profile-analytics-test-secret';
if (process.env.PROFILE_ANALYTICS_LOCAL_DB) {
  const localDb = new URL(process.env.PROFILE_ANALYTICS_LOCAL_DB);
  assert.equal(localDb.protocol, 'postgresql:');
  assert.equal(localDb.hostname, '127.0.0.1');
  assert.equal(localDb.port, '55439');
  assert.equal(localDb.pathname, '/postgres');
  process.env.DATABASE_URL = process.env.PROFILE_ANALYTICS_LOCAL_DB;
}
const prisma = require('../prisma').default as typeof import('../prisma').default;
// Optional baseline replay executes the preserved repository controller with its
// original module path, without overwriting another agent's current source.
const loadController = () => {
  if (!process.env.PROFILE_ANALYTICS_BASELINE_FILE) return require('./userController');
  const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
  const filename = require.resolve('./userController');
  const baseline = new Module(filename, module);
  baseline.filename = filename;
  baseline.paths = Module._nodeModulePaths(path.dirname(filename));
  const source = fs.readFileSync(process.env.PROFILE_ANALYTICS_BASELINE_FILE, 'utf8');
  baseline._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, esModuleInterop: true } }).outputText, filename);
  return baseline.exports;
};
const { getUserAnalytics } = loadController() as typeof import('./userController');
const { PrivacyService } = require('../services/privacyService') as typeof import('../services/privacyService');
const { buildProfileAnalyticsPostWhere, getProfileAnalytics, PROFILE_ANALYTICS_BATCH_SIZE } = require('../services/profileAnalyticsAccess') as typeof import('../services/profileAnalyticsAccess');
after(async () => { await prisma.$disconnect(); });

const response = () => {
  const state: { status: number; body?: any } = { status: 200 };
  const res: any = { status(code: number) { state.status = code; return res; }, json(body: any) { state.body = body; return res; } };
  return { state, res };
};

test('regression: missing authentication is rejected before analytics reads', async () => {
  const originalRaw = prisma.$queryRaw, originalUser = prisma.user.findUnique;
  let reads = 0;
  try {
    (prisma.user as any).findUnique = async () => { reads++; return { isPrivate: false }; };
    (prisma as any).$queryRaw = async () => { reads++; return []; };
    const { state, res } = response();
    await getUserAnalytics({ params: { id: 'owner' } } as any, res);
    assert.equal(state.status, 401);
    assert.equal(reads, 0);
  } finally { (prisma as any).$queryRaw = originalRaw; (prisma.user as any).findUnique = originalUser; }
});

test('regression: profile aggregates never use an unscoped global raw query', async () => {
  const originalRaw = prisma.$queryRaw, originalTransaction = prisma.$transaction, originalPrivacy = PrivacyService.canViewUserContent;
  let unscopedReads = 0;
  try {
    PrivacyService.canViewUserContent = async () => true;
    (prisma as any).$queryRaw = async () => { unscopedReads++; return [{ type: 'Poll', country: 'Excluded', gender: 'Female', ageGroup: '25-34', count: BigInt(1) }]; };
    (prisma as any).$transaction = async () => ({ totalResponses: 0, byType: {}, byCountry: {}, byGender: {}, byAge: {} });
    const { state, res } = response();
    await getUserAnalytics({ params: { id: 'owner' }, user: { userId: 'viewer' } } as any, res);
    assert.equal(state.status, 200);
    assert.equal(unscopedReads, 0);
    assert.equal(state.body.totalResponses, 0);
  } finally { (prisma as any).$queryRaw = originalRaw; (prisma as any).$transaction = originalTransaction; PrivacyService.canViewUserContent = originalPrivacy; }
});

// This interpreter is intentionally limited to operators emitted by these
// policies. Unknown fields/operators throw; SQL NULL remains UNKNOWN under NOT.
// It is not a substitute for PostgreSQL/Prisma execution or query-plan testing.
type Truth = boolean | null;
type Row = Record<string, any>;
const all = (values: Truth[]): Truth => values.includes(false) ? false : values.includes(null) ? null : true;
const any = (values: Truth[]): Truth => values.includes(true) ? true : values.includes(null) ? null : false;
const negate = (value: Truth): Truth => value === null ? null : !value;
const list = (value: any): any[] => Array.isArray(value) ? value : [value];
const scalar = (value: any): any => value instanceof Date ? value.getTime() : value;
function fieldMatches(value: any, condition: any): Truth {
  if (condition === null) return value === null;
  if (typeof condition !== 'object' || condition instanceof Date) return value === null ? null : scalar(value) === scalar(condition);
  if (Array.isArray(value)) {
    return all(Object.entries(condition).map(([op, operand]) => {
      if (op === 'some') return value.some(row => matches(row, operand) === true);
      if (op === 'none') return !value.some(row => matches(row, operand) === true);
      if (op === 'every') return value.every(row => matches(row, operand) === true);
      throw new Error(`Unsupported collection operator ${op}`);
    }));
  }
  if ('is' in condition || 'isNot' in condition) {
    return all(Object.entries(condition).map(([op, operand]) => {
      const result = operand === null ? value === null : value !== null && matches(value, operand) === true;
      if (op === 'is') return result;
      if (op === 'isNot') return !result;
      throw new Error(`Unsupported relation operator ${op}`);
    }));
  }
  const operators = ['equals', 'not', 'in', 'notIn', 'gt', 'gte', 'lt', 'lte', 'mode'];
  if (Object.keys(condition).some(key => operators.includes(key))) {
    return all(Object.entries(condition).map(([op, operand]) => {
      if (op === 'mode') { assert.equal(operand, 'insensitive'); return true; }
      if (op === 'equals') return condition.mode === 'insensitive' && typeof value === 'string' && typeof operand === 'string'
        ? value.toLowerCase() === operand.toLowerCase() : fieldMatches(value, operand);
      if (op === 'not') return negate(fieldMatches(value, operand));
      if (value === null) return null;
      if (op === 'in') return (operand as any[]).includes(value);
      if (op === 'notIn') return !(operand as any[]).includes(value);
      if (op === 'gt') return scalar(value) > scalar(operand);
      if (op === 'gte') return scalar(value) >= scalar(operand);
      if (op === 'lt') return scalar(value) < scalar(operand);
      if (op === 'lte') return scalar(value) <= scalar(operand);
      throw new Error(`Unsupported scalar operator ${op}`);
    }));
  }
  return value === null ? false : matches(value, condition);
}
function matches(row: Row, where: any): Truth {
  assert.ok(row && typeof row === 'object', 'Expected a fixture row');
  return all(Object.entries(where).map(([key, value]) => {
    if (key === 'AND') return all(list(value).map(item => matches(row, item)));
    if (key === 'OR') return any(list(value).map(item => matches(row, item)));
    if (key === 'NOT') return all(list(value).map(item => negate(matches(row, item))));
    assert.ok(Object.prototype.hasOwnProperty.call(row, key), `Unsupported fixture field ${key}`);
    return fieldMatches(row[key], value);
  }));
}
const NOW = new Date('2026-09-14T00:00:00.000Z');
const author = (changes: Row = {}): Row => ({ id: 'owner', isPrivate: false, mediaPrivacyTarget: false, following: [], blockedBy: [], blocking: [], ...changes });
const group = (changes: Row = {}): Row => ({ isPublic: true, isDeleted: false, members: [], ...changes });
const post = (id: string, changes: Row = {}): Row => ({ id, authorId: 'owner',pageId:null, author: author(), isDeleted: false, status: 'PUBLISHED',
  groupId: null, group: null, targetedGroups: [], targetAudience: 'Public', hiddenBy: [], sharedFromId: null, sharedFrom: null,
  resultsWho: 'Public', resultsTiming: 'AnyTime', expiresAt: null, responses: [], type: 'Poll', ...changes });
const activeFollower = author({ following: [{ followerId: 'viewer', status: 'ACTIVE' }] });

const matrix: Array<{ name: string; item: Row; viewer?: string; allowed: boolean }> = [
  { name: 'public post', item: post('public'), allowed: true },
  { name: 'Page publishing never contributes to the internal actor personal analytics',item:post('page-source',{pageId:'page-1'}),viewer:'owner',allowed:false },
  // Preserve the existing individual-post visibility contract: SQL NOT true
  // excludes NULL here. This is a known availability limitation, not a new grant.
  { name: 'public author unset media transition retains legacy exclusion', item: post('public-null', { author: author({ mediaPrivacyTarget: null }) }), allowed: false },
  { name: 'private author nonfollower', item: post('private', { author: author({ isPrivate: true }) }), allowed: false },
  { name: 'private author active follower', item: post('private-follow', { author: author({ isPrivate: true, following: activeFollower.following }) }), allowed: true },
  { name: 'private author pending follower', item: post('private-pending', { author: author({ isPrivate: true, following: [{ followerId: 'viewer', status: 'PENDING' }] }) }), allowed: false },
  { name: 'followers audience nonfollower', item: post('followers', { targetAudience: 'Followers' }), allowed: false },
  { name: 'followers audience active follower', item: post('followers-active', { targetAudience: 'Followers', author: activeFollower }), allowed: true },
  { name: 'OnlyMe audience nonauthor', item: post('self', { targetAudience: 'OnlyMe' }), allowed: false },
  { name: 'OnlyMe audience author', item: post('self-author', { targetAudience: 'OnlyMe' }), viewer: 'owner', allowed: true },
  { name: 'OnlyMe results nonauthor', item: post('results-self', { resultsWho: 'OnlyMe' }), allowed: false },
  { name: 'author result settings bypass', item: post('results-self-author', { resultsWho: 'OnlyMe', resultsTiming: 'AfterEnd', expiresAt: new Date('2099-01-01') }), viewer: 'owner', allowed: true },
  { name: 'follower results nonfollower', item: post('results-followers', { resultsWho: 'Followers' }), allowed: false },
  { name: 'follower results active follower', item: post('results-followers-active', { resultsWho: 'Followers', author: activeFollower }), allowed: true },
  { name: 'follower results pending follower', item: post('results-followers-pending', { resultsWho: 'Followers', author: author({ following: [{ followerId: 'viewer', status: 'PENDING' }] }) }), allowed: false },
  { name: 'participant results nonparticipant', item: post('results-participants', { resultsWho: 'Participants' }), allowed: false },
  { name: 'participant results matching user', item: post('results-participant-active', { resultsWho: 'Participants', responses: [{ userId: 'viewer' }] }), allowed: true },
  { name: 'another users participation is insufficient', item: post('other-participant', { resultsWho: 'Participants', responses: [{ userId: 'somebody-else' }] }), allowed: false },
  { name: 'Immediately timing before participation', item: post('immediate', { resultsTiming: 'Immediately' }), allowed: false },
  { name: 'Immediately timing after participation', item: post('immediate-voted', { resultsTiming: 'Immediately', responses: [{ userId: 'viewer' }] }), allowed: true },
  { name: 'AfterEnd future', item: post('future', { resultsTiming: 'AfterEnd', expiresAt: new Date('2099-01-01') }), allowed: false },
  { name: 'AfterEnd no expiry', item: post('no-expiry', { resultsTiming: 'AfterEnd' }), allowed: false },
  { name: 'AfterEnd exact expiry boundary', item: post('expired', { resultsTiming: 'AfterEnd', expiresAt: NOW }), allowed: true },
  { name: 'hidden by viewer', item: post('hidden', { hiddenBy: [{ userId: 'viewer' }] }), allowed: false },
  { name: 'hidden by another user', item: post('hidden-other', { hiddenBy: [{ userId: 'someone-else' }] }), allowed: true },
  { name: 'viewer blocked author', item: post('block-out', { author: author({ blockedBy: [{ blockerId: 'viewer' }] }) }), allowed: false },
  { name: 'author blocked viewer', item: post('block-in', { author: author({ blocking: [{ blockedId: 'viewer' }] }) }), allowed: false },
  { name: 'public group', item: post('public-group', { groupId: 'group', group: group(), targetAudience: 'Groups' }), allowed: true },
  { name: 'private group nonmember', item: post('private-group', { groupId: 'group', group: group({ isPublic: false }), targetAudience: 'Groups' }), allowed: false },
  { name: 'private group joined member', item: post('joined-group', { groupId: 'group', group: group({ isPublic: false, members: [{ userId: 'viewer', status: 'JOINED' }] }), targetAudience: 'Groups' }), allowed: true },
  { name: 'private group pending member', item: post('pending-group', { targetedGroups: [group({ isPublic: false, members: [{ userId: 'viewer', status: 'PENDING' }] })], targetAudience: 'Groups' }), allowed: false },
  { name: 'private targeted group joined member', item: post('targeted-joined', { targetedGroups: [group({ isPublic: false, members: [{ userId: 'viewer', status: 'JOINED' }] })], targetAudience: 'Groups' }), allowed: true },
  { name: 'deleted group', item: post('deleted-group', { groupId: 'group', group: group({ isDeleted: true }), targetAudience: 'Groups' }), allowed: false },
  { name: 'public targeted group', item: post('targeted-group', { targetedGroups: [group()], targetAudience: 'Groups' }), allowed: true },
  { name: 'group visibility does not bypass result restriction', item: post('group-self-results', { targetedGroups: [group()], targetAudience: 'Groups', resultsWho: 'OnlyMe' }), allowed: false },
  { name: 'ProfileAndGroups with null media transition', item: post('profile-groups', { targetAudience: 'ProfileAndGroups', author: author({ mediaPrivacyTarget: null }) }), allowed: true },
  { name: 'draft', item: post('draft', { status: 'DRAFT' }), allowed: false },
  { name: 'author cannot aggregate own draft', item: post('owner-draft', { status: 'DRAFT' }), viewer: 'owner', allowed: false },
  { name: 'deleted post', item: post('deleted', { isDeleted: true }), allowed: false },
  { name: 'author cannot aggregate own deleted post', item: post('owner-deleted', { isDeleted: true }), viewer: 'owner', allowed: false },
  { name: 'repost is not double counted', item: post('repost', { sharedFromId: 'source', sharedFrom: post('source') }), allowed: false },
  { name: 'author cannot double count own repost', item: post('owner-repost', { sharedFromId: 'source', sharedFrom: post('source') }), viewer: 'owner', allowed: false },
  { name: 'another authors post', item: post('other-owner', { authorId: 'other', author: author({ id: 'other' }) }), allowed: false },
  { name: 'unset legacy result fields', item: post('legacy', { resultsWho: null, resultsTiming: null }), allowed: true },
  { name: 'unknown result audience', item: post('unknown', { resultsWho: 'UNRECOGNIZED' }), allowed: false },
];

for (const scenario of matrix) {
  test(`effective analytics inclusion: ${scenario.name}`, () => {
    const actual = matches(scenario.item, buildProfileAnalyticsPostWhere('owner', scenario.viewer || 'viewer', NOW)) === true;
    assert.equal(actual, scenario.allowed);
  });
}

test('filter interpreter fails closed for unsupported fields/operators and preserves SQL NULL', () => {
  assert.throws(() => matches(post('p'), { unsupported: true }), /Unsupported fixture field/);
  assert.throws(() => matches(post('p'), { responses: { unrecognized: {} } }), /Unsupported collection operator/);
  assert.equal(matches({ flag: null }, { NOT: { flag: true } }), null);
  assert.equal(matches({ flag: null }, { OR: [{ flag: null }, { flag: false }] }), true);
});

async function withStore(owner: Row, items: Row[], callback: (observations: { batches: string[][]; transactionOptions: any; postQueries: any[] }) => Promise<void>) {
  const original = prisma.$transaction;
  const observations = { batches: [] as string[][], transactionOptions: undefined as any, postQueries: [] as any[] };
  try {
    (prisma as any).$transaction = async (run: any, options: any) => {
      observations.transactionOptions = options;
      return run({
        user: { findFirst: async (args: any) => matches(owner, args.where) === true ? { id: owner.id } : null },
        post: { findMany: async (args: any) => {
          observations.postQueries.push(args);
          assert.deepEqual(args.select, { id: true }, 'Only identifiers may be loaded for aggregation');
          assert.deepEqual(args.orderBy, { id: 'asc' });
          assert.ok(args.take > 0 && args.take <= 500, 'Every page must be bounded');
          return items.filter(item => matches(item, args.where) === true).sort((a, b) => a.id.localeCompare(b.id)).slice(0, args.take).map(item => ({ id: item.id }));
        } },
        $queryRaw: async (query: any) => {
          const sql = query.strings.join('?');
          assert.match(sql, /WHERE post\."id" IN \(/, 'Aggregate must be constrained to admitted IDs');
          assert.match(sql, /GROUP BY 1, 2, 3, 4/);
          const ids: string[] = query.values;
          assert.ok(ids.length > 0 && ids.length <= 500);
          assert.equal(new Set(ids).size, ids.length);
          for (const id of ids) { assert.ok(items.some(item => item.id === id)); assert.ok(!sql.includes(id), 'IDs must remain bind parameters'); }
          observations.batches.push(ids);
          return items.filter(item => ids.includes(item.id)).map(item => ({ type: item.type, country: item.country || item.id, gender: 'Female', ageGroup: '25-34', count: BigInt(item.responseCount || 1) }));
        }
      });
    };
    await callback(observations);
  } finally { (prisma as any).$transaction = original; }
}

test('aggregate DTO excludes forbidden posts rather than merely displaying a filtered UI', async () => {
  const fixtures = matrix.filter(scenario => !scenario.viewer).map(scenario => scenario.item.id === 'expired'
    ? { ...scenario.item, expiresAt: new Date('2000-01-01') } : scenario.item);
  const expected = matrix.filter(scenario => !scenario.viewer && scenario.allowed).map(scenario => scenario.item.id).sort();
  await withStore(author(), fixtures, async observations => {
    const result = await getProfileAnalytics('owner', 'viewer');
    assert.ok(result);
    assert.equal(result.totalResponses, expected.length);
    assert.deepEqual(Object.keys(result.byCountry).sort(), expected);
    assert.equal(result.byGender.Female, expected.length);
    assert.deepEqual(observations.batches.flat().sort(), expected);
    assert.equal(observations.transactionOptions.isolationLevel, 'RepeatableRead');
  });
});

for (const blockedOwner of [author({ isPrivate: true }), author({ mediaPrivacyTarget: true }), author({ blockedBy: [{ blockerId: 'viewer' }] }), author({ blocking: [{ blockedId: 'viewer' }] })]) {
  test(`profile gate denies aggregate before post reads: ${JSON.stringify(blockedOwner)}`, async () => {
    await withStore(blockedOwner, [post('private-data')], async observations => {
      assert.equal(await getProfileAnalytics('owner', 'viewer'), null);
      assert.equal(observations.postQueries.length, 0);
      assert.equal(observations.batches.length, 0);
    });
  });
}

test('private profile active follower and profile owner retain their permitted aggregates', async () => {
  const privateOwner = author({ isPrivate: true, following: activeFollower.following });
  await withStore(privateOwner, [post('visible', { author: privateOwner }), post('owner-only', { author: privateOwner, resultsWho: 'OnlyMe' })], async () => {
    assert.equal((await getProfileAnalytics('owner', 'viewer'))?.totalResponses, 1);
    assert.equal((await getProfileAnalytics('owner', 'owner'))?.totalResponses, 2);
  });
});

test('bounded pagination aggregates every admitted ID once and never includes adjacent forbidden IDs', async () => {
  const fixtures = Array.from({ length: PROFILE_ANALYTICS_BATCH_SIZE * 2 + 3 }, (_, index) => post(`visible-${String(index).padStart(5, '0')}`, { responseCount: 2, country: 'Synthetic' }));
  fixtures.push(post('visible-00500-forbidden', { resultsWho: 'OnlyMe', responseCount: 1000, country: 'Forbidden' }));
  await withStore(author(), fixtures, async observations => {
    const result = await getProfileAnalytics('owner', 'viewer');
    assert.equal(result?.totalResponses, (PROFILE_ANALYTICS_BATCH_SIZE * 2 + 3) * 2);
    assert.equal(result?.byCountry.Forbidden, undefined);
    assert.deepEqual(observations.batches.map(batch => batch.length), [500, 500, 3]);
    assert.equal(new Set(observations.batches.flat()).size, PROFILE_ANALYTICS_BATCH_SIZE * 2 + 3);
    assert.ok(JSON.stringify(observations.postQueries[1].where).includes('"gt":"visible-00499"'));
  });
});

test('no admitted posts returns an empty DTO without issuing raw aggregates', async () => {
  await withStore(author(), [post('forbidden', { targetAudience: 'OnlyMe' })], async observations => {
    const result = await getProfileAnalytics('owner', 'viewer');
    assert.equal(result?.totalResponses, 0);
    assert.equal(observations.batches.length, 0);
  });
});

test('real PostgreSQL-compatible engine: seeded permission matrix and >500 admitted posts', { skip: !process.env.PROFILE_ANALYTICS_LOCAL_DB, timeout: 120_000 }, async context => {
  const prefix = `nav-analytics-${require('node:crypto').randomUUID()}`;
  const userIds: string[] = [], postIds: string[] = [], groupIds: string[] = [];
  const users: any[] = [], posts: any[] = [], groups: any[] = [], follows: any[] = [], blocks: any[] = [], members: any[] = [], hidden: any[] = [], responses: any[] = [], targeted: Array<{ id: string; groups: string[] }> = [];
  const addUser = (id: string, changes: Row = {}) => { userIds.push(id); users.push({ id, name: 'Synthetic analytics fixture', handle: id, mediaPrivacyTarget: false, country: 'Synthetic', birthday: new Date('2000-01-01'), ...changes }); };
  const viewerId = `${prefix}-viewer`, otherId = `${prefix}-other`;
  addUser(viewerId); addUser(otherId);
  const addPost = (id: string, ownerId: string, changes: Row = {}) => { postIds.push(id); posts.push({ id, authorId: ownerId, title: 'Synthetic analytics policy fixture', description: '', type: 'Poll', expiresAt: new Date('2099-01-01'), targetAudience: 'Public', resultsWho: 'Public', resultsTiming: 'AnyTime', status: 'PUBLISHED', ...changes }); };
  // expiresAt is nonnullable in the actual schema; the impossible null-expiry
  // input remains covered only by the defensive predicate evaluator above.
  const cases = matrix.filter(scenario => scenario.name !== 'AfterEnd no expiry').map((scenario, index) => {
    const item = scenario.item, ownerId = `${prefix}-owner-${index}`, respondentId = `${prefix}-respondent-${index}`, postId = `${prefix}-post-${index}`;
    addUser(ownerId, { isPrivate: item.author.isPrivate, mediaPrivacyTarget: item.author.mediaPrivacyTarget });
    addUser(respondentId, { country: `Dimension-${index}` });
    const mappedUser = (id: string) => id === 'viewer' ? viewerId : id === 'owner' ? ownerId : otherId;
    for (const follow of item.author.following) follows.push({ followerId: mappedUser(follow.followerId), followingId: ownerId, status: follow.status });
    for (const block of item.author.blockedBy) blocks.push({ blockerId: mappedUser(block.blockerId), blockedId: ownerId });
    for (const block of item.author.blocking) blocks.push({ blockerId: ownerId, blockedId: mappedUser(block.blockedId) });
    const mappedGroups: string[] = [];
    for (const [groupIndex, groupRow] of [...(item.group ? [item.group] : []), ...item.targetedGroups].entries()) {
      const id = `${prefix}-group-${index}-${groupIndex}`;
      groupIds.push(id); mappedGroups.push(id);
      groups.push({ id, name: 'Synthetic analytics group', description: '', category: 'General', isPublic: groupRow.isPublic, isDeleted: groupRow.isDeleted });
      for (const member of groupRow.members) members.push({ groupId: id, userId: mappedUser(member.userId), status: member.status });
    }
    let sharedFromId: string | null = null;
    if (item.sharedFromId) { sharedFromId = `${prefix}-source-${index}`; addPost(sharedFromId, ownerId); }
    addPost(postId, item.authorId === 'other' ? otherId : ownerId, { isDeleted: item.isDeleted, status: item.status, targetAudience: item.targetAudience,
      resultsWho: item.resultsWho, resultsTiming: item.resultsTiming, expiresAt: item.id === 'expired' ? new Date('2000-01-01') : item.expiresAt || new Date('2099-01-01'),
      groupId: item.group ? mappedGroups[0] : null, sharedFromId });
    if (item.targetedGroups.length) targeted.push({ id: postId, groups: mappedGroups });
    for (const hiddenRow of item.hiddenBy) hidden.push({ postId, userId: mappedUser(hiddenRow.userId) });
    responses.push({ id: `${prefix}-response-${index}`, postId, userId: item.responses.length ? mappedUser(item.responses[0].userId) : respondentId });
    return { ...scenario, ownerId, actorId: scenario.viewer === 'owner' ? ownerId : viewerId };
  });
  const batchOwner = `${prefix}-batch-owner`, batchRespondent = `${prefix}-batch-respondent`;
  addUser(batchOwner, { mediaPrivacyTarget: false }); addUser(batchRespondent, { country: 'BatchAllowed' });
  for (let i = 0; i < 503; i++) { const id = `${prefix}-batch-${String(i).padStart(4, '0')}`; addPost(id, batchOwner); responses.push({ id: `${id}-response`, postId: id, userId: batchRespondent }); }
  const forbiddenBatchId = `${prefix}-batch-forbidden`;
  addPost(forbiddenBatchId, batchOwner, { resultsWho: 'OnlyMe' });
  responses.push({ id: `${forbiddenBatchId}-response`, postId: forbiddenBatchId, userId: otherId });
  // Small setup packets keep this fixture portable to the local PG wire bridge;
  // production aggregation still executes its real 500-ID pages unchanged.
  const chunks = <T>(rows: T[]): T[][] => Array.from({ length: Math.ceil(rows.length / 20) }, (_, index) => rows.slice(index * 20, (index + 1) * 20));
  const seed = async (model: any, rows: any[]) => { for (const data of chunks(rows)) await model.createMany({ data }); };
  try {
    await seed(prisma.user, users);
    await seed(prisma.userDemographics, userIds.map(userId => ({ userId, gender: 'Female' })));
    await seed(prisma.group, groups);
    await seed(prisma.post, posts);
    await seed(prisma.follow, follows);
    await seed(prisma.userBlock, blocks);
    await seed(prisma.groupMember, members);
    await seed(prisma.hiddenPost, hidden);
    await seed(prisma.response, responses);
    for (const target of targeted) await prisma.post.update({ where: { id: target.id }, data: { targetedGroups: { connect: target.groups.map(id => ({ id })) } } });
    for (const scenario of cases) {
      const result = await getProfileAnalytics(scenario.ownerId, scenario.actorId);
      if (scenario.allowed) {
        assert.ok(result, `${scenario.name}: allowed owner unexpectedly rejected`);
        assert.equal(result.totalResponses, 1, scenario.name);
        assert.equal(Object.values(result.byCountry).reduce((sum, value) => sum + value, 0), 1, scenario.name);
      } else {
        assert.equal(result?.totalResponses || 0, 0, scenario.name);
        if (result) { assert.deepEqual(result.byCountry, {}, scenario.name); assert.deepEqual(result.byAge, {}, scenario.name); assert.equal(result.byGender.Female, 0, scenario.name); }
      }
    }
    const batch = await getProfileAnalytics(batchOwner, viewerId);
    assert.equal(batch?.totalResponses, 503, 'Admitted public posts span multiple 500-ID batches');
    assert.deepEqual(batch?.byCountry, { BatchAllowed: 503 }, 'Forbidden post must not leak another country dimension');
    context.diagnostic(`Real Prisma and aggregate SQL verified ${cases.length} policy cases plus 503 allowed and 1 excluded batch post.`);
  } catch (error) {
    context.diagnostic(`Original integration failure before cleanup: ${String(error)}`);
    throw error;
  } finally {
    await prisma.response.deleteMany({ where: { postId: { in: postIds } } });
    await prisma.hiddenPost.deleteMany({ where: { postId: { in: postIds } } });
    await prisma.post.deleteMany({ where: { id: { in: postIds } } });
    await prisma.groupMember.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.group.deleteMany({ where: { id: { in: groupIds } } });
    await prisma.follow.deleteMany({ where: { OR: [{ followerId: { in: userIds } }, { followingId: { in: userIds } }] } });
    await prisma.userBlock.deleteMany({ where: { OR: [{ blockerId: { in: userIds } }, { blockedId: { in: userIds } }] } });
    await prisma.userDemographics.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    assert.equal(await prisma.post.count({ where: { id: { in: postIds } } }), 0, 'Exact post cleanup');
    assert.equal(await prisma.user.count({ where: { id: { in: userIds } } }), 0, 'Exact user cleanup');
  }
});

