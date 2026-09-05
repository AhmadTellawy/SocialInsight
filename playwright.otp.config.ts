import { defineConfig, devices } from '@playwright/test';

const port = 4175;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/otp-e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results/otp-local',
  use: {
    ...devices['Pixel 5'],
    baseURL,
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
