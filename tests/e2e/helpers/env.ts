const DEFAULT_BASE_URL = 'https://socialinsightapp.com/';

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
