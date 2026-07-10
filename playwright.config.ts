import { defineConfig, devices } from '@playwright/test';
import { baseURL } from './tests/e2e/helpers/env';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    serviceWorkers: 'block',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 5'],
      },
    },
  ],
});
