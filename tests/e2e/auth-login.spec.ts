import { test } from '@playwright/test';
import { blockUnexpectedMutations, expectAuthenticatedShell, loginAsPublicCreator } from './helpers/auth';

test.describe('authentication login', () => {
  test('logs in with the configured public creator account', async ({ page }) => {
    await blockUnexpectedMutations(page);

    await loginAsPublicCreator(page);
    await expectAuthenticatedShell(page);
  });
});
