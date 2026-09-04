import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { installMockApp, makePost, makeState, POST_ID, POST_MEDIA_ID } from './mockApp';

const fixtureImage = path.resolve(process.cwd(), 'public/pwa-192x192.png');

async function installDecodeObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const controls = {
      calls: [] as string[],
    };
    (window as unknown as { __mediaE2EDecode: typeof controls }).__mediaE2EDecode = controls;
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      configurable: true,
      value: function decode(this: HTMLImageElement): Promise<void> {
        const source = this.currentSrc || this.src;
        if (!source.includes('/__media_e2e_images__/')) {
          return Promise.resolve();
        }
        controls.calls.push(source);
        return Promise.resolve();
      },
    });
  });
}

const postCarousel = (page: Page) => page.getByRole('region', { name: 'Post images' });

test.describe('MediaImage loading contract in post detail', () => {
  test('keeps a fixed skeleton frame and hides pixels until load plus decode complete', async ({ page }) => {
    const state = makeState({
      post: makePost('/__media_e2e_images__/decode.png'),
    });
    await installMockApp(page, state);
    await installDecodeObserver(page);
    let imageRequests = 0;
    let releaseImage!: () => void;
    const imageGate = new Promise<void>((resolve) => { releaseImage = resolve; });
    await page.route('**/__media_e2e_images__/decode.png', async (route) => {
      imageRequests += 1;
      await imageGate;
      await route.fulfill({ status: 200, contentType: 'image/png', path: fixtureImage });
    });

    await page.goto(`/post/${POST_ID}`, { waitUntil: 'domcontentloaded' });
    const carousel = postCarousel(page);
    await expect(carousel).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => imageRequests).toBe(1);

    const frameBefore = await carousel.boundingBox();
    expect(frameBefore).not.toBeNull();
    expect(frameBefore!.width).toBeGreaterThan(100);
    expect(frameBefore!.height).toBeGreaterThan(60);
    const mediaFrame = carousel.locator('[data-media-state]').first();
    await expect(mediaFrame).toHaveAttribute('data-media-state', 'loading');
    await expect(mediaFrame).toHaveAttribute('aria-busy', 'true');
    await expect(mediaFrame.getByTestId('media-image-skeleton')).toBeVisible();

    const image = carousel.locator('img[alt="Delayed post image"]');
    if (await image.count()) {
      await expect(image).toHaveClass(/(?:^|\s)opacity-0(?:\s|$)/);
    }
    await expect(carousel.locator('span[role="img"]')).toHaveCount(0);

    releaseImage();
    await expect(mediaFrame).toHaveAttribute('data-media-state', 'ready');
    await expect.poll(() => page.evaluate(() => (
      (window as unknown as { __mediaE2EDecode: { calls: string[] } }).__mediaE2EDecode.calls.length
    ))).toBeGreaterThan(0);
    await expect(mediaFrame).toHaveAttribute('aria-busy', 'false');
    await expect(image).toHaveClass(/(?:^|\s)opacity-100(?:\s|$)/);
    await expect(mediaFrame.getByTestId('media-image-skeleton')).toHaveCount(0);

    const frameAfter = await carousel.boundingBox();
    expect(frameAfter).not.toBeNull();
    expect(Math.abs(frameAfter!.width - frameBefore!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(frameAfter!.height - frameBefore!.height)).toBeLessThanOrEqual(1);
  });

  test('shows fallback only after a real failure and performs one source refresh', async ({ page }) => {
    const state = makeState({
      post: makePost('/__media_e2e_images__/failure-1.png'),
    });
    await installMockApp(page, state);

    let imageAttempts = 0;
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    await page.route('**/__media_e2e_images__/failure-*.png', async (route) => {
      imageAttempts += 1;
      await (imageAttempts === 1 ? firstGate : secondGate);
      await route.abort('failed');
    });

    await page.goto(`/post/${POST_ID}`, { waitUntil: 'domcontentloaded' });
    const carousel = postCarousel(page);
    await expect(carousel).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => imageAttempts).toBe(1);
    await expect(carousel.locator('[aria-busy="true"]')).toBeVisible();
    await expect(carousel.locator('span[role="img"]')).toHaveCount(0);

    releaseFirst();
    await expect.poll(() => imageAttempts).toBe(2);
    expect(state.mediaPresentationCalls).toBe(1);
    await expect(carousel.locator('[aria-busy="true"]')).toBeVisible();
    await expect(carousel.locator('span[role="img"]')).toHaveCount(0);

    releaseSecond();
    const fallback = carousel.locator('[data-media-state="failed"]').first();
    await expect(fallback).toBeVisible();
    await expect(carousel.locator('[aria-busy="true"]')).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(imageAttempts).toBe(2);
    expect(state.mediaPresentationCalls).toBe(1);

    const exposedBrokenImage = await carousel.locator('img').evaluateAll((images) => images.some((element) => {
      const styles = getComputedStyle(element);
      return styles.display !== 'none'
        && styles.visibility !== 'hidden'
        && Number(styles.opacity || '1') > 0.01;
    }));
    expect(exposedBrokenImage).toBe(false);
    expect(state.post).toMatchObject({
      media: [{ id: POST_MEDIA_ID }],
    });
  });
});
