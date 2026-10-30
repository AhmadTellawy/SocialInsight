import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/post-ui-e2e',
  testMatch: ['photo-flow.spec.ts', 'heif-preparation.spec.ts', 'crop-contrast.spec.ts', 'creator-parity.spec.ts'],
  workers: 1, retries: 0, timeout: 90000,
  reporter: [['list']],
  outputDir: '.ai-company/memory/tasks/SI-PHOTO-UPLOAD-20261031/browser-results',
  use: { baseURL: 'http://127.0.0.1:4187', channel: 'msedge', viewport: { width: 390, height: 844 }, hasTouch: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4187', url: 'http://127.0.0.1:4187', reuseExistingServer: false, timeout: 120000 }
});
