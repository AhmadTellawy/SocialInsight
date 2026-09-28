import { expect, test } from '@playwright/test';

const svg = (color: string, width = 200, height = 100) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${color}"/></svg>`)}`;

test.setTimeout(120_000);

const mountHarness = async (page: import('@playwright/test').Page) => {
  await page.route('http://127.0.0.1:4174/', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
      <style>.w-full { width: 100%; } .block { display: block; } .relative { position: relative; }
        .absolute { position: absolute; } .inset-0 { inset: 0; }</style>
      <script type="module">
        import RefreshRuntime from '/@react-refresh';
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => (type) => type;
        window.__vite_plugin_react_preamble_installed__ = true;
      </script></head><body></body></html>`
  }));
  await page.goto('/');
  await page.evaluate(async () => {
    const React = await import('/node_modules/.vite/deps/react.js');
    const ReactDOM = await import('/node_modules/.vite/deps/react-dom_client.js');
    const ReactDOMCore = await import('/node_modules/.vite/deps/react-dom.js');
    const { MediaImage } = await import('/components/media/MediaImage.tsx');
    const { mediaApi } = await import('/services/mediaApi.ts');
    const host = document.createElement('div');
    host.id = 'media-image-test';
    host.style.width = '300px';
    document.body.append(host);
    const root = (ReactDOM.createRoot || ReactDOM.default.createRoot)(host);
    (window as any).mediaTest = {
      mediaApi,
      render: (props: Record<string, unknown>) => (ReactDOMCore.flushSync || ReactDOMCore.default.flushSync)(() => {
        root.render((React.createElement || React.default.createElement)(MediaImage, { className: 'w-full h-auto object-contain', eager: true, ...props }));
      })
    };
  });
};

test('holds a fixed skeleton through load and decode, then hides the old identity', async ({ page }) => {
  await mountHarness(page);
  await page.evaluate((src) => {
    (window as any).decodeResolve = undefined;
    HTMLImageElement.prototype.decode = function () {
      return new Promise<void>((resolve) => { (window as any).decodeResolve = resolve; });
    };
    (window as any).mediaTest.render({
      media: { id: 'first', access: 'PUBLIC', aspectRatio: 2, width: 200, height: 100, src }
    });
  }, svg('red'));
  const frame = page.locator('#media-image-test > span');
  await expect(frame).toHaveAttribute('data-media-state', 'decoding');
  await expect(frame.locator('[data-testid="media-image-skeleton"]')).toBeVisible();
  await expect(frame.locator('img')).toHaveClass(/opacity-0/);
  const before = await frame.boundingBox();
  expect(before?.width).toBe(300);
  expect(before?.height).toBe(150);
  await page.evaluate(() => (window as any).decodeResolve());
  await expect(frame).toHaveAttribute('data-media-state', 'ready');
  await expect(frame.locator('[data-testid="media-image-skeleton"]')).toHaveCount(0);
  expect((await frame.boundingBox())?.height).toBe(150);

  await page.evaluate((src) => (window as any).mediaTest.render({
    media: { id: 'second', access: 'PUBLIC', aspectRatio: 2, width: 200, height: 100, src }
  }), svg('blue'));
  await expect(frame.locator('img[src*="red"]')).toHaveCount(0);
  await expect(frame.locator('[data-testid="media-image-skeleton"]')).toBeVisible();
  await expect(frame.locator('img')).toHaveClass(/opacity-0/);
  expect((await frame.boundingBox())?.height).toBe(150);
});

test('refreshes a failed signed source once and falls back without a retry loop', async ({ page }) => {
  await page.route('**/bad-primary.svg', (route) => route.fulfill({ status: 404 }));
  await page.route('**/bad-refreshed.svg', (route) => route.fulfill({ status: 404 }));
  await mountHarness(page);
  await page.evaluate((fallbackSrc) => {
    (window as any).refreshCalls = 0;
    (window as any).mediaTest.mediaApi.get = async () => {
      (window as any).refreshCalls += 1;
      return { id: 'asset', access: 'PUBLIC', aspectRatio: 2, width: 200, height: 100, src: '/bad-refreshed.svg' };
    };
    (window as any).mediaTest.render({
      media: { id: 'asset', access: 'PUBLIC', aspectRatio: 2, width: 200, height: 100, src: '/bad-primary.svg' },
      fallbackSrc
    });
  }, svg('green'));
  const frame = page.locator('#media-image-test > span');
  await expect(frame).toHaveAttribute('data-media-state', 'ready');
  expect(await page.evaluate(() => (window as any).refreshCalls)).toBe(1);
  await expect(frame.locator('img')).toHaveAttribute('src', svg('green'));
  expect((await frame.boundingBox())?.height).toBe(150);
});

test('uses resolved ratio for an ID-only fluid image before revealing it', async ({ page }) => {
  await mountHarness(page);
  await page.evaluate(() => {
    HTMLImageElement.prototype.decode = function () {
      return new Promise<void>((resolve) => { (window as any).decodeResolve = resolve; });
    };
    (window as any).mediaTest.mediaApi.get = () => new Promise((resolve) => {
      (window as any).resolveMedia = resolve;
    });
    (window as any).mediaTest.render({ mediaId: 'late-asset' });
  });
  const frame = page.locator('#media-image-test > span');
  await expect(frame).toHaveAttribute('data-media-state', 'resolving');
  expect((await frame.boundingBox())?.height).toBe(300);
  await page.evaluate((src) => (window as any).resolveMedia({
    id: 'late-asset', access: 'PUBLIC', aspectRatio: 2, width: 200, height: 100, src
  }), svg('purple'));
  await expect(frame).toHaveAttribute('data-media-state', 'decoding');
  await expect(frame.locator('[data-testid="media-image-skeleton"]')).toBeVisible();
  expect((await frame.boundingBox())?.height).toBe(150);
  await page.evaluate(() => (window as any).decodeResolve());
  await expect(frame).toHaveAttribute('data-media-state', 'ready');
  expect((await frame.boundingBox())?.height).toBe(150);
  await expect(frame.locator('img')).toHaveCSS('object-fit', 'contain');
  await frame.screenshot({ path: 'test-results/media-image-flexible-question.png' });
});

test('uses natural ratio for a fluid legacy URL without presentation metadata', async ({ page }) => {
  await mountHarness(page);
  await page.evaluate((fallbackSrc) => {
    HTMLImageElement.prototype.decode = function () {
      return new Promise<void>((resolve) => { (window as any).decodeResolve = resolve; });
    };
    (window as any).mediaTest.render({ fallbackSrc });
  }, svg('orange'));
  const frame = page.locator('#media-image-test > span');
  await expect(frame).toHaveAttribute('data-media-state', 'decoding');
  await expect(frame.locator('[data-testid="media-image-skeleton"]')).toBeVisible();
  expect((await frame.boundingBox())?.height).toBe(150);
  await page.evaluate(() => (window as any).decodeResolve());
  await expect(frame).toHaveAttribute('data-media-state', 'ready');
  expect((await frame.boundingBox())?.height).toBe(150);
});

test('keeps a legacy cover skeleton frame fixed before download and decode complete', async ({ page }) => {
  let releaseDownload: () => void = () => undefined;
  const downloadHeld = new Promise<void>((resolve) => { releaseDownload = resolve; });
  await page.route('**/delayed-cover.svg', async (route) => {
    await downloadHeld;
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="200"><rect width="100" height="200" fill="orange"/></svg>' });
  });
  await mountHarness(page);
  await page.evaluate(() => {
    HTMLImageElement.prototype.decode = function () {
      return new Promise<void>((resolve) => { (window as any).decodeResolve = resolve; });
    };
    (window as any).mediaTest.render({ fallbackSrc: '/delayed-cover.svg', style: { aspectRatio: 3 / 2 } });
  });
  const frame = page.locator('#media-image-test > span');
  await expect(frame).toHaveAttribute('data-media-state', 'loading');
  await expect(frame.locator('[data-testid="media-image-skeleton"]')).toBeVisible();
  expect((await frame.boundingBox())?.height).toBe(200);

  releaseDownload();
  await expect(frame).toHaveAttribute('data-media-state', 'decoding');
  expect((await frame.boundingBox())?.height).toBe(200);
  await expect(frame.locator('img')).toHaveCSS('object-fit', 'contain');
  await page.evaluate(() => (window as any).decodeResolve());
  await expect(frame).toHaveAttribute('data-media-state', 'ready');
  expect((await frame.boundingBox())?.height).toBe(200);
});

for (const scenario of [
  { name: 'mobile with horizontal options', width: 375, height: 812, imageLayout: 'horizontal', imageWidth: 200, imageHeight: 100 },
  { name: 'desktop with horizontal options', width: 1280, height: 800, imageLayout: 'horizontal', imageWidth: 200, imageHeight: 100 },
  { name: 'mobile with vertical options and a portrait source', width: 375, height: 812, imageLayout: 'vertical', imageWidth: 100, imageHeight: 200 },
  { name: 'desktop with horizontal options and a portrait source', width: 1280, height: 800, imageLayout: 'horizontal', imageWidth: 100, imageHeight: 200 },
]) {
  test(`keeps an ID-only quiz question frame reserved on ${scenario.name} through resolution, decode, and source change`, async ({ page }) => {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await mountHarness(page);
    await page.evaluate(async (imageLayout) => {
      const React = await import('/node_modules/.vite/deps/react.js');
      const ReactDOM = await import('/node_modules/.vite/deps/react-dom_client.js');
      const ReactDOMCore = await import('/node_modules/.vite/deps/react-dom.js');
      const { SurveyQuestion } = await import('/components/Survey/SurveyQuestion.tsx');
      const host = document.createElement('div');
      host.id = 'quiz-question-test';
      host.style.width = 'min(100% - 32px, 600px)';
      host.style.margin = '0 auto';
      document.body.append(host);
      const root = (ReactDOM.createRoot || ReactDOM.default.createRoot)(host);
      (window as any).questionTest = {
        resolveMedia: undefined,
        decodeResolve: undefined,
        render: (imageMediaId: string) => (ReactDOMCore.flushSync || ReactDOMCore.default.flushSync)(() => {
          root.render((React.createElement || React.default.createElement)(SurveyQuestion, {
            sourceSurvey: {
              type: 'Quiz', imageLayout,
              sections: [{ questions: [{ id: 'question', imageMediaId, imageLayout }] }]
            },
            options: [], selectedOptions: [], shouldShowResults: false,
            hasVoted: false, isExpired: false, hasImages: false,
            isHorizontal: false, isRating: false, isMultiple: false,
            totalVotes: 0, portraitImages: new Set(), followUpAnswers: {},
            onOptionClick: () => {}, onFollowUpChange: () => {},
            onImageExpand: () => {}, onDetectOrientation: () => {}
          }));
        })
      };
      HTMLImageElement.prototype.decode = function () {
        return new Promise<void>((resolve) => { (window as any).questionTest.decodeResolve = resolve; });
      };
      (window as any).mediaTest.mediaApi.get = () => new Promise((resolve) => {
        (window as any).questionTest.resolveMedia = resolve;
      });
      (window as any).questionTest.render('first-question-image');
    }, scenario.imageLayout);

    const frame = page.locator('#quiz-question-test [data-media-state]').first();
    const reservedHeight = async () => {
      const box = await frame.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width / box!.height).toBeCloseTo(3 / 2, 2);
      return box!.height;
    };
    await expect(frame).toHaveAttribute('data-media-state', 'resolving');
    const initialHeight = await reservedHeight();
    await page.evaluate(({ src, width, height }) => (window as any).questionTest.resolveMedia({
      id: 'first-question-image', access: 'PUBLIC', aspectRatio: width / height,
      width, height, src
    }), { src: svg('purple', scenario.imageWidth, scenario.imageHeight), width: scenario.imageWidth, height: scenario.imageHeight });
    await expect(frame).toHaveAttribute('data-media-state', 'decoding');
    expect(await reservedHeight()).toBeCloseTo(initialHeight, 1);
    await page.evaluate(() => (window as any).questionTest.decodeResolve());
    await expect(frame).toHaveAttribute('data-media-state', 'ready');
    expect(await reservedHeight()).toBeCloseTo(initialHeight, 1);
    await expect(frame.locator('img')).toHaveCSS('object-fit', 'contain');

    await page.evaluate(() => (window as any).questionTest.render('second-question-image'));
    await expect(frame).toHaveAttribute('data-media-state', 'resolving');
    await expect(frame.locator('img')).toHaveCount(0);
    expect(await reservedHeight()).toBeCloseTo(initialHeight, 1);
    await page.evaluate(({ src, width, height }) => (window as any).questionTest.resolveMedia({
      id: 'second-question-image', access: 'PUBLIC', aspectRatio: width / height,
      width, height, src
    }), { src: svg('blue', scenario.imageWidth, scenario.imageHeight), width: scenario.imageWidth, height: scenario.imageHeight });
    await expect(frame).toHaveAttribute('data-media-state', 'decoding');
    expect(await reservedHeight()).toBeCloseTo(initialHeight, 1);
    await page.evaluate(() => (window as any).questionTest.decodeResolve());
    await expect(frame).toHaveAttribute('data-media-state', 'ready');
    expect(await reservedHeight()).toBeCloseTo(initialHeight, 1);
    await expect(frame.locator('img')).toHaveCSS('object-fit', 'contain');
  });
}
