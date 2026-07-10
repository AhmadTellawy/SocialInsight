import { test } from '@playwright/test';
import { blockUnexpectedMutations, expectAuthenticatedShell, expectTokenPresent, loginAsPublicCreator } from './helpers/auth';

test.describe('authenticated session persistence', () => {
  test('keeps the authenticated session across reload', async ({ page }) => {
    await blockUnexpectedMutations(page);

    await loginAsPublicCreator(page);
    await expectTokenPresent(page);

    await page.reload({ waitUntil: 'domcontentloaded' });

    await expectTokenPresent(page);
    await expectAuthenticatedShell(page);
  });
});
