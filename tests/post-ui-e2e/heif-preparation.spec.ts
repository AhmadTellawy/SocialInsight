import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Structurally bounded synthetic HEIF is never decoded in the browser. The
// converter response is mocked; real codec/security evidence belongs to Linux.
const heifFile = () => {
  const bytes = Buffer.alloc(57);
  bytes.writeUInt32BE(20, 0); bytes.write('ftyp', 4); bytes.write('heic', 8); bytes.write('heic', 16);
  bytes.writeUInt32BE(8, 20); bytes.write('hvcC', 24);
  bytes.writeUInt32BE(20, 28); bytes.write('ispe', 32); bytes.writeUInt32BE(640, 40); bytes.writeUInt32BE(480, 44);
  bytes.writeUInt32BE(9, 48); bytes.write('mdat', 52); bytes[56] = 1;
  return { name: 'selected.heic', mimeType: 'image/heic', buffer: bytes };
};
const pending = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
};
const readDrafts = async (page: Page) => JSON.parse(await page.getByTestId('drafts').textContent() || '[]');
const preview = {
  id: 'prepared-asset', status: 'TEMPORARY', sourceMime: 'image/heic',
  preview: { src: '/pwa-192x192.png', mime: 'image/webp', width: 192, height: 192, aspectRatio: 1, expiresInSeconds: 300 }
};
async function fixture(page: Page, language = 'en') {
  await page.addInitScript(() => {
    sessionStorage.setItem('si_csrf_token', 'synthetic-csrf-token-long');
    sessionStorage.setItem('si_auth_identity', 'synthetic-user');
    const originalFetch = window.fetch;
    (window as any).abortedMediaRequests = [];
    window.fetch = (input, init) => {
      init?.signal?.addEventListener('abort', () => (window as any).abortedMediaRequests.push(String(input)), { once: true });
      return originalFetch(input, init);
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/tests/post-ui-e2e/heif-fixture/index.html?lang=${language}`);
  await expect(page.getByRole('button', { name: 'Submit fixture', exact: true })).toBeVisible();
}

test('failed HEIF retry waits visibly for the other pending batch item', async ({ page }) => {
  const second = pending(); let warmups = 0;
  await page.route('**/api/media/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/config')) return route.fulfill({ json: { heifServerPreparationConfigured: true, heifServerPreparationEnabled: false } });
    if (pathname.endsWith('/heif/warmup')) {
      const call = ++warmups;
      if (call === 2) await second.promise;
      return route.fulfill({ json: { heifServerPreparationEnabled: call > 2 } });
    }
    if (pathname.endsWith('/uploads')) return route.fulfill({ json: { assetId: 'prepared-asset', signedUrl: 'http://127.0.0.1:4187/synthetic-upload' } });
    if (pathname.endsWith('/prepare')) return route.fulfill({ json: preview });
    if (route.request().method() === 'DELETE') return route.fulfill({ json: {} });
    throw new Error(`Unexpected route ${pathname}`);
  });
  await page.route('**/synthetic-upload', route => route.fulfill({ status: 200, body: '' }));
  await fixture(page);
  await page.locator('input[type=file]').setInputFiles([{ ...heifFile(), name: 'first.heic' }, { ...heifFile(), name: 'second.heic' }]);
  await expect.poll(() => warmups).toBe(2);
  const retry = page.getByRole('button', { name: 'Retry', exact: true }).first();
  await expect(retry).toBeDisabled();
  const describedBy = await retry.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`[id="${describedBy}"]`)).toContainText('Preparing your images');
  expect(warmups).toBe(2);
  second.release();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(2);
  await expect(retry).toBeEnabled();
  await retry.focus(); await page.keyboard.press('Enter');
  await expect(page.getByTestId('media-crop-editor')).toBeVisible();
  expect(warmups).toBe(3);
  await page.keyboard.press('Escape');
});

test('cold HEIF failure retains the selected file and retry creates one prepared asset', async ({ page }) => {
  let configs = 0, warmups = 0, uploads = 0, preparations = 0, deletes = 0;
  await page.route('**/api/media/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    let body: object;
    if (pathname.endsWith('/config')) { configs++; body = { heifServerPreparationConfigured: true, heifServerPreparationEnabled: false }; }
    else if (pathname.endsWith('/heif/warmup')) {
      warmups++; expect(request.method()).toBe('POST'); expect(request.postData()).toBeNull();
      expect(request.headers()['x-csrf-token']).toBe('synthetic-csrf-token-long');
      body = { heifServerPreparationEnabled: warmups > 1 };
    } else if (pathname.endsWith('/uploads')) {
      uploads++; body = { assetId: 'prepared-asset', signedUrl: 'http://127.0.0.1:4187/synthetic-upload' };
    } else if (pathname.endsWith('/prepare')) { preparations++; body = preview; }
    else if (request.method() === 'DELETE') { deletes++; body = {}; }
    else throw new Error(`Unexpected media route ${pathname}`);
    await route.fulfill({ json: body });
  });
  await page.route('**/synthetic-upload', route => route.fulfill({ status: 200, body: '' }));
  await fixture(page);
  await page.locator('input[type=file]').setInputFiles(heifFile());
  await expect(page.getByRole('alert')).toContainText('Try again or remove it');
  const first = await readDrafts(page);
  expect(first).toHaveLength(1);
  expect(first[0]).toMatchObject({ status: 'error', name: 'selected.heic' });
  expect(uploads).toBe(0);
  await expect(page.getByRole('button', { name: 'Submit fixture', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByTestId('media-crop-editor')).toBeVisible();
  const retry = await readDrafts(page);
  expect(retry[0]).toMatchObject({ clientId: first[0].clientId, status: 'editing', assetId: 'prepared-asset' });
  expect({ configs, warmups, uploads, preparations }).toEqual({ configs: 2, warmups: 2, uploads: 1, preparations: 1 });
  await expect(page.getByTestId('asset-ids')).toHaveText('[]');
  await expect(page.getByRole('button', { name: 'Submit fixture', exact: true })).toBeDisabled();
  // Exercise the real editor's keyboard cancellation without depending on the
  // fixture's minimal layout (production Tailwind visual QA is separate).
  await page.keyboard.press('Escape');
  await expect.poll(() => deletes).toBe(1);
  await expect(page.getByTestId('drafts')).toHaveText('[]');
});

test('Arabic waiting is cancelable and later selection can warm again without stale results', async ({ page }) => {
  const warmup = pending();
  let warmups = 0, uploads = 0;
  await page.route('**/api/media/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/config')) return route.fulfill({ json: { heifServerPreparationConfigured: true, heifServerPreparationEnabled: false } });
    if (pathname.endsWith('/heif/warmup')) {
      warmups++;
      if (warmups === 1) await warmup.promise;
      await route.fulfill({ json: { heifServerPreparationEnabled: false } }).catch(() => {});
      return;
    }
    uploads++;
    throw new Error(`Unexpected upload after canceled warmup ${pathname}`);
  });
  await fixture(page, 'ar');
  await page.locator('input[type=file]').setInputFiles(heifFile());
  await expect.poll(() => warmups).toBe(1);
  const waiting = page.getByRole('status').filter({ hasText: 'جارٍ تجهيز الصور' });
  await expect(waiting).toBeVisible();
  await page.getByRole('button', { name: 'إلغاء التجهيز', exact: true }).click();
  await expect(page.getByTestId('drafts')).toHaveText('[]');
  await expect.poll(() => page.evaluate(() => (window as any).abortedMediaRequests)).toContain('/api/media/heif/warmup');
  warmup.release();
  await expect(waiting).toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles(heifFile());
  await expect(page.getByRole('alert')).toContainText('تعذر تجهيز الصورة الآن');
  expect(warmups).toBe(2);
  expect(uploads).toBe(0);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('media-crop-editor')).toHaveCount(0);
});

test('ordinary images bypass config and warmup entirely', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/**', async route => { requests.push(route.request().url()); await route.abort(); });
  await fixture(page);
  await page.locator('input[type=file]').setInputFiles(path.resolve(process.cwd(), 'public/pwa-192x192.png'));
  await expect(page.getByTestId('media-crop-editor')).toBeVisible();
  expect(requests).toEqual([]);
  expect((await readDrafts(page))[0]).toMatchObject({ status: 'editing', serverPrepared: false });
});

test('ordinary image in a mixed selection opens before cold HEIF and selected order stays intact', async ({ page }) => {
  const warmup = pending();
  let warmups = 0;
  await page.route('**/api/media/**', async route => {
    if (new URL(route.request().url()).pathname.endsWith('/config')) return route.fulfill({ json: { heifServerPreparationConfigured: true, heifServerPreparationEnabled: false } });
    warmups++;
    await warmup.promise;
    await route.fulfill({ json: { heifServerPreparationEnabled: false } }).catch(() => {});
  });
  await fixture(page);
  const png = await import('node:fs/promises').then(fs => fs.readFile(path.resolve(process.cwd(), 'public/pwa-192x192.png')));
  await page.locator('input[type=file]').setInputFiles([heifFile(), { name: 'ordinary.png', mimeType: 'image/png', buffer: png }]);
  await expect(page.getByTestId('media-crop-editor')).toBeVisible();
  await expect.poll(() => warmups).toBe(1);
  const drafts = await readDrafts(page);
  expect(drafts.map((draft: any) => draft.name)).toEqual(['selected.heic', 'ordinary.png']);
  expect(drafts[0].status).toBe('processing');
  expect(drafts[1].status).toBe('editing');
  expect(drafts[1].aspectRatio).toBeCloseTo(4 / 3);
  warmup.release();
  await expect(page.getByRole('alert')).toContainText('Try again or remove it');
});

test('closing the picker cancels active preparation and cleans its temporary asset', async ({ page }) => {
  const preparation = pending();
  let preparations = 0, deletes = 0;
  await page.route('**/api/media/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/config')) return route.fulfill({ json: { heifServerPreparationConfigured: true, heifServerPreparationEnabled: true } });
    if (pathname.endsWith('/uploads')) return route.fulfill({ json: { assetId: 'prepared-asset', signedUrl: 'http://127.0.0.1:4187/synthetic-upload' } });
    if (pathname.endsWith('/prepare')) {
      preparations++;
      await preparation.promise;
      await route.fulfill({ json: preview }).catch(() => {});
      return;
    }
    if (request.method() === 'DELETE') { deletes++; return route.fulfill({ json: {} }); }
    throw new Error(`Unexpected route ${pathname}`);
  });
  await page.route('**/synthetic-upload', route => route.fulfill({ status: 200, body: '' }));
  await fixture(page);
  await page.locator('input[type=file]').setInputFiles(heifFile());
  await expect.poll(() => preparations).toBe(1);
  await page.getByRole('button', { name: 'Close picker', exact: true }).click();
  await expect.poll(() => deletes).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).abortedMediaRequests)).toContain('/api/media/prepared-asset/prepare');
  preparation.release();
  await expect(page.getByTestId('media-crop-editor')).toHaveCount(0);
  await expect(page.getByTestId('asset-ids')).toHaveText('[]');
});

for (const peerStatus of ['ready', 'processing'] as const) {
test(`mixed images keep one finalized frame when the first HEIF becomes editable last (${peerStatus} peer)`, async ({ page }, testInfo) => {
  const warmup = pending();
  const ordinaryFinalization = pending();
  const assets = new Map<string, { mime: string; ratio?: number }>();
  const finalized: Array<{ id: string; crop: { aspectRatio: number; crop: { x: number; y: number; width: number; height: number } } }> = [];
  const posts: Array<{ ids: string[]; requestedRatio: number; storedRatios: number[]; accepted: boolean }> = [];
  let warmups = 0;
  await page.route('**/api/media/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/config')) return route.fulfill({ json: { heifServerPreparationConfigured: true, heifServerPreparationEnabled: false } });
    if (pathname.endsWith('/heif/warmup')) {
      warmups++;
      await warmup.promise;
      return route.fulfill({ json: { heifServerPreparationEnabled: true } });
    }
    if (pathname.endsWith('/uploads')) {
      const { mime } = request.postDataJSON();
      const id = mime === 'image/png' ? 'ordinary-asset' : 'heif-asset';
      expect(assets.has(id)).toBe(false);
      assets.set(id, { mime });
      return route.fulfill({ json: { assetId: id, signedUrl: `http://127.0.0.1:4187/synthetic-upload/${id}` } });
    }
    if (pathname.endsWith('/prepare')) return route.fulfill({ json: { ...preview, id: 'heif-asset' } });
    if (pathname.endsWith('/finalize')) {
      const id = pathname.split('/').at(-2)!;
      const crop = request.postDataJSON();
      expect(assets.has(id)).toBe(true);
      expect(crop.crop.width).toBeGreaterThan(0);
      expect(crop.crop.height).toBeGreaterThan(0);
      assets.get(id)!.ratio = crop.aspectRatio;
      finalized.push({ id, crop });
      if (id === 'ordinary-asset' && peerStatus === 'processing') await ordinaryFinalization.promise;
      return route.fulfill({ json: { id, aspectRatio: crop.aspectRatio, width: Math.round(1200 * crop.aspectRatio), height: 1200 } });
    }
    throw new Error(`Unexpected mixed-frame media route ${pathname}`);
  });
  await page.route('**/synthetic-upload/*', route => route.fulfill({ status: 200, body: '' }));
  // Deterministic response fixture applies the existing server's 1% frame
  // contract to ratios stored by actual UI finalize requests; no DB/codec claim.
  await page.route('**/api/heif-fixture/posts', async route => {
    const { mediaAssetIds: ids, mediaAspectRatio: requestedRatio } = route.request().postDataJSON();
    const storedRatios = ids.map((id: string) => assets.get(id)?.ratio);
    const first = storedRatios[0];
    const accepted = ids.length === 2 && storedRatios.every((ratio: number) => ratio && Math.abs(ratio - first) / first <= 0.01)
      && Math.abs(requestedRatio - first) / first <= 0.01;
    posts.push({ ids, requestedRatio, storedRatios, accepted });
    await route.fulfill({ status: accepted ? 200 : 409, json: accepted ? { id: 'synthetic-post' } : { code: 'MEDIA_RATIO_MISMATCH' } });
  });
  await fixture(page);
  const png = await import('node:fs/promises').then(fs => fs.readFile(path.resolve(process.cwd(), 'public/pwa-192x192.png')));
  await page.locator('input[type=file]').setInputFiles([heifFile(), { name: 'ordinary.png', mimeType: 'image/png', buffer: png }]);
  const editor = page.getByTestId('media-crop-editor');
  await expect(editor).toBeVisible();
  await expect.poll(() => warmups).toBe(1);
  await expect(editor.getByRole('button', { name: 'Done', exact: true })).toBeEnabled();
  await editor.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(() => finalized.length).toBe(1);
  await expect.poll(async () => (await readDrafts(page))[1]?.status).toBe(peerStatus);
  expect(finalized.map(({ id, crop }) => ({ id, ratio: crop.aspectRatio }))).toEqual([{ id: 'ordinary-asset', ratio: 4 / 3 }]);
  expect((await readDrafts(page))[0].status).toBe('processing');
  await expect(page.getByRole('button', { name: 'Submit fixture', exact: true })).toBeDisabled();

  warmup.release();
  await expect(editor).toBeVisible();
  const square = editor.getByRole('group', { name: 'Aspect ratio', exact: true }).getByRole('button', { name: '1:1', exact: true });
  // Replays the reported user action on the old UI. The corrected UI must
  // retain the already-finalized frame and therefore offers no square preset.
  if (await square.count()) await square.click();
  await expect(editor.getByRole('button', { name: 'Done', exact: true })).toBeEnabled();
  await editor.getByRole('button', { name: 'Done', exact: true }).click();
  ordinaryFinalization.release();
  await expect.poll(async () => (await readDrafts(page)).map((draft: any) => draft.status)).toEqual(['ready', 'ready']);
  await expect(page.getByRole('button', { name: 'Submit fixture', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Submit fixture', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  const observation = JSON.stringify({ peerStatus, finalized, posts, drafts: await readDrafts(page) }, null, 2);
  const observationPath = testInfo.outputPath('mixed-frame-observation.json');
  await import('node:fs/promises').then(fs => fs.writeFile(observationPath, observation + '\n'));
  await testInfo.attach('mixed-frame-observation.json', { path: observationPath, contentType: 'application/json' });
  await expect(page.getByTestId('submission')).toHaveText('accepted');
  expect(finalized.map(({ crop }) => crop.aspectRatio)).toEqual([4 / 3, 4 / 3]);
  expect(posts[0]).toMatchObject({ ids: ['heif-asset', 'ordinary-asset'], requestedRatio: 4 / 3, accepted: true });
});
}
