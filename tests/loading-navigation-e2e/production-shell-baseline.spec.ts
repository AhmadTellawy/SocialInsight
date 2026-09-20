import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const samples = Number(process.env.LOADING_NAV_SAMPLES || 20);

const percentile = (values: number[], ratio: number): number => {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)];
};

const blockProductionWrites = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const writeGuard = { suppressedFetches: 0, suppressedBeacons: 0, blockedXhr: 0, blockedForms: 0 };
    (window as typeof window & { __productionWriteGuard?: typeof writeGuard }).__productionWriteGuard = writeGuard;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestMethod = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (requestMethod !== 'GET' && requestMethod !== 'HEAD') {
        const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const pathname = new URL(requestUrl, window.location.href).pathname;
        if (/\/analytics\/|\/views\/?$/.test(pathname)) {
          writeGuard.suppressedFetches += 1;
          return new Response('', { status: 204 });
        }
        throw new Error(`Production baseline blocked an unexpected ${requestMethod} ${pathname}`);
      }
      return nativeFetch(input, init);
    };

    const xhrRequests = new WeakMap<XMLHttpRequest, { method: string; url: string }>();
    const nativeXhrOpen = XMLHttpRequest.prototype.open;
    const nativeXhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...rest: unknown[]) {
      xhrRequests.set(this, { method: method.toUpperCase(), url: String(url) });
      return nativeXhrOpen.call(this, method, url, ...(rest as [boolean?, string?, string?]));
    };
    XMLHttpRequest.prototype.send = function(body?: Document | XMLHttpRequestBodyInit | null) {
      const request = xhrRequests.get(this);
      if (request && request.method !== 'GET' && request.method !== 'HEAD') {
        writeGuard.blockedXhr += 1;
        throw new Error(`Production baseline blocked an unexpected ${request.method} ${request.url}`);
      }
      return nativeXhrSend.call(this, body);
    };

    HTMLFormElement.prototype.submit = function() {
      writeGuard.blockedForms += 1;
      throw new Error('Production baseline blocked an unexpected form submission');
    };
    HTMLFormElement.prototype.requestSubmit = function() {
      writeGuard.blockedForms += 1;
      throw new Error('Production baseline blocked an unexpected form submission');
    };
    document.addEventListener('submit', (event) => {
      writeGuard.blockedForms += 1;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    navigator.sendBeacon = () => {
      writeGuard.suppressedBeacons += 1;
      return true;
    };
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
    cache_conditions: {
      cold: 'new browser context per sample',
      warm: 'reload in one browser context with HTTP cache preserved; writes blocked by init-script fetch, XHR, form, and beacon guards'
    },
    sample_size_each: samples,
    cold_ms: { p50: percentile(cold, 0.5), p75: percentile(cold, 0.75), p95: percentile(cold, 0.95), raw: cold },
    warm_ms: { p50: percentile(warm, 0.5), p75: percentile(warm, 0.75), p95: percentile(warm, 0.95), raw: warm },
    observed_assets: [...assets].sort(),
  };
  await testInfo.attach('production-shell-baseline', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  console.log(`LOADING_NAV_EVIDENCE ${JSON.stringify(evidence)}`);
});
