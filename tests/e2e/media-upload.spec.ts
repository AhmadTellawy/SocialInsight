import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type Response, type Route } from '@playwright/test';
import { baseURL } from './helpers/env';
import { expectTokenPresent, gotoApp } from './helpers/auth';
import { publicCreatorAuthStatePath } from './helpers/authState';

const CONTROLLED_WRITE_APPROVAL_ENV = 'ONLINE_CONTROLLED_WRITE_APPROVED';
const APPROVED_ONLINE_BASE_URL = 'https://socialinsightapp.com/';
const API_HOST = 'socialinsight-api.onrender.com';
const STORAGE_HOST = 'jlanmsxfggpnbwoowejy.supabase.co';
const STORAGE_SIGNED_UPLOAD_PATH = '/storage/v1/object/upload/sign/media-originals/';
const controlledWriteApproved = process.env[CONTROLLED_WRITE_APPROVAL_ENV] === 'true';
const authStateExists = fs.existsSync(publicCreatorAuthStatePath);
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const mediaFinalizePattern = new RegExp(`^/api/media/(${UUID})/finalize$`, 'i');
const mediaDeletePattern = new RegExp(`^/api/media/(${UUID})$`, 'i');
const postDeletePattern = new RegExp(`^/api/posts/(${UUID})$`, 'i');

type SafetyState = {
  assetIds: Set<string>;
  postId?: string;
  createUrl?: string;
  uploadSessions: number;
  storageUploads: number;
  finalizations: number;
  postCreates: number;
  postDeletes: number;
  mediaDeletes: number;
  cleanup: boolean;
  blocked: string[];
};

function isBackgroundMutation(method: string, pathname: string): boolean {
  return method === 'POST' && (
    /^\/api\/posts\/[^/]+\/views\/?$/.test(pathname) ||
    /^\/api\/analytics\/interactions\/batch\/?$/.test(pathname)
  );
}

function extractPostId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const value = body as {
    id?: unknown;
    postId?: unknown;
    post?: { id?: unknown };
    data?: { id?: unknown; postId?: unknown; post?: { id?: unknown } };
  };
  const candidates = [value.id, value.postId, value.post?.id, value.data?.id, value.data?.postId, value.data?.post?.id];
  return candidates.find((candidate): candidate is string => typeof candidate === 'string');
}

function installResponseTracking(page: Page, state: SafetyState): void {
  page.on('response', async (response: Response) => {
    const request = response.request();
    const url = new URL(response.url());
    if (request.method() === 'POST' && url.hostname === API_HOST && url.pathname === '/api/media/uploads' && response.ok()) {
      try {
        const body = await response.json() as { assetId?: unknown };
        if (typeof body.assetId === 'string') state.assetIds.add(body.assetId);
      } catch {
        // The mutation guard still captures the exact ID from the finalize path.
      }
    }
    if (request.method() === 'POST' && url.hostname === API_HOST && url.pathname === '/api/posts' && response.ok()) {
      try {
        const body = await response.json();
        state.postId = extractPostId(body);
        state.createUrl = response.url();
      } catch {
        state.postId = undefined;
      }
    }
  });
}

async function installMutationGuard(page: Page, state: SafetyState): Promise<void> {
  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      await route.continue();
      return;
    }
    if (isBackgroundMutation(method, pathname)) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (method === 'POST' && url.hostname === API_HOST && pathname === '/api/media/uploads' && state.uploadSessions < 2) {
      state.uploadSessions += 1;
      await route.continue();
      return;
    }
    if (
      method === 'PUT' &&
      url.hostname === STORAGE_HOST &&
      pathname.startsWith(STORAGE_SIGNED_UPLOAD_PATH) &&
      state.storageUploads < 2
    ) {
      state.storageUploads += 1;
      await route.continue();
      return;
    }
    const finalizeMatch = pathname.match(mediaFinalizePattern);
    if (method === 'POST' && url.hostname === API_HOST && finalizeMatch && state.finalizations < 2) {
      state.assetIds.add(finalizeMatch[1]);
      state.finalizations += 1;
      await route.continue();
      return;
    }
    if (method === 'POST' && url.hostname === API_HOST && pathname === '/api/posts' && state.postCreates === 0) {
      state.postCreates += 1;
      await route.continue();
      return;
    }
    const postDeleteMatch = pathname.match(postDeletePattern);
    if (
      method === 'DELETE' &&
      url.hostname === API_HOST &&
      state.cleanup &&
      postDeleteMatch?.[1] === state.postId &&
      state.postDeletes < 3
    ) {
      state.postDeletes += 1;
      await route.continue();
      return;
    }
    const mediaDeleteMatch = pathname.match(mediaDeletePattern);
    if (
      method === 'DELETE' &&
      url.hostname === API_HOST &&
      mediaDeleteMatch &&
      state.assetIds.has(mediaDeleteMatch[1]) &&
      state.mediaDeletes < state.assetIds.size * 4
    ) {
      state.mediaDeletes += 1;
      await route.continue();
      return;
    }

    state.blocked.push(`${method} ${url.hostname}${pathname}`);
    await route.abort('blockedbyclient');
  });
}

async function authenticatedDelete(page: Page, targetUrl: string): Promise<{ ok: boolean; status: number }> {
  return page.evaluate(async (url) => {
    const token = window.localStorage.getItem('si_token');
    const rawUser = window.localStorage.getItem('si_user');
    let userId: string | undefined;
    try {
      const user = rawUser ? JSON.parse(rawUser) : null;
      userId = typeof user?.id === 'string' ? user.id : undefined;
    } catch {
      userId = undefined;
    }
    if (!token) return { ok: false, status: 0 };
    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: userId ? JSON.stringify({ userId }) : undefined,
      });
      return { ok: response.ok, status: response.status };
    } catch {
      return { ok: false, status: 0 };
    }
  }, targetUrl);
}

async function authenticatedDeleteWithRetry(
  page: Page,
  targetUrl: string,
): Promise<{ ok: boolean; status: number }> {
  let result = { ok: false, status: 0 };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    result = await authenticatedDelete(page, targetUrl);
    if (result.ok || result.status === 404) return result;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }

  return result;
}

async function cleanup(page: Page, state: SafetyState): Promise<void> {
  state.cleanup = true;
  try {
    if (state.postId && state.createUrl) {
      const createUrl = new URL(state.createUrl);
      const result = await authenticatedDeleteWithRetry(page, `${createUrl.origin}/api/posts/${state.postId}`);
      expect(result.ok || result.status === 404, `expected exact post cleanup to succeed, got HTTP ${result.status}`).toBe(true);
      return;
    }
    for (const assetId of state.assetIds) {
      const result = await authenticatedDeleteWithRetry(page, `https://${API_HOST}/api/media/${assetId}`);
      expect(result.ok || result.status === 404, `expected exact media cleanup to succeed, got HTTP ${result.status}`).toBe(true);
    }
  } finally {
    state.cleanup = false;
  }
}

test.setTimeout(150_000);

test.describe('ONLINE_CONTROLLED_WRITE post media upload', () => {
  test.skip(!controlledWriteApproved, `Set ${CONTROLLED_WRITE_APPROVAL_ENV}=true after explicit approval.`);
  test.skip(!authStateExists, 'Authenticated storage state is required.');
  test.use({ storageState: publicCreatorAuthStatePath });

  test('uploads two images, publishes a carousel, and cleans up exact IDs', async ({ page }) => {
    expect(baseURL).toBe(APPROVED_ONLINE_BASE_URL);
    const firstImage = path.resolve(process.cwd(), 'public', 'pwa-512x512.png');
    const secondImage = path.resolve(process.cwd(), 'public', 'logo.png');
    expect(fs.existsSync(firstImage)).toBe(true);
    expect(fs.existsSync(secondImage)).toBe(true);

    const suffix = `${Date.now()}_${randomUUID().slice(0, 8)}`;
    const pollTitle = `e2e_media_poll_${suffix}`;
    const state: SafetyState = {
      assetIds: new Set(),
      uploadSessions: 0,
      storageUploads: 0,
      finalizations: 0,
      postCreates: 0,
      postDeletes: 0,
      mediaDeletes: 0,
      cleanup: false,
      blocked: [],
    };

    installResponseTracking(page, state);
    await installMutationGuard(page, state);

    try {
      await gotoApp(page, '/create/poll');
      await expectTokenPresent(page);
      await expect(page.getByRole('heading', { name: /new poll/i })).toBeVisible({ timeout: 15_000 });

      const postButton = page.getByRole('button', { name: /^Post$/ });
      await expect(postButton).toBeDisabled();
      await expect(page.getByRole('button', { name: 'List option layout' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Grid option layout' })).toBeVisible();

      const pollTypeBox = await page.getByText('Poll Type', { exact: true }).boundingBox();
      const categoryBox = await page.getByText('Category', { exact: true }).boundingBox();
      expect(pollTypeBox).not.toBeNull();
      expect(categoryBox).not.toBeNull();
      expect(pollTypeBox!.x).toBeLessThan(categoryBox!.x);

      const chooserPromise = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Add poll images' }).click();
      const chooser = await chooserPromise;
      await chooser.setFiles([firstImage, secondImage]);

      for (let index = 0; index < 2; index += 1) {
        const cropDialog = page.getByRole('dialog', { name: 'Crop image' });
        await expect(cropDialog).toBeVisible({ timeout: 15_000 });
        const applyButton = cropDialog.getByRole('button', { name: 'Apply' });
        await expect(applyButton).toBeEnabled({ timeout: 15_000 });
        await applyButton.click();
        await expect.poll(() => state.uploadSessions, { timeout: 20_000 }).toBe(index + 1);
      }

      await expect.poll(() => state.finalizations, { timeout: 45_000 }).toBe(2);
      await expect.poll(() => page.getByRole('button', { name: 'Edit', exact: true }).count(), { timeout: 45_000 }).toBe(2);

      await page.getByPlaceholder('Ask a question...').fill(pollTitle);
      await page.getByPlaceholder('Option 1').fill(`e2e_option_a_${suffix}`);
      await page.getByPlaceholder('Option 2').fill(`e2e_option_b_${suffix}`);
      await page.getByRole('button', { name: /select category/i }).click();
      await page.getByRole('button', { name: /^Technology$/ }).click();
      await expect(postButton).toBeEnabled();

      const createResponsePromise = page.waitForResponse((response) => {
        const request = response.request();
        const url = new URL(response.url());
        return request.method() === 'POST' && url.hostname === API_HOST && url.pathname === '/api/posts';
      });
      await postButton.click();
      const createResponse = await createResponsePromise;
      expect(createResponse.ok()).toBe(true);
      const createBody = await createResponse.json();
      state.postId = state.postId || extractPostId(createBody);
      state.createUrl = state.createUrl || createResponse.url();
      expect(state.postId).toBeTruthy();

      await gotoApp(page, `/post/${state.postId}`);
      await expect(page.getByText(pollTitle, { exact: true })).toBeVisible({ timeout: 20_000 });
      const carousel = page.getByRole('region', { name: 'Post images' });
      await expect(carousel).toBeVisible({ timeout: 20_000 });
      await expect(carousel.getByRole('group', { name: '1 / 2' })).toBeVisible();
      await expect(carousel.getByRole('group', { name: '2 / 2' })).toBeAttached();
      expect(state.blocked).toEqual([]);
    } finally {
      try {
        await cleanup(page, state);
      } finally {
        console.log(`MEDIA_CONTROLLED_WRITE_COUNTS ${JSON.stringify({
          assets: state.assetIds.size,
          uploadSessions: state.uploadSessions,
          storageUploads: state.storageUploads,
          finalizations: state.finalizations,
          postCreates: state.postCreates,
          postDeletes: state.postDeletes,
          mediaDeletes: state.mediaDeletes,
          blocked: state.blocked.length,
        })}`);
      }
    }

    expect(state.assetIds.size).toBe(2);
    expect(state.uploadSessions).toBe(2);
    expect(state.storageUploads).toBe(2);
    expect(state.finalizations).toBe(2);
    expect(state.postCreates).toBe(1);
    expect(state.postDeletes).toBeGreaterThanOrEqual(1);
    expect(state.postDeletes).toBeLessThanOrEqual(3);
  });
});
