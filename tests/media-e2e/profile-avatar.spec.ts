import path from 'node:path';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { installMockApp, makeState, PROFILE_ID } from './mockApp';

const fixtureImage = path.resolve(process.cwd(), 'public/pwa-192x192.png');
const heicFixture = Buffer.from(
  readFileSync(path.resolve(process.cwd(), 'tests/media-e2e/fixtures/heic-sample.base64'), 'utf8').trim(),
  'base64'
);

const avatarAction = (page: Page) => page.getByTestId('profile-avatar-action');

async function openOwnProfile(page: Page): Promise<void> {
  await page.goto('/profile', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Media E2E Owner' })).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/profile$/);
}

async function chooseAvatarFromProfile(page: Page): Promise<void> {
  const action = avatarAction(page);
  await expect(action).toBeVisible();
  const urlBefore = page.url();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    action.click(),
  ]);
  await expect(page).toHaveURL(urlBefore);
  await chooser.setFiles(fixtureImage);
  const editor = page.getByTestId('media-crop-editor');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute('data-media-purpose', 'PROFILE_AVATAR');
  await expect(editor.getByRole('button', { name: '1:1' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(urlBefore);
}

test.describe('direct own-profile avatar flow', () => {
  test('opens the chooser in place, crops, uploads, finalizes, saves the media id, and refreshes the avatar', async ({ page }) => {
    test.setTimeout(60_000);
    const state = makeState();
    await installMockApp(page, state);
    await openOwnProfile(page);
    await chooseAvatarFromProfile(page);

    await page.getByTestId('media-crop-editor').getByRole('button', { name: 'Done' }).click();
    await expect.poll(() => state.profileUpdateCalls.length, { timeout: 20_000 }).toBe(1);
    expect(state.uploadStartCalls).toHaveLength(1);
    expect(state.uploadStartCalls[0]).toMatchObject({ purpose: 'PROFILE_AVATAR', mime: 'image/png' });
    expect(Number(state.uploadStartCalls[0].size)).toBeGreaterThan(0);
    expect(state.signedUploadCalls).toBe(1);
    expect(state.finalizeCalls).toHaveLength(1);
    expect(state.finalizeCalls[0]).toMatchObject({ aspectRatio: 1 });
    expect(state.profileUpdateCalls[0]).toMatchObject({ avatarMediaId: 'avatar-asset-1' });
    expect(state.requestOrder).toEqual(['upload-start', 'signed-upload', 'finalize', 'profile-update']);
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.locator('img[alt="Media E2E Owner"][src*="pwa-192x192.png"]').first()).toBeVisible();
    expect(state.profile.avatarMediaId).toBe('avatar-asset-1');
  });

  test('uploads and prepares real HEIC bytes on the server before crop and finalize', async ({ page }) => {
    test.setTimeout(60_000);
    const state = makeState();
    await installMockApp(page, state);
    await openOwnProfile(page);

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      avatarAction(page).click(),
    ]);
    await chooser.setFiles({ name: 'iphone-camera.heic', mimeType: 'image/heic', buffer: heicFixture });
    await expect(page.getByTestId('media-crop-editor')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('media-crop-editor').getByRole('button', { name: 'Done' }).click();
    await expect.poll(() => state.profileUpdateCalls.length, { timeout: 20_000 }).toBe(1);
    expect(state.uploadStartCalls).toHaveLength(1);
    expect(state.uploadStartCalls[0]).toMatchObject({ purpose: 'PROFILE_AVATAR', mime: 'image/heic' });
    expect(state.signedUploadCalls).toBe(1);
    expect(state.prepareCalls).toBe(1);
    expect(state.finalizeCalls).toHaveLength(1);
    expect(state.requestOrder).toEqual(['upload-start', 'signed-upload', 'prepare', 'finalize', 'profile-update']);
    await expect(page).toHaveURL(/\/profile$/);
  });

  test('keeps the profile in place after processing failure and retries finalize without uploading twice', async ({ page }) => {
    test.setTimeout(60_000);
    const state = makeState({ failNextFinalize: true });
    await installMockApp(page, state);
    await openOwnProfile(page);
    await chooseAvatarFromProfile(page);

    await page.getByTestId('media-crop-editor').getByRole('button', { name: 'Done' }).click();
    await expect.poll(() => state.finalizeCalls.length, { timeout: 20_000 }).toBe(1);
    expect(state.profileUpdateCalls).toHaveLength(0);
    await expect(page.getByRole('alert')).toContainText(/processing|could not|failed/i);
    const retry = page.getByRole('button', { name: /^retry$/i }).first();
    await expect(retry).toBeVisible();
    await expect(page).toHaveURL(/\/profile$/);

    await retry.click();
    await expect.poll(() => state.profileUpdateCalls.length, { timeout: 20_000 }).toBe(1);
    expect(state.uploadStartCalls).toHaveLength(1);
    expect(state.signedUploadCalls).toBe(1);
    expect(state.finalizeCalls).toHaveLength(2);
    expect(state.profileUpdateCalls[0]).toMatchObject({ avatarMediaId: 'avatar-asset-1' });
    await expect(page.locator('img[alt="Media E2E Owner"][src*="pwa-192x192.png"]').first()).toBeVisible();
    expect(state.profile.id).toBe(PROFILE_ID);
  });

  test('retries a prepared HEIC finalize without a second upload or preparation', async ({ page }) => {
    test.setTimeout(60_000);
    const state = makeState({ failNextFinalize: true });
    await installMockApp(page, state);
    await openOwnProfile(page);
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      avatarAction(page).click(),
    ]);
    await chooser.setFiles({ name: 'iphone-camera.heic', mimeType: 'image/heic', buffer: heicFixture });
    await expect(page.getByTestId('media-crop-editor')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('media-crop-editor').getByRole('button', { name: 'Done' }).click();
    await expect.poll(() => state.finalizeCalls.length, { timeout: 20_000 }).toBe(1);
    const retry = page.getByRole('button', { name: /^retry$/i }).first();
    await expect(retry).toBeVisible();
    await retry.click();
    await expect.poll(() => state.profileUpdateCalls.length, { timeout: 20_000 }).toBe(1);
    expect(state.uploadStartCalls).toHaveLength(1);
    expect(state.signedUploadCalls).toBe(1);
    expect(state.prepareCalls).toBe(1);
    expect(state.finalizeCalls).toHaveLength(2);
  });

  test('reconciles a failed profile update, preserves the old avatar, and retries with fresh optimistic state', async ({ page }) => {
    test.setTimeout(60_000);
    const state = makeState({ failNextProfileUpdate: true });
    await installMockApp(page, state);
    await openOwnProfile(page);
    const detailReadsBeforeUpload = state.profileDetailReads;
    await chooseAvatarFromProfile(page);

    await page.getByTestId('media-crop-editor').getByRole('button', { name: 'Done' }).click();
    await expect.poll(() => state.profileUpdateCalls.length, { timeout: 20_000 }).toBe(1);
    await expect.poll(() => state.profileDetailReads, { timeout: 20_000 }).toBeGreaterThan(detailReadsBeforeUpload);
    await expect(page.getByTestId('profile-avatar-save-error')).toContainText(/could not be saved/i);
    expect(state.profile.avatarMediaId).toBeNull();
    expect(state.profileUpdateCalls[0]).toMatchObject({
      avatarMediaId: 'avatar-asset-1',
      expectedUpdatedAt: '2026-09-04T00:00:00.000Z',
    });
    await expect(page).toHaveURL(/\/profile$/);

    await page.getByRole('button', { name: /^retry$/i }).click();
    await expect.poll(() => state.profileUpdateCalls.length, { timeout: 20_000 }).toBe(2);
    expect(state.profileUpdateCalls[1]).toMatchObject({
      avatarMediaId: 'avatar-asset-1',
      expectedUpdatedAt: '2026-09-04T00:00:02.000Z',
    });
    expect(state.uploadStartCalls).toHaveLength(1);
    expect(state.signedUploadCalls).toBe(1);
    expect(state.finalizeCalls).toHaveLength(1);
    await expect(page.locator('img[alt="Media E2E Owner"][src*="pwa-192x192.png"]').first()).toBeVisible();
    expect(state.profile.avatarMediaId).toBe('avatar-asset-1');
  });
});
