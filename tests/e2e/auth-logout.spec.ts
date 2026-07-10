import { test } from '@playwright/test';
import {
  blockUnexpectedMutations,
  expectTokenCleared,
  expectUnauthenticatedShell,
  loginAsPublicCreator,
  logoutThroughUi,
} from './helpers/auth';

test.describe('authentication logout', () => {
  test('logs out through the profile settings UI', async ({ page }) => {
    await blockUnexpectedMutations(page);

    await loginAsPublicCreator(page);
    await logoutThroughUi(page);

    await expectTokenCleared(page);
    await expectUnauthenticatedShell(page);
  });
});
