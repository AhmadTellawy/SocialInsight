import { expect, test } from '@playwright/test';
import { installMockApp, makeState } from './mockApp';

test('built PWA shell exposes its manifest, registers a service worker, and renders the profile route', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'pwa-chromium', 'PWA smoke belongs to the service-worker-enabled project.');
  await installMockApp(page, makeState());
  await page.goto('/profile', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Media E2E Owner' })).toBeVisible({ timeout: 15_000 });
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBeTruthy();
  const manifest = await page.evaluate(async (href) => {
    const response = await fetch(href!);
    return { status: response.status, body: await response.json() };
  }, manifestHref);
  expect(manifest.status).toBe(200);
  expect(manifest.body).toMatchObject({
    name: 'SocialInsight',
    short_name: 'SocialInsight',
  });
  expect(Array.isArray(manifest.body.icons)).toBe(true);
  expect(manifest.body.icons.length).toBeGreaterThan(0);

  const serviceWorker = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return null;
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 15_000)),
    ]);
    if (!registration) return null;
    const worker = registration.active || registration.waiting || registration.installing;
    return worker ? new URL(worker.scriptURL).pathname : null;
  });
  expect(serviceWorker).toMatch(/\/sw\.js$/);
  const serviceWorkerResponse = await request.get('/sw.js');
  expect(serviceWorkerResponse.ok()).toBe(true);
  const serviceWorkerSource = await serviceWorkerResponse.text();
  expect(serviceWorkerSource).not.toContain('libheif');
});
