import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
import { io as createSocket, type Socket } from 'socket.io-client';
import { baseURL } from './helpers/env';

const CONTROLLED_WRITE_APPROVAL_ENV = 'ONLINE_CONTROLLED_WRITE_APPROVED';
const APPROVED_FRONTEND = 'https://socialinsightapp.com/';
const API_BASE_URL = (process.env.ONLINE_E2E_API_BASE_URL || 'https://socialinsight-api.onrender.com/api').replace(/\/$/, '');
const API_ORIGIN = new URL(API_BASE_URL).origin;
const authDirectory = path.resolve(process.cwd(), 'tests/e2e/.auth');
const creatorStatePath = path.join(authDirectory, 'public_creator.json');
const recipientStatePath = path.join(authDirectory, 'public_voter.json');
const controlledWriteApproved = process.env[CONTROLLED_WRITE_APPROVAL_ENV] === 'true';

interface StoredPersona {
  id: string;
  handle: string;
  token: string;
}

interface SafeNotification {
  id: string;
  type: string;
  targetId?: string;
  deepLink?: string;
  payload?: {
    postId?: string;
    commentId?: string;
    replyId?: string;
    sourceType?: 'post' | 'comment' | 'reply';
    deepLink?: string;
  };
}

interface MutationState {
  createdPostId?: string;
  allowedNotificationIds: Set<string>;
  createCount: number;
  commentCount: number;
  cleanupCount: number;
  blocked: string[];
}

function readPersona(storagePath: string): StoredPersona {
  const state = JSON.parse(fs.readFileSync(storagePath, 'utf8')) as {
    origins?: Array<{ origin?: string; localStorage?: Array<{ name?: string; value?: string }> }>;
  };
  const storage = state.origins?.find((entry) => entry.origin === new URL(baseURL).origin)?.localStorage || [];
  const token = storage.find((entry) => entry.name === 'si_token')?.value;
  const rawUser = storage.find((entry) => entry.name === 'si_user')?.value;
  const parsed = rawUser ? JSON.parse(rawUser) : undefined;
  const user = parsed?.user || parsed;

  if (!token || typeof user?.id !== 'string' || typeof user?.handle !== 'string') {
    throw new Error(`Invalid E2E auth state: ${path.basename(storagePath)}`);
  }
  return { id: user.id, handle: user.handle, token };
}

function requireGates(): void {
  if (!controlledWriteApproved) {
    throw new Error(`ONLINE_CONTROLLED_WRITE requires ${CONTROLLED_WRITE_APPROVAL_ENV}=true.`);
  }
  if (baseURL !== APPROVED_FRONTEND) {
    throw new Error(`Online Mention E2E is restricted to ${APPROVED_FRONTEND}.`);
  }
  if (new URL(API_BASE_URL).protocol !== 'https:' || new URL(API_BASE_URL).hostname !== 'socialinsight-api.onrender.com') {
    throw new Error('Online Mention E2E API host is not approved.');
  }
  for (const statePath of [creatorStatePath, recipientStatePath]) {
    if (!fs.existsSync(statePath)) throw new Error(`Missing E2E storage state: ${path.basename(statePath)}`);
  }
}

const isBackgroundMutation = (method: string, pathname: string) =>
  method === 'POST' && (/\/analytics\/interactions\/batch\/?$/.test(pathname) || /\/posts\/[^/]+\/views\/?$/.test(pathname));

async function installMutationGuard(page: Page, role: 'creator' | 'recipient', state: MutationState): Promise<void> {
  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return route.continue();

    const url = new URL(request.url());
    const pathname = url.pathname;
    if (isBackgroundMutation(method, pathname)) return route.fulfill({ status: 204, body: '' });

    if (role === 'creator' && method === 'POST' && /\/api\/posts\/?$/.test(pathname)) {
      const body = request.postDataJSON() as { title?: string };
      if (state.createCount === 0 && body?.title?.startsWith('e2e_')) {
        state.createCount += 1;
        return route.continue();
      }
    }

    if (role === 'creator' && method === 'POST' && state.createdPostId
      && pathname.endsWith(`/api/posts/${state.createdPostId}/comments`)) {
      const body = request.postDataJSON() as { text?: string };
      if (state.commentCount === 0 && body?.text?.startsWith('e2e_')) {
        state.commentCount += 1;
        return route.continue();
      }
    }

    if (role === 'creator' && method === 'DELETE' && state.createdPostId
      && pathname.endsWith(`/api/posts/${state.createdPostId}`)) {
      state.cleanupCount += 1;
      return route.continue();
    }

    const notificationReadMatch = pathname.match(/\/api\/users\/[^/]+\/notifications\/([^/]+)\/read\/?$/);
    if (role === 'recipient' && method === 'POST' && notificationReadMatch
      && state.allowedNotificationIds.has(notificationReadMatch[1])) {
      return route.continue();
    }

    state.blocked.push(`${method} ${url.hostname}${pathname}`);
    await route.abort('blockedbyclient');
  });
}

async function addRealtimeCollector(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const target = window as typeof window & { __e2eMentionEvents?: SafeNotification[] };
    target.__e2eMentionEvents = [];
    window.addEventListener('app:newNotification', (event) => {
      const detail = (event as CustomEvent<SafeNotification>).detail;
      target.__e2eMentionEvents?.push({
        id: detail?.id,
        type: detail?.type,
        targetId: detail?.targetId,
        deepLink: detail?.deepLink,
        payload: detail?.payload,
      });
    });
  });
}

async function apiCall<T>(page: Page, pathName: string, init?: { method?: string; body?: unknown }): Promise<{ status: number; body?: T }> {
  return page.evaluate(async ({ apiBaseUrl, pathName, init }) => {
    const token = window.localStorage.getItem('si_token');
    if (!token) return { status: 0 };
    const response = await fetch(`${apiBaseUrl}${pathName}`, {
      method: init?.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
    });
    let body: T | undefined;
    try { body = await response.json() as T; } catch { /* no response body */ }
    return { status: response.status, body };
  }, { apiBaseUrl: API_BASE_URL, pathName, init });
}

async function getMentionNotifications(page: Page, userId: string, postId: string): Promise<SafeNotification[]> {
  const response = await apiCall<SafeNotification[]>(page, `/users/${userId}/notifications`);
  expect(response.status).toBe(200);
  return (response.body || []).filter((notification) => notification.type === 'mention' && notification.targetId === postId);
}

function connectSpoofedSocket(token: string, claimedUserId: string): Promise<{ socket: Socket; events: SafeNotification[] }> {
  const socket = createSocket(API_ORIGIN, {
    auth: { token },
    query: { userId: claimedUserId },
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  const events: SafeNotification[] = [];
  socket.on('newNotification', (notification) => events.push({
    id: notification?.id,
    type: notification?.type,
    targetId: notification?.targetId,
    deepLink: notification?.deepLink,
    payload: notification?.payload,
  }));

  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve({ socket, events }));
    socket.once('connect_error', () => reject(new Error('Authenticated spoof-test socket failed to connect')));
  });
}

test.setTimeout(150_000);

test.describe('ONLINE_CONTROLLED_WRITE Mention foundation', () => {
  test.skip(!controlledWriteApproved, `ONLINE_CONTROLLED_WRITE requires ${CONTROLLED_WRITE_APPROVAL_ENV}=true.`);

  test('valid post/comment mentions navigate correctly while legacy room spoofing fails', async ({ browser }) => {
    test.info().annotations.push({ type: 'test-class', description: 'ONLINE_CONTROLLED_WRITE' });
    requireGates();

    const creator = readPersona(creatorStatePath);
    const recipient = readPersona(recipientStatePath);
    const state: MutationState = {
      allowedNotificationIds: new Set(),
      createCount: 0,
      commentCount: 0,
      cleanupCount: 0,
      blocked: [],
    };
    const suffix = `${Date.now()}_${randomUUID().slice(0, 8)}`;
    const postTitle = `e2e_mentions_post_${suffix} @${recipient.handle}`;
    const commentText = `e2e_mentions_comment_${suffix} @${recipient.handle}`;

    const creatorContext = await browser.newContext({ storageState: creatorStatePath, serviceWorkers: 'block' });
    const recipientContext = await browser.newContext({ storageState: recipientStatePath, serviceWorkers: 'block' });
    await addRealtimeCollector(recipientContext);
    const creatorPage = await creatorContext.newPage();
    const recipientPage = await recipientContext.newPage();
    await installMutationGuard(creatorPage, 'creator', state);
    await installMutationGuard(recipientPage, 'recipient', state);

    let spoofedSocket: Socket | undefined;
    let cleaned = false;
    try {
      let recipientSocketSeen = false;
      recipientPage.on('websocket', (webSocket) => {
        if (webSocket.url().includes('/socket.io/')) recipientSocketSeen = true;
      });

      await Promise.all([
        creatorPage.goto(baseURL, { waitUntil: 'domcontentloaded' }),
        recipientPage.goto(baseURL, { waitUntil: 'domcontentloaded' }),
      ]);
      await expect.poll(() => recipientSocketSeen, { timeout: 20_000 }).toBe(true);

      const spoof = await connectSpoofedSocket(creator.token, recipient.id);
      spoofedSocket = spoof.socket;

      const createResponse = await apiCall<{ id?: string }>(creatorPage, '/posts', {
        method: 'POST',
        body: {
          title: postTitle,
          description: '',
          type: 'Poll',
          options: [
            { text: 'e2e_option_one', votes: 0 },
            { text: 'e2e_option_two', votes: 0 },
          ],
          category: 'Technology',
          targetAudience: 'Public',
          allowAnonymous: true,
          forceAnonymous: false,
          allowComments: true,
          status: 'PUBLISHED',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      });
      expect(createResponse.status).toBe(200);
      expect(createResponse.body?.id).toBeTruthy();
      state.createdPostId = createResponse.body!.id!;

      await expect.poll(async () => recipientPage.evaluate((postId) => {
        const events = (window as typeof window & { __e2eMentionEvents?: SafeNotification[] }).__e2eMentionEvents || [];
        return events.filter((event) => event.type === 'mention' && event.targetId === postId).length;
      }, state.createdPostId), { timeout: 20_000 }).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 750));
      expect(spoof.events.filter((event) => event.targetId === state.createdPostId)).toHaveLength(0);

      let mentionNotifications: SafeNotification[] = [];
      await expect.poll(async () => {
        mentionNotifications = await getMentionNotifications(recipientPage, recipient.id, state.createdPostId!);
        return mentionNotifications.filter((notification) => notification.payload?.sourceType === 'post').length;
      }, { timeout: 20_000 }).toBe(1);
      const postNotification = mentionNotifications.find((notification) => notification.payload?.sourceType === 'post')!;
      expect(postNotification.deepLink).toBe(`/post/${state.createdPostId}`);
      state.allowedNotificationIds.add(postNotification.id);

      await recipientPage.goto(`${baseURL}notifications`, { waitUntil: 'domcontentloaded' });
      await recipientPage.locator(`[data-notification-id="${postNotification.id}"]`).click();
      await expect(recipientPage).toHaveURL(new RegExp(`/post/${state.createdPostId}(?:\\?.*)?$`));

      const commentResponse = await apiCall<{ id?: string }>(creatorPage, `/posts/${state.createdPostId}/comments`, {
        method: 'POST',
        body: { text: commentText },
      });
      expect(commentResponse.status).toBe(200);
      expect(commentResponse.body?.id).toBeTruthy();
      const commentId = commentResponse.body!.id!;

      await expect.poll(async () => recipientPage.evaluate(({ postId, commentId }) => {
        const events = (window as typeof window & { __e2eMentionEvents?: SafeNotification[] }).__e2eMentionEvents || [];
        return events.filter((event) => event.targetId === postId && event.payload?.commentId === commentId).length;
      }, { postId: state.createdPostId, commentId }), { timeout: 20_000 }).toBe(1);

      await expect.poll(async () => {
        mentionNotifications = await getMentionNotifications(recipientPage, recipient.id, state.createdPostId!);
        return mentionNotifications.filter((notification) => notification.payload?.commentId === commentId).length;
      }, { timeout: 20_000 }).toBe(1);
      const commentNotification = mentionNotifications.find((notification) => notification.payload?.commentId === commentId)!;
      expect(commentNotification.deepLink).toBe(`/post/${state.createdPostId}?comment=${commentId}`);
      state.allowedNotificationIds.add(commentNotification.id);

      await recipientPage.goto(`${baseURL}notifications`, { waitUntil: 'domcontentloaded' });
      await recipientPage.locator(`[data-notification-id="${commentNotification.id}"]`).click();
      await expect(recipientPage).toHaveURL(new RegExp(`/post/${state.createdPostId}\\?comment=${commentId}$`));
      const focusedComment = recipientPage.locator(`[data-comment-id="${commentId}"]`);
      await expect(focusedComment).toBeVisible({ timeout: 20_000 });
      await expect(focusedComment).toHaveClass(/ring-2/);

      const cleanup = await apiCall(creatorPage, `/posts/${state.createdPostId}`, { method: 'DELETE' });
      expect(cleanup.status).toBe(200);
      cleaned = true;
      await expect.poll(async () => (await getMentionNotifications(recipientPage, recipient.id, state.createdPostId!)).length, {
        timeout: 20_000,
      }).toBe(0);
    } finally {
      spoofedSocket?.disconnect();
      if (state.createdPostId && !cleaned) {
        const cleanup = await apiCall(creatorPage, `/posts/${state.createdPostId}`, { method: 'DELETE' });
        cleaned = cleanup.status === 200 || cleanup.status === 404;
      }
      await creatorContext.close();
      await recipientContext.close();
    }

    expect(cleaned).toBe(true);
    expect(state.createCount).toBe(1);
    expect(state.commentCount).toBe(1);
    expect(state.cleanupCount).toBeGreaterThanOrEqual(1);
    expect(state.blocked).toEqual([]);
  });
});
