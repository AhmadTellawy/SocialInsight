import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { test, type APIRequestContext, type Page } from '@playwright/test';
import { baseURL } from './helpers/env';

type PersonaKey =
  | 'public_creator'
  | 'public_voter'
  | 'private_user'
  | 'follower_user'
  | 'non_follower_user'
  | 'group_owner'
  | 'group_member'
  | 'page_owner';

type PersonaCredential = {
  role: PersonaKey;
  name: string;
  handle: string;
  email: string;
  password: string;
  birthday: string;
  country: string;
};

type PersonasFile = {
  version: 1;
  createdAt: string;
  personas: Partial<Record<PersonaKey, PersonaCredential>>;
};

type AuthEndpoints = {
  loginUrl: string;
  registerUrl: string;
};

type LoginResult =
  | { state: 'success'; body: Record<string, unknown> }
  | { state: 'missing'; status: number }
  | { state: 'rate-limited'; status: number }
  | { state: 'failed'; status: number };

type RegisterResult =
  | { state: 'success' }
  | { state: 'rate-limited'; status: number }
  | { state: 'failed'; status: number };

const canonicalOnlineOrigin = 'https://socialinsightapp.com';
const defaultProvisioningDelayMs = 30_000;
const authDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.auth');
const personasPath = path.join(authDir, 'personas.local.json');

const personaKeys: PersonaKey[] = [
  'public_creator',
  'public_voter',
  'private_user',
  'follower_user',
  'non_follower_user',
  'group_owner',
  'group_member',
  'page_owner',
];

function requireProvisioningApproval() {
  if (process.env.ONLINE_TEST_ACCOUNT_PROVISIONING_APPROVED !== 'true') {
    throw new Error('ONLINE_TEST_ACCOUNT_PROVISIONING_APPROVED=true is required before provisioning online test accounts.');
  }
}

function requireOnlineBaseUrl() {
  const resolved = new URL(baseURL);

  if (resolved.origin !== canonicalOnlineOrigin) {
    throw new Error('Account provisioning is restricted to https://socialinsightapp.com/.');
  }
}

function ensureAuthDir() {
  mkdirSync(authDir, { recursive: true });
}

function getProvisioningDelayMs() {
  const configuredDelay = process.env.E2E_PROVISIONING_DELAY_MS;

  if (!configuredDelay) {
    return defaultProvisioningDelayMs;
  }

  const parsedDelay = Number.parseInt(configuredDelay, 10);

  if (!Number.isFinite(parsedDelay) || parsedDelay < 0) {
    throw new Error('E2E_PROVISIONING_DELAY_MS must be a non-negative integer.');
  }

  return parsedDelay;
}

async function waitForProvisioningDelay(delayMs: number) {
  if (delayMs <= 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function randomSuffix() {
  return `${Date.now()}_${randomBytes(4).toString('hex')}`.toLowerCase();
}

function createPersonaCredential(role: PersonaKey, suffix: string): PersonaCredential {
  const handle = `e2e_${role}_${suffix}`.slice(0, 48);

  return {
    role,
    name: `e2e_${role}`,
    handle,
    email: `${handle}@example.com`,
    password: `${randomBytes(18).toString('base64url')}A1!`,
    birthday: '1990-01-01',
    country: 'US',
  };
}

function readOrCreatePersonasFile(): { data: PersonasFile; createdFile: boolean; addedPersonas: PersonaKey[] } {
  ensureAuthDir();

  let data: PersonasFile;
  let createdFile = false;

  if (existsSync(personasPath)) {
    data = JSON.parse(readFileSync(personasPath, 'utf8')) as PersonasFile;
  } else {
    createdFile = true;
    data = {
      version: 1,
      createdAt: new Date().toISOString(),
      personas: {},
    };
  }

  const suffix = randomSuffix();
  const addedPersonas: PersonaKey[] = [];

  for (const role of personaKeys) {
    if (!data.personas[role]) {
      data.personas[role] = createPersonaCredential(role, suffix);
      addedPersonas.push(role);
    }
  }

  if (createdFile || addedPersonas.length > 0) {
    writeFileSync(personasPath, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8' });
  }

  return { data, createdFile, addedPersonas };
}

function getPersona(data: PersonasFile, role: PersonaKey): PersonaCredential {
  const persona = data.personas[role];

  if (!persona) {
    throw new Error(`Missing local credential record for ${role}.`);
  }

  return persona;
}

function storagePathFor(role: PersonaKey) {
  return path.join(authDir, `${role}.json`);
}

function hasValidStorageState(role: PersonaKey) {
  const statePath = storagePathFor(role);

  if (!existsSync(statePath)) {
    return false;
  }

  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as {
      origins?: Array<{
        origin?: string;
        localStorage?: Array<{ name?: string; value?: string }>;
      }>;
    };

    return Boolean(
      state.origins?.some((origin) =>
        origin.origin === canonicalOnlineOrigin &&
        origin.localStorage?.some((entry) => entry.name === 'si_token' && Boolean(entry.value)),
      ),
    );
  } catch {
    return false;
  }
}

async function openLoginForm(page: Page) {
  await page.goto(baseURL);

  const identifierField = page.getByPlaceholder(/email|handle/i).first();

  if (!(await identifierField.isVisible({ timeout: 5000 }).catch(() => false))) {
    const loginButton = page.getByRole('button', { name: /log\s*in|sign\s*in/i }).first();
    await loginButton.click();
  }

  await page.getByPlaceholder(/email|handle/i).first().waitFor({ state: 'visible', timeout: 15000 });
}

function endpointsFromLoginUrl(loginUrl: string): AuthEndpoints {
  const parsed = new URL(loginUrl);

  if (parsed.protocol !== 'https:') {
    throw new Error('Observed auth endpoint is not HTTPS.');
  }

  if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1') {
    throw new Error('Observed auth endpoint is not an online host.');
  }

  if (!parsed.pathname.endsWith('/auth/login')) {
    throw new Error('Unable to derive account provisioning endpoints from the observed login request.');
  }

  parsed.pathname = parsed.pathname.replace(/\/auth\/login$/, '/auth/register');

  return {
    loginUrl,
    registerUrl: parsed.toString(),
  };
}

async function discoverAuthEndpoints(
  page: Page,
  request: APIRequestContext,
  persona: PersonaCredential,
): Promise<{ endpoints: AuthEndpoints; loginResult: LoginResult }> {
  await openLoginForm(page);

  const requestPromise = page
    .waitForRequest((loginRequest) => {
      const url = new URL(loginRequest.url());
      return loginRequest.method().toUpperCase() === 'POST' && url.pathname.endsWith('/auth/login');
    }, { timeout: 15000 })
    .catch(() => null);

  const responsePromise = page
    .waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method().toUpperCase() === 'POST' && url.pathname.endsWith('/auth/login');
    }, { timeout: 15000 })
    .catch(() => null);

  await page.getByPlaceholder(/email|handle/i).first().fill(persona.handle);
  await page.getByPlaceholder(/password/i).first().fill(persona.password);
  await page.getByRole('button', { name: /sign\s*in|log\s*in/i }).first().click();

  const loginRequest = await requestPromise;

  if (!loginRequest) {
    throw new Error('No login request was observed while discovering the deployed auth endpoint.');
  }

  const endpoints = endpointsFromLoginUrl(loginRequest.url());
  const response = await responsePromise;

  if (!response) {
    return { endpoints, loginResult: await tryLogin(request, endpoints.loginUrl, persona) };
  }

  if (response.status() === 429) {
    return { endpoints, loginResult: { state: 'rate-limited', status: response.status() } };
  }

  if (response.ok()) {
    const body = await response.json() as Record<string, unknown>;
    return { endpoints, loginResult: { state: 'success', body } };
  }

  if (response.status() === 401 || response.status() === 404) {
    return { endpoints, loginResult: { state: 'missing', status: response.status() } };
  }

  return { endpoints, loginResult: { state: 'failed', status: response.status() } };
}

async function tryLogin(request: APIRequestContext, loginUrl: string, persona: PersonaCredential): Promise<LoginResult> {
  const response = await request.post(loginUrl, {
    data: {
      identifier: persona.handle,
      password: persona.password,
      authProvider: 'Email',
    },
  });

  if (response.status() === 429) {
    return { state: 'rate-limited', status: response.status() };
  }

  if (response.ok()) {
    const body = await response.json() as Record<string, unknown>;
    return { state: 'success', body };
  }

  if (response.status() === 401 || response.status() === 404) {
    return { state: 'missing', status: response.status() };
  }

  return { state: 'failed', status: response.status() };
}

async function registerPersona(request: APIRequestContext, registerUrl: string, persona: PersonaCredential): Promise<RegisterResult> {
  const response = await request.post(registerUrl, {
    data: {
      name: persona.name,
      handle: persona.handle,
      email: persona.email,
      password: persona.password,
      birthday: persona.birthday,
      country: persona.country,
      authProvider: 'Email',
    },
  });

  if (response.status() === 429) {
    return { state: 'rate-limited', status: response.status() };
  }

  if (!response.ok()) {
    return { state: 'failed', status: response.status() };
  }

  return { state: 'success' };
}

function saveStorageStateFromLoginBody(role: PersonaKey, body: Record<string, unknown>) {
  const token = body.token;

  if (typeof token !== 'string' || token.length === 0) {
    throw new Error(`Login response for ${role} did not include a token.`);
  }

  const { token: _token, ...user } = body;
  const state = {
    cookies: [],
    origins: [
      {
        origin: canonicalOnlineOrigin,
        localStorage: [
          { name: 'si_token', value: token },
          { name: 'si_user', value: JSON.stringify(user) },
        ],
      },
    ],
  };

  writeFileSync(storagePathFor(role), `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8' });
}

test('provisions online e2e test accounts and storage states', async ({ page, request }) => {
  requireProvisioningApproval();
  requireOnlineBaseUrl();

  const provisioningDelayMs = getProvisioningDelayMs();
  const { data, createdFile, addedPersonas } = readOrCreatePersonasFile();
  const alreadyProvisioned: PersonaKey[] = [];
  const created: PersonaKey[] = [];
  const loginRefreshed: PersonaKey[] = [];
  const skipped: Array<{ role: PersonaKey; reason: string }> = [];
  const failed: Array<{ role: PersonaKey; reason: string }> = [];
  const storageStates = new Set<string>();
  const pendingPersonas: PersonaKey[] = [];

  for (const role of personaKeys) {
    if (hasValidStorageState(role)) {
      alreadyProvisioned.push(role);
      skipped.push({ role, reason: 'valid-storage-state' });
      storageStates.add(storagePathFor(role));
    } else {
      pendingPersonas.push(role);
    }
  }

  let endpoints: AuthEndpoints | undefined;
  let firstPendingRole: PersonaKey | undefined;
  let firstPendingLoginResult: LoginResult | undefined;
  let networkPersonaAttempts = 0;
  let stoppedForRateLimit = false;

  async function waitBeforeNextNetworkPersona() {
    if (networkPersonaAttempts > 0) {
      await waitForProvisioningDelay(provisioningDelayMs);
    }

    networkPersonaAttempts += 1;
  }

  if (pendingPersonas.length > 0) {
    firstPendingRole = pendingPersonas[0];
    await waitBeforeNextNetworkPersona();

    const firstPendingPersona = getPersona(data, firstPendingRole);
    const discovery = await discoverAuthEndpoints(page, request, firstPendingPersona);
    endpoints = discovery.endpoints;
    firstPendingLoginResult = discovery.loginResult;
  }

  for (const role of pendingPersonas) {
    if (!endpoints) {
      failed.push({ role, reason: 'auth-endpoint-unavailable' });
      continue;
    }

    const persona = getPersona(data, role);
    let loginResult = role === firstPendingRole && firstPendingLoginResult
      ? firstPendingLoginResult
      : undefined;

    if (!loginResult) {
      await waitBeforeNextNetworkPersona();
      loginResult = await tryLogin(request, endpoints.loginUrl, persona);
    }

    if (loginResult.state === 'rate-limited') {
      failed.push({ role, reason: 'rate-limited' });
      stoppedForRateLimit = true;
      break;
    }

    if (loginResult.state === 'failed') {
      failed.push({ role, reason: `login-http-${loginResult.status}` });
      continue;
    }

    if (loginResult.state === 'missing') {
      const registerResult = await registerPersona(request, endpoints.registerUrl, persona);

      if (registerResult.state === 'rate-limited') {
        failed.push({ role, reason: 'registration-rate-limited' });
        stoppedForRateLimit = true;
        break;
      }

      if (registerResult.state === 'failed') {
        failed.push({ role, reason: `registration-http-${registerResult.status}` });
        continue;
      }

      created.push(role);
      await waitForProvisioningDelay(provisioningDelayMs);
      loginResult = await tryLogin(request, endpoints.loginUrl, persona);
    } else {
      loginRefreshed.push(role);
    }

    if (loginResult.state === 'rate-limited') {
      failed.push({ role, reason: 'rate-limited' });
      stoppedForRateLimit = true;
      break;
    }

    if (loginResult.state !== 'success') {
      failed.push({ role, reason: 'login-after-registration-failed' });
      continue;
    }

    saveStorageStateFromLoginBody(role, loginResult.body);
    storageStates.add(storagePathFor(role));
  }

  console.log(`ACCOUNT_PROVISIONING_SUMMARY ${JSON.stringify({
    personasFileCreated: createdFile,
    personasAdded: addedPersonas,
    alreadyProvisioned,
    created,
    loginRefreshed,
    skipped,
    failed,
    stoppedForRateLimit,
    provisioningDelayMs,
    storageStates: [...storageStates],
  })}`);

  if (failed.length > 0) {
    throw new Error(`Account provisioning failed for: ${failed.map((item) => item.role).join(', ')}`);
  }
});
