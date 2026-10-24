import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/pages-creation-e2e', workers: 1, retries: 0,
  globalTeardown: './tests/pages-creation-e2e/teardown.cjs',
  reporter: [['list']], outputDir: './tests/pages-creation-e2e/results',
  timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:4193', browserName: 'chromium', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node tests/pages-creation-e2e/server.cjs', url: 'http://127.0.0.1:4193/__test/ready', reuseExistingServer: false, timeout: 180000 },
});
