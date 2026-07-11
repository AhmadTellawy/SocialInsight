import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_BASE_URL = 'https://socialinsightapp.com/';
const LOCAL_E2E_ENV_FILE = '.env.e2e.local';
const APPROVED_E2E_HOST = 'socialinsightapp.com';

function loadLocalE2EEnv(): void {
  const envPath = path.resolve(process.cwd(), LOCAL_E2E_ENV_FILE);

  if (!fs.existsSync(envPath)) {
    return;
  }

  const contents = fs.readFileSync(envPath, 'utf8');

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = rawValue;
  }
}

loadLocalE2EEnv();

export function resolveBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configuredUrl = env.E2E_BASE_URL || DEFAULT_BASE_URL;
  const candidate = configuredUrl.trim();

  if (!candidate) {
    throw new Error('A Playwright base URL is required. Set E2E_BASE_URL.');
  }

  try {
    const url = new URL(candidate);
    assertApprovedOnlineBaseUrl(url);
    return url.href;
  } catch {
    throw new Error(
      `Invalid Playwright base URL. E2E_BASE_URL must be an HTTPS URL on ${APPROVED_E2E_HOST}.`,
    );
  }
}

export const baseURL = resolveBaseUrl();

function assertApprovedOnlineBaseUrl(url: URL): void {
  if (url.protocol !== 'https:') {
    throw new Error('E2E_BASE_URL must use HTTPS.');
  }

  if (url.hostname !== APPROVED_E2E_HOST) {
    throw new Error(`E2E_BASE_URL must target ${APPROVED_E2E_HOST}.`);
  }

  if (isForbiddenHost(url.hostname)) {
    throw new Error('E2E_BASE_URL must not target localhost or a private network address.');
  }
}

function isForbiddenHost(hostname: string): boolean {
  const normalizedHost = hostname.toLowerCase();

  if (['localhost', '0.0.0.0', '127.0.0.1'].includes(normalizedHost)) {
    return true;
  }

  const octets = normalizedHost.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  const [first, second] = octets;

  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

export interface E2ECredentials {
  login: string;
  password: string;
}

export function getPublicCreatorCredentials(env: NodeJS.ProcessEnv = process.env): E2ECredentials {
  const login = (env.E2E_PUBLIC_CREATOR_LOGIN || env.E2E_PUBLIC_CREATOR_EMAIL || '').trim();
  const password = env.E2E_PUBLIC_CREATOR_PASSWORD || '';

  if (!login) {
    throw new Error(
      'Missing E2E public creator login. Set E2E_PUBLIC_CREATOR_LOGIN or E2E_PUBLIC_CREATOR_EMAIL in .env.e2e.local.',
    );
  }

  if (!password) {
    throw new Error('Missing E2E public creator password. Set E2E_PUBLIC_CREATOR_PASSWORD in .env.e2e.local.');
  }

  return { login, password };
}
