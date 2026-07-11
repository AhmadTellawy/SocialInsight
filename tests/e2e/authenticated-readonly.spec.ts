import { expect, test } from '@playwright/test';
import { blockUnexpectedMutations, expectAuthenticatedShell, expectTokenPresent, gotoApp } from './helpers/auth';
import { publicCreatorAuthStatePath } from './helpers/authState';

test.use({ storageState: publicCreatorAuthStatePath });

test.describe('authenticated read-only app state', () => {
  test('loads the app with stored public creator authentication', async ({ page }) => {
    await blockUnexpectedMutations(page);

    await gotoApp(page);

    await expectTokenPresent(page);
    await expect(page.getByPlaceholder('Enter your email or handle')).toHaveCount(0);
    await expect(page.getByPlaceholder('Enter your password')).toHaveCount(0);
    await expectAuthenticatedShell(page);
    await expect(page.locator('header').getByRole('img', { name: /^User$/ })).toBeVisible({ timeout: 15_000 });
  });
});
