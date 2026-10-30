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
  const retry = page.getByTestId('media-photo-flow').getByRole('button', { name: 'Retry', exact: true }).first();
  await expect(retry).toBeDisabled();
  expect(warmups).toBe(2);
  second.release();
  await expect(page.getByTestId('media-photo-flow').getByRole('button', { name: 'Retry', exact: true })).toHaveCount(2);
  await expect(retry).toBeEnabled();
  await retry.focus(); await page.keyboard.press('Enter');
  await expect(page.getByTestId('media-photo-flow')).toBeVisible();
  await expect.poll(async () => (await readDrafts(page))[0]?.status).toBe('editing');
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
  await expect(page.getByTestId('media-photo-flow').getByRole('alert')).toContainText('Try again or remove it');
  const first = await readDrafts(page);
  expect(first).toHaveLength(1);
  expect(first[0]).toMatchObject({ status: 'error', name: 'selected.heic' });
  expect(uploads).toBe(0);
  await expect(page.getByRole('button', { name: 'Submit fixture', exact: true })).toBeDisabled();
  await page.getByTestId('media-photo-flow').getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByTestId('media-photo-flow')).toBeVisible();
  await expect.poll(async () => (await readDrafts(page))[0]?.status).toBe('editing');
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
  const waiting = page.getByTestId('media-photo-flow').getByRole('status');
  await expect(waiting).toBeVisible();
  await page.getByTestId('media-photo-flow').getByRole('button', { name: 'إلغاء', exact: true }).click();
  await expect(page.getByTestId('drafts')).toHaveText('[]');
  await expect.poll(() => page.evaluate(() => (window as any).abortedMediaRequests)).toContain('/api/media/heif/warmup');
  warmup.release();
  await expect(waiting).toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles(heifFile());
  await expect(page.getByTestId('media-photo-flow').getByRole('alert')).toContainText('تعذر تجهيز الصورة الآن');
  expect(warmups).toBe(2);
  expect(uploads).toBe(0);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('media-photo-flow').getByRole('button', { name: 'التالي', exact: true })).toBeDisabled();
});

test('ordinary images bypass config and warmup entirely', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/**', async route => { requests.push(route.request().url()); await route.abort(); });
  await fixture(page);
  await page.locator('input[type=file]').setInputFiles(path.resolve(process.cwd(), 'public/pwa-192x192.png'));
  await expect(page.getByTestId('media-photo-flow')).toBeVisible();
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
  await expect(page.getByTestId('media-photo-flow')).toBeVisible();
  await expect.poll(() => warmups).toBe(1);
  const drafts = await readDrafts(page);
  expect(drafts.map((draft: any) => draft.name)).toEqual(['selected.heic', 'ordinary.png']);
  expect(drafts[0].status).toBe('processing');
  expect(drafts[1].status).toBe('editing');
  expect(drafts[1].aspectRatio).toBe(1);
  warmup.release();
  await expect(page.getByTestId('media-photo-flow').getByRole('alert')).toContainText('Try again or remove it');
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
  await page.getByRole('button', { name: 'Close picker', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(() => deletes).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).abortedMediaRequests)).toContain('/api/media/prepared-asset/prepare');
  preparation.release();
  await expect(page.getByTestId('media-photo-flow')).toHaveCount(0);
  await expect(page.getByTestId('asset-ids')).toHaveText('[]');
});

test('late HEIF preparation keeps source identity and batch selection until both images are ready', async ({ page }) => {
  const preparation = pending(); let prepared = false;
  const finalized: any[] = []; let uploads = 0;
  await page.route('**/api/media/**', async route => {
    const request = route.request(); const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/config')) return route.fulfill({ json: { heifServerPreparationConfigured: true, heifServerPreparationEnabled: true } });
    if (pathname.endsWith('/uploads')) return route.fulfill({ json: { assetId: 'asset-' + ++uploads, signedUrl: 'http://127.0.0.1:4187/synthetic-upload' } });
    if (pathname.endsWith('/prepare')) { await preparation.promise; prepared = true; return route.fulfill({ json: { ...preview, id: 'asset-1' } }); }
    if (pathname.endsWith('/finalize')) {
      const crop = request.postDataJSON(); finalized.push(crop);
      return route.fulfill({ json: { id: pathname.split('/').at(-2), aspectRatio: crop.aspectRatio, width: 192, height: Math.round(192 / crop.aspectRatio) } });
    }
    return route.fulfill({ json: {} });
  });
  await page.route('**/synthetic-upload', route => route.fulfill({ status: 200 }));
  await fixture(page);
  const png = await import('node:fs/promises').then(fs => fs.readFile(path.resolve(process.cwd(), 'public/pwa-192x192.png')));
  await page.locator('input[type=file]').setInputFiles([heifFile(), { name: 'ordinary.png', mimeType: 'image/png', buffer: png }]);
  const editor = page.getByTestId('media-photo-flow');
  await expect.poll(async () => (await readDrafts(page))[1]?.status).toBe('editing');
  await expect(editor.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  expect(finalized).toHaveLength(0);
  preparation.release();
  await expect(editor.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
  expect(prepared).toBe(true);
  await editor.getByRole('button', { name: 'Next', exact: true }).click();
  await editor.getByRole('button', { name: 'Aspect ratio', exact: true }).click();
  await editor.getByRole('button', { name: 'Portrait 4:5', exact: true }).click();
  await editor.getByRole('button', { name: 'Done', exact: true }).click();
  await editor.getByRole('button', { name: 'Next', exact: true }).click();
  await expect.poll(async () => (await readDrafts(page)).map((d: any) => d.status)).toEqual(['ready', 'ready']);
  expect(finalized.map(c => c.aspectRatio).sort()).toEqual([.8, 1]);
  expect((await readDrafts(page)).map((d: any) => d.name)).toEqual(['selected.heic', 'ordinary.png']);
  expect(uploads).toBe(2);
});
