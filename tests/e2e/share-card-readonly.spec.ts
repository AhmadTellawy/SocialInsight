import { expect, test, type Locator, type Page } from '@playwright/test';
import { blockUnexpectedMutations, gotoApp } from './helpers/auth';
import { publicCreatorAuthStatePath } from './helpers/authState';

declare global {
  interface Window {
    __shareCapture?: {
      width: number;
      height: number;
      fileCount: number;
      text: string;
      imageUrl: string;
    };
  }
}

test.use({
  storageState: publicCreatorAuthStatePath,
  viewport: { width: 390, height: 844 }
});

async function installShareCapture(page: Page, language: 'en' | 'ar'): Promise<void> {
  await page.addInitScript((requestedLanguage) => {
    window.localStorage.setItem('i18nextLng', requestedLanguage);
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: () => true
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        const files = data.files ? Array.from(data.files) : [];
        const file = files[0];
        if (!file) {
          window.__shareCapture = {
            width: 0,
            height: 0,
            fileCount: 0,
            text: data.text || '',
            imageUrl: ''
          };
          return;
        }
        const bitmap = await createImageBitmap(file);
        window.__shareCapture = {
          width: bitmap.width,
          height: bitmap.height,
          fileCount: files.length,
          text: data.text || '',
          imageUrl: URL.createObjectURL(file)
        };
        bitmap.close();
      }
    });
  }, language);
}

async function openFirstPublicShareCard(page: Page): Promise<Locator> {
  const feedCards = page.getByTestId('survey-card');
  await expect(feedCards.first()).toBeVisible({ timeout: 20_000 });
  const count = await feedCards.count();

  for (let index = 0; index < count; index += 1) {
    const feedCard = feedCards.nth(index);
    if (!await feedCard.isVisible().catch(() => false)) continue;
    await feedCard.scrollIntoViewIfNeeded();
    const shareButton = feedCard.getByRole('button', { name: 'Share', exact: true });
    if (!await shareButton.isVisible().catch(() => false)) continue;
    await shareButton.click();

    const shareCard = page.getByTestId('share-card');
    await expect(shareCard).toHaveCount(1);
    if (await shareCard.getAttribute('data-share-privacy') === 'public') return shareCard;

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 2_000 });
  }

  throw new Error('No public post was available for read-only Share Card verification.');
}

async function expectStableShareShell(shareCard: Locator, direction: 'ltr' | 'rtl'): Promise<void> {
  const dimensions = await shareCard.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight
  }));
  expect(dimensions).toEqual({ width: 1080, height: 1080, scrollWidth: 1080, scrollHeight: 1080 });
  await expect(shareCard).toHaveAttribute('dir', direction);
  await expect(shareCard.getByTestId('share-card-domain')).toHaveText('socialinsightapp.com');
  await expect(shareCard.getByTestId('share-card-date')).not.toHaveText(/ago/i);
  await expect(shareCard.getByTestId('share-card-actions').locator('svg')).toHaveCount(5);
  await expect(shareCard.getByTestId('share-card-actions')).toHaveText('');
  await expect(shareCard).not.toContainText(/join the conversation/i);
  await expect(shareCard.locator('.lucide-eye')).toHaveCount(0);
}

test('mobile generates the official 1080 square Share Card and carries its canonical URL', async ({ page }) => {
  await installShareCapture(page, 'en');
  await blockUnexpectedMutations(page);
  await gotoApp(page, '/');

  const shareCard = await openFirstPublicShareCard(page);
  await expectStableShareShell(shareCard, 'ltr');

  await page.getByRole('button', { name: 'Share Outside' }).click();
  await expect.poll(() => page.evaluate(() => window.__shareCapture?.width || 0), { timeout: 15_000 }).toBe(1080);
  const capture = await page.evaluate(() => window.__shareCapture!);
  expect(capture.height).toBe(1080);
  expect(capture.fileCount).toBe(1);
  expect(capture.text).toContain('https://socialinsightapp.com/post/');

  await page.setViewportSize({ width: 1200, height: 1200 });
  await page.evaluate(() => {
    const image = document.createElement('img');
    image.dataset.testid = 'generated-share-card';
    image.src = window.__shareCapture!.imageUrl;
    image.width = 1080;
    image.height = 1080;
    image.style.display = 'block';
    document.body.replaceChildren(image);
  });
  const generatedImage = page.getByTestId('generated-share-card');
  await expect(generatedImage).toBeVisible();
  await expect.poll(() => generatedImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(1080);
  await generatedImage.screenshot({ path: 'test-results/share-card-mobile-generated.png' });
});

test('Arabic Share Card uses RTL content without mirroring the brand header', async ({ page }) => {
  await installShareCapture(page, 'ar');
  await blockUnexpectedMutations(page);
  await gotoApp(page, '/');

  const shareCard = await openFirstPublicShareCard(page);
  await expectStableShareShell(shareCard, 'rtl');
  await expect(shareCard.locator('header')).toHaveAttribute('dir', 'ltr');
  await expect(shareCard.getByTestId('share-card-participation')).toContainText(/تصويت|استجابة/);
});
