import assert from 'node:assert/strict';
import test from 'node:test';
import { arePublishedPostsVisible, buildVisiblePostSql, buildVisiblePublishedPostsExistSql } from './postVisibilitySql';
import { buildFeedPostScalarSelect } from './postFeedService';

test('untrusted identities, filters and cursor are parameters, with a bounded static scalar projection', () => {
  const injected = `x' OR TRUE; DROP TABLE "Post"; --`;
  const query = buildVisiblePostSql({ viewerId: injected, ids: [injected], authorId: injected,
    authorHandle: injected, groupId: injected, pageId: injected, type: injected,
    cursor: { id: injected, createdAt: new Date('2026-01-01') }, limit: 31 });
  assert.ok(!query.text.includes(injected));
  assert.ok(query.values.includes(injected));
  assert.ok(query.values.includes(31));
  const projection = query.text.split(' FROM "Post" p WHERE ')[0];
  for (const field of Object.keys(buildFeedPostScalarSelect())) assert.ok(projection.includes(`"p"."${field}"`));
  assert.ok(!projection.includes('*'));
});

test('feature gate changes SQL per call and allowlist does not enable other viewers', () => {
  const enabled = process.env.PAGES_ENABLED;
  const allowlisted = process.env.PAGES_TEST_USERS;
  try {
    process.env.PAGES_ENABLED = 'false'; process.env.PAGES_TEST_USERS = 'allowed';
    assert.ok(!buildVisiblePostSql({viewerId:'outsider',limit:1}).text.includes('"publicationState"'));
    assert.ok(buildVisiblePostSql({viewerId:'allowed',limit:1}).text.includes('"publicationState"'));
    process.env.PAGES_ENABLED = 'true';
    assert.ok(buildVisiblePostSql({limit:1}).text.includes('"publicationState"'));
  } finally {
    if (enabled === undefined) delete process.env.PAGES_ENABLED; else process.env.PAGES_ENABLED = enabled;
    if (allowlisted === undefined) delete process.env.PAGES_TEST_USERS; else process.env.PAGES_TEST_USERS = allowlisted;
  }
});

test('empty identifier sets fail closed and unbounded limits are rejected', () => {
  assert.match(buildVisiblePostSql({ids:[],limit:1}).text, /AND \(FALSE\)/);
  for (const limit of [0,-1,32,1.5,Infinity,NaN]) assert.throws(() => buildVisiblePostSql({limit}));
});

test('existence query binds requested IDs/viewer and preserves optional Page-only and source predicates', () => {
  const injected = `x' OR TRUE; --`;
  const query = buildVisiblePublishedPostsExistSql([injected, injected, 'other'], injected, 'PAGE');
  assert.ok(!query.text.includes(injected));
  assert.equal(query.values.filter(value => value === 'other').length, 1);
  assert.equal(query.text.split('requested(id)')[0].match(/::text/g)?.length, 2, 'Duplicate requested IDs are one requirement');
  assert.match(query.text, /p\."pageId" IS NOT NULL/);
  assert.match(query.text, /sharedFromId/);
  assert.match(query.text, /SELECT NOT EXISTS/);
  assert.ok(!query.text.includes('ORDER BY')); assert.ok(!query.text.includes('LIMIT'));
  assert.equal(buildVisiblePublishedPostsExistSql([]).text, 'SELECT FALSE AS visible');
});

test('existence helper fails closed for absent or invalid results and rechecks every invocation', async () => {
  let calls = 0;
  let rows: any[] = [{ visible: true }];
  const tx: any = { $queryRaw: async () => { calls++; return rows; } };
  assert.equal(await arePublishedPostsVisible(tx, []), false); assert.equal(calls, 0);
  assert.equal(await arePublishedPostsVisible(tx, ['one']), true);
  for (const result of [[{ visible: false }], [], [{ visible: 1 }], [{}]]) {
    rows = result; assert.equal(await arePublishedPostsVisible(tx, ['one']), false);
  }
  assert.equal(calls, 5, 'No reuse of earlier authorization');
});
