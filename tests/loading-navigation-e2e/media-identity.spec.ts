import { expect, test, type Route } from '@playwright/test';

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

test('a failed signed avatar refresh stops after one attempt and keeps fixed fallback dimensions', async ({ page }) => {
  const profile = {
    id: 'alpha',
    handle: 'alpha',
    name: 'Alpha Profile',
    avatar: '/broken-avatar.png',
    avatarMediaId: 'avatar-alpha',
    bio: '',
    location: '',
    website: '',
    email: 'alpha@example.test',
    phone: '',
    language: 'en',
    isPrivate: false,
    groupPrivacy: 'Public',
    peopleTagPermission: 'EVERYONE',
    profileLinks: [],
    stats: { followers: 0, following: 0, posts: 0, responses: 0 },
    demographics: {},
    updatedAt: '2026-09-20T00:00:00.000Z'
  };
  let presentationRequests = 0;

  await page.addInitScript((user) => {
    localStorage.setItem('si_token', 'media-stability-token');
    localStorage.setItem('si_user', JSON.stringify(user));
  }, profile);
  await page.route('**/broken-avatar.png', route => route.fulfill({ status: 404, body: '' }));
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/media/avatar-alpha') {
      presentationRequests += 1;
      return json(route, {
        id: 'avatar-alpha',
        access: 'RESTRICTED',
        aspectRatio: 1,
        width: 112,
        height: 112,
        src: '/broken-avatar.png'
      });
    }
    if (url.pathname === '/api/users/me' || url.pathname === '/api/users/alpha' || url.pathname === '/api/users/handle/alpha') {
      return json(route, profile);
    }
    if (url.pathname === '/api/posts') return json(route, { data: [], nextCursor: null });
    if (route.request().method() !== 'GET') return json(route, {});
    return json(route, []);
  });

  await page.goto('/@alpha');
  const fallback = page.getByRole('img', { name: 'Alpha Profile' });
  const avatarFrame = page.getByTestId('profile-avatar-frame');
  await expect(avatarFrame).toBeVisible();
  const initialBox = await avatarFrame.boundingBox();
  expect(initialBox).not.toBeNull();
  expect(initialBox!.width).toBeGreaterThan(0);
  expect(initialBox!.height).toBeGreaterThan(0);
  await expect(fallback).toBeVisible();
  await expect.poll(() => presentationRequests).toBe(1);
  await page.waitForTimeout(500);
  expect(presentationRequests).toBe(1);
  await expect(fallback).toBeVisible();
  expect(await avatarFrame.boundingBox()).toEqual(initialBox);
});

test('a delayed avatar refresh from profile A cannot appear after an SPA switch to profile B', async ({ page }) => {
  const makeProfile = (id: string) => ({
    id, handle: id, name: `${id.toUpperCase()} Profile`, avatar: `/${id}.png`, avatarMediaId: `avatar-${id}`,
    bio: '', location: '', website: '', email: `${id}@example.test`, phone: '', language: 'en',
    isPrivate: false, groupPrivacy: 'Public', peopleTagPermission: 'EVERYONE', profileLinks: [],
    stats: { followers: 0, following: 0, posts: 0, responses: 0 }, demographics: {}, updatedAt: '2026-09-20T00:00:00.000Z'
  });
  const alpha = makeProfile('alpha');
  const beta = makeProfile('beta');
  const viewer = alpha;
  const redPixel = 'data:image/gif;base64,R0lGODlhAQABAIABAP8AAP///yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  let alphaPresentationRequests = 0;

  await page.addInitScript((user) => {
    localStorage.setItem('si_token', 'media-race-token');
    localStorage.setItem('si_user', JSON.stringify(user));
  }, viewer);
  await page.route('**/alpha.png', route => route.fulfill({ status: 404, body: '' }));
  await page.route('**/beta.png', route => route.fulfill({ status: 404, body: '' }));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const handle = url.pathname.match(/^\/api\/users\/handle\/(alpha|beta)$/)?.[1];
    if (url.pathname === '/api/users/me') return json(route, viewer);
    if (handle) return json(route, handle === 'alpha' ? alpha : beta);
    if (url.pathname === '/api/media/avatar-alpha') {
      alphaPresentationRequests += 1;
      await new Promise(resolve => setTimeout(resolve, 1_000));
      return json(route, { id: 'avatar-alpha', access: 'RESTRICTED', aspectRatio: 1, width: 112, height: 112, src: redPixel });
    }
    if (url.pathname === '/api/media/avatar-beta') {
      return json(route, { id: 'avatar-beta', access: 'RESTRICTED', aspectRatio: 1, width: 112, height: 112, src: '/beta.png' });
    }
    if (url.pathname === '/api/posts') return json(route, { data: [], nextCursor: null });
    if (route.request().method() !== 'GET') return json(route, {});
    return json(route, []);
  });

  await page.goto('/@alpha');
  await expect(page.locator('h2').filter({ hasText: /^ALPHA Profile$/ })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => alphaPresentationRequests).toBe(1);
  await page.evaluate(() => {
    history.pushState({}, '', '/@beta');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.locator('h2').filter({ hasText: /^BETA Profile$/ })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1_100);
  await expect(page.locator(`img[src="${redPixel}"]`)).toHaveCount(0);
  await expect(page.locator('h2').filter({ hasText: /^ALPHA Profile$/ })).toHaveCount(0);
});
