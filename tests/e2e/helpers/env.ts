import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_BASE_URL = 'https://socialinsightapp.com/';
const LOCAL_E2E_ENV_FILE = '.env.e2e.local';

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
  const configuredUrl = env.E2E_BASE_URL || env.PLAYWRIGHT_BASE_URL || DEFAULT_BASE_URL;
  const candidate = configuredUrl.trim();

  if (!candidate) {
    throw new Error('A Playwright base URL is required. Set E2E_BASE_URL or PLAYWRIGHT_BASE_URL.');
  }

  try {
    return new URL(candidate).href;
  } catch {
    throw new Error(`Invalid Playwright base URL: ${candidate}`);
  }
}

export const baseURL = resolveBaseUrl();

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
