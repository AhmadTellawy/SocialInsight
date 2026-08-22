import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const creatorStatePath = path.resolve(process.cwd(), 'tests/e2e/.auth/public_creator.json');

async function blockOnlineWrites(page: Page): Promise<string[]> {
  const blockedMutations: string[] = [];
  await page.route('**/*', async (route) => {
    const method = route.request().method().toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue();
    blockedMutations.push(`${method} ${new URL(route.request().url()).pathname}`);
    return route.fulfill({ status: 204, contentType: 'application/json', body: '{}' });
  });
  return blockedMutations;
}

test.describe('post options read-only UX', () => {
  test.skip(!fs.existsSync(creatorStatePath), 'Requires the local public_creator online auth state.');
  test.use({ storageState: creatorStatePath });

  test('has a named, touch-sized menu and keeps keyboard focus inside it', async ({ page }) => {
    const blockedMutations = await blockOnlineWrites(page);
    await page.goto('/profile');

    const trigger = page.getByRole('button', { name: 'Open post options' }).first();
    await expect(trigger).toBeVisible();
    const box = await trigger.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);

    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Post options' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Copy link', { exact: true })).toBeVisible();
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

    await page.keyboard.press('Shift+Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    expect(blockedMutations.filter((entry) => !entry.includes('/analytics/'))).toEqual([]);
  });

  test('localizes the menu and aligns it correctly in Arabic RTL', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'ar'));
    await blockOnlineWrites(page);
    await page.goto('/profile');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const trigger = page.getByRole('button', { name: 'فتح خيارات المنشور' }).first();
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'خيارات المنشور' });
    const copyAction = dialog.getByRole('button').filter({ hasText: 'نسخ الرابط' });
    await expect(copyAction).toBeVisible();
    await expect(copyAction).toHaveCSS('text-align', 'start');
  });
});
