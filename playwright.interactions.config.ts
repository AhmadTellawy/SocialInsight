import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/interactions-e2e', workers: 1, retries: 0, timeout: 45_000,
  reporter: [['list'], ['json', { outputFile: 'tests/interactions-e2e/results/report.json' }]],
  outputDir: 'tests/interactions-e2e/results/artifacts',
  use: { ...devices['Pixel 7'], browserName: 'chromium', baseURL: 'http://127.0.0.1:4196', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4196', url: 'http://127.0.0.1:4196', reuseExistingServer: false, timeout: 120000 }
});
