import { expect, test } from '@playwright/test';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

test.describe('application load', () => {
  test('renders a non-empty app shell', async ({ page }) => {
    await page.route('**/*', async (route) => {
      if (MUTATING_METHODS.has(route.request().method().toUpperCase())) {
        await route.abort();
        return;
      }

      await route.continue();
    });

    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response, 'initial navigation should return a response').not.toBeNull();
    expect(response?.ok(), 'initial navigation should succeed').toBeTruthy();

    const body = page.locator('body');
    await expect(body).toBeVisible();

    const appRoot = page.locator('#root');
    await expect(appRoot).toBeVisible();

    await expect
      .poll(
        async () =>
          appRoot.evaluate((element) => {
            const root = element as HTMLElement;
            return root.childElementCount + root.innerText.trim().length;
          }),
        {
          message: 'expected the application root to contain rendered UI',
          timeout: 15_000,
        },
      )
      .toBeGreaterThan(0);
  });
});
