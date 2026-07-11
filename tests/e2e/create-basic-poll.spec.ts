import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type Request, type Response, type Route } from '@playwright/test';
import { baseURL } from './helpers/env';
import { expectTokenPresent, gotoApp } from './helpers/auth';
import { publicCreatorAuthStatePath } from './helpers/authState';

const APPROVED_ONLINE_BASE_URL = 'https://socialinsightapp.com/';
const DEFAULT_APPROVED_API_HOST = 'socialinsightapp.com';
const CONTROLLED_WRITE_APPROVAL_ENV = 'ONLINE_CONTROLLED_WRITE_APPROVED';
const ADDITIONAL_APPROVED_API_HOSTS_ENV = 'ONLINE_E2E_APPROVED_API_HOSTS';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const controlledWriteApproved = process.env[CONTROLLED_WRITE_APPROVAL_ENV] === 'true';
const authStateExists = fs.existsSync(publicCreatorAuthStatePath);
const approvedApiHosts = buildApprovedApiHosts();

if (controlledWriteApproved && authStateExists) {
  test.use({ storageState: publicCreatorAuthStatePath });
}

type MutationAction = 'allowed-create' | 'allowed-cleanup' | 'neutralized' | 'blocked';

type MutationRecord = {
  method: string;
  hostname: string;
  pathname: string;
  action: MutationAction;
  reason?: string;
};

type MutationSafetyState = {
  createdPostId?: string;
  createPostUrl?: string;
  createResponseStatus?: number;
  createRequests: number;
  cleanupRequests: number;
  cleanupStarted: boolean;
  submitClicked: boolean;
  mutations: MutationRecord[];
};

type CreateTrackingState = {
  requestObserved: boolean;
  requestUrl?: string;
  requestUrlPath?: string;
  responseObserved: boolean;
  responseParsed: boolean;
  responseStatus: number | null;
  requestFinished: boolean;
  requestFailed: boolean;
  requestFailureText?: string;
  createIdCaptured: string | null;
};

type CreateOutcome =
  | { kind: 'response' }
  | { kind: 'request-failed' }
  | { kind: 'blocked'; mutation: MutationRecord }
  | { kind: 'validation'; messages: string[] }
  | { kind: 'timeout' };

function requireExplicitApproval(): void {
  if (!controlledWriteApproved) {
    throw new Error(
      `ONLINE_CONTROLLED_WRITE requires explicit approval. Set ${CONTROLLED_WRITE_APPROVAL_ENV}=true before running this test.`,
    );
  }
}

function requireCanonicalOnlineBaseUrl(): void {
  if (baseURL !== APPROVED_ONLINE_BASE_URL) {
    throw new Error(`ONLINE_CONTROLLED_WRITE requires E2E_BASE_URL=${APPROVED_ONLINE_BASE_URL}.`);
  }
}

function requireAuthStorageState(): void {
  if (!fs.existsSync(publicCreatorAuthStatePath)) {
    throw new Error(
      'Auth storage state is missing. Regenerate it with the approved online auth setup before running controlled-write tests.',
    );
  }
}

function normalizeApprovedHost(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();

  if (!trimmed) {
    return undefined;
  }

  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return url.hostname.toLowerCase();
  } catch {
    const [host] = trimmed.split(/[/:]/);
    return host || undefined;
  }
}

function buildApprovedApiHosts(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const hosts = new Set<string>([DEFAULT_APPROVED_API_HOST]);
  const configuredHosts = env[ADDITIONAL_APPROVED_API_HOSTS_ENV] || '';

  for (const host of configuredHosts.split(',')) {
    const normalizedHost = normalizeApprovedHost(host);

    if (normalizedHost) {
      hosts.add(normalizedHost);
    }
  }

  return hosts;
}

function isPostsCollectionPath(pathname: string): boolean {
  return /^\/(?:api\/)?posts\/?$/.test(pathname);
}

function isPostByIdPath(pathname: string, postId: string): boolean {
  return new RegExp(`^/(?:api/)?posts/${postId}/?$`).test(pathname);
}

function isPostViewPath(pathname: string): boolean {
  return /^\/(?:api\/)?posts\/[^/]+\/views\/?$/.test(pathname);
}

function isAnalyticsBatchPath(pathname: string): boolean {
  return /^\/(?:api\/)?analytics\/interactions\/batch\/?$/.test(pathname);
}

function isNeutralizableBackgroundMutation(method: string, pathname: string): boolean {
  return method === 'POST' && (isPostViewPath(pathname) || isAnalyticsBatchPath(pathname));
}

function isCreatePostResponse(response: Response): boolean {
  const request = response.request();
  const url = new URL(response.url());

  return isCreatePostRequestLike(request.method(), url);
}

function isCreatePostRequest(request: Request): boolean {
  return isCreatePostRequestLike(request.method(), new URL(request.url()));
}

function isCreatePostRequestLike(method: string, url: URL): boolean {
  return (
    method.toUpperCase() === 'POST' &&
    approvedApiHosts.has(url.hostname.toLowerCase()) &&
    isPostsCollectionPath(url.pathname)
  );
}

function extractCreatedPostId(responseBody: unknown): string | undefined {
  if (!responseBody || typeof responseBody !== 'object') {
    return undefined;
  }

  const body = responseBody as {
    id?: unknown;
    postId?: unknown;
    post?: { id?: unknown };
    data?: { id?: unknown; postId?: unknown; post?: { id?: unknown } };
  };

  if (typeof body.id === 'string') {
    return body.id;
  }

  if (typeof body.postId === 'string') {
    return body.postId;
  }

  if (typeof body.post?.id === 'string') {
    return body.post.id;
  }

  if (typeof body.data?.id === 'string') {
    return body.data.id;
  }

  if (typeof body.data?.postId === 'string') {
    return body.data.postId;
  }

  if (typeof body.data?.post?.id === 'string') {
    return body.data.post.id;
  }

  return undefined;
}

function extractCreatedPostIdFromLocation(locationValue: string): string | undefined {
  try {
    const url = new URL(locationValue, APPROVED_ONLINE_BASE_URL);
    const match = url.pathname.match(/^\/(?:api\/)?posts\/([^/]+)\/?$/);
    return match?.[1] ? decodeURIComponent(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

function buildDeleteUrl(createPostUrl: string, postId: string): string {
  const url = new URL(createPostUrl);
  url.pathname = url.pathname.replace(/\/$/, '') + `/${encodeURIComponent(postId)}`;
  return url.href;
}

function mutationSummary(records: MutationRecord[]): string[] {
  return records.map((record) => {
    const reason = record.reason ? ` reason=${record.reason}` : '';
    return `${record.method} host=${record.hostname} path=${record.pathname}${reason}`;
  });
}

function mutationsByAction(state: MutationSafetyState, action: MutationAction): MutationRecord[] {
  return state.mutations.filter((record) => record.action === action);
}

function expectNoBlockedMutations(state: MutationSafetyState): void {
  const blockedMutations = mutationsByAction(state, 'blocked');
  expect(mutationSummary(blockedMutations), 'expected no blocked or unexpected online data mutations').toEqual([]);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBlockedMutation(state: MutationSafetyState, timeoutMs: number): Promise<MutationRecord | undefined> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const blockedMutation = state.mutations.find((record) => record.action === 'blocked');

    if (blockedMutation) {
      return blockedMutation;
    }

    await delay(100);
  }

  return undefined;
}

function installCreateTracking(page: Page, state: CreateTrackingState): void {
  page.on('request', (request) => {
    if (!isCreatePostRequest(request)) {
      return;
    }

    const url = new URL(request.url());
    state.requestObserved = true;
    state.requestUrl = request.url();
    state.requestUrlPath = url.pathname;
  });

  page.on('response', (response) => {
    if (!isCreatePostResponse(response)) {
      return;
    }

    state.responseObserved = true;
    state.responseStatus = response.status();
    state.responseParsed = false;

    const locationId = extractCreatedPostIdFromLocation(response.headers().location || '');
    if (locationId) {
      state.createIdCaptured = locationId;
    }

    void response.json()
      .then((body) => {
        const id = extractCreatedPostId(body);

        if (id) {
          state.createIdCaptured = id;
        }
      })
      .catch(() => undefined)
      .finally(() => {
        state.responseParsed = true;
      });
  });

  page.on('requestfinished', (request) => {
    if (isCreatePostRequest(request)) {
      state.requestFinished = true;
    }
  });

  page.on('requestfailed', (request) => {
    if (!isCreatePostRequest(request)) {
      return;
    }

    state.requestFailed = true;
    state.requestFailureText = request.failure()?.errorText || 'request-failed';
  });
}

async function waitForCreateTrackingOutcome(
  page: Page,
  createState: CreateTrackingState,
  mutationState: MutationSafetyState,
  timeoutMs: number,
): Promise<CreateOutcome> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const blockedMutation = mutationState.mutations.find((record) => record.action === 'blocked');

    if (blockedMutation) {
      return { kind: 'blocked', mutation: blockedMutation };
    }

    if (createState.responseObserved && createState.responseParsed) {
      return { kind: 'response' };
    }

    if (createState.requestFailed) {
      return { kind: 'request-failed' };
    }

    const validationMessages = await visibleValidationMessages(page);
    if (validationMessages.length > 0) {
      return { kind: 'validation', messages: validationMessages };
    }

    await delay(250);
  }

  const blockedMutation = mutationState.mutations.find((record) => record.action === 'blocked');
  return blockedMutation ? { kind: 'blocked', mutation: blockedMutation } : { kind: 'timeout' };
}

async function visibleValidationMessages(page: Page): Promise<string[]> {
  const messages = await page
    .locator('text=/please|required|failed|error|select at least/i')
    .evaluateAll((elements) =>
      Array.from(new Set(
        elements
          .map((element) => element.textContent?.replace(/\s+/g, ' ').trim())
          .filter((message): message is string => Boolean(message)),
      )).slice(0, 5),
    )
    .catch(() => []);

  return messages;
}

async function createFailureDetails(page: Page, state: MutationSafetyState, reason: string): Promise<string> {
  const blockedMutations = mutationsByAction(state, 'blocked');
  const neutralizedMutations = mutationsByAction(state, 'neutralized');
  const validationMessages = await visibleValidationMessages(page);
  const details = [
    `reason=${reason}`,
    `submitClicked=${state.submitClicked ? 'yes' : 'no'}`,
    `allowedCreateRequests=${state.createRequests}`,
    `neutralizedMutations=${mutationSummary(neutralizedMutations).join(' | ') || 'none'}`,
    `blockedMutations=${mutationSummary(blockedMutations).join(' | ') || 'none'}`,
    `visibleValidation=${validationMessages.join(' | ') || 'none'}`,
  ];

  return details.join('; ');
}

async function createTrackingFailureDetails(
  page: Page,
  mutationState: MutationSafetyState,
  createState: CreateTrackingState,
  reason: string,
): Promise<string> {
  const baseDetails = await createFailureDetails(page, mutationState, reason);
  const trackingDetails = [
    `createRequestObserved=${createState.requestObserved ? 'yes' : 'no'}`,
    `createResponseObserved=${createState.responseObserved ? 'yes' : 'no'}`,
    `createResponseStatus=${createState.responseStatus ?? 'none'}`,
    `createRequestFinished=${createState.requestFinished ? 'yes' : 'no'}`,
    `createRequestFailed=${createState.requestFailed ? 'yes' : 'no'}`,
    `createIdCaptured=${createState.createIdCaptured ? 'yes' : 'no'}`,
  ];

  return `${baseDetails}; ${trackingDetails.join('; ')}`;
}

async function installMutationGuard(page: Page, state: MutationSafetyState): Promise<void> {
  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    const method = request.method().toUpperCase();

    if (!MUTATING_METHODS.has(method)) {
      await route.continue();
      return;
    }

    const url = new URL(request.url());
    const hostname = url.hostname.toLowerCase();

    if (!approvedApiHosts.has(hostname)) {
      state.mutations.push({
        method,
        hostname,
        pathname: url.pathname,
        action: 'blocked',
        reason: 'unapproved-api-host',
      });
      await route.abort('blockedbyclient');
      return;
    }

    const canCreatePoll = method === 'POST' && isPostsCollectionPath(url.pathname) && state.createRequests === 0;
    const canCleanupPoll =
      method === 'DELETE' &&
      state.cleanupStarted &&
      Boolean(state.createdPostId) &&
      isPostByIdPath(url.pathname, state.createdPostId!);
    const canNeutralizeBackgroundWrite = isNeutralizableBackgroundMutation(method, url.pathname);

    if (canCreatePoll) {
      state.createRequests += 1;
      state.createPostUrl = request.url();
      state.mutations.push({ method, hostname, pathname: url.pathname, action: 'allowed-create' });
      await route.continue();
      return;
    }

    if (canCleanupPoll) {
      state.cleanupRequests += 1;
      state.mutations.push({ method, hostname, pathname: url.pathname, action: 'allowed-cleanup' });
      await route.continue();
      return;
    }

    if (canNeutralizeBackgroundWrite) {
      state.mutations.push({
        method,
        hostname,
        pathname: url.pathname,
        action: 'neutralized',
        reason: 'background-view-or-analytics',
      });

      if (isPostViewPath(url.pathname)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ recorded: false, viewCount: 0 }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ acceptedCount: 0, rejectedCount: 0, rejections: [] }),
      });
      return;
    }

    state.mutations.push({
      method,
      hostname,
      pathname: url.pathname,
      action: 'blocked',
      reason: 'unapproved-mutation',
    });
    await route.abort('blockedbyclient');
  });
}

async function cleanupCreatedPoll(page: Page, state: MutationSafetyState): Promise<void> {
  if (!state.createdPostId || !state.createPostUrl) {
    return;
  }

  const deleteUrl = buildDeleteUrl(state.createPostUrl, state.createdPostId);
  state.cleanupStarted = true;

  try {
    const result = await page.evaluate(async (targetUrl) => {
      const token = window.localStorage.getItem('si_token');
      const rawUser = window.localStorage.getItem('si_user');
      const pathname = new URL(targetUrl).pathname;
      let userId: string | null = null;

      if (rawUser) {
        try {
          const parsedUser = JSON.parse(rawUser);
          userId = typeof parsedUser?.id === 'string' ? parsedUser.id : null;
        } catch {
          userId = null;
        }
      }

      if (!token || !userId) {
        return { ok: false, status: 0, pathname, reason: 'missing-auth' };
      }

      try {
        const response = await fetch(targetUrl, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ userId }),
        });

        return { ok: response.ok, status: response.status, pathname: new URL(response.url).pathname };
      } catch {
        return { ok: false, status: 0, pathname, reason: 'request-failed' };
      }
    }, deleteUrl);

    if (!result.ok) {
      throw new Error(`Cleanup failed with HTTP ${result.status} for DELETE ${result.pathname}.`);
    }
  } finally {
    state.cleanupStarted = false;
  }
}

test.setTimeout(90_000);

test.describe('ONLINE_CONTROLLED_WRITE basic public poll creation', () => {
  test.skip(
    !controlledWriteApproved,
    `ONLINE_CONTROLLED_WRITE requires explicit approval: set ${CONTROLLED_WRITE_APPROVAL_ENV}=true.`,
  );

  // ONLINE_CONTROLLED_WRITE: creates one e2e_ poll online and deletes only the captured post ID.
  test('creates and cleans up a basic public poll', async ({ page }) => {
    test.info().annotations.push({ type: 'test-class', description: 'ONLINE_CONTROLLED_WRITE' });

    requireExplicitApproval();
    requireCanonicalOnlineBaseUrl();
    requireAuthStorageState();

    const uniqueSuffix = `${Date.now()}_${randomUUID().slice(0, 8)}`;
    const pollTitle = `e2e_basic_poll_${uniqueSuffix}`;
    const optionA = `e2e_option_a_${uniqueSuffix}`;
    const optionB = `e2e_option_b_${uniqueSuffix}`;
    const safetyState: MutationSafetyState = {
      createRequests: 0,
      cleanupRequests: 0,
      cleanupStarted: false,
      submitClicked: false,
      mutations: [],
    };
    const createState: CreateTrackingState = {
      requestObserved: false,
      responseObserved: false,
      responseParsed: false,
      responseStatus: null,
      requestFinished: false,
      requestFailed: false,
      createIdCaptured: null,
    };

    expect(pollTitle.startsWith('e2e_'), 'expected controlled-write poll title to use e2e_ prefix').toBe(true);
    expect(optionA.startsWith('e2e_'), 'expected controlled-write poll option to use e2e_ prefix').toBe(true);
    expect(optionB.startsWith('e2e_'), 'expected controlled-write poll option to use e2e_ prefix').toBe(true);

    await installMutationGuard(page, safetyState);
    installCreateTracking(page, createState);

    try {
      await gotoApp(page, '/create/poll');
      await expectTokenPresent(page);
      await expect(page.getByRole('heading', { name: /new poll/i })).toBeVisible({ timeout: 15_000 });

      await page.getByPlaceholder('Ask a question...').fill(pollTitle);
      await page.getByPlaceholder('Option 1').fill(optionA);
      await page.getByPlaceholder('Option 2').fill(optionB);

      await page.getByRole('button', { name: /select category/i }).click();
      await page.getByRole('button', { name: /^Technology$/ }).click();

      expectNoBlockedMutations(safetyState);

      const createOutcomePromise = waitForCreateTrackingOutcome(page, createState, safetyState, 30_000);
      await page.getByRole('button', { name: /^Post$/ }).click();
      safetyState.submitClicked = true;

      const createOutcome = await createOutcomePromise;

      if (createOutcome.kind === 'blocked') {
        throw new Error(await createTrackingFailureDetails(page, safetyState, createState, 'blocked-mutation-before-create-response'));
      }

      if (createOutcome.kind === 'request-failed') {
        throw new Error(await createTrackingFailureDetails(page, safetyState, createState, createState.requestFailureText || 'create-request-failed'));
      }

      if (createOutcome.kind === 'validation') {
        throw new Error(await createTrackingFailureDetails(page, safetyState, createState, 'visible-validation-before-create-response'));
      }

      if (createOutcome.kind === 'timeout') {
        throw new Error(await createTrackingFailureDetails(page, safetyState, createState, 'create-response-timeout'));
      }

      safetyState.createPostUrl = safetyState.createPostUrl || createState.requestUrl;
      safetyState.createResponseStatus = createState.responseStatus ?? undefined;

      expect(createState.responseStatus, 'expected poll creation response status to be observed').not.toBeNull();
      expect(createState.responseStatus! >= 200 && createState.responseStatus! < 300, 'expected poll creation request to return HTTP 2xx').toBe(true);

      if (!createState.createIdCaptured) {
        throw new Error(
          await createTrackingFailureDetails(page, safetyState, createState, 'created-poll-id-not-captured'),
        );
      }

      safetyState.createdPostId = createState.createIdCaptured;

      await expect(page.getByText(pollTitle).first()).toBeVisible({ timeout: 15_000 });
    } finally {
      try {
        await cleanupCreatedPoll(page, safetyState);
      } finally {
        console.log(`CONTROLLED_WRITE_MUTATIONS ${JSON.stringify(mutationSummary(safetyState.mutations))}`);
        console.log(`CONTROLLED_WRITE_CREATE_TRACKING ${JSON.stringify({
          requestObserved: createState.requestObserved,
          responseObserved: createState.responseObserved,
          responseStatus: createState.responseStatus,
          responseParsed: createState.responseParsed,
          requestFinished: createState.requestFinished,
          requestFailed: createState.requestFailed,
          idCaptured: Boolean(createState.createIdCaptured),
        })}`);
      }
    }

    expect(safetyState.createRequests, 'expected exactly one poll creation request').toBe(1);
    expect(safetyState.cleanupRequests, 'expected exactly one cleanup request').toBe(1);
    expectNoBlockedMutations(safetyState);
  });
});
