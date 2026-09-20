import { defineConfig, devices } from '@playwright/test';

const isLocal = process.env.LOADING_NAV_LOCAL === '1';
const port = 4174;
const baseURL = (process.env.LOADING_NAV_BASE_URL || (isLocal ? `http://127.0.0.1:${port}` : 'https://opiniup.com')).replace(/\/$/, '');

export default defineConfig({
  testDir: './tests/loading-navigation-e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results/loading-navigation',
  use: {
    ...devices['Pixel 5'],
    baseURL,
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  webServer: isLocal ? {
    command: `npm run preview -- --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  } : undefined,
});
