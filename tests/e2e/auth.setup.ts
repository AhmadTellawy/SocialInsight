import { test } from '@playwright/test';
import { blockUnexpectedMutations, expectTokenPresent, loginAsPublicCreator } from './helpers/auth';
import { ensureAuthStateDirectory, publicCreatorAuthStatePath } from './helpers/authState';

test.setTimeout(60_000);

test('authenticate public creator and save storage state', async ({ page }) => {
  await blockUnexpectedMutations(page);

  await loginAsPublicCreator(page, { tokenTimeout: 45_000 });
  await expectTokenPresent(page);

  ensureAuthStateDirectory();
  await page.context().storageState({ path: publicCreatorAuthStatePath });
});
