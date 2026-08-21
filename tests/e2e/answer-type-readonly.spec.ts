import { expect, test, type Locator, type Page } from '@playwright/test';
import { blockUnexpectedMutations, gotoApp } from './helpers/auth';
import { publicCreatorAuthStatePath } from './helpers/authState';

test.use({
  storageState: publicCreatorAuthStatePath,
  viewport: { width: 390, height: 844 }
});

async function expectSingleLineSelector(group: Locator, expectedCount: number): Promise<void> {
  const radios = group.getByRole('radio');
  await expect(radios).toHaveCount(expectedCount);

  const groupBox = await group.boundingBox();
  const radioBoxes = await Promise.all((await radios.all()).map((radio) => radio.boundingBox()));
  expect(groupBox).not.toBeNull();
  expect(radioBoxes.every(Boolean)).toBe(true);

  const top = radioBoxes[0]!.y;
  for (const box of radioBoxes) {
    expect(Math.abs(box!.y - top)).toBeLessThan(2);
    expect(box!.x).toBeGreaterThanOrEqual(groupBox!.x - 1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(groupBox!.x + groupBox!.width + 1);
  }
}

async function openCreationScreen(page: Page, path: string): Promise<void> {
  await blockUnexpectedMutations(page);
  await gotoApp(page, path);
  await expect(page.getByRole('radiogroup', { name: 'Answer Type' }).first()).toBeVisible({ timeout: 15_000 });
}

test.describe('answer type creation UX (online, read-only)', () => {
  test('Poll preserves text labels and validates Text, Images, and Rating independently', async ({ page }) => {
    await openCreationScreen(page, '/create/poll');

    const selector = page.getByRole('radiogroup', { name: 'Answer Type' }).first();
    const postButton = page.getByRole('button', { name: /^post$/i });
    await expectSingleLineSelector(selector, 3);
    await expect(selector.getByRole('radio', { name: 'Text options' })).toHaveAttribute('aria-checked', 'true');
    await expect(postButton).toBeDisabled();

    await page.getByPlaceholder('Ask a question...').fill('e2e_readonly_answer_type_check');
    await page.getByPlaceholder('Option 1').fill('Messi');
    await page.getByPlaceholder('Option 2').fill('Ronaldo');
    await page.getByRole('button', { name: /select category/i }).click();
    await page.getByRole('button', { name: 'Entertainment', exact: true }).click();
    await expect(postButton).toBeEnabled();

    await selector.getByRole('radio', { name: 'Image options' }).click();
    await expect(postButton).toBeDisabled();
    await expect(page.getByText(/Option names are used in results and analytics/i)).toBeVisible();
    await expect(page.getByLabel('Option name 1')).toHaveValue('Messi');
    await expect(page.getByLabel('Option name 2')).toHaveValue('Ronaldo');
    await expect(page.getByRole('button', { name: /Add images/i }).first()).toBeVisible();
    await page.screenshot({ path: 'test-results/answer-type-poll-mobile-images.png', fullPage: true });

    await selector.getByRole('radio', { name: 'Rating scale' }).click();
    await expect(postButton).toBeEnabled();
    await expect(page.getByTestId('rating-scale-input')).toBeVisible();
    await expect(page.getByLabel('Option name 1')).toHaveCount(0);

    await selector.getByRole('radio', { name: 'Text options' }).click();
    await expect(page.getByPlaceholder('Option 1')).toHaveValue('Messi');
    await expect(page.getByPlaceholder('Option 2')).toHaveValue('Ronaldo');
    await expect(postButton).toBeEnabled();
  });

  test('Survey exposes Text, Images, and Rating without losing the row editor', async ({ page }) => {
    await openCreationScreen(page, '/create/survey');

    const selector = page.getByRole('radiogroup', { name: 'Answer Type' }).first();
    await expectSingleLineSelector(selector, 3);
    await selector.getByRole('radio', { name: 'Image options' }).click();
    await expect(page.getByText(/Option names are used in results and analytics/i)).toBeVisible();
    await expect(page.getByLabel('Option name 1')).toBeVisible();
    await selector.getByRole('radio', { name: 'Rating scale' }).click();
    await expect(page.getByTestId('rating-scale-input')).toBeVisible();
    await selector.getByRole('radio', { name: 'Text options' }).click();
    await expect(page.getByPlaceholder('Option 1')).toBeVisible();
  });

  test('Quiz and Challenge expose only their supported Text and Images modes', async ({ page }) => {
    await openCreationScreen(page, '/create/quiz');

    let selector = page.getByRole('radiogroup', { name: 'Answer Type' }).first();
    await expectSingleLineSelector(selector, 2);
    await expect(selector.getByRole('radio', { name: 'Rating scale' })).toHaveCount(0);
    await selector.getByRole('radio', { name: 'Image options' }).click();
    await expect(page.getByText(/Option names are used in results and analytics/i)).toBeVisible();

    await gotoApp(page, '/create/challenge');
    selector = page.getByRole('radiogroup', { name: 'Answer Type' }).first();
    await expectSingleLineSelector(selector, 2);
    await expect(selector.getByRole('radio', { name: 'Rating scale' })).toHaveCount(0);
    await selector.getByRole('radio', { name: 'Image options' }).click();
    await expect(page.getByText(/Option names are used in results and analytics/i)).toBeVisible();
  });

  test('Arabic keeps the mobile selector on one line in RTL', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('i18nextLng', 'ar'));
    await blockUnexpectedMutations(page);
    await gotoApp(page, '/create/poll');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const selector = page.getByRole('radiogroup', { name: 'نوع الإجابة' }).first();
    await expectSingleLineSelector(selector, 3);
    await selector.getByRole('radio', { name: 'خيارات بالصور' }).click();
    await expect(page.getByText(/تُستخدم أسماء الخيارات في النتائج والتحليلات/)).toBeVisible();
    await page.screenshot({ path: 'test-results/answer-type-poll-mobile-rtl.png', fullPage: true });
  });

  test('desktop keeps the selector compact and supports arrow-key selection', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openCreationScreen(page, '/create/poll');

    const selector = page.getByRole('radiogroup', { name: 'Answer Type' }).first();
    await expectSingleLineSelector(selector, 3);
    const textOption = selector.getByRole('radio', { name: 'Text options' });
    const imageOption = selector.getByRole('radio', { name: 'Image options' });
    await textOption.click();
    await textOption.press('ArrowRight');
    await expect(imageOption).toHaveAttribute('aria-checked', 'true');
    await page.screenshot({ path: 'test-results/answer-type-poll-desktop.png', fullPage: true });
  });
});
