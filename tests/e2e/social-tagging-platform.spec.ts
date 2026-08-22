import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type Route } from '@playwright/test';
import { baseURL } from './helpers/env';

const APPROVED_FRONTEND = 'https://socialinsightapp.com/';
const APPROVED_API_HOST = 'socialinsight-api.onrender.com';
const API_BASE_URL = (process.env.ONLINE_E2E_API_BASE_URL || `https://${APPROVED_API_HOST}/api`).replace(/\/$/, '');
const CONTROLLED_WRITE_APPROVAL_ENV = 'ONLINE_CONTROLLED_WRITE_APPROVED';
const authDirectory = path.resolve(process.cwd(), 'tests/e2e/.auth');
const creatorStatePath = path.join(authDirectory, 'public_creator.json');
const recipientStatePath = path.join(authDirectory, 'public_voter.json');
const controlledWriteApproved = process.env[CONTROLLED_WRITE_APPROVAL_ENV] === 'true';

type Persona = { id: string; handle: string };
type NotificationRecord = {
  id: string;
  type: string;
  targetId?: string;
  deepLink?: string;
  payload?: {
    postId?: string;
    peopleTagId?: string;
    peopleTagStatus?: string;
    sourceType?: string;
    deepLink?: string;
  };
};

type MutationState = {
  postId?: string;
  peopleTagId?: string;
  createCount: number;
  updateCount: number;
  acceptCount: number;
  removeTagCount: number;
  cleanupCount: number;
  blocked: string[];
};

function readPersona(storagePath: string): Persona {
  const state = JSON.parse(fs.readFileSync(storagePath, 'utf8')) as {
    origins?: Array<{ origin?: string; localStorage?: Array<{ name?: string; value?: string }> }>;
  };
  const storage = state.origins?.find((entry) => entry.origin === new URL(baseURL).origin)?.localStorage || [];
  const rawUser = storage.find((entry) => entry.name === 'si_user')?.value;
  const parsed = rawUser ? JSON.parse(rawUser) : undefined;
  const user = parsed?.user || parsed;
  if (typeof user?.id !== 'string' || typeof user?.handle !== 'string') {
    throw new Error(`Invalid E2E auth state: ${path.basename(storagePath)}`);
  }
  return { id: user.id, handle: user.handle };
}

function requireGates(): void {
  if (!controlledWriteApproved) {
    throw new Error(`ONLINE_CONTROLLED_WRITE requires ${CONTROLLED_WRITE_APPROVAL_ENV}=true.`);
  }
  if (baseURL !== APPROVED_FRONTEND) {
    throw new Error(`Online social-tagging E2E is restricted to ${APPROVED_FRONTEND}.`);
  }
  const apiUrl = new URL(API_BASE_URL);
  if (apiUrl.protocol !== 'https:' || apiUrl.hostname !== APPROVED_API_HOST) {
    throw new Error(`Online social-tagging E2E API is restricted to ${APPROVED_API_HOST}.`);
  }
  for (const statePath of [creatorStatePath, recipientStatePath]) {
    if (!fs.existsSync(statePath)) throw new Error(`Missing E2E storage state: ${path.basename(statePath)}`);
  }
}

const isBackgroundMutation = (method: string, pathname: string) =>
  method === 'POST' && (/\/analytics\/interactions\/batch\/?$/.test(pathname) || /\/posts\/[^/]+\/views\/?$/.test(pathname));

async function installMutationGuard(
  page: Page,
  role: 'creator' | 'recipient',
  state: MutationState,
  recipientId: string
): Promise<void> {
  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return route.continue();

    const url = new URL(request.url());
    const pathname = url.pathname;
    if (isBackgroundMutation(method, pathname)) return route.fulfill({ status: 204, body: '' });

    if (role === 'creator' && method === 'POST' && /\/api\/posts\/?$/.test(pathname)) {
      const body = request.postDataJSON() as { title?: string; taggedUserIds?: string[] };
      if (state.createCount === 0
        && body?.title?.startsWith('e2e_')
        && body.taggedUserIds?.length === 1
        && body.taggedUserIds[0] === recipientId) {
        state.createCount += 1;
        return route.continue();
      }
    }

    if (role === 'creator' && method === 'PUT' && state.postId
      && pathname.endsWith(`/api/posts/${state.postId}`)) {
      const body = request.postDataJSON() as { title?: string; taggedUserIds?: string[] };
      if (state.updateCount < 2
        && body?.title?.startsWith('e2e_')
        && body.taggedUserIds?.length === 1
        && body.taggedUserIds[0] === recipientId) {
        state.updateCount += 1;
        return route.continue();
      }
    }

    if (role === 'creator' && method === 'DELETE' && state.postId
      && pathname.endsWith(`/api/posts/${state.postId}`)) {
      state.cleanupCount += 1;
      return route.continue();
    }

    if (role === 'recipient' && method === 'POST' && state.peopleTagId
      && pathname.endsWith(`/api/posts/people-tags/${state.peopleTagId}/accept`)
      && state.acceptCount === 0) {
      state.acceptCount += 1;
      return route.continue();
    }

    if (role === 'recipient' && method === 'DELETE' && state.peopleTagId
      && pathname.endsWith(`/api/posts/people-tags/${state.peopleTagId}`)
      && state.removeTagCount === 0) {
      state.removeTagCount += 1;
      return route.continue();
    }

    state.blocked.push(`${method} ${url.hostname}${pathname}`);
    await route.abort('blockedbyclient');
  });
}

async function apiCall<T>(page: Page, pathName: string, init?: { method?: string; body?: unknown }) {
  return page.evaluate(async ({ apiBaseUrl, pathName, init }) => {
    const token = window.localStorage.getItem('si_token');
    if (!token) return { status: 0, body: undefined as T | undefined };
    const response = await fetch(`${apiBaseUrl}${pathName}`, {
      method: init?.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(init?.body ? { body: JSON.stringify(init.body) } : {})
    });
    let body: T | undefined;
    try { body = await response.json() as T; } catch { /* no response body */ }
    return { status: response.status, body };
  }, { apiBaseUrl: API_BASE_URL, pathName, init });
}

async function postNotifications(page: Page, userId: string, postId: string): Promise<NotificationRecord[]> {
  const response = await apiCall<NotificationRecord[]>(page, `/users/${userId}/notifications`);
  expect(response.status).toBe(200);
  return (response.body || []).filter((notification) => notification.targetId === postId);
}

test.setTimeout(210_000);

test.describe('ONLINE_CONTROLLED_WRITE social tagging platform', () => {
  test.skip(!controlledWriteApproved, `ONLINE_CONTROLLED_WRITE requires ${CONTROLLED_WRITE_APPROVAL_ENV}=true.`);

  test('verifies composer, mentions, topics, trends, and people tags with exact cleanup', async ({ browser }) => {
    test.info().annotations.push({ type: 'test-class', description: 'ONLINE_CONTROLLED_WRITE' });
    requireGates();

    const creator = readPersona(creatorStatePath);
    const recipient = readPersona(recipientStatePath);
    const state: MutationState = {
      createCount: 0,
      updateCount: 0,
      acceptCount: 0,
      removeTagCount: 0,
      cleanupCount: 0,
      blocked: []
    };
    const suffix = `${Date.now().toString(36)}${randomUUID().replace(/-/g, '').slice(0, 5)}`;
    const englishTag = `E2E_Tag_${suffix}`;
    const normalizedEnglishTag = englishTag.toLowerCase();
    const arabicTag = `اختبار_${suffix}`;
    const initialTitle = `e2e_social_tagging_${suffix} @${recipient.handle} #${englishTag} #${arabicTag}`;
    const punctuationTitle = `${initialTitle}!`;
    const mentionRemovedTitle = `e2e_social_tagging_${suffix} #${englishTag} #${arabicTag}`;

    const creatorContext = await browser.newContext({
      storageState: creatorStatePath,
      serviceWorkers: 'block',
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true
    });
    const recipientContext = await browser.newContext({
      storageState: recipientStatePath,
      serviceWorkers: 'block',
      viewport: { width: 1280, height: 900 }
    });
    const creatorPage = await creatorContext.newPage();
    const recipientPage = await recipientContext.newPage();
    await installMutationGuard(creatorPage, 'creator', state, recipient.id);
    await installMutationGuard(recipientPage, 'recipient', state, recipient.id);

    let cleaned = false;
    try {
      await creatorPage.goto(`${baseURL}create/poll`, { waitUntil: 'domcontentloaded' });
      const composer = creatorPage.locator('textarea[role="combobox"]').first();
      await expect(composer).toBeVisible({ timeout: 20_000 });
      await composer.fill(`e2e_composer @${recipient.handle}`);
      const listbox = creatorPage.getByRole('listbox');
      await expect(listbox).toBeVisible({ timeout: 15_000 });
      const recipientOption = listbox.getByRole('option').filter({ hasText: `@${recipient.handle}` }).first();
      await expect(recipientOption).toBeVisible();
      const dropdownBounds = await listbox.boundingBox();
      expect(dropdownBounds).not.toBeNull();
      expect(dropdownBounds!.y).toBeGreaterThanOrEqual(0);
      expect(dropdownBounds!.y + dropdownBounds!.height).toBeLessThanOrEqual(844);
      await recipientOption.tap();
      await expect(composer).toHaveValue(`e2e_composer @${recipient.handle} `);

      await creatorPage.evaluate(() => window.localStorage.setItem('i18nextLng', 'ar'));
      await creatorPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(creatorPage.locator('html')).toHaveAttribute('dir', 'rtl');
      const rtlComposer = creatorPage.locator('textarea[role="combobox"]').first();
      await rtlComposer.fill(`e2e_واجهة #اختبار @${recipient.handle}`);
      await expect(creatorPage.getByRole('listbox')).toBeVisible({ timeout: 15_000 });
      await creatorPage.getByRole('listbox').getByRole('option').filter({ hasText: `@${recipient.handle}` }).first().tap();
      await expect(rtlComposer).toHaveValue(`e2e_واجهة #اختبار @${recipient.handle} `);

      await recipientPage.goto(baseURL, { waitUntil: 'domcontentloaded' });
      const createResponse = await apiCall<{
        id?: string;
        mentions?: Array<{ targetUserId: string }>;
        taggedUsers?: Array<{ id: string; taggedUserId: string; status: string }>;
      }>(creatorPage, '/posts', {
        method: 'POST',
        body: {
          title: initialTitle,
          description: '',
          type: 'Poll',
          options: [
            { text: 'e2e_option_one', votes: 0 },
            { text: 'e2e_option_two', votes: 0 }
          ],
          taggedUserIds: [recipient.id],
          category: 'Technology',
          targetAudience: 'Public',
          allowAnonymous: true,
          forceAnonymous: false,
          allowComments: true,
          status: 'PUBLISHED',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
        }
      });
      expect(createResponse.status).toBe(200);
      expect(createResponse.body?.id).toBeTruthy();
      state.postId = createResponse.body!.id!;
      expect(createResponse.body?.mentions?.some((mention) => mention.targetUserId === recipient.id)).toBe(true);
      const createdTag = createResponse.body?.taggedUsers?.find((tag) => tag.taggedUserId === recipient.id);
      expect(createdTag?.status).toBe('PENDING');
      state.peopleTagId = createdTag!.id;

      let notifications: NotificationRecord[] = [];
      await expect.poll(async () => {
        notifications = await postNotifications(recipientPage, recipient.id, state.postId!);
        return notifications.filter((notification) => ['mention', 'people_tag'].includes(notification.type)).length;
      }, { timeout: 25_000 }).toBe(2);
      expect(notifications.filter((notification) => notification.type === 'mention')).toHaveLength(1);
      expect(notifications.filter((notification) => notification.type === 'people_tag')).toHaveLength(1);
      const mentionNotification = notifications.find((notification) => notification.type === 'mention')!;
      const peopleTagNotification = notifications.find((notification) => notification.type === 'people_tag')!;
      expect(mentionNotification.payload?.deepLink || mentionNotification.deepLink).toBe(`/post/${state.postId}`);
      expect(peopleTagNotification.payload?.deepLink || peopleTagNotification.deepLink).toBe(`/post/${state.postId}`);
      expect(peopleTagNotification.payload?.peopleTagId).toBe(state.peopleTagId);

      const acceptResponse = await apiCall<{ status?: string }>(recipientPage, `/posts/people-tags/${state.peopleTagId}/accept`, { method: 'POST' });
      expect(acceptResponse.status).toBe(200);
      expect(acceptResponse.body?.status).toBe('ACCEPTED');

      const postResponse = await apiCall<{
        title?: string;
        mentions?: Array<{ targetUserId: string }>;
        taggedUsers?: Array<{ id: string; status: string }>;
      }>(recipientPage, `/posts/${state.postId}`);
      expect(postResponse.status).toBe(200);
      expect(postResponse.body?.mentions?.some((mention) => mention.targetUserId === recipient.id)).toBe(true);
      expect(postResponse.body?.taggedUsers?.some((tag) => tag.id === state.peopleTagId && tag.status === 'ACCEPTED')).toBe(true);

      await recipientPage.goto(`${baseURL}post/${state.postId}`, { waitUntil: 'domcontentloaded' });
      await expect(recipientPage.locator(`a[href="/profile/${recipient.id}"]`).first()).toBeVisible({ timeout: 20_000 });
      await expect(recipientPage.locator(`a[href="/hashtag/${encodeURIComponent(normalizedEnglishTag)}"]`).first()).toBeVisible();
      await expect(recipientPage.locator(`a[href="/hashtag/${encodeURIComponent(arabicTag)}"]`).first()).toBeVisible();

      for (const tagName of [normalizedEnglishTag, arabicTag]) {
        const topicResponse = await apiCall<{ data?: Array<{ id: string }> }>(recipientPage, `/hashtags/${encodeURIComponent(tagName)}/posts?sort=recent&limit=10`);
        expect(topicResponse.status).toBe(200);
        expect(topicResponse.body?.data?.some((post) => post.id === state.postId)).toBe(true);
      }

      const searchResponse = await apiCall<{ topics?: Array<{ normalizedName: string; postCount: number }> }>(recipientPage, `/search?q=${encodeURIComponent(`#${englishTag}`)}`);
      expect(searchResponse.status).toBe(200);
      expect(searchResponse.body?.topics?.some((topic) => topic.normalizedName === normalizedEnglishTag && topic.postCount >= 1)).toBe(true);

      const trendingResponse = await apiCall<{ topics?: Array<{ normalizedName: string }> }>(recipientPage, '/hashtags/trending?limit=30');
      expect(trendingResponse.status).toBe(200);
      expect(trendingResponse.body?.topics?.some((topic) => topic.normalizedName === normalizedEnglishTag)).toBe(true);

      await recipientPage.goto(`${baseURL}hashtag/${encodeURIComponent(arabicTag)}`, { waitUntil: 'domcontentloaded' });
      await expect(recipientPage.getByRole('heading', { name: `#${arabicTag}` })).toBeVisible({ timeout: 20_000 });
      await expect(recipientPage.getByText(initialTitle, { exact: false }).first()).toBeVisible();
      expect(await recipientPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

      const punctuationUpdate = await apiCall(creatorPage, `/posts/${state.postId}`, {
        method: 'PUT',
        body: { title: punctuationTitle, taggedUserIds: [recipient.id] }
      });
      expect(punctuationUpdate.status).toBe(200);
      await expect.poll(async () => {
        notifications = await postNotifications(recipientPage, recipient.id, state.postId!);
        return notifications.filter((notification) => notification.type === 'mention').length;
      }, { timeout: 20_000 }).toBe(1);

      const removeMentionUpdate = await apiCall(creatorPage, `/posts/${state.postId}`, {
        method: 'PUT',
        body: { title: mentionRemovedTitle, taggedUserIds: [recipient.id] }
      });
      expect(removeMentionUpdate.status).toBe(200);
      await expect.poll(async () => {
        notifications = await postNotifications(recipientPage, recipient.id, state.postId!);
        return notifications.filter((notification) => notification.type === 'mention').length;
      }, { timeout: 20_000 }).toBe(0);

      const removeTagResponse = await apiCall(recipientPage, `/posts/people-tags/${state.peopleTagId}`, { method: 'DELETE' });
      expect(removeTagResponse.status).toBe(200);
      await expect.poll(async () => {
        notifications = await postNotifications(recipientPage, recipient.id, state.postId!);
        return notifications.filter((notification) => notification.type === 'people_tag').length;
      }, { timeout: 20_000 }).toBe(0);

      const cleanupResponse = await apiCall(creatorPage, `/posts/${state.postId}`, { method: 'DELETE' });
      expect(cleanupResponse.status).toBe(200);
      cleaned = true;
      for (const tagName of [normalizedEnglishTag, arabicTag]) {
        const topicAfterCleanup = await apiCall<{ data?: Array<{ id: string }> }>(recipientPage, `/hashtags/${encodeURIComponent(tagName)}/posts?sort=recent&limit=10`);
        expect(topicAfterCleanup.status).toBe(200);
        expect(topicAfterCleanup.body?.data?.some((post) => post.id === state.postId)).toBe(false);
      }
    } finally {
      if (state.postId && !cleaned) {
        const cleanupResponse = await apiCall(creatorPage, `/posts/${state.postId}`, { method: 'DELETE' });
        cleaned = cleanupResponse.status === 200 || cleanupResponse.status === 404;
      }
      await creatorContext.close();
      await recipientContext.close();
    }

    expect(cleaned).toBe(true);
    expect(state.createCount).toBe(1);
    expect(state.updateCount).toBe(2);
    expect(state.acceptCount).toBe(1);
    expect(state.removeTagCount).toBe(1);
    expect(state.cleanupCount).toBeGreaterThanOrEqual(1);
    expect(state.blocked).toEqual([]);
  });
});
