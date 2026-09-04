import { expect, test, type Page, type Route } from '@playwright/test';

const fixtureUser = {
  id: 'user-e2e-1', name: 'Auth Fixture', handle: 'auth_fixture', email: 'private@example.test',
  emailVerifiedAt: '2026-09-04T00:00:00.000Z', avatar: null, birthday: '1990-09-01',
  followersCount: 0, followingCount: 0, stats: { followers: 0, following: 0, responses: 0 },
  language: 'en', isPrivate: false, verifiedBadge: false
};

const json = (route: Route, body: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body)
});

const mockAnonymousApi = async (page: Page) => {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/session') return json(route, { error: 'Authentication required', code: 'AUTH_REQUIRED' }, 401);
    return json(route, []);
  });
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('i18nextLng', 'en');
    localStorage.setItem('si_token', 'legacy-token-that-must-be-removed');
  });
});

test('password reset request and confirmation are recoverable and credentialed', async ({ page }) => {
  const requests: Array<{ path: string; authorization: string | undefined; cookie: string | undefined }> = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({ path: url.pathname, authorization: request.headers().authorization, cookie: request.headers().cookie });
    if (url.pathname === '/api/auth/session') return json(route, { code: 'AUTH_REQUIRED' }, 401);
    if (url.pathname === '/api/auth/password-reset/request') return route.fulfill({ status: 202, body: '' });
    if (url.pathname === '/api/auth/password-reset/confirm') return json(route, { success: true });
    return json(route, []);
  });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByRole('button', { name: 'Forgot your password?' }).click();
  await page.getByLabel('Email address').fill('private@example.test');
  await page.getByLabel('Email address').press('Enter');
  await expect(page.getByRole('heading', { name: 'Enter your reset code' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('six-digit code has been sent');
  await page.getByLabel('Six-digit code').fill('123456');
  await page.getByLabel('New password').fill('NewPassword1!');
  await page.getByLabel('New password').press('Enter');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('password has been reset');
  expect(requests.some(({ path }) => path === '/api/auth/password-reset/request')).toBe(true);
  expect(requests.some(({ path }) => path === '/api/auth/password-reset/confirm')).toBe(true);
  expect(requests.every(({ authorization }) => authorization === undefined)).toBe(true);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('si_token'))).toBeNull();
});

test('Google start uses the backend URL and never exposes a secret or token parameter', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/session') return json(route, { code: 'AUTH_REQUIRED' }, 401);
    if (url.pathname === '/api/auth/oauth/google/start') return json(route, {
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=state-fixture&code_challenge=challenge-fixture'
    });
    return json(route, []);
  });
  await page.route('https://accounts.google.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Provider fixture</h1>' }));
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page).toHaveURL(/accounts\.google\.com/);
  const providerUrl = new URL(page.url());
  expect(providerUrl.searchParams.has('client_secret')).toBe(false);
  expect(providerUrl.searchParams.has('access_token')).toBe(false);
  expect(providerUrl.searchParams.get('state')).toBeTruthy();
  expect(providerUrl.searchParams.get('code_challenge')).toBeTruthy();
});

test('OAuth callback error is cleaned from the address bar and shown as a recoverable login error', async ({ page }) => {
  await mockAnonymousApi(page);
  await page.goto('/?oauth_error=OAUTH_STATE_INVALID&oauth_provider=google');
  await expect(page).toHaveURL((url) => !url.searchParams.has('oauth_error') && !url.searchParams.has('oauth_provider'));
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Social sign-in could not be completed');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('si_token'))).toBeNull();
});

test('OAuth callback success restores the cookie session, stores no bearer token and cleans callback parameters', async ({ page }) => {
  const authRequests: Array<Record<string, string>> = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/auth/session') {
      authRequests.push(request.headers());
      return json(route, { user: fixtureUser, csrfToken: 'csrf-e2e-token-at-least-16' });
    }
    if (request.method() === 'GET') return json(route, []);
    return json(route, { success: true });
  });
  await page.goto('/?oauth=success&oauth_provider=google');
  await expect(page).toHaveURL((url) => !url.searchParams.has('oauth') && !url.searchParams.has('oauth_provider'));
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('si_auth_identity'))).toBe('user-e2e-1');
  expect(authRequests.length).toBeGreaterThan(0);
  expect(authRequests.every((headers) => headers.authorization === undefined)).toBe(true);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('si_token'))).toBeNull();
});
