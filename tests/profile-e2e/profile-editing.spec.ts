import path from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';

type ProfileLink = {
  id: string;
  title: string;
  url: string;
  normalizedUrl: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type MockProfile = {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  avatarMediaId: string | null;
  avatarMedia?: Record<string, unknown> | null;
  coverMediaId: string | null;
  coverMedia?: Record<string, unknown> | null;
  bio: string | null;
  location: string;
  website: string;
  email: string;
  phone: string;
  language: string;
  birthday: string;
  profileLinks: ProfileLink[];
  updatedAt: string;
  country: string;
  isPrivate: boolean;
  groupPrivacy: 'Public';
  peopleTagPermission: 'EVERYONE';
  demographics: {
    gender: string;
    ageGroup: string;
    maritalStatus: string;
    education: string;
    employment: string;
    industry: string;
    sector: string;
    nationality: string;
  };
  stats: { followers: number; following: number; posts: number; responses: number };
};

const facebookUrl = 'https://www.facebook.com/share/19LFpJK7Y5';
const fixtureImage = path.resolve(process.cwd(), 'public/pwa-192x192.png');

const ageGroupFor = (birthday: string): string => {
  const [year, month, day] = birthday.split('-').map(Number);
  const today = { year: 2026, month: 9, day: 1 };
  let age = today.year - year;
  if (today.month < month || (today.month === month && today.day < day)) age -= 1;
  if (age < 18) return 'Under 18';
  if (age <= 24) return '18-24';
  if (age <= 34) return '25-34';
  if (age <= 44) return '35-44';
  if (age <= 54) return '45-54';
  return '55+';
};

const makeProfile = (): MockProfile => ({
  id: 'profile-e2e-user',
  name: 'Profile E2E User',
  handle: 'profile_e2e_user',
  avatar: '',
  avatarMediaId: null,
  avatarMedia: null,
  coverMediaId: null,
  coverMedia: null,
  bio: 'Profile editor integration fixture',
  location: '',
  website: '',
  email: 'profile-e2e@example.test',
  phone: '',
  language: 'en',
  birthday: '2000-09-02',
  profileLinks: [],
  updatedAt: '2026-09-01T00:00:00.000Z',
  country: 'Jordan',
  isPrivate: false,
  groupPrivacy: 'Public',
  peopleTagPermission: 'EVERYONE',
  demographics: {
    gender: '',
    ageGroup: '25-34',
    maritalStatus: '',
    education: '',
    employment: '',
    industry: '',
    sector: '',
    nationality: '',
  },
  stats: { followers: 0, following: 0, posts: 0, responses: 0 },
});

type MockApiState = {
  profile: MockProfile;
  links: ProfileLink[];
  mediaPurposeById: Map<string, 'PROFILE_AVATAR' | 'PROFILE_COVER'>;
  mediaSequence: number;
  linkCreateCalls: number;
  profileSaveCalls: number;
  failPrivateProfileLoads: boolean;
  failNextProfileSave: boolean;
  lastProfilePayload?: Record<string, unknown>;
  notificationSnapshot?: { settings: any; updatedAt: string | null };
  notificationSaveCalls?: number;
  failNotificationSave?: boolean;
};

const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) =>
  route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });

async function installAuthenticatedMockApi(page: Page, state: MockApiState): Promise<void> {
  await page.addInitScript((profile) => {
    window.localStorage.setItem('si_token', 'profile-e2e-token');
    window.localStorage.setItem('si_user', JSON.stringify(profile));
  }, state.profile);

  await page.route('**/__profile_e2e_upload__/**', (route) => route.fulfill({ status: 200, body: '' }));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname === '/api/notification-settings') {
      state.notificationSnapshot ||= { settings: { myPosts: { likes: 'everyone', comments: 'everyone', shares: 'following' }, toggles: { newFollowers: true, invitations: true, commentInteractions: true, mentions: true, peopleTags: true, pushNotifications: false }, quietHours: { enabled: false, start: '22:00', end: '08:00', timeZone: 'UTC' } }, updatedAt: null };
      if (method === 'GET') return json(route, state.notificationSnapshot);
      if (method === 'PUT') {
        state.notificationSaveCalls = (state.notificationSaveCalls || 0) + 1;
        const payload = request.postDataJSON();
        if (state.failNotificationSave) { state.failNotificationSave = false; return json(route, { error: 'Temporary failure' }, 503); }
        if (payload.expectedUpdatedAt !== state.notificationSnapshot.updatedAt) return json(route, { error: 'Conflict' }, 409);
        state.notificationSnapshot = { settings: payload.settings, updatedAt: `2026-09-01T00:00:0${state.notificationSaveCalls}.000Z` };
        return json(route, state.notificationSnapshot);
      }
    }

    if (method === 'GET' && pathname === '/api/auth/session') {
      return json(route, { user: { ...state.profile, profileLinks: state.links }, csrfToken: 'mock-csrf-token' });
    }

    if (method === 'PATCH' && pathname === '/api/users/me/settings') {
      state.profileSaveCalls += 1;
      const payload = request.postDataJSON() as { changes: Partial<MockProfile>; expectedUpdatedAt: string };
      state.lastProfilePayload = payload;
      if (state.failNextProfileSave) {
        state.failNextProfileSave = false;
        return json(route, { error: 'Temporary settings failure', code: 'PROFILE_UPDATE_FAILED' }, 503);
      }
      Object.assign(state.profile, payload.changes, { updatedAt: `2026-09-01T00:00:0${state.profileSaveCalls}.000Z` });
      return json(route, state.profile);
    }

    if (method === 'GET' && pathname === '/api/users/me') {
      if (state.failPrivateProfileLoads) {
        return json(route, { error: 'Temporary private-profile failure', code: 'PROFILE_READ_FAILED' }, 503);
      }
      return json(route, { ...state.profile, profileLinks: state.links }, 200, { 'Cache-Control': 'private, no-store' });
    }

    if (method === 'GET' && pathname === `/api/users/${state.profile.id}`) {
      return json(route, { ...state.profile, profileLinks: state.links });
    }

    if (method === 'GET' && pathname === '/api/posts') {
      return json(route, { data: [], nextCursor: null });
    }

    if (pathname === '/api/users/me/profile-links') {
      if (method === 'GET') return json(route, state.links, 200, { 'Cache-Control': 'private, no-store' });
      if (method === 'POST') {
        state.linkCreateCalls += 1;
        const payload = request.postDataJSON() as { title: string; url: string };
        const created: ProfileLink = {
          id: `link-${state.linkCreateCalls}`,
          title: payload.title,
          url: payload.url,
          normalizedUrl: payload.url,
          sortOrder: state.links.length,
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        };
        state.links.push(created);
        state.profile.profileLinks = [...state.links];
        return json(route, created, 201);
      }
    }

    if (method === 'POST' && pathname === '/api/media/uploads') {
      const input = request.postDataJSON() as { purpose: 'PROFILE_AVATAR' | 'PROFILE_COVER' };
      const assetId = `asset-${++state.mediaSequence}`;
      state.mediaPurposeById.set(assetId, input.purpose);
      return json(route, {
        assetId,
        bucket: 'e2e',
        path: assetId,
        token: 'signed-e2e-token',
        signedUrl: `${url.origin}/__profile_e2e_upload__/${assetId}`,
        expiresInSeconds: 300,
      }, 201);
    }

    const finalizeMatch = /^\/api\/media\/([^/]+)\/finalize$/.exec(pathname);
    if (method === 'POST' && finalizeMatch) {
      const assetId = finalizeMatch[1];
      const purpose = state.mediaPurposeById.get(assetId);
      return json(route, {
        id: assetId,
        aspectRatio: purpose === 'PROFILE_COVER' ? 3 : 1,
        width: purpose === 'PROFILE_COVER' ? 1200 : 512,
        height: purpose === 'PROFILE_COVER' ? 400 : 512,
      });
    }

    const mediaMatch = /^\/api\/media\/([^/]+)$/.exec(pathname);
    if (mediaMatch && method === 'GET') {
      const assetId = mediaMatch[1];
      const purpose = state.mediaPurposeById.get(assetId);
      return json(route, {
        id: assetId,
        access: 'RESTRICTED',
        aspectRatio: purpose === 'PROFILE_COVER' ? 3 : 1,
        width: purpose === 'PROFILE_COVER' ? 1200 : 512,
        height: purpose === 'PROFILE_COVER' ? 400 : 512,
        src: '/pwa-192x192.png',
      });
    }
    if (mediaMatch && method === 'DELETE') return route.fulfill({ status: 204, body: '' });

    if (method === 'PUT' && pathname === `/api/users/${state.profile.id}`) {
      state.profileSaveCalls += 1;
      const payload = request.postDataJSON() as Record<string, unknown>;
      state.lastProfilePayload = payload;
      if (state.failNextProfileSave) {
        state.failNextProfileSave = false;
        return json(route, { error: 'Temporary profile failure', code: 'PROFILE_UPDATE_FAILED' }, 503);
      }
      if (typeof payload.name === 'string') state.profile.name = payload.name;
      if (typeof payload.bio === 'string') state.profile.bio = payload.bio;
      if (typeof payload.birthday === 'string') {
        state.profile.birthday = payload.birthday;
        state.profile.demographics.ageGroup = ageGroupFor(payload.birthday);
      }
      if (typeof payload.isPrivate === 'boolean') state.profile.isPrivate = payload.isPrivate;
      if (payload.demographics && typeof payload.demographics === 'object') Object.assign(state.profile.demographics, payload.demographics);
      if (typeof payload.location === 'string') state.profile.location = payload.location;
      if (typeof payload.website === 'string') state.profile.website = payload.website;
      if (Object.prototype.hasOwnProperty.call(payload, 'avatarMediaId')) {
        state.profile.avatarMediaId = payload.avatarMediaId as string | null;
        state.profile.avatarMedia = state.profile.avatarMediaId ? {
          id: state.profile.avatarMediaId,
          access: 'PUBLIC',
          aspectRatio: 1,
          width: 512,
          height: 512,
          src: '/pwa-192x192.png',
        } : null;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'coverMediaId')) {
        state.profile.coverMediaId = payload.coverMediaId as string | null;
        state.profile.coverMedia = state.profile.coverMediaId ? {
          id: state.profile.coverMediaId,
          access: 'PUBLIC',
          aspectRatio: 3,
          width: 1200,
          height: 400,
          src: '/pwa-192x192.png',
        } : null;
      }
      state.profile.updatedAt = `2026-09-01T00:00:0${state.profileSaveCalls}.000Z`;
      return json(route, { ...state.profile, profileLinks: state.links });
    }

    if (method === 'GET') return json(route, []);
    return route.fulfill({ status: 204, body: '' });
  });
}

const openEditProfile = async (page: Page): Promise<void> => {
  await page.goto('/settings/profile/edit-profile');
  await expect(page.getByRole('heading', { name: 'Edit Profile' })).toBeVisible({ timeout: 15_000 });
};

const settingsState = (): MockApiState => ({ profile: makeProfile(), links: [], mediaPurposeById: new Map(), mediaSequence: 0, linkCreateCalls: 0, profileSaveCalls: 0, failPrivateProfileLoads: false, failNextProfileSave: false });

test.describe('settings critical acceptance', () => {
  test('notifications save explicitly, ignore stale local cache and preserve failed draft', async ({ page }) => {
    const state = settingsState(); state.failNotificationSave = true;
    await installAuthenticatedMockApi(page, state);
    await page.addInitScript(() => {
      localStorage.setItem('notif_settings_v1_profile-e2e-user', JSON.stringify({ myPosts: { likes: 'off' } }));
      localStorage.setItem('notif_settings_meta_v1_profile-e2e-user', JSON.stringify({ updatedAt: '2099-01-01T00:00:00Z' }));
    });
    await page.goto('/settings/profile/notifications-detailed');
    await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible({ timeout: 15_000 });
    const likes = page.getByRole('radiogroup', { name: 'Likes on my posts', exact: true });
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await expect(likes.getByRole('radio', { name: 'Everyone', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(save).toBeDisabled();
    await likes.getByRole('radio', { name: 'Off', exact: true }).click();
    await expect(save).toBeEnabled();
    expect(state.notificationSaveCalls || 0).toBe(0);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
    await save.click();
    await expect(page.getByRole('alert')).toContainText('draft is still here');
    await expect(likes.getByRole('radio', { name: 'Off', exact: true })).toHaveAttribute('aria-checked', 'true');
    await save.click();
    await expect(page.getByRole('status')).toContainText('Changes saved');
    expect(state.notificationSnapshot?.settings.myPosts.likes).toBe('off');
    expect(state.notificationSnapshot?.settings.toggles.pushNotifications).toBe(false);
    await expect(save).toBeDisabled();
    await page.reload();
    await expect(likes.getByRole('radio', { name: 'Off', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Activity of people I follow', { exact: true })).toHaveCount(0);
    await page.getByRole('switch', { name: 'Quiet hours', exact: true }).click();
    await page.getByLabel('From', { exact: true }).fill('08:00');
    await expect(save).toBeDisabled();
    await expect(page.getByRole('alert')).toContainText('different start and end');
    await page.getByLabel('Until', { exact: true }).fill('22:00');
    await page.getByLabel('Time zone', { exact: true }).fill('Asia/Amman');
    await save.click();
    await expect(page.getByRole('status')).toContainText('Changes saved');
    expect(state.notificationSnapshot?.settings.quietHours).toEqual({ enabled: true, start: '08:00', end: '22:00', timeZone: 'Asia/Amman' });
  });

  test('denied device notification permission stays off and displays failure', async ({ page }) => {
    const state = settingsState();
    await installAuthenticatedMockApi(page, state);
    await page.addInitScript(() => {
      Object.defineProperty(Notification, 'permission', { get: () => 'denied', configurable: true });
      Notification.requestPermission = async () => 'denied';
    });
    await page.goto('/settings/profile/notifications-detailed');
    const enable = page.getByRole('button', { name: 'Enable on this browser', exact: true });
    await expect(enable).toBeEnabled({ timeout: 15_000 });
    await enable.click();
    await expect(page.getByRole('alert')).toContainText('browser notification setting could not be changed');
    await expect(enable).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Deliver device notifications', exact: true })).toHaveAttribute('aria-checked', 'false');
    expect(state.notificationSaveCalls || 0).toBe(0);
  });
  test('demographics save only net editable changes and stay saved after reload', async ({ page }) => {
    const state = settingsState();
    await installAuthenticatedMockApi(page, state);
    await page.goto('/settings/profile/demographics');
    await expect(page.getByRole('heading', { name: 'Demographic information' })).toBeVisible({ timeout: 15_000 });
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeDisabled();
    await page.getByRole('button', { name: 'Gender Not specified', exact: true }).click();
    await page.getByRole('radio', { name: 'Male', exact: true }).click();
    await expect(save).toBeEnabled();
    await page.getByRole('button', { name: 'Gender Male', exact: true }).click();
    await page.getByRole('radio', { name: 'Not specified', exact: true }).click();
    await expect(save).toBeDisabled();
    expect(state.profileSaveCalls).toBe(0);
    await page.getByRole('button', { name: 'Gender Not specified', exact: true }).click();
    await page.getByRole('radio', { name: 'Female', exact: true }).click();
    await save.click();
    await expect(page.getByRole('status')).toContainText('Changes saved');
    await expect(save).toBeDisabled();
    expect(Object.keys(state.lastProfilePayload || {}).sort()).toEqual(['demographics', 'expectedUpdatedAt']);
    expect(state.lastProfilePayload?.demographics).not.toHaveProperty('ageGroup');
    expect(state.profile.demographics.gender).toBe('Female');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Gender Female', exact: true })).toBeVisible();
    await expect(save).toBeDisabled();
  });

  test('demographics keeps failed draft and offers Continue editing or Discard changes on leave', async ({ page }) => {
    const state = settingsState(); state.failNextProfileSave = true;
    await installAuthenticatedMockApi(page, state);
    await page.goto('/settings/profile/demographics');
    await page.getByRole('button', { name: 'Gender Not specified', exact: true }).click();
    await page.getByRole('radio', { name: 'Male', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('could not be saved');
    await expect(page.getByRole('button', { name: 'Gender Male', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Unsaved changes' })).toContainText('will not be saved');
    await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
    await expect(page).toHaveURL(/\/demographics$/);
    await expect(page.getByRole('button', { name: 'Gender Male', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Privacy Policy', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Unsaved changes' })).toBeVisible();
    await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    expect(state.profile.demographics.gender).toBe('');
    await page.goto('/settings/profile/demographics');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  });

  test('Arabic demographics supports full bilingual country search and localized discard actions', async ({ page }) => {
    const state = settingsState(); state.profile.language = 'ar';
    await installAuthenticatedMockApi(page, state);
    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'ar'));
    await page.goto('/settings/profile/demographics');
    await expect(page.getByRole('heading', { name: 'المعلومات الديموغرافية' })).toBeVisible();
    await page.getByRole('button', { name: 'الجنسية غير محدد', exact: true }).click();
    const search = page.getByRole('searchbox');
    await search.fill('Jordan');
    await page.getByRole('radio', { name: 'الأردن', exact: true }).click();
    await page.getByRole('button', { name: 'الجنسية الأردن', exact: true }).click();
    await search.fill('zzzzzz');
    await expect(page.getByRole('status')).toContainText('لا توجد دول مطابقة');
    await search.fill('الأردن');
    await page.getByRole('radio', { name: 'الأردن', exact: true }).click();
    await page.getByRole('button', { name: 'رجوع', exact: true }).click();
    await expect(page.getByRole('button', { name: 'الاستمرار بالتعديل', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'تجاهل التغييرات', exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/profile$/);
    expect(state.profileSaveCalls).toBe(0);
  });

  test('profile photo controls open current image cropping directly and save only that image', async ({ page }) => {
    const state = settingsState();
    state.profile.avatarMediaId = 'initial-avatar';
    state.profile.coverMediaId = 'initial-cover';
    state.profile.avatarMedia = { id: 'initial-avatar', access: 'PUBLIC', aspectRatio: 1, width: 192, height: 192, src: '/pwa-192x192.png' };
    state.profile.coverMedia = { id: 'initial-cover', access: 'PUBLIC', aspectRatio: 3, width: 192, height: 64, src: '/pwa-192x192.png' };
    state.mediaPurposeById.set('initial-avatar', 'PROFILE_AVATAR');
    state.mediaPurposeById.set('initial-cover', 'PROFILE_COVER');
    await installAuthenticatedMockApi(page, state);
    await page.goto('/profile');
    await page.getByRole('button', { name: 'Edit profile photo', exact: true }).click();
    await expect(page.getByTestId('media-crop-editor')).toHaveAttribute('data-media-purpose', 'PROFILE_AVATAR');
    await expect(page).toHaveURL(/\/profile$/);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect.poll(() => state.profile.avatarMediaId).toBe('asset-1');
    expect(Object.keys(state.lastProfilePayload || {}).sort()).toEqual(['avatarMediaId', 'expectedUpdatedAt']);
    await page.getByRole('button', { name: 'Edit cover photo', exact: true }).click();
    await expect(page.getByTestId('media-crop-editor')).toHaveAttribute('data-media-purpose', 'PROFILE_COVER');
    await expect(page.getByRole('button', { name: '3:1' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/\/profile$/);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Remove photo', exact: true }).click();
    await page.getByRole('button', { name: 'Remove photo', exact: true }).click();
    await expect.poll(() => state.profile.coverMediaId).toBe(null);
    expect(Object.keys(state.lastProfilePayload || {}).sort()).toEqual(['coverMediaId', 'expectedUpdatedAt']);
  });

  test('privacy controls retain saved value on failure and group audience persists independently', async ({ page }) => {
    const state = settingsState(); state.failNextProfileSave = true;
    await installAuthenticatedMockApi(page, state);
    await page.goto('/settings/profile/account-privacy');
    const search = page.getByRole('switch', { name: 'Show my profile in search', exact: true });
    await expect(search).toHaveAttribute('aria-checked', 'true');
    await search.click();
    await expect(page.getByRole('alert')).toContainText('previous value');
    await expect(search).toHaveAttribute('aria-checked', 'true');
    await search.click();
    await expect(search).toHaveAttribute('aria-checked', 'false');
    expect((state.lastProfilePayload as any).changes).toEqual({ searchVisibility: false });
    await page.goto('/settings/profile/group-privacy');
    await page.getByRole('radio', { name: 'Only me', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Only me', exact: true })).toHaveAttribute('aria-checked', 'true');
    expect((state.lastProfilePayload as any).changes).toEqual({ groupPrivacy: 'Off' });
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Only me', exact: true })).toHaveAttribute('aria-checked', 'true');
  });
});

test.describe('local mocked mobile profile editing', () => {
  test('stages avatar/cover crops, hides app navigation, and makes media-only changes saveable', async ({ page }) => {
    test.setTimeout(60_000);
    const state: MockApiState = {
      profile: makeProfile(),
      links: [],
      mediaPurposeById: new Map(),
      mediaSequence: 0,
      linkCreateCalls: 0,
      profileSaveCalls: 0,
      failPrivateProfileLoads: false,
      failNextProfileSave: false,
    };
    await installAuthenticatedMockApi(page, state);
    await openEditProfile(page);

    await expect(page.getByTestId('bottom-navigation')).toHaveCount(0);
    const save = page.getByRole('button', { name: /^save$/i });
    await expect(save).toBeDisabled();

    const avatarInput = page.locator('input[type="file"][data-media-purpose="PROFILE_AVATAR"]');
    await avatarInput.setInputFiles(fixtureImage);
    await expect(page.getByTestId('media-crop-editor')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('media-crop-editor')).toHaveCount(0);
    await expect(save).toBeDisabled();

    await avatarInput.setInputFiles(fixtureImage);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('media-crop-editor')).toHaveCount(0);
    await expect(save).toBeEnabled();
    await save.click();
    await expect.poll(() => state.profile.avatarMediaId).toBe('asset-1');
    expect(state.lastProfilePayload?.avatarMediaId).toBe('asset-1');
    await page.goto('/profile');
    await expect(page.getByRole('img', { name: 'Profile E2E User' }).first()).toHaveAttribute('src', /pwa-192x192\.png/);

    await page.goto('/settings/profile/account-privacy');
    const privacySwitch = page.getByRole('switch', { name: 'Private account' });
    await expect(privacySwitch).toHaveAttribute('aria-checked', 'false');
    await privacySwitch.click();
    await expect.poll(() => state.profile.isPrivate).toBe(true);
    const updatedAtAfterPrivacySave = state.profile.updatedAt;

    await openEditProfile(page);
    const coverInput = page.locator('input[type="file"][data-media-purpose="PROFILE_COVER"]');
    await coverInput.setInputFiles(fixtureImage);
    await expect(page.getByTestId('media-crop-editor')).toHaveAttribute('data-media-purpose', 'PROFILE_COVER');
    await expect(page.getByRole('button', { name: '3:1' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.reactEasyCrop_CropAreaRound')).toHaveCount(0);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
    await expect(save).toBeEnabled();
    await save.click();
    await expect.poll(() => state.profile.coverMediaId).toBe('asset-2');
    expect(state.lastProfilePayload?.coverMediaId).toBe('asset-2');
    expect(state.lastProfilePayload?.expectedUpdatedAt).toBe(updatedAtAfterPrivacySave);
    await page.goto('/profile');
    await expect(page.locator('img[alt=""]').first()).toHaveAttribute('src', /pwa-192x192\.png/);
  });

  test('persists DOB-derived age, preserves a failed draft, and adds the Facebook link once', async ({ page }) => {
    const state: MockApiState = {
      profile: makeProfile(),
      links: [],
      mediaPurposeById: new Map(),
      mediaSequence: 0,
      linkCreateCalls: 0,
      profileSaveCalls: 0,
      failPrivateProfileLoads: false,
      failNextProfileSave: true,
    };
    await installAuthenticatedMockApi(page, state);
    await openEditProfile(page);

    const birthday = page.locator('#profile-date-of-birth');
    await birthday.fill('1990-09-01');
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByRole('alert')).toContainText(/could not be saved/i);
    await expect(birthday).toHaveValue('1990-09-01');

    await page.getByRole('button', { name: /^save$/i }).click();
    await expect.poll(() => state.profile.birthday).toBe('1990-09-01');
    expect(state.profile.demographics.ageGroup).toBe('35-44');

    await page.goto('/settings/profile/demographics');
    await expect(page.getByTestId('bottom-navigation')).toHaveCount(0);
    await expect(page.getByText('35-44', { exact: true })).toBeVisible();

    await page.goto('/settings/profile/links');
    await expect(page.getByTestId('bottom-navigation')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Manage Links' })).toBeVisible();
    await page.getByRole('button', { name: 'Add Link' }).first().click();
    await page.locator('#profile-link-title').fill('Facebook');
    await page.locator('#profile-link-url').fill(facebookUrl);
    await page.getByRole('button', { name: /^save$/i }).click({ clickCount: 2 });
    await expect(page.getByText('Facebook', { exact: true })).toBeVisible();
    await expect(page.getByText('www.facebook.com/share/19LFpJK7Y5', { exact: true })).toBeVisible();
    expect(state.linkCreateCalls).toBe(1);
  });

  test('blocks destructive saves after a private-profile load failure and recovers with Retry', async ({ page }) => {
    const state: MockApiState = {
      profile: makeProfile(),
      links: [],
      mediaPurposeById: new Map(),
      mediaSequence: 0,
      linkCreateCalls: 0,
      profileSaveCalls: 0,
      failPrivateProfileLoads: true,
      failNextProfileSave: false,
    };
    await installAuthenticatedMockApi(page, state);
    await openEditProfile(page);

    const loadWarning = page.getByText('Some private profile details could not be loaded.', { exact: true });
    await expect(loadWarning).toBeVisible();
    await page.locator('#profile-display-name').fill('Draft kept while private data is unavailable');
    await expect(page.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(state.profileSaveCalls).toBe(0);

    state.failPrivateProfileLoads = false;
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(loadWarning).toHaveCount(0);
    await expect(page.locator('#profile-date-of-birth')).toHaveValue('2000-09-02');
    await expect(page.locator('#profile-display-name')).toHaveValue('Draft kept while private data is unavailable');
    await expect(page.getByRole('button', { name: /^save$/i })).toBeEnabled();
  });

  test('Android/browser Back confirms before discarding an unsaved profile draft', async ({ page }) => {
    const state: MockApiState = {
      profile: makeProfile(),
      links: [],
      mediaPurposeById: new Map(),
      mediaSequence: 0,
      linkCreateCalls: 0,
      profileSaveCalls: 0,
      failPrivateProfileLoads: false,
      failNextProfileSave: false,
    };
    await installAuthenticatedMockApi(page, state);
    await page.goto('/settings/profile');
    await page.getByRole('button', { name: /Edit Profile/i }).click();
    await expect(page).toHaveURL(/\/settings\/profile\/edit-profile$/);
    await page.locator('#profile-display-name').fill('Unsaved hardware-back draft');

    page.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('confirm');
      await dialog.dismiss();
    });
    await page.goBack();
    await expect(page).toHaveURL(/\/settings\/profile\/edit-profile$/);
    await expect(page.locator('#profile-display-name')).toHaveValue('Unsaved hardware-back draft');

    page.once('dialog', (dialog) => dialog.accept());
    await page.goBack();
    await expect(page).toHaveURL(/\/settings\/profile$/);

    await page.getByRole('button', { name: /Edit Profile/i }).click();
    await expect(page.locator('#profile-display-name')).toHaveValue('Profile E2E User');

    await page.locator('#profile-display-name').fill('Draft retained through Links');
    await page.getByRole('button', { name: /^Links\b/i }).click();
    await expect(page).toHaveURL(/\/settings\/profile\/links$/);
    const linksBeforeUnloadIsGuarded = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      return !window.dispatchEvent(event);
    });
    expect(linksBeforeUnloadIsGuarded).toBe(true);

    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/settings\/profile\/edit-profile$/);
    await expect(page.locator('#profile-display-name')).toHaveValue('Draft retained through Links');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/settings\/profile$/);
  });

  test('direct-entry Profile Back actions use deterministic in-app parent routes', async ({ page }) => {
    const state: MockApiState = {
      profile: makeProfile(),
      links: [],
      mediaPurposeById: new Map(),
      mediaSequence: 0,
      linkCreateCalls: 0,
      profileSaveCalls: 0,
      failPrivateProfileLoads: false,
      failNextProfileSave: false,
    };
    await installAuthenticatedMockApi(page, state);

    await page.goto('/settings/profile/edit-profile');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/@profile_e2e_user$/);

    await page.goto('/settings/profile/links');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/settings\/profile\/edit-profile$/);
  });

  test('normalizes a nullable private bio without crashing or enabling Save', async ({ page }) => {
    const profile = makeProfile();
    profile.bio = null;
    const state: MockApiState = {
      profile,
      links: [],
      mediaPurposeById: new Map(),
      mediaSequence: 0,
      linkCreateCalls: 0,
      profileSaveCalls: 0,
      failPrivateProfileLoads: false,
      failNextProfileSave: false,
    };
    await installAuthenticatedMockApi(page, state);
    await openEditProfile(page);

    await expect(page.getByText('0/500', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(state.profileSaveCalls).toBe(0);
  });
});
