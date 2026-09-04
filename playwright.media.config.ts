import { defineConfig, devices } from '@playwright/test';

const port = 4187;
const baseURL = `http://127.0.0.1:${port}`;
const pwaSmoke = /pwa-smoke\.spec\.ts/;

export default defineConfig({
  testDir: './tests/media-e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  outputDir: 'test-results/media-local',
  use: {
    baseURL,
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  webServer: {
    command: `npm.cmd run build && npm.cmd run preview -- --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
  projects: [
    {
      name: 'desktop-chromium',
      testIgnore: pwaSmoke,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'pixel-5-chromium',
      testIgnore: pwaSmoke,
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'iphone-webkit',
      testIgnore: pwaSmoke,
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'pwa-chromium',
      testMatch: pwaSmoke,
      use: {
        ...devices['Pixel 5'],
        serviceWorkers: 'allow',
      },
    },
  ],
});
