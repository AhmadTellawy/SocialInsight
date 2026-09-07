import { defineConfig } from '@playwright/test';

// Local UI-contract evidence only. API and device transports are controlled fixtures.
export default defineConfig({
  testDir: './tests/profile-e2e',
  testMatch: 'settings-qa.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 45_000,
  reporter: [['list']],
  outputDir: 'test-results/settings-qa-local',
  use: {
    baseURL: 'http://127.0.0.1:4187',
    browserName: 'chromium',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 12_000
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4187 --strictPort',
    url: 'http://127.0.0.1:4187',
    reuseExistingServer: false,
    timeout: 120_000
  }
});
