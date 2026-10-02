import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPath, decodeRouteSegment, hasAppPredecessor, isKnownPath, profilePath } from './navigation.ts';

test('canonical aliases and trailing separators preserve group identities', () => {
  assert.equal(canonicalPath('/groups/one/settings/'), '/group/one/settings');
  assert.equal(canonicalPath('/groups/a%20b'), '/group/a%20b');
  assert.equal(canonicalPath('/@person/'), '/@person');
  assert.equal(canonicalPath('///'), '/');
  assert.equal(canonicalPath('/post/post-id'), '/post/post-id');
});

test('only valid route shapes are accepted including every implemented settings child', () => {
  const implementedProfileSettingsRoutes = [
    '/settings/profile/edit-profile', '/settings/profile/links', '/settings/profile/email-phone', '/settings/profile/account-access',
    '/settings/profile/language', '/settings/profile/demographics', '/settings/profile/notifications-detailed',
    '/settings/profile/group-privacy', '/settings/profile/account-privacy', '/settings/profile/help', '/settings/profile/theme',
    '/settings/profile/security', '/settings/profile/data', '/settings/profile/blocked', '/settings/profile/view-as',
  ];
  for (const p of ['/', '/search', '/trends', '/notifications', '/messages', '/profile', '/privacy', '/login', '/signup', '/settings/profile',
    '/pages', '/pages/create', '/pages/mine', '/pages/invitations', '/pages/blocks', '/pages/staff', '/pages/cases',
    '/pages/example-page', '/pages/manage/page-id', '/pages/staff/case-id', '/pages/cases/case-id',
    '/@person', '/profile/user-id', '/post/post-id', '/group/group-id', '/group/group-id/settings', '/hashtag/%D8%B1%D8%A3%D9%8A',
    ...['poll', 'survey', 'quiz', 'challenge', 'group', 'business'].map(type => `/create/${type}`),
    ...implementedProfileSettingsRoutes]) assert.equal(isKnownPath(p), true, p);
  for (const p of ['/unknown', '/group/', '/@', '/post/p/settings', '/profile/u/settings', '/group/g/members', '/create/unknown', '/pagesfoo',
    '/settings/profile/username', '/settings/profile/no-such-child', '/settings/profile/edit-profile/extra', '/post/%E0%A4%A',
    '/profile/%2Fsecret', '/group/%5Csecret', '/@name%3Ftab=saved', '/hashtag/%00hidden']) assert.equal(isKnownPath(p), false, p);
});

test('Page namespace delegates every nested path to the safe Pages boundary', () => {
  for (const path of ['/pages/', '/pages/manage', '/pages/manage/page/extra', '/pages/%2Fsecret', '/pages/%E0%A4%A']) {
    assert.equal(isKnownPath(path), true, path);
  }
  assert.equal(isKnownPath('/pagesfoo'), false);
});

test('decoded segments cannot smuggle separators, controls or malformed encoding', () => {
  assert.equal(decodeRouteSegment('%D8%B1%D8%A3%D9%8A'), 'رأي');
  assert.equal(decodeRouteSegment('post-123'), 'post-123');
  for (const value of ['', '%', '%E0%A4%A', 'a%2Fb', 'a%5Cb', 'a%3Fb', 'a%23b', '%00', '%1F', 'a%20b', 'a\nb']) {
    assert.equal(decodeRouteSegment(value), '', value);
  }
});

test('back eligibility uses a valid positive router index, never generic history length', () => {
  for (const state of [undefined, null, {}, { length: 10 }, { idx: 0 }, { idx: -1 }, { idx: 1.5 }, { idx: '2' }, { idx: NaN }, { idx: Infinity }]) {
    assert.equal(hasAppPredecessor(state), false);
  }
  assert.equal(hasAppPredecessor({ idx: 1 }), true);
  assert.equal(hasAppPredecessor({ idx: 12, usr: { unrelated: true } }), true);
});

test('profile links prefer encoded handles and use encoded stable ids when absent', () => {
  assert.equal(profilePath({ id: 'user-1', handle: 'person' }), '/@person');
  assert.equal(profilePath({ id: 'user/1' }), '/profile/user%2F1');
  assert.equal(profilePath({ id: 'user-1', handle: 'رأي' }), '/@%D8%B1%D8%A3%D9%8A');
});
