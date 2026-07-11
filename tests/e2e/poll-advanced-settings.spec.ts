import fs from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import { expectTokenPresent, gotoApp } from './helpers/auth';
import { publicCreatorAuthStatePath } from './helpers/authState';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const AUTH_STORAGE_KEYS = new Set(['si_token', 'si_user']);

type StorageItem = {
  name: string;
  value: string;
};

type StoredUser = Record<string, unknown>;

function readStoredAuthItems(): StorageItem[] {
  const storageState = JSON.parse(fs.readFileSync(publicCreatorAuthStatePath, 'utf8'));
  const authOrigin = storageState.origins?.find((origin: { localStorage?: StorageItem[] }) =>
    origin.localStorage?.some((item) => item.name === 'si_token'),
  );

  return authOrigin?.localStorage?.filter((item) => AUTH_STORAGE_KEYS.has(item.name)) || [];
}

function readStoredUser(authItems: StorageItem[]): StoredUser {
  const storedUser = authItems.find((item) => item.name === 'si_user');
  return storedUser ? JSON.parse(storedUser.value) : {};
}

async function mirrorStoredAuthToCurrentOrigin(page: Page, authItems: StorageItem[]): Promise<void> {
  await page.context().addInitScript((items: StorageItem[]) => {
    for (const item of items) {
      window.localStorage.setItem(item.name, item.value);
    }
  }, authItems);
}

async function restoreStoredAuthOnLoadedPage(page: Page, authItems: StorageItem[]): Promise<void> {
  await page.evaluate((items: StorageItem[]) => {
    for (const item of items) {
      window.localStorage.setItem(item.name, item.value);
    }
  }, authItems);
}

function isAllowedBackgroundMutation(mutation: string): boolean {
  return (
    /\/analytics\/interactions\/batch$/.test(mutation) ||
    /\/posts\/[^/]+\/views$/.test(mutation)
  );
}

function isCurrentUserRefreshRequest(route: Route): boolean {
  const request = route.request();
  if (request.method().toUpperCase() !== 'GET') {
    return false;
  }

  const pathname = new URL(request.url()).pathname;
  return /^\/api\/users\/[^/]+$/.test(pathname) || /^\/users\/[^/]+$/.test(pathname);
}

async function blockAndRecordMutations(page: Page, storedUser: StoredUser): Promise<string[]> {
  const blockedMutations: string[] = [];

  await page.route('**/*', async (route: Route) => {
    if (isCurrentUserRefreshRequest(route)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(storedUser),
      });
      return;
    }

    const request = route.request();
    const method = request.method().toUpperCase();

    if (MUTATING_METHODS.has(method)) {
      const url = new URL(request.url());
      blockedMutations.push(`${method} ${url.pathname}`);
      await route.abort();
      return;
    }

    await route.continue();
  });

  return blockedMutations;
}

async function expectPublicPollVisibility(page: Page): Promise<void> {
  const visibilitySummary = page.getByTestId('poll-visibility-summary');

  await expect(visibilitySummary).toBeVisible();
  await expect(visibilitySummary).toHaveAttribute('data-poll-visibility', 'Public');
  await expect(visibilitySummary).toContainText('Public');

  await visibilitySummary.click();

  await expect(page.getByTestId('poll-visibility-option-public')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('poll-visibility-option-groups')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText(/select target groups/i)).toHaveCount(0);
}

test.use({ storageState: publicCreatorAuthStatePath });

test.describe('poll advanced settings defaults', () => {
  test.skip(true, 'ONLINE_NO_WRITE pending deployment of Phase 4A poll advanced settings test hooks.');

  test('keeps a new poll on public visibility before and after reopening advanced settings', async ({ page }) => {
    const authItems = readStoredAuthItems();
    const storedUser = readStoredUser(authItems);
    const blockedMutations = await blockAndRecordMutations(page, storedUser);

    expect(authItems.map((item) => item.name).sort(), 'expected stored auth state to contain safe auth keys').toEqual([
      'si_token',
      'si_user',
    ]);

    await mirrorStoredAuthToCurrentOrigin(page, authItems);
    await gotoApp(page, '/create/poll');

    const tokenMirrored = await page.evaluate(() => Boolean(window.localStorage.getItem('si_token')));
    if (!tokenMirrored) {
      await restoreStoredAuthOnLoadedPage(page, authItems);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await gotoApp(page, '/create/poll');
    }

    await expectTokenPresent(page);
    await expect(page.getByRole('heading', { name: /new poll/i })).toBeVisible({ timeout: 15_000 });

    const advancedSettingsTrigger = page.getByTestId('poll-advanced-settings-trigger');
    await expect(advancedSettingsTrigger).toBeVisible();

    await advancedSettingsTrigger.click();
    await expectPublicPollVisibility(page);

    await page.locator('div[aria-hidden="true"]').last().dispatchEvent('click');
    await expect(page.getByTestId('poll-visibility-option-public')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /new poll/i })).toBeVisible();
    await expect(advancedSettingsTrigger).toBeVisible();

    await advancedSettingsTrigger.click();
    await expectPublicPollVisibility(page);

    const unexpectedMutations = blockedMutations.filter((mutation) => !isAllowedBackgroundMutation(mutation));
    expect(unexpectedMutations, 'expected no app data mutations while checking poll settings').toEqual([]);
    expect(
      blockedMutations.some((mutation) => /^POST \/api\/posts\/?$/.test(mutation) || /^POST \/posts\/?$/.test(mutation)),
      'expected the regression test not to attempt poll creation',
    ).toBe(false);
  });
});
