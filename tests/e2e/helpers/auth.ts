import { expect, type Page, type Route } from '@playwright/test';
import { getPublicCreatorCredentials } from './env';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isAllowedMutatingRequest(route: Route): boolean {
  const request = route.request();
  const method = request.method().toUpperCase();

  if (!MUTATING_METHODS.has(method)) {
    return true;
  }

  const url = new URL(request.url());
  return url.pathname.endsWith('/auth/login');
}

export async function blockUnexpectedMutations(page: Page): Promise<void> {
  await page.route('**/*', async (route) => {
    if (!isAllowedMutatingRequest(route)) {
      await route.abort();
      return;
    }

    await route.continue();
  });
}

export async function gotoApp(page: Page, path = '/'): Promise<void> {
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(response, 'expected root navigation to return a response').not.toBeNull();
  expect(response?.ok(), 'expected root navigation to succeed').toBeTruthy();
  await expect(page.locator('#root')).toBeVisible();

  if (path !== '/') {
    await navigateClientSide(page, path);
  }

  await expect(page.locator('#root')).toBeVisible();
}

export async function navigateClientSide(page: Page, path: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.evaluate((targetPath) => {
        window.history.pushState({}, '', targetPath);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, path);
      break;
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }

      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    }
  }

  await page.waitForURL((url) => url.pathname === path);
  await expect(page.locator('#root')).toBeVisible();
}

async function openLoginForm(page: Page): Promise<void> {
  await gotoApp(page);

  const identifierInput = page.getByPlaceholder('Enter your email or handle');
  const loginFormAlreadyOpen = await identifierInput.isVisible({ timeout: 1_000 }).catch(() => false);

  if (!loginFormAlreadyOpen) {
    const loginButton = page.getByRole('button', { name: /log\s*in/i }).first();
    await expect(loginButton).toBeVisible({ timeout: 15_000 });
    await loginButton.click();
  }

  await expect(identifierInput).toBeVisible({ timeout: 15_000 });
}

async function hasAuthToken(page: Page): Promise<boolean> {
  return page.evaluate(() => Boolean(window.localStorage.getItem('si_token'))).catch(() => false);
}

async function waitForAuthToken(page: Page, timeout = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeout;

  while (Date.now() <= deadline) {
    if (await hasAuthToken(page)) {
      return true;
    }

    await page.waitForTimeout(250).catch(() => undefined);
  }

  return hasAuthToken(page);
}

async function waitForOptionalLoginResponse(page: Page) {
  return page
    .waitForResponse((response) => new URL(response.url()).pathname.endsWith('/auth/login'), { timeout: 5_000 })
    .catch(() => null);
}

interface LoginOptions {
  tokenTimeout?: number;
}

async function submitLoginAndVerifyAuthenticatedState(
  page: Page,
  submit: () => Promise<void>,
  options: LoginOptions = {},
): Promise<void> {
  const loginResponsePromise = waitForOptionalLoginResponse(page);

  await submit();

  const [loginResponse, tokenPresent] = await Promise.all([
    loginResponsePromise,
    waitForAuthToken(page, options.tokenTimeout),
  ]);

  if (loginResponse && !loginResponse.ok() && !tokenPresent) {
    throw new Error(`Login response returned HTTP ${loginResponse.status()}`);
  }

  expect(tokenPresent, 'expected authenticated token in localStorage after login').toBe(true);
}

export async function loginAsPublicCreator(page: Page, options: LoginOptions = {}): Promise<void> {
  const credentials = getPublicCreatorCredentials();
  const identifierInput = page.getByPlaceholder('Enter your email or handle');
  const passwordInput = page.getByPlaceholder('Enter your password');

  await openLoginForm(page);
  await identifierInput.fill(credentials.login);
  await passwordInput.fill(credentials.password);

  await expect
    .poll(async () => (await identifierInput.inputValue()) === credentials.login, {
      message: 'expected the login identifier field to be populated',
      timeout: 5_000,
    })
    .toBe(true);
  await expect
    .poll(async () => (await passwordInput.inputValue()).length > 0, {
      message: 'expected the password field to be populated',
      timeout: 5_000,
    })
    .toBe(true);

  const signInButton = page.getByRole('button', { name: /sign in/i });
  await expect(signInButton).toBeEnabled({ timeout: 5_000 });
  await submitLoginAndVerifyAuthenticatedState(page, () => signInButton.click(), options);

  await page.waitForURL((url) => url.pathname === '/', { timeout: 10_000 }).catch(() => undefined);
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  await expect(page.getByRole('button', { name: /login/i })).toHaveCount(0, { timeout: 15_000 });
}

export async function expectTokenPresent(page: Page): Promise<void> {
  await expect
    .poll(() => hasAuthToken(page), {
      message: 'expected an authenticated token in localStorage',
      timeout: 15_000,
    })
    .toBe(true);
}

export async function expectTokenCleared(page: Page): Promise<void> {
  await expect
    .poll(
      async () => page.evaluate(() => window.localStorage.getItem('si_token')).catch(() => '__navigation_pending__'),
      {
        message: 'expected authenticated token to be cleared from localStorage',
        timeout: 15_000,
      },
    )
    .toBeNull();
}

export async function expectAuthenticatedShell(page: Page): Promise<void> {
  await expectTokenPresent(page);
  await expect(page.getByRole('button', { name: /login/i })).toHaveCount(0, { timeout: 15_000 });
}

export async function expectUnauthenticatedShell(page: Page): Promise<void> {
  await gotoApp(page);
  await expect(page.getByRole('button', { name: /login/i })).toBeVisible({ timeout: 15_000 });
}

export async function logoutThroughUi(page: Page): Promise<void> {
  await navigateClientSide(page, '/settings/profile');
  await expect(page.getByText(/^Settings$/i)).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: /^log out$/i }).click();
  await expect(page.getByText(/log out of your account/i)).toBeVisible();
  await page.getByRole('button', { name: /^log out$/i }).last().click();
  await expectTokenCleared(page);
}
