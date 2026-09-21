import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPageDestination, hasPageCapability, isPagePublic, mayManagePageRole,
  mayPublishPageContent, PageState } from './pagePolicy';
import { pageCreateSchema, pageCsvCell, pageHandleSchema, pagePatchSchema, pageWebUrlSchema } from './pageValidation';

const published: PageState = { publicationState: 'PUBLISHED', platformState: 'NONE',
  safetyHiddenAt: null, deletionRequestedAt: null, purgedAt: null };

test('independent restrictions do not silently restore visibility when another restriction is lifted', () => {
  for (const publicationState of ['DRAFT', 'PUBLISHED', 'UNPUBLISHED']) {
    for (const platformState of ['NONE', 'RESTRICTED', 'SUSPENDED']) {
      for (let mask = 0; mask < 8; mask++) {
        const page = { ...published, publicationState, platformState,
          safetyHiddenAt: mask & 1 ? new Date() : null,
          deletionRequestedAt: mask & 2 ? new Date() : null, purgedAt: mask & 4 ? new Date() : null };
        assert.equal(isPagePublic(page), publicationState === 'PUBLISHED' && platformState !== 'SUSPENDED' && mask === 0);
        assert.equal(mayPublishPageContent(page), publicationState === 'PUBLISHED' && platformState === 'NONE' && mask === 0);
      }
    }
  }
});

test('analyst cannot write and editor cannot export or obtain team identities', () => {
  for (const capability of ['editInfo', 'manageContent', 'reply', 'moderateComments', 'block', 'manageTeam', 'audit', 'publication', 'ownership', 'deletion'] as const) {
    assert.equal(hasPageCapability('ANALYST', capability), false, capability);
  }
  for (const capability of ['export', 'manageTeam', 'audit', 'editInfo', 'changeHandle', 'block', 'publication'] as const) {
    assert.equal(hasPageCapability('EDITOR', capability), false, capability);
  }
  assert.equal(hasPageCapability('ANALYST', 'export'), true);
  assert.equal(hasPageCapability(null, 'analytics'), false);
});

test('admin cannot create another admin, demote an admin or manipulate the owner', () => {
  assert.equal(mayManagePageRole('ADMIN', 'ADMIN'), false);
  assert.equal(mayManagePageRole('OWNER', 'OWNER'), false);
  assert.equal(mayManagePageRole('ADMIN', 'EDITOR'), true);
  assert.equal(mayManagePageRole('ADMIN', 'ANALYST'), true);
  for (const capability of ['changeHandle', 'ownership', 'publication', 'deletion'] as const) {
    assert.equal(hasPageCapability('ADMIN', capability), false);
  }
});

test('Page destination rejects primary ids, JSON ids, nested relations and legacy group audience', () => {
  for (const input of [{ groupId: 'x' }, { targetGroups: ['x'] }, { targetGroups: '["x"]' },
    { targetGroups: 'malformed' }, { targetedGroups: { connect: [{ id: 'x' }] } },
    { targetedGroups: { set: [] } }, { targetAudience: 'Groups' }, { targetAudience: 'ProfileAndGroups' },
    { targetAudience: 'Public,Groups' }]) {
    assert.throws(() => assertPageDestination(input), /PAGE_GROUP_DESTINATION_FORBIDDEN/);
  }
  assert.doesNotThrow(() => assertPageDestination({ targetAudience: 'Public', targetGroups: [] }));
  assert.doesNotThrow(() => assertPageDestination({ targetAudience: 'Followers', targetGroups: '[]', groupId: null }));
});

test('handles are normalized before reservation and disallow deceptive Unicode and route names', () => {
  assert.equal(pageHandleSchema.parse('  My_Page  '), 'my_page');
  for (const value of ['admin', 'PAGES', 'a', '12name', 'a.b', 'a-b', 'a\u202eb', 'аbc', 'a'.repeat(31)]) {
    assert.equal(pageHandleSchema.safeParse(value).success, false, value);
  }
});

test('public contacts are opt-in and authority, owner, badge and counters cannot be mass-assigned', () => {
  const basics = { requestId: '860e1325-c2cf-4aa4-ab7e-ff0eaa5e89b2', name: 'شركة اختبار',
    handle: 'example_page', bio: 'نبذة', category: 'company', representationConfirmed: true };
  const parsed = pageCreateSchema.parse(basics);
  assert.equal(parsed.publicEmail, null);
  assert.equal(parsed.publicPhone, null);
  assert.deepEqual(parsed.links, []);
  assert.equal(pageCreateSchema.safeParse({ ...basics, representationConfirmed: false }).success, false);
  for (const field of ['ownerId', 'role', 'verifiedBadge', 'platformState', 'followersCount', 'isTestFixture']) {
    assert.equal(pagePatchSchema.safeParse({ [field]: 'forged' }).success, false, field);
  }
  assert.equal(pageCreateSchema.safeParse({ ...basics, cta: 'EMAIL' }).success, false);
});

test('links reject script schemes and embedded credentials without fetching external addresses', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///secret', 'https://user:password@example.com']) {
    assert.equal(pageWebUrlSchema.safeParse(url).success, false);
  }
  assert.equal(pageWebUrlSchema.safeParse('https://example.com/path?q=مرحبا').success, true);
});

test('aggregate CSV preserves Arabic and quotes while neutralizing spreadsheet formulas', () => {
  assert.equal(pageCsvCell('مرحبا,"العالم"'), '"مرحبا,""العالم"""');
  for (const value of ['=1+1', '+cmd', '-1+2', '@sum(1)', '  =1', '\t=1']) {
    assert.equal(pageCsvCell(value).startsWith('"\''), true);
  }
  assert.equal(pageCsvCell(25), '"25"');
});

test('Page text counts visible graphemes, permits description lines and rejects bidi controls',()=>{
  assert.equal(pagePatchSchema.safeParse({name:'ا\u0654'.repeat(100)}).success,true);
  assert.equal(pagePatchSchema.safeParse({name:'ا\u0654'.repeat(101)}).success,false);
  assert.equal(pagePatchSchema.safeParse({name:'👍'}).success,false);
  assert.equal(pagePatchSchema.safeParse({description:'السطر الأول\nالسطر الثاني'}).success,true);
  assert.equal(pagePatchSchema.safeParse({bio:'سطر\nآخر'}).success,false);
  for(const value of ['اسم\u061cمضلل','اسم\u202eمضلل','اسم\u0000مضلل'])assert.equal(pagePatchSchema.safeParse({name:value}).success,false);
});
