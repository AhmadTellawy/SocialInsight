import { defineConfig, devices } from '@playwright/test';

const port = 4174;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './profile-e2e',
  testMatch: 'media-image.spec.ts',
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '../test-results/media-image-local',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    serviceWorkers: 'block',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
