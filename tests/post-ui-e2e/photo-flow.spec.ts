import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('../../server/node_modules/sharp');

async function image(name = 'portrait.png', width = 800, height = 1200) {
  const buffer = await sharp({ create: { width, height, channels: 3, background: '#619eaf' } })
    .composite([{ input: Buffer.from('<svg width="800" height="1200"><rect x="0" y="100" width="800" height="150" fill="#f04444"/><circle cx="400" cy="600" r="160" fill="#f6dfb5"/></svg>'), top: 0, left: 0 }].filter(() => width >= 800 && height >= 1200))
    .png().toBuffer();
  return { name, mimeType: 'image/png', buffer };
}
async function mockMedia(page: Page, failFirst = false) {
  const finalized: any[] = []; const deleted: string[] = []; let uploads = 0; let failed = false;
  await page.addInitScript(() => {
    sessionStorage.setItem('si_csrf_token', 'synthetic-csrf-token-long');
    sessionStorage.setItem('si_auth_identity', 'synthetic-user');
  });
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/api/media/**', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname.endsWith('/config')) return route.fulfill({ json: { heifServerPreparationConfigured: true, heifServerPreparationEnabled: true } });
    if (url.pathname.endsWith('/uploads')) return route.fulfill({ json: { assetId: 'asset-' + ++uploads, signedUrl: 'http://127.0.0.1:4187/synthetic-upload' } });
    if (request.method() === 'DELETE') { deleted.push(url.pathname); return route.fulfill({ json: {} }); }
    if (url.pathname.endsWith('/finalize') || url.pathname.endsWith('/retry')) {
      const crop = request.postDataJSON(); finalized.push(crop);
      if (failFirst && !failed) { failed = true; return route.fulfill({ status: 500, json: { message: 'Synthetic upload failure' } }); }
      return route.fulfill({ json: { id: url.pathname.split('/')[3], aspectRatio: crop.aspectRatio, width: 800, height: Math.round(800 / crop.aspectRatio), status: 'READY' } });
    }
    if (request.method() === 'GET') return route.fulfill({ json: { id: url.pathname.split('/')[3], access: 'RESTRICTED', aspectRatio: .8, width: 800, height: 1000, src: '/pwa-192x192.png' } });
    return route.fulfill({ json: {} });
  });
  await page.route('**/synthetic-upload', route => route.fulfill({ status: 200 }));
  return { finalized, deleted, uploads: () => uploads };
}
const flow = (page: Page) => page.getByTestId('media-photo-flow');
const next = (page: Page) => flow(page).getByRole('button', { name: 'Next', exact: true }).click();
async function ratio(page: Page, name: string, all = false) {
  await flow(page).getByRole('button', { name: 'Aspect ratio', exact: true }).click();
  await flow(page).locator('[data-ratio-sheet]').getByRole('button', { name: new RegExp('^' + name) }).click();
  if (all) await flow(page).getByRole('checkbox').check();
  await flow(page).getByRole('button', { name: 'Done', exact: true }).click();
}
async function fixture(page: Page, lang = 'en') {
  await page.goto('/tests/post-ui-e2e/photo-fixture/index.html?lang=' + lang);
}
const drafts = async (page: Page) => JSON.parse(await page.getByTestId('drafts').textContent() || '[]');

test('browser back cancels the photo flow and releases scrolling', async ({ page }) => {
  await mockMedia(page); await fixture(page);
  const previousOverflow = await page.evaluate(() => document.body.style.overflow);
  await page.locator('input[type=file]').setInputFiles(await image());
  await expect(flow(page).getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
  await page.goBack();
  await expect(flow(page)).toHaveCount(0);
  await expect(page.getByTestId('drafts')).toHaveText('[]');
  expect(await page.evaluate(() => document.body.style.overflow)).toBe(previousOverflow);
});

test('invalid option file and canceled replacement preserve names, slots and original assets', async ({ page }) => {
  const network = await mockMedia(page);
  await page.route('https://cdn.tailwindcss.com/**', route => route.fulfill({ body: '' }));
  await page.goto('/tests/post-ui-e2e/index.html?creatorSteps&create=poll&stepsImages&blankPhotoOptions');
  await page.addStyleTag({ url: '/styles/tailwind.css' });
  await page.locator('input[data-media-purpose="OPTION_IMAGE"][multiple]').setInputFiles([
    await image('one.png'), await image('two.png'),
    { name: 'corrupt.png', mimeType: 'image/png', buffer: Buffer.from('invalid image') }
  ]);
  await expect(flow(page).getByRole('alert')).toBeVisible();
  await next(page); await next(page);
  await expect.poll(() => network.finalized.length).toBe(2);
  const names = page.getByPlaceholder(/^Option (?:name )?[0-9]+$/);
  await expect(names).toHaveCount(2);
  await names.nth(0).fill('Keep first'); await names.nth(1).fill('Keep second');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Replace image for option 2', exact: true }).click();
  await (await chooser).setFiles(await image('replacement.png'));
  await expect(flow(page).getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
  await flow(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(names).toHaveCount(2);
  await expect(names.nth(0)).toHaveValue('Keep first');
  await expect(names.nth(1)).toHaveValue('Keep second');
  expect(network.uploads()).toBe(2);
});

test('square → portrait → original uses unchanged source, and upload sends the expanded crop', async ({ page }) => {
  const network = await mockMedia(page); await fixture(page);
  await page.locator('input[type=file]').setInputFiles(await image());
  await expect(flow(page).getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
  await expect.poll(() => flow(page).locator('img').evaluateAll(images => images.every((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))).toBe(true);
  const viewport = flow(page).getByTestId('source-crop').first();
  expect(JSON.parse(await viewport.getAttribute('data-crop') || '{}')).toMatchObject({ width: 1, height: 2 / 3 });
  const source = await viewport.locator('img').getAttribute('src');
  await next(page); await ratio(page, 'Portrait');
  expect(JSON.parse(await viewport.getAttribute('data-crop') || '{}').height).toBeCloseTo(5 / 6);
  await page.screenshot({ path: test.info().outputPath('portrait.png') });
  await ratio(page, 'Original');
  expect(JSON.parse(await viewport.getAttribute('data-crop') || '{}')).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  expect(await viewport.locator('img').getAttribute('src')).toBe(source);
  await ratio(page, 'Portrait'); await next(page);
  await expect(flow(page)).toHaveCount(0);
  await expect.poll(async () => (await drafts(page))[0]?.status).toBe('ready');
  expect(network.finalized[0].crop.height).toBeCloseTo(5 / 6);
  expect(network.finalized[0].crop.width).toBe(1);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await ratio(page, 'Original'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  expect((await drafts(page))[0].crop.aspectRatio).toBe(.8);
  expect(network.uploads()).toBe(1);
});

test('selection order, collapsing preview, mixed originals and apply-all', async ({ page }) => {
  const network = await mockMedia(page); await fixture(page);
  await page.locator('input[type=file]').setInputFiles([await image('one.png'), await image('two.png', 1200, 800), await image('three.png', 900, 900)]);
  await expect(flow(page).getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
  await flow(page).getByRole('button', { name: 'Multiple selected', exact: true }).click();
  await expect(flow(page).getByText('1 selected', { exact: true })).toBeVisible();
  await flow(page).getByRole('button', { name: 'Select multiple', exact: true }).click();
  await flow(page).getByRole('button', { name: 'Photo 2', exact: true }).click();
  await flow(page).getByRole('button', { name: 'Photo 3', exact: true }).click();
  await expect(flow(page).getByText('3 selected', { exact: true })).toBeVisible();
  await flow(page).getByRole('button', { name: 'Photo 1', exact: true }).click();
  await flow(page).getByRole('button', { name: 'Photo 1', exact: true }).click();
  await flow(page).getByRole('button', { name: 'More photos', exact: true }).click();
  expect((await flow(page).getByTestId('photo-selection-preview').boundingBox())!.height).toBeLessThan(150);
  await next(page); await ratio(page, 'Original', true); await next(page);
  await expect.poll(async () => (await drafts(page)).filter((d: any) => d.status === 'ready').length).toBe(3);
  expect((await drafts(page)).map((d: any) => d.name)).toEqual(['two.png', 'three.png', 'one.png']);
  expect(network.finalized.map(d => d.aspectRatio).sort()).toEqual([2 / 3, 1, 1.5].sort());
});

test('cancel and max eight leave no stray uploads; Arabic fits a narrow phone', async ({ page }) => {
  const network = await mockMedia(page); await page.setViewportSize({ width: 320, height: 740 }); await fixture(page, 'ar');
  const file = await image();
  await page.locator('input[type=file]').setInputFiles(Array.from({ length: 9 }, (_, index) => ({ ...file, name: index + '.png' })));
  await expect(flow(page)).toHaveAttribute('dir', 'rtl');
  await expect.poll(async () => (await drafts(page)).length).toBe(8);
  await expect(flow(page).getByRole('alert')).toBeVisible();
  await expect.poll(async () => (await drafts(page)).map((draft: any) => draft.status), { timeout: 15000 }).toEqual(Array(8).fill('editing'));
  await expect(flow(page).getByRole('button', { name: 'التالي', exact: true })).toBeEnabled();
  await expect.poll(() => flow(page).locator('img').evaluateAll(images => images.every((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))).toBe(true);
  expect(await flow(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('arabic-selection.png') });
  await flow(page).getByRole('button', { name: 'إلغاء', exact: true }).click();
  await expect(page.getByTestId('drafts')).toHaveText('[]');
  expect(network.uploads()).toBe(0);
});

test('failed finalize retries without losing original crop', async ({ page }) => {
  const network = await mockMedia(page, true); await fixture(page);
  await page.locator('input[type=file]').setInputFiles(await image());
  await next(page); await ratio(page, 'Portrait'); await next(page);
  await expect.poll(async () => (await drafts(page))[0]?.status).toBe('error');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.poll(async () => (await drafts(page))[0]?.status).toBe('ready');
  expect(network.finalized).toHaveLength(2);
  expect(network.finalized[1]).toEqual(network.finalized[0]);
});

for (const kind of ['poll', 'survey', 'quiz', 'challenge']) {
test(`${kind} creator returns selected photos to named option rows and submits their asset IDs`, async ({ page }) => {
  await mockMedia(page);
  // Use the same compiled styles as production, avoiding the external fixture CDN.
  await page.route('https://cdn.tailwindcss.com/**', route => route.fulfill({ body: '' }));
  await page.goto('/tests/post-ui-e2e/index.html?creatorSteps&create=' + kind + '&stepsImages&blankPhotoOptions' + (kind === 'quiz' ? '&singleQuiz' : ''));
  await page.addStyleTag({ url: '/styles/tailwind.css' });
  await page.locator('input[data-media-purpose="OPTION_IMAGE"][multiple]').setInputFiles([await image('a.png'), await image('b.png')]);
  await next(page); await ratio(page, 'Portrait', true); await next(page);
  const one = page.getByPlaceholder(kind === 'challenge' ? 'Item 1 Name' : /^Option (?:name )?1$/).first();
  const two = page.getByPlaceholder(kind === 'challenge' ? 'Item 2 Name' : /^Option (?:name )?2$/).first();
  await one.fill('Coastal blue'); await two.fill('Warm sand');
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('option-names.png'), fullPage: true });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByTestId('step-submit-count')).toHaveText('1');
  const payload = JSON.parse(await page.getByTestId('step-submit-payload').textContent() || '{}');
  const options = payload.options || payload.sections[0].questions[0].options;
  expect(options.map((o: any) => o.text)).toEqual(['Coastal blue', 'Warm sand']);
  expect(options.every((o: any) => o.imageMediaId)).toBe(true);
});
}

test('post photos return as cropped attachments without changing text options', async ({ page }) => {
  const network = await mockMedia(page);
  await page.route('https://cdn.tailwindcss.com/**', route => route.fulfill({ body: '' }));
  await page.goto('/tests/post-ui-e2e/index.html?creatorSteps&create=poll');
  await page.addStyleTag({ url: '/styles/tailwind.css' });
  const originalNames = await page.getByPlaceholder(/^Option (?:name )?[12]$/).evaluateAll(inputs => inputs.map((input: HTMLInputElement) => input.value));
  await page.locator('input[data-media-purpose="POST"]').setInputFiles([await image(), await image('wide.png', 1200, 800)]);
  await next(page); await ratio(page, 'Original', true); await next(page);
  await expect.poll(() => network.finalized.length).toBe(2);
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByTestId('step-submit-count')).toHaveText('1');
  const payload = JSON.parse(await page.getByTestId('step-submit-payload').textContent() || '{}');
  expect(payload.mediaAssetIds).toEqual(['image-0', 'image-1', 'image-2', 'asset-1', 'asset-2']);
  expect(payload.options.map((o: any) => o.text)).toEqual(originalNames);
});
