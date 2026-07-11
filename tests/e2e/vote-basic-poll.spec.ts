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

function extractFirstOptionId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const data = body as { options?: Array<{ id?: unknown }>; post?: { options?: Array<{ id?: unknown }> }; data?: { options?: Array<{ id?: unknown }> } };
  const optionId = data.options?.[0]?.id || data.post?.options?.[0]?.id || data.data?.options?.[0]?.id;
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
        const optionId = extractFirstOptionId(body);
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
    if (isVoteRequest(request, state.createdPostId)) voteState.requestObserved = true;
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
});
