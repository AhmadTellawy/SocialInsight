import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/post-ui-e2e',
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'tests/post-ui-e2e/results',
  use: { baseURL: 'http://127.0.0.1:4187', browserName: 'chromium', hasTouch: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4187', url: 'http://127.0.0.1:4187', reuseExistingServer: false, timeout: 120000 },
});
