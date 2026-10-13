import { test, expect } from '@playwright/test';

const route = '/tests/post-response-sheet/index.html?rating';

for (const width of [320, 390, 1280]) for (const lang of ['en', 'ar']) {
  test(`rating results ${width} ${lang}: summary and compact shared sheet`, async ({ page }, info) => {
    test.slow(); // Includes cold Vite startup and two screenshots on the first case.
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${route}&done&forced&lang=${lang}`);
    const summary = page.getByTestId('rating-results-summary');
    await expect(summary).toHaveCount(1);
    await expect(summary.getByTestId('rating-summary-average')).toHaveText('2.8 / 5');
    await expect(summary.getByTestId('rating-summary-count')).toContainText('40');
    await expect(summary.getByTestId('rating-your-rating')).toContainText('2');
    await expect(page.getByTestId('rating-average')).toHaveCount(0);
    await expect(page.getByTestId('rating-scale-results')).toHaveCount(0);
    await expect(page.getByRole('switch')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Anonymous responses|ردود مجهولة/ })).toHaveCount(0);
    const cover = await page.getByRole('img', { name: 'Cover', exact: true }).boundingBox();
    expect(cover!.width / cover!.height).toBeCloseTo(.8, 2);
    await page.screenshot({ path: info.outputPath('rating-feed.png'), fullPage: true });
    const trigger = page.getByRole('button', { name: /View results|عرض النتائج/ });
    await trigger.click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByTestId('rating-results-summary')).toBeVisible();
    const rows = sheet.getByRole('listitem');
    await expect(rows).toHaveCount(5);
    await expect(rows.locator('[data-testid="rating-result-summary"]').first()).toContainText('15%');
    await expect(sheet.locator('[data-rating-value="2"]')).toHaveAttribute('data-selected', 'true');
    const heights = await rows.evaluateAll(els => els.map(el => el.getBoundingClientRect().height));
    expect(heights.every(height => height >= 36 && height <= 38)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await sheet.screenshot({ path: info.outputPath('rating-sheet.png') });
    await page.goBack();
    await expect(sheet).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}

test('rating vote preserves anonymity, updates count once and removes anonymous controls', async ({ page }) => {
  await page.goto(`${route}&forced`);
  await page.getByRole('button', { name: /View options/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('button', { name: 'Anonymous responses', exact: true })).toBeVisible();
  await sheet.getByTestId('rating-star').nth(3).click();
  await expect(sheet.getByTestId('rating-summary-count')).toHaveText('41 ratings');
  await expect(sheet.getByTestId('rating-your-rating')).toHaveText('Your rating 4');
  await expect(sheet.getByRole('button', { name: 'Anonymous responses', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('receipt')).toContainText('"anonymous":true');
  expect(JSON.parse(await page.getByTestId('receipt').innerText())).toHaveLength(1);
});

test('rating without media moves results into shared sheet after voting', async ({ page }) => {
  await page.goto(`${route}&media=none`);
  await expect(page.getByRole('button', { name: /View options|View results/ })).toHaveCount(0);
  await page.getByTestId('rating-star').nth(4).click();
  await expect(page.getByTestId('rating-summary-count')).toHaveText('41 ratings');
  await expect(page.getByTestId('rating-scale-results')).toHaveCount(0);
  await page.getByRole('button', { name: /View results/ }).click();
  await expect(page.getByRole('dialog').getByTestId('rating-your-rating')).toHaveText('Your rating 5');
});

test('failed rating remains retryable without showing successful results', async ({ page }) => {
  await page.goto(`${route}&fail`);
  await page.getByRole('button', { name: /View options/ }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByTestId('rating-star').nth(3).click();
  await expect(sheet.getByRole('alert').filter({ hasText: "Couldn't submit your rating" })).toBeVisible();
  await expect(page.getByTestId('rating-results-summary')).toHaveCount(0);
  await expect(sheet.getByTestId('rating-star').nth(2)).toBeEnabled();
  await sheet.getByTestId('rating-star').nth(2).click();
  await expect.poll(async () => JSON.parse(await page.getByTestId('receipt').innerText()).length).toBe(2);
});

test('private rating results never disclose summary, average or distribution', async ({ page }) => {
  for (const state of ['done', 'expired']) {
    await page.goto(`${route}&private&forced&${state}`);
    await expect(page.getByTestId('rating-results-summary')).toHaveCount(0);
    await expect(page.getByTestId('rating-average')).toHaveCount(0);
    await page.getByRole('button', { name: /View options|View results/ }).click();
    await expect(page.getByTestId('rating-results-summary')).toHaveCount(0);
    await expect(page.getByTestId('rating-scale-results')).toHaveCount(0);
    await expect(page.getByTestId('rating-star').first()).toBeDisabled();
    expect(await page.getByTestId('receipt').innerText()).toBe('[]');
  }
});

test('expired rating shows results without inventing a personal vote', async ({ page }) => {
  await page.goto(`${route}&expired`);
  await expect(page.getByTestId('rating-your-rating')).toHaveCount(0);
  await page.getByRole('button', { name: /View results/ }).click();
  await expect(page.getByTestId('rating-scale-results')).toBeVisible();
  await expect(page.getByTestId('rating-star')).toHaveCount(0);
  await expect(page.getByTestId('rating-your-rating')).toHaveCount(0);
});

test('rating share capture preserves its existing inline composition', async ({ page }) => {
  await page.goto(`${route}&capture&done`);
  await expect(page.getByRole('button', { name: /View options|View results/ })).toHaveCount(0);
  await expect(page.getByTestId('rating-results-summary')).toHaveCount(0);
  await expect(page.getByTestId('rating-average')).toBeVisible();
});
