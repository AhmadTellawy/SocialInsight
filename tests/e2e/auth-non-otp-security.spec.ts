import { expect, request, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseURL } from './helpers/env';

const ONLINE_ORIGIN = 'https://socialinsightapp.com';
const DEFAULT_APPROVED_API_HOST = 'socialinsight-api.onrender.com';
const AUTH_APPROVAL_ENV = 'ONLINE_AUTH_SECURITY_CHECK_APPROVED';
const personasPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '.auth', 'personas.local.json');

type PersonaCredential = {
  handle?: string;
  email?: string;
  password?: string;
};

type PersonasFile = {
  personas?: {
    public_creator?: PersonaCredential;
  };
};

type LoginResult = {
  status: number;
  error: string | null;
  hasToken: boolean;
};

function requireApprovedRun() {
  if (process.env[AUTH_APPROVAL_ENV] !== 'true') {
    throw new Error(`${AUTH_APPROVAL_ENV}=true is required for online auth security verification.`);
  }
}

function requireOnlineTarget() {
  const resolved = new URL(baseURL);

  if (resolved.origin !== ONLINE_ORIGIN) {
    throw new Error('Auth security verification is restricted to https://socialinsightapp.com/.');
  }
}

function approvedApiHosts() {
  const hosts = new Set([DEFAULT_APPROVED_API_HOST, new URL(ONLINE_ORIGIN).hostname]);
  const configured = process.env.ONLINE_E2E_APPROVED_API_HOSTS || '';

  for (const entry of configured.split(',')) {
    const hostname = entry.trim().toLowerCase();
    if (hostname) {
      hosts.add(hostname);
    }
  }

  return hosts;
}

function requireApprovedEndpoint(url: URL, allowedPaths: Set<string>) {
  if (url.protocol !== 'https:') {
    throw new Error('Auth security verification only allows HTTPS endpoints.');
  }

  if (!approvedApiHosts().has(url.hostname.toLowerCase())) {
    throw new Error(`Blocked request to unapproved host/path: ${url.hostname} ${url.pathname}`);
  }

  if (!allowedPaths.has(url.pathname)) {
    throw new Error(`Blocked request to unapproved auth path: ${url.hostname} ${url.pathname}`);
  }

  if (url.pathname.includes('/otp') || url.pathname.includes('/register/init') || url.pathname.includes('/register/complete')) {
    throw new Error(`Blocked request to deferred auth path: ${url.hostname} ${url.pathname}`);
  }
}

function apiUrl(pathname: '/api/auth/login' | '/api/auth/register') {
  const url = new URL(`https://${DEFAULT_APPROVED_API_HOST}`);
  url.pathname = pathname;
  requireApprovedEndpoint(url, new Set(['/api/auth/login', '/api/auth/register']));
  return url.toString();
}

function publicCreatorCredentials() {
  if (!fs.existsSync(personasPath)) {
    throw new Error('Missing local E2E personas file required for auth security verification.');
  }

  const data = JSON.parse(fs.readFileSync(personasPath, 'utf8')) as PersonasFile;
  const persona = data.personas?.public_creator;
  const login = persona?.handle || persona?.email || '';
  const password = persona?.password || '';

  if (!login || !password) {
    throw new Error('Missing public_creator credential fields required for auth security verification.');
  }

  return { login, password };
}

function wrongPassword() {
  return `definitely_wrong_${Date.now()}_A1!`;
}

function nonexistentIdentifier() {
  return `e2e_missing_auth_${Date.now()}_${Math.random().toString(16).slice(2)}@example.invalid`;
}

async function safeLogin(
  api: Awaited<ReturnType<typeof request.newContext>>,
  payload: Record<string, unknown>,
  authRequestCount: { value: number },
): Promise<LoginResult> {
  authRequestCount.value += 1;
  expect(authRequestCount.value, 'auth request budget should not be exceeded').toBeLessThanOrEqual(5);

  const response = await api.post(apiUrl('/api/auth/login'), { data: payload });
  const status = response.status();
  const contentType = response.headers()['content-type'] || '';
  let error: string | null = null;
  let hasToken = false;

  if (contentType.includes('application/json')) {
    const body = (await response.json()) as { error?: unknown; token?: unknown };
    error = typeof body.error === 'string' ? body.error : null;
    hasToken = typeof body.token === 'string' && body.token.length > 0;
  }

  return { status, error, hasToken };
}

test.describe('online non-OTP auth security regression', () => {
  test('rejects authProvider bypasses, keeps login errors generic, and disables legacy register', async () => {
    requireApprovedRun();
    requireOnlineTarget();

    const credentials = publicCreatorCredentials();
    const api = await request.newContext();
    const authRequestCount = { value: 0 };

    try {
      const omittedProvider = await safeLogin(
        api,
        {
          identifier: credentials.login,
          password: wrongPassword(),
        },
        authRequestCount,
      );

      const manipulatedProvider = await safeLogin(
        api,
        {
          identifier: credentials.login,
          password: wrongPassword(),
          authProvider: 'OAuth',
        },
        authRequestCount,
      );

      const nonexistent = await safeLogin(
        api,
        {
          identifier: nonexistentIdentifier(),
          password: wrongPassword(),
        },
        authRequestCount,
      );

      const validLogin = await safeLogin(
        api,
        {
          identifier: credentials.login,
          password: credentials.password,
          authProvider: 'Email',
        },
        authRequestCount,
      );

      authRequestCount.value += 1;
      expect(authRequestCount.value, 'auth request budget should not be exceeded').toBeLessThanOrEqual(5);
      const legacyRegister = await api.post(apiUrl('/api/auth/register'), { data: {} });

      expect(omittedProvider.status, 'wrong password without authProvider should be rejected').toBe(401);
      expect(manipulatedProvider.status, 'wrong password with manipulated authProvider should be rejected').toBe(401);
      expect(nonexistent.status, 'nonexistent account should be rejected').toBe(401);

      expect(omittedProvider.error, 'wrong-password failure should use the generic message').toBe(
        'Invalid login credentials',
      );
      expect(manipulatedProvider.error, 'manipulated-provider failure should use the generic message').toBe(
        'Invalid login credentials',
      );
      expect(nonexistent.error, 'unknown-account failure should use the same generic message').toBe(
        omittedProvider.error,
      );

      expect(validLogin.status, 'existing valid login should still succeed').toBe(200);
      expect(validLogin.hasToken, 'valid login should return an auth token without exposing it').toBe(true);

      expect(legacyRegister.status(), 'legacy register route should be disabled').toBe(410);
    } finally {
      await api.dispose();
    }
  });
});
