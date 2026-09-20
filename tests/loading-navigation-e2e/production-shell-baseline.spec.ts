import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const samples = Number(process.env.LOADING_NAV_SAMPLES || 20);

const percentile = (values: number[], ratio: number): number => {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)];
};

const blockProductionWrites = async (page: Page): Promise<void> => {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      if (/\/analytics\/|\/views\/?$/.test(pathname)) {
        await route.fulfill({ status: 204, body: '' });
        return;
      }
      throw new Error(`Production baseline attempted an unexpected ${request.method()} ${pathname}`);
    }
    await route.continue();
  });
};

const measureShell = async (page: Page, action: () => Promise<unknown>): Promise<number> => {
  const startedAt = performance.now();
  await action();
  await expect(page.getByRole('button', { name: /login/i })).toBeVisible();
  return Math.round(performance.now() - startedAt);
};

test('records production guest cold and warm shell timing without writes', async ({ browser }, testInfo) => {
  test.setTimeout(Math.max(180_000, samples * 30_000));
  const cold: number[] = [];
  const warm: number[] = [];
  const assets = new Set<string>();

  for (let index = 0; index < samples; index += 1) {
    const context: BrowserContext = await browser.newContext({
      viewport: { width: 393, height: 727 },
      deviceScaleFactor: 2.75,
      isMobile: true,
      hasTouch: true,
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    await blockProductionWrites(page);
    page.on('response', (response) => {
      const pathname = new URL(response.url()).pathname;
      if (pathname.startsWith('/assets/')) assets.add(pathname);
    });
    cold.push(await measureShell(page, () => page.goto(`${testInfo.project.use.baseURL}/`, { waitUntil: 'domcontentloaded' })));
    await context.close();
  }

  const warmContext = await browser.newContext({
    viewport: { width: 393, height: 727 },
    deviceScaleFactor: 2.75,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  });
  const warmPage = await warmContext.newPage();
  await blockProductionWrites(warmPage);
  await measureShell(warmPage, () => warmPage.goto(`${testInfo.project.use.baseURL}/`, { waitUntil: 'domcontentloaded' }));
  for (let index = 0; index < samples; index += 1) {
    warm.push(await measureShell(warmPage, () => warmPage.reload({ waitUntil: 'domcontentloaded' })));
  }
  await warmPage.screenshot({ path: testInfo.outputPath('production-guest-shell.png'), fullPage: true });
  await warmContext.close();

  const evidence = {
    environment: testInfo.project.use.baseURL,
    viewport: testInfo.project.use.viewport,
    user_agent_profile: 'Playwright Pixel 5 geometry / Chromium',
    service_workers: 'blocked for comparable document-shell timing',
    cache_conditions: { cold: 'new browser context per sample', warm: 'reload in one browser context' },
    sample_size_each: samples,
    cold_ms: { p50: percentile(cold, 0.5), p75: percentile(cold, 0.75), p95: percentile(cold, 0.95), raw: cold },
    warm_ms: { p50: percentile(warm, 0.5), p75: percentile(warm, 0.75), p95: percentile(warm, 0.95), raw: warm },
    observed_assets: [...assets].sort(),
  };
  await testInfo.attach('production-shell-baseline', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  console.log(`LOADING_NAV_EVIDENCE ${JSON.stringify(evidence)}`);
});
