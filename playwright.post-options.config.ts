import { defineConfig } from '@playwright/test';
const results = process.env.POST_OPTIONS_RESULTS || 'tests/post-options-e2e/results';

export default defineConfig({
  testDir: './tests/post-options-e2e',
  workers: 1,
  retries: 0,
  timeout: 150000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['json', { outputFile: `${results}/report.json` }]],
  outputDir: `${results}/artifacts`,
  use: {
    baseURL: process.env.POST_OPTIONS_BASE_URL || 'http://127.0.0.1:4189',
    browserName: 'chromium',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: process.env.POST_OPTIONS_CHROMIUM ? { executablePath: process.env.POST_OPTIONS_CHROMIUM } : {},
  },
  projects: [
    { name: 'en-mobile', use: { viewport: { width: 390, height: 900 }, hasTouch: true } },
    { name: 'ar-mobile', use: { viewport: { width: 390, height: 900 }, hasTouch: true } },
    { name: 'en-desktop', use: { viewport: { width: 1280, height: 1000 } } },
  ],
});
