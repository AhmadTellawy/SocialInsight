import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type Request, type Route } from '@playwright/test';
import { baseURL } from './helpers/env';
import { expectTokenPresent, gotoApp } from './helpers/auth';
import { publicCreatorAuthStatePath } from './helpers/authState';

const APPROVED_ONLINE_BASE_URL = 'https://socialinsightapp.com/';
const DEFAULT_APPROVED_API_HOST = 'socialinsightapp.com';
const APPROVED_API_HOSTS_ENV = 'ONLINE_E2E_APPROVED_API_HOSTS';
const CONTROLLED_WRITE_APPROVAL_ENV = 'ONLINE_CONTROLLED_WRITE_APPROVED';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const publicVoterAuthStatePath = path.resolve(process.cwd(), 'tests/e2e/.auth/public_voter.json');

const controlledWriteApproved = process.env[CONTROLLED_WRITE_APPROVAL_ENV] === 'true';
const approvedApiHosts = buildApprovedApiHosts();

type MutationAction = 'allowed-create' | 'allowed-vote' | 'allowed-cleanup' | 'neutralized' | 'blocked';

type MutationRecord = {
  method: string;
  hostname: string;
  pathname: string;
  action: MutationAction;
  reason?: string;
};

type MutationState = {
  createdPostId?: string;
  createPostUrl?: string;
  selectedOptionId?: string;
  cleanupStarted: boolean;
  createRequests: number;
  voteRequests: number;
  cleanupRequests: number;
  mutations: MutationRecord[];
};

type CreateTrackingState = {
  requestObserved: boolean;
  responseObserved: boolean;
  responseParsed: boolean;
  responseStatus: number | null;
  requestFinished: boolean;
  requestFailed: boolean;
  idCaptured: string | null;
  optionIdCaptured: string | null;
};

type VoteTrackingState = {
  requestObserved: boolean;
  responseObserved: boolean;
  responseParsed: boolean;
  responseStatus: number | null;
  requestFinished: boolean;
  requestFailed: boolean;
  optionIdsCaptured: string[];
};

function normalizeApprovedHost(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;

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
  const configuredHosts = env[APPROVED_API_HOSTS_ENV] || '';

  for (const value of configuredHosts.split(',')) {
    const host = normalizeApprovedHost(value);
    if (host) hosts.add(host);
  }

  return hosts;
}

function requireGates(): void {
  if (!controlledWriteApproved) {
    throw new Error(`ONLINE_CONTROLLED_WRITE requires ${CONTROLLED_WRITE_APPROVAL_ENV}=true.`);
  }

  if (baseURL !== APPROVED_ONLINE_BASE_URL) {
    throw new Error(`ONLINE_CONTROLLED_WRITE requires E2E_BASE_URL=${APPROVED_ONLINE_BASE_URL}.`);
  }

  if (!fs.existsSync(publicCreatorAuthStatePath)) {
    throw new Error('public_creator storageState is missing.');
  }

  if (!fs.existsSync(publicVoterAuthStatePath)) {
    throw new Error('public_voter storageState is missing.');
  }
}

function isPostsCollectionPath(pathname: string): boolean {
  return /^\/(?:api\/)?posts\/?$/.test(pathname);
}

function isPostByIdPath(pathname: string, postId: string): boolean {
  return new RegExp(`^/(?:api/)?posts/${postId}/?$`).test(pathname);
}

function isVotePath(pathname: string, postId: string): boolean {
  return new RegExp(`^/(?:api/)?posts/${postId}/vote/?$`).test(pathname);
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

function isCreateRequest(request: Request): boolean {
  const url = new URL(request.url());
  return request.method().toUpperCase() === 'POST' && approvedApiHosts.has(url.hostname.toLowerCase()) && isPostsCollectionPath(url.pathname);
}

function isVoteRequest(request: Request, postId?: string): boolean {
  if (!postId) return false;
  const url = new URL(request.url());
  return request.method().toUpperCase() === 'POST' && approvedApiHosts.has(url.hostname.toLowerCase()) && isVotePath(url.pathname, postId);
}

function mutationSummary(records: MutationRecord[]): string[] {
  return records.map((record) => {
    const reason = record.reason ? ` reason=${record.reason}` : '';
    return `${record.method} host=${record.hostname} path=${record.pathname}${reason}`;
  });
}

function mutationsByAction(state: MutationState, action: MutationAction): MutationRecord[] {
  return state.mutations.filter((record) => record.action === action);
}

function extractCreatedPostId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;

  const data = body as {
    id?: unknown;
    postId?: unknown;
    post?: { id?: unknown };
    data?: { id?: unknown; postId?: unknown; post?: { id?: unknown } };
  };

  if (typeof data.id === 'string') return data.id;
  if (typeof data.postId === 'string') return data.postId;
  if (typeof data.post?.id === 'string') return data.post.id;
  if (typeof data.data?.id === 'string') return data.data.id;
  if (typeof data.data?.postId === 'string') return data.data.postId;
  if (typeof data.data?.post?.id === 'string') return data.data.post.id;

  return undefined;
}

function extractTrackedOptionId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  type ResponseOption = { id?: unknown; ratingValue?: unknown };
  const data = body as {
    options?: ResponseOption[];
    post?: { options?: ResponseOption[] };
    data?: { options?: ResponseOption[]; post?: { options?: ResponseOption[] } };
  };
  const options = data.options || data.post?.options || data.data?.options || data.data?.post?.options || [];
  const optionId = (options.find((option) => Number(option.ratingValue) === 4) || options[0])?.id;
  return typeof optionId === 'string' ? optionId : undefined;
}

function buildDeleteUrl(createPostUrl: string, postId: string): string {
  const url = new URL(createPostUrl);
  url.pathname = url.pathname.replace(/\/$/, '') + `/${encodeURIComponent(postId)}`;
  return url.href;
}

async function installMutationGuard(page: Page, state: MutationState): Promise<void> {
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
      state.mutations.push({ method, hostname, pathname: url.pathname, action: 'blocked', reason: 'unapproved-api-host' });
      await route.abort('blockedbyclient');
      return;
    }

    const canCreate = method === 'POST' && isPostsCollectionPath(url.pathname) && state.createRequests === 0;
    const canVote =
      method === 'POST' &&
      Boolean(state.createdPostId) &&
      isVotePath(url.pathname, state.createdPostId!) &&
      state.voteRequests === 0;
    const canCleanup =
      method === 'DELETE' &&
      state.cleanupStarted &&
      Boolean(state.createdPostId) &&
      isPostByIdPath(url.pathname, state.createdPostId!);

    if (canCreate) {
      state.createRequests += 1;
      state.createPostUrl = request.url();
      state.mutations.push({ method, hostname, pathname: url.pathname, action: 'allowed-create' });
      await route.continue();
      return;
    }

    if (canVote) {
      state.voteRequests += 1;
      state.mutations.push({ method, hostname, pathname: url.pathname, action: 'allowed-vote' });
      await route.continue();
      return;
    }

    if (canCleanup) {
      state.cleanupRequests += 1;
      state.mutations.push({ method, hostname, pathname: url.pathname, action: 'allowed-cleanup' });
      await route.continue();
      return;
    }

    if (isNeutralizableBackgroundMutation(method, url.pathname)) {
      state.mutations.push({ method, hostname, pathname: url.pathname, action: 'neutralized', reason: 'background-view-or-analytics' });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: isPostViewPath(url.pathname)
          ? JSON.stringify({ recorded: false, viewCount: 0 })
          : JSON.stringify({ acceptedCount: 0, rejectedCount: 0, rejections: [] }),
      });
      return;
    }

    state.mutations.push({ method, hostname, pathname: url.pathname, action: 'blocked', reason: 'unapproved-mutation' });
    await route.abort('blockedbyclient');
  });
}

function installCreateTracking(page: Page, state: CreateTrackingState): void {
  page.on('request', (request) => {
    if (isCreateRequest(request)) state.requestObserved = true;
  });

  page.on('response', (response) => {
    if (!isCreateRequest(response.request())) return;

    state.responseObserved = true;
    state.responseStatus = response.status();
    state.responseParsed = false;

    void response.json()
      .then((body) => {
        const id = extractCreatedPostId(body);
        const optionId = extractTrackedOptionId(body);
        if (id) state.idCaptured = id;
        if (optionId) state.optionIdCaptured = optionId;
      })
      .catch(() => undefined)
      .finally(() => {
        state.responseParsed = true;
      });
  });

  page.on('requestfinished', (request) => {
    if (isCreateRequest(request)) state.requestFinished = true;
  });

  page.on('requestfailed', (request) => {
    if (isCreateRequest(request)) state.requestFailed = true;
  });
}

function installVoteTracking(page: Page, state: MutationState, voteState: VoteTrackingState): void {
  page.on('request', (request) => {
    if (!isVoteRequest(request, state.createdPostId)) return;
    voteState.requestObserved = true;
    try {
      const body = request.postDataJSON() as { optionIds?: unknown };
      voteState.optionIdsCaptured = Array.isArray(body.optionIds)
        ? body.optionIds.filter((optionId): optionId is string => typeof optionId === 'string')
        : [];
    } catch {
      voteState.optionIdsCaptured = [];
    }
  });

  page.on('response', (response) => {
    if (!isVoteRequest(response.request(), state.createdPostId)) return;

    voteState.responseObserved = true;
    voteState.responseStatus = response.status();
    voteState.responseParsed = false;
    void response.json()
      .catch(() => undefined)
      .finally(() => {
        voteState.responseParsed = true;
      });
  });

  page.on('requestfinished', (request) => {
    if (isVoteRequest(request, state.createdPostId)) voteState.requestFinished = true;
  });

  page.on('requestfailed', (request) => {
    if (isVoteRequest(request, state.createdPostId)) voteState.requestFailed = true;
  });
}

async function waitForCreateResponse(createState: CreateTrackingState, mutationState: MutationState): Promise<void> {
  const deadline = Date.now() + 30_000;

  while (Date.now() <= deadline) {
    const blocked = mutationsByAction(mutationState, 'blocked')[0];
    if (blocked) throw new Error(`Blocked mutation before create response: ${mutationSummary([blocked]).join('')}`);
    if (createState.responseObserved && createState.responseParsed) return;
    if (createState.requestFailed) throw new Error('Create request failed.');
    await delay(250);
  }

  throw new Error(
    [
      'Create response timeout',
      `requestObserved=${createState.requestObserved ? 'yes' : 'no'}`,
      `responseObserved=${createState.responseObserved ? 'yes' : 'no'}`,
      `requestFinished=${createState.requestFinished ? 'yes' : 'no'}`,
      `idCaptured=${createState.idCaptured ? 'yes' : 'no'}`,
      `optionIdCaptured=${createState.optionIdCaptured ? 'yes' : 'no'}`,
    ].join('; '),
  );
}

async function waitForVoteResponse(voteState: VoteTrackingState, mutationState: MutationState): Promise<void> {
  const deadline = Date.now() + 30_000;

  while (Date.now() <= deadline) {
    const blocked = mutationsByAction(mutationState, 'blocked')[0];
    if (blocked) throw new Error(`Blocked mutation before vote response: ${mutationSummary([blocked]).join('')}`);
    if (voteState.responseObserved && voteState.responseParsed) return;
    if (voteState.requestFailed) throw new Error('Vote request failed.');
    await delay(250);
  }

  throw new Error(
    [
      'Vote response timeout',
      `requestObserved=${voteState.requestObserved ? 'yes' : 'no'}`,
      `responseObserved=${voteState.responseObserved ? 'yes' : 'no'}`,
      `requestFinished=${voteState.requestFinished ? 'yes' : 'no'}`,
    ].join('; '),
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanupCreatedPoll(page: Page, state: MutationState): Promise<void> {
  if (!state.createdPostId || !state.createPostUrl) return;

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

      if (!token || !userId) return { ok: false, status: 0, pathname };

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
        return { ok: false, status: 0, pathname };
      }
    }, deleteUrl);

    if (!result.ok) {
      throw new Error(`Cleanup failed with HTTP ${result.status} for DELETE ${result.pathname}.`);
    }
  } finally {
    state.cleanupStarted = false;
  }
}

test.setTimeout(120_000);

test.describe('ONLINE_CONTROLLED_WRITE basic poll vote', () => {
  test.skip(!controlledWriteApproved, `ONLINE_CONTROLLED_WRITE requires ${CONTROLLED_WRITE_APPROVAL_ENV}=true.`);

  test('creates a poll, votes once with a second persona, and cleans up', async ({ browser }) => {
    test.info().annotations.push({ type: 'test-class', description: 'ONLINE_CONTROLLED_WRITE' });
    requireGates();

    const uniqueSuffix = `${Date.now()}_${randomUUID().slice(0, 8)}`;
    const pollTitle = `e2e_vote_poll_${uniqueSuffix}`;
    const optionA = `e2e_vote_option_a_${uniqueSuffix}`;
    const optionB = `e2e_vote_option_b_${uniqueSuffix}`;
    const state: MutationState = {
      cleanupStarted: false,
      createRequests: 0,
      voteRequests: 0,
      cleanupRequests: 0,
      mutations: [],
    };
    const createState: CreateTrackingState = {
      requestObserved: false,
      responseObserved: false,
      responseParsed: false,
      responseStatus: null,
      requestFinished: false,
      requestFailed: false,
      idCaptured: null,
      optionIdCaptured: null,
    };
    const voteState: VoteTrackingState = {
      requestObserved: false,
      responseObserved: false,
      responseParsed: false,
      responseStatus: null,
      requestFinished: false,
      requestFailed: false,
      optionIdsCaptured: [],
    };

    const creatorContext = await browser.newContext({
      baseURL: APPROVED_ONLINE_BASE_URL,
      storageState: publicCreatorAuthStatePath,
    });
    const voterContext = await browser.newContext({
      baseURL: APPROVED_ONLINE_BASE_URL,
      storageState: publicVoterAuthStatePath,
    });
    const creatorPage = await creatorContext.newPage();
    const voterPage = await voterContext.newPage();

    await installMutationGuard(creatorPage, state);
    await installMutationGuard(voterPage, state);
    installCreateTracking(creatorPage, createState);
    installVoteTracking(voterPage, state, voteState);

    try {
      await gotoApp(creatorPage, '/');
      await expectTokenPresent(creatorPage);

      const createPromise = creatorPage.evaluate(async (payload) => {
        const token = window.localStorage.getItem('si_token');
        if (!token) return { ok: false, status: 0 };

        const response = await fetch('https://socialinsight-api.onrender.com/api/posts', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        return { ok: response.ok, status: response.status };
      }, {
        title: pollTitle,
        description: '',
        type: 'Poll',
        pollChoiceType: 'multiple',
        options: [
          { id: 'option-a', text: optionA, votes: 0 },
          { id: 'option-b', text: optionB, votes: 0 },
        ],
        category: 'Technology',
        targetAudience: 'Public',
        targetGroups: [],
        resultsWho: 'Public',
        resultsTiming: 'AnyTime',
        allowAnonymous: true,
        forceAnonymous: false,
        allowMultipleSelection: false,
        allowUserOptions: false,
        allowComments: true,
        status: 'PUBLISHED',
      });

      await Promise.all([createPromise, waitForCreateResponse(createState, state)]);

      expect(createState.responseStatus, 'expected create response status').not.toBeNull();
      expect(createState.responseStatus! >= 200 && createState.responseStatus! < 300).toBe(true);
      expect(createState.idCaptured, 'expected created poll ID').toBeTruthy();
      expect(createState.optionIdCaptured, 'expected created poll option ID').toBeTruthy();

      state.createdPostId = createState.idCaptured!;
      state.selectedOptionId = createState.optionIdCaptured!;
      state.createPostUrl = state.createPostUrl || 'https://socialinsight-api.onrender.com/api/posts';

      await gotoApp(voterPage, `/post/${state.createdPostId}`);
      await expectTokenPresent(voterPage);

      const votePromise = voterPage.evaluate(async ({ postId, optionId }) => {
        const token = window.localStorage.getItem('si_token');
        if (!token) return { ok: false, status: 0 };

        const response = await fetch(`https://socialinsight-api.onrender.com/api/posts/${postId}/vote`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ optionIds: [optionId], isAnonymous: true }),
        });
        return { ok: response.ok, status: response.status };
      }, { postId: state.createdPostId, optionId: state.selectedOptionId });

      await Promise.all([votePromise, waitForVoteResponse(voteState, state)]);

      expect(voteState.responseStatus, 'expected vote response status').not.toBeNull();
      expect(voteState.responseStatus! >= 200 && voteState.responseStatus! < 300).toBe(true);

      const verification = await voterPage.evaluate(async (postId) => {
        const token = window.localStorage.getItem('si_token');
        const rawUser = window.localStorage.getItem('si_user');
        let userId: string | null = null;

        if (rawUser) {
          try {
            const parsedUser = JSON.parse(rawUser);
            userId = typeof parsedUser?.id === 'string' ? parsedUser.id : null;
          } catch {
            userId = null;
          }
        }

        if (!token || !userId) return { ok: false, status: 0, participated: false };

        const response = await fetch(`https://socialinsight-api.onrender.com/api/posts/${postId}?userId=${encodeURIComponent(userId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return { ok: false, status: response.status, participated: false };
        const post = await response.json();
        return {
          ok: true,
          status: response.status,
          participated: Boolean(post?.hasParticipated),
          selectedCount: Array.isArray(post?.userSelectedOptions) ? post.userSelectedOptions.length : 0,
        };
      }, state.createdPostId);

      expect(verification.ok, 'expected post verification request to succeed').toBe(true);
      expect(verification.participated || verification.selectedCount > 0, 'expected vote to be reflected for voter').toBe(true);
    } finally {
      try {
        await cleanupCreatedPoll(creatorPage, state);
      } finally {
        console.log(`POLL_VOTE_CONTROLLED_WRITE_MUTATIONS ${JSON.stringify(mutationSummary(state.mutations))}`);
        console.log(`POLL_VOTE_CREATE_TRACKING ${JSON.stringify({
          requestObserved: createState.requestObserved,
          responseObserved: createState.responseObserved,
          responseStatus: createState.responseStatus,
          responseParsed: createState.responseParsed,
          requestFinished: createState.requestFinished,
          requestFailed: createState.requestFailed,
          idCaptured: Boolean(createState.idCaptured),
          optionIdCaptured: Boolean(createState.optionIdCaptured),
        })}`);
        console.log(`POLL_VOTE_TRACKING ${JSON.stringify({
          requestObserved: voteState.requestObserved,
          responseObserved: voteState.responseObserved,
          responseStatus: voteState.responseStatus,
          responseParsed: voteState.responseParsed,
          requestFinished: voteState.requestFinished,
          requestFailed: voteState.requestFailed,
          optionIdsCaptured: voteState.optionIdsCaptured,
        })}`);
        await creatorContext.close();
        await voterContext.close();
      }
    }

    expect(state.createRequests, 'expected exactly one poll create request').toBe(1);
    expect(state.voteRequests, 'expected exactly one poll vote request').toBe(1);
    expect(state.cleanupRequests, 'expected exactly one cleanup request').toBe(1);
    expect(mutationSummary(mutationsByAction(state, 'blocked')), 'expected no blocked mutations').toEqual([]);
  });

  test('renders and submits a compact Rating Scale safely in English and Arabic', async ({ browser }) => {
    test.info().annotations.push({ type: 'test-class', description: 'ONLINE_CONTROLLED_WRITE' });
    requireGates();

    const uniqueSuffix = `${Date.now()}_${randomUUID().slice(0, 8)}`;
    const pollTitle = `e2e_rating_poll_${uniqueSuffix}`;
    const state: MutationState = {
      cleanupStarted: false,
      createRequests: 0,
      voteRequests: 0,
      cleanupRequests: 0,
      mutations: [],
    };
    const createState: CreateTrackingState = {
      requestObserved: false,
      responseObserved: false,
      responseParsed: false,
      responseStatus: null,
      requestFinished: false,
      requestFailed: false,
      idCaptured: null,
      optionIdCaptured: null,
    };
    const voteState: VoteTrackingState = {
      requestObserved: false,
      responseObserved: false,
      responseParsed: false,
      responseStatus: null,
      requestFinished: false,
      requestFailed: false,
      optionIdsCaptured: [],
    };

    const creatorContext = await browser.newContext({
      baseURL: APPROVED_ONLINE_BASE_URL,
      storageState: publicCreatorAuthStatePath,
    });
    const voterContext = await browser.newContext({
      baseURL: APPROVED_ONLINE_BASE_URL,
      storageState: publicVoterAuthStatePath,
      viewport: { width: 390, height: 844 },
    });
    const creatorPage = await creatorContext.newPage();
    const voterPage = await voterContext.newPage();

    await installMutationGuard(creatorPage, state);
    await installMutationGuard(voterPage, state);
    installCreateTracking(creatorPage, createState);
    installVoteTracking(voterPage, state, voteState);

    const setLanguage = async (language: 'en' | 'ar') => {
      await voterPage.evaluate((value) => {
        window.localStorage.setItem('i18nextLng', value);
        document.cookie = `i18next=${value}; path=/`;
      }, language);
      await voterPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(voterPage.locator('#root')).toBeVisible();
    };

    try {
      await gotoApp(creatorPage, '/');
      await expectTokenPresent(creatorPage);

      const createPromise = creatorPage.evaluate(async (payload) => {
        const token = window.localStorage.getItem('si_token');
        if (!token) return { ok: false, status: 0 };

        const response = await fetch('https://socialinsight-api.onrender.com/api/posts', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        return { ok: response.ok, status: response.status };
      }, {
        title: pollTitle,
        description: '',
        type: 'Poll',
        pollChoiceType: 'rating',
        options: [5, 4, 3, 2, 1].map((ratingValue, order) => ({
          id: `e2e_rating_${ratingValue}_${uniqueSuffix}`,
          text: String(ratingValue),
          votes: 0,
          order,
          isRating: true,
          ratingValue,
        })),
        category: 'Technology',
        targetAudience: 'Public',
        targetGroups: [],
        resultsWho: 'Public',
        resultsTiming: 'AnyTime',
        allowAnonymous: true,
        forceAnonymous: false,
        allowMultipleSelection: false,
        allowUserOptions: false,
        allowComments: true,
        status: 'PUBLISHED',
      });

      await Promise.all([createPromise, waitForCreateResponse(createState, state)]);
      expect(createState.responseStatus, 'expected Rating Poll create response status').not.toBeNull();
      expect(createState.responseStatus! >= 200 && createState.responseStatus! < 300).toBe(true);
      expect(createState.idCaptured, 'expected created Rating Poll ID').toBeTruthy();
      expect(createState.optionIdCaptured, 'expected rating=4 option ID').toBeTruthy();

      state.createdPostId = createState.idCaptured!;
      state.selectedOptionId = createState.optionIdCaptured!;
      state.createPostUrl = state.createPostUrl || 'https://socialinsight-api.onrender.com/api/posts';

      await gotoApp(voterPage, `/post/${state.createdPostId}`);
      await expectTokenPresent(voterPage);
      await setLanguage('en');

      const ratingInput = voterPage.getByTestId('rating-scale-input');
      const ratingStars = ratingInput.getByTestId('rating-star');
      await expect(voterPage.getByText(pollTitle, { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(ratingInput).toBeVisible();
      await expect(ratingStars).toHaveCount(5);
      await expect(voterPage.getByTestId('rating-scale-results')).toHaveCount(0);
      await expect(ratingInput.getByText('1 · Worst', { exact: true })).toBeVisible();
      await expect(ratingInput.getByText('5 · Best', { exact: true })).toBeVisible();

      for (const width of [360, 390, 430, 768, 1280]) {
        await voterPage.setViewportSize({ width, height: width >= 768 ? 900 : 844 });
        const metrics = await ratingInput.evaluate((container) => {
          const stars = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="rating-star"]'));
          const boxes = stars.map((star) => {
            const box = star.getBoundingClientRect();
            return {
              value: star.dataset.ratingValue,
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
            };
          });
          return {
            clientWidth: container.clientWidth,
            scrollWidth: container.scrollWidth,
            boxes,
          };
        });

        expect(metrics.scrollWidth, `rating control should not scroll at ${width}px`).toBeLessThanOrEqual(metrics.clientWidth + 1);
        expect(Math.max(...metrics.boxes.map((box) => box.y)) - Math.min(...metrics.boxes.map((box) => box.y))).toBeLessThanOrEqual(1);
        expect(metrics.boxes.every((box) => box.width >= 44 && box.height >= 44), `touch targets at ${width}px`).toBe(true);
        expect([...metrics.boxes].sort((a, b) => a.x - b.x).map((box) => box.value)).toEqual(['1', '2', '3', '4', '5']);
      }

      await voterPage.setViewportSize({ width: 390, height: 844 });
      await ratingInput.locator('[data-rating-value="3"]').hover();
      await expect(ratingInput.locator('[data-rating-value="1"]')).toHaveAttribute('data-filled', 'true');
      await expect(ratingInput.locator('[data-rating-value="2"]')).toHaveAttribute('data-filled', 'true');
      await expect(ratingInput.locator('[data-rating-value="3"]')).toHaveAttribute('data-filled', 'true');
      await expect(ratingInput.locator('[data-rating-value="4"]')).toHaveAttribute('data-filled', 'false');
      await voterPage.mouse.move(1, 1);
      await expect(ratingInput.locator('[data-rating-value="1"]')).toHaveAttribute('data-filled', 'false');

      await setLanguage('ar');
      await expect(voterPage.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(ratingInput.getByText('قيّم من 1 إلى 5', { exact: true })).toBeVisible();
      await expect(ratingInput.getByText('1 · الأسوأ', { exact: true })).toBeVisible();
      await expect(ratingInput.getByText('5 · الأفضل', { exact: true })).toBeVisible();
      const rtlPhysicalValues = await ratingStars.evaluateAll((stars) => stars
        .map((star) => ({ value: star.getAttribute('data-rating-value'), x: star.getBoundingClientRect().x }))
        .sort((a, b) => a.x - b.x)
        .map((star) => star.value));
      expect(rtlPhysicalValues).toEqual(['1', '2', '3', '4', '5']);

      let failureInjected = false;
      let successDelayApplied = false;
      await voterPage.route(`**/api/posts/${state.createdPostId}/vote`, async (route) => {
        if (route.request().method().toUpperCase() !== 'POST') {
          await route.fallback();
          return;
        }

        const url = new URL(route.request().url());
        if (!failureInjected) {
          failureInjected = true;
          state.mutations.push({
            method: 'POST',
            hostname: url.hostname,
            pathname: url.pathname,
            action: 'neutralized',
            reason: 'intentional-rating-failure',
          });
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'intentional e2e rating failure' }),
          });
          return;
        }

        if (!successDelayApplied) {
          successDelayApplied = true;
          await delay(750);
        }
        await route.fallback();
      });

      await ratingInput.locator('[data-rating-value="4"]').click();
      await expect(ratingInput.getByRole('alert')).toContainText('تعذر إرسال تقييمك');
      await expect(ratingInput).toBeVisible();
      await expect(voterPage.getByTestId('rating-scale-results')).toHaveCount(0);
      await expect(ratingStars).toHaveCount(5);
      for (const value of [1, 2, 3, 4, 5]) {
        await expect(ratingInput.locator(`[data-rating-value="${value}"]`)).toHaveAttribute('data-filled', 'false');
      }
      expect(state.voteRequests, 'synthetic failure must not reach the online API').toBe(0);

      Object.assign(voteState, {
        requestObserved: false,
        responseObserved: false,
        responseParsed: false,
        responseStatus: null,
        requestFinished: false,
        requestFailed: false,
        optionIdsCaptured: [],
      });
      await setLanguage('en');

      const ratingFour = ratingInput.locator('[data-rating-value="4"]');
      await ratingFour.evaluate((element) => {
        (element as HTMLButtonElement).click();
        (element as HTMLButtonElement).click();
      });
      await expect(ratingInput.getByText('Submitting rating...', { exact: true })).toBeVisible();
      await waitForVoteResponse(voteState, state);

      expect(voteState.responseStatus, 'expected successful Rating Poll vote response').not.toBeNull();
      expect(voteState.responseStatus! >= 200 && voteState.responseStatus! < 300).toBe(true);
      expect(voteState.optionIdsCaptured).toEqual([state.selectedOptionId]);

      const results = voterPage.getByTestId('rating-scale-results');
      const rows = results.getByTestId('rating-result-row');
      await expect(results).toBeVisible({ timeout: 15_000 });
      await expect(rows).toHaveCount(5);
      expect(await rows.evaluateAll((items) => items.map((item) => item.getAttribute('data-rating-value')))).toEqual(['5', '4', '3', '2', '1']);

      const rowHeights = await rows.evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
      expect(rowHeights.every((height) => height >= 56 && height <= 64), `compact result row heights: ${rowHeights.join(', ')}`).toBe(true);
      const selectedRow = results.locator('[data-testid="rating-result-row"][data-rating-value="4"]');
      await expect(selectedRow).toHaveAttribute('data-selected', 'true');
      await expect(selectedRow.getByTestId('rating-result-summary')).toContainText('100%');
      await expect(selectedRow.getByTestId('rating-result-summary')).toContainText('1 vote');
      await expect(selectedRow.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
      await expect(results.getByRole('progressbar')).toHaveCount(5);

      const summaryStyles = await results.getByTestId('rating-result-summary').evaluateAll((items) => items.map((item) => {
        const style = window.getComputedStyle(item);
        return { whiteSpace: style.whiteSpace, flexWrap: style.flexWrap };
      }));
      expect(summaryStyles.every((style) => style.whiteSpace === 'nowrap' && style.flexWrap === 'nowrap')).toBe(true);
      await expect(voterPage.getByTestId('rating-average')).toContainText('4.0 Average');
      await expect(voterPage.getByTestId('rating-total-votes')).toContainText('1');
    } finally {
      try {
        await cleanupCreatedPoll(creatorPage, state);
      } finally {
        console.log(`RATING_POLL_CONTROLLED_WRITE_MUTATIONS ${JSON.stringify(mutationSummary(state.mutations))}`);
        console.log(`RATING_POLL_CREATE_TRACKING ${JSON.stringify({
          requestObserved: createState.requestObserved,
          responseObserved: createState.responseObserved,
          responseStatus: createState.responseStatus,
          responseParsed: createState.responseParsed,
          requestFinished: createState.requestFinished,
          requestFailed: createState.requestFailed,
          idCaptured: Boolean(createState.idCaptured),
          ratingFourOptionIdCaptured: Boolean(createState.optionIdCaptured),
        })}`);
        console.log(`RATING_POLL_VOTE_TRACKING ${JSON.stringify({
          requestObserved: voteState.requestObserved,
          responseObserved: voteState.responseObserved,
          responseStatus: voteState.responseStatus,
          responseParsed: voteState.responseParsed,
          requestFinished: voteState.requestFinished,
          requestFailed: voteState.requestFailed,
          optionCount: voteState.optionIdsCaptured.length,
        })}`);
        await creatorContext.close();
        await voterContext.close();
      }
    }

    expect(failureInjected, 'expected the controlled failure path to run').toBe(true);
    expect(successDelayApplied, 'expected the controlled loading state to run').toBe(true);
    expect(state.createRequests, 'expected exactly one Rating Poll create request').toBe(1);
    expect(state.voteRequests, 'expected duplicate clicks to produce exactly one online vote request').toBe(1);
    expect(state.cleanupRequests, 'expected exactly one exact-ID cleanup request').toBe(1);
    expect(mutationSummary(mutationsByAction(state, 'blocked')), 'expected no blocked mutations').toEqual([]);
  });

  test('uses the same compact control for a Rating Scale question inside a Survey', async ({ browser }) => {
    test.info().annotations.push({ type: 'test-class', description: 'ONLINE_CONTROLLED_WRITE' });
    requireGates();

    const uniqueSuffix = `${Date.now()}_${randomUUID().slice(0, 8)}`;
    const surveyTitle = `e2e_rating_survey_${uniqueSuffix}`;
    const questionText = `e2e_rating_question_${uniqueSuffix}`;
    const state: MutationState = {
      cleanupStarted: false,
      createRequests: 0,
      voteRequests: 0,
      cleanupRequests: 0,
      mutations: [],
    };
    const createState: CreateTrackingState = {
      requestObserved: false,
      responseObserved: false,
      responseParsed: false,
      responseStatus: null,
      requestFinished: false,
      requestFailed: false,
      idCaptured: null,
      optionIdCaptured: null,
    };

    const context = await browser.newContext({
      baseURL: APPROVED_ONLINE_BASE_URL,
      storageState: publicCreatorAuthStatePath,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await installMutationGuard(page, state);
    installCreateTracking(page, createState);

    try {
      await gotoApp(page, '/');
      await expectTokenPresent(page);

      const createPromise = page.evaluate(async (payload) => {
        const token = window.localStorage.getItem('si_token');
        if (!token) return { ok: false, status: 0 };

        const response = await fetch('https://socialinsight-api.onrender.com/api/posts', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        return { ok: response.ok, status: response.status };
      }, {
        title: surveyTitle,
        description: '',
        type: 'Survey',
        category: 'Technology',
        sections: [{
          id: `e2e_rating_section_${uniqueSuffix}`,
          title: '',
          questions: [{
            id: `e2e_rating_question_id_${uniqueSuffix}`,
            text: questionText,
            type: 'multiple_choice',
            isRequired: true,
            minSelection: 1,
            maxSelection: 1,
            imageLayout: 'vertical',
            options: [5, 4, 3, 2, 1].map((ratingValue, order) => ({
              id: `e2e_survey_rating_${ratingValue}_${uniqueSuffix}`,
              text: String(ratingValue),
              votes: 0,
              order,
              isRating: true,
              ratingValue,
            })),
          }],
        }],
        targetAudience: 'Public',
        targetGroups: [],
        resultsWho: 'Public',
        resultsTiming: 'AnyTime',
        allowAnonymous: true,
        forceAnonymous: false,
        status: 'PUBLISHED',
      });

      await Promise.all([createPromise, waitForCreateResponse(createState, state)]);
      expect(createState.responseStatus, 'expected Rating Survey create response status').not.toBeNull();
      expect(createState.responseStatus! >= 200 && createState.responseStatus! < 300).toBe(true);
      expect(createState.idCaptured, 'expected created Rating Survey ID').toBeTruthy();

      state.createdPostId = createState.idCaptured!;
      state.createPostUrl = state.createPostUrl || 'https://socialinsight-api.onrender.com/api/posts';

      await gotoApp(page, `/post/${state.createdPostId}`);
      await expectTokenPresent(page);
      await page.evaluate(() => {
        window.localStorage.setItem('i18nextLng', 'ar');
        document.cookie = 'i18next=ar; path=/';
      });
      await page.reload({ waitUntil: 'domcontentloaded' });

      await expect(page.getByText(surveyTitle, { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(questionText, { exact: true })).toBeVisible();
      const ratingInput = page.getByTestId('rating-scale-input');
      const ratingStars = ratingInput.getByTestId('rating-star');
      await expect(ratingInput).toBeVisible();
      await expect(ratingStars).toHaveCount(5);
      await expect(page.getByTestId('rating-scale-results')).toHaveCount(0);
      expect(await ratingStars.evaluateAll((stars) => stars
        .map((star) => ({ value: star.getAttribute('data-rating-value'), x: star.getBoundingClientRect().x }))
        .sort((a, b) => a.x - b.x)
        .map((star) => star.value))).toEqual(['1', '2', '3', '4', '5']);

      await ratingInput.locator('[data-rating-value="5"]').click();
      for (const value of [1, 2, 3, 4, 5]) {
        await expect(ratingInput.locator(`[data-rating-value="${value}"]`)).toHaveAttribute('data-filled', 'true');
      }
      await expect(page.getByRole('button', { name: /^Finish$/ })).toBeEnabled();
      expect(state.voteRequests, 'selecting a Survey answer must not submit before Finish').toBe(0);
    } finally {
      try {
        await cleanupCreatedPoll(page, state);
      } finally {
        console.log(`RATING_SURVEY_CONTROLLED_WRITE_MUTATIONS ${JSON.stringify(mutationSummary(state.mutations))}`);
        console.log(`RATING_SURVEY_CREATE_TRACKING ${JSON.stringify({
          requestObserved: createState.requestObserved,
          responseObserved: createState.responseObserved,
          responseStatus: createState.responseStatus,
          responseParsed: createState.responseParsed,
          requestFinished: createState.requestFinished,
          requestFailed: createState.requestFailed,
          idCaptured: Boolean(createState.idCaptured),
        })}`);
        await context.close();
      }
    }

    expect(state.createRequests, 'expected exactly one Rating Survey create request').toBe(1);
    expect(state.voteRequests, 'expected no premature Rating Survey vote request').toBe(0);
    expect(state.cleanupRequests, 'expected exactly one exact-ID cleanup request').toBe(1);
    expect(mutationSummary(mutationsByAction(state, 'blocked')), 'expected no blocked mutations').toEqual([]);
  });
});
