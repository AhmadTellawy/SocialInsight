import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/reels-e2e', expect: { timeout: 20000 }, workers: 1, retries: 0,
  globalTeardown: './tests/reels-e2e/teardown.cjs',
  reporter: [['list']], outputDir: './tests/reels-e2e/results', timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:4196', browserName: 'chromium', viewport: { width: 390, height: 844 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node tests/reels-e2e/server.cjs', url: 'http://127.0.0.1:4196/__test/ready', reuseExistingServer: false, timeout: 180000 },
});
