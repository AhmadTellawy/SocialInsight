import path from 'node:path';
import { expect, test } from '@playwright/test';
import { computedTextContrast } from './contrast';

test('creator crop selected and unselected ratios remain readable in the production dark theme at 390px', async ({ page }, testInfo) => {
  const unexpectedApiRequests: string[] = [];
  await page.route('**/api/**', async route => {
    unexpectedApiRequests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Unexpected request in crop-only fixture' }) });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tests/post-ui-e2e/index.html?create=poll&dir=ltr');
  await expect(page.getByRole('button', { name: 'Add poll images', exact: true })).toBeVisible();
  // The existing creator harness uses Tailwind; load the same additional stylesheet as index.tsx.
  await page.addStyleTag({ path: path.resolve(process.cwd(), 'styles/theme.css') });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.style.colorScheme = 'dark';
  });
  await expect(page.locator('html')).toHaveCSS('--si-surface', '#111827');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(11, 18, 32)');

  await page.locator('input[type="file"][data-media-purpose="POST"]').setInputFiles(path.resolve(process.cwd(), 'public/pwa-192x192.png'));
  const editor = page.getByTestId('media-crop-editor');
  await expect(editor).toHaveAttribute('data-media-purpose', 'POST');
  const ratios = editor.getByRole('group', { name: 'Aspect ratio', exact: true });
  const presets = [{ name: 'Original', ratio: 1 }, { name: '1:1', ratio: 1 }, { name: '4:5', ratio: 0.8 }, { name: '1.91:1', ratio: 1.91 }];
  await expect(ratios.getByRole('button')).toHaveCount(presets.length);
  const measurements: Record<string, unknown>[] = [];
  for (const selected of presets) {
    await ratios.getByRole('button', { name: selected.name, exact: true }).click();
    for (const preset of presets) {
      const button = ratios.getByRole('button', { name: preset.name, exact: true });
      const pressed = preset.ratio === selected.ratio;
      await expect(button).toHaveAttribute('aria-pressed', String(pressed));
      await expect.poll(async () => (await computedTextContrast(button)).ratio, {
        message: `${preset.name} ${pressed ? 'selected' : 'unselected'} text contrast`,
      }).toBeGreaterThanOrEqual(4.5);
      measurements.push({ selected: selected.name, preset: preset.name, pressed, ...await computedTextContrast(button) });
    }
    await expect.poll(async () => {
      const bounds = await editor.locator('.reactEasyCrop_CropArea').boundingBox();
      return bounds ? bounds.width / bounds.height : 0;
    }).toBeCloseTo(selected.ratio, 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`creator-crop-dark-390-${selected.name.replaceAll(':', '-')}.png`) });
  }
  await testInfo.attach('creator-crop-contrast.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add poll images', exact: true })).toBeVisible();
  expect(unexpectedApiRequests).toEqual([]);
});
