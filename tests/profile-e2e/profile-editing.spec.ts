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
