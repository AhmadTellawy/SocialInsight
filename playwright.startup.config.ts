import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/startup-e2e',
  fullyParallel: true,
  workers: 2,
  timeout: 45_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['json', { outputFile: 'tests/startup-e2e/results/report.json' }]],
  outputDir: 'tests/startup-e2e/results',
  use: {
    baseURL: 'http://127.0.0.1:4186',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'en-mobile', use: { ...devices['Pixel 5'], locale: 'en-US' } },
    { name: 'ar-mobile', use: { ...devices['Pixel 5'], locale: 'ar-JO' } },
  ],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4186 --strictPort',
    url: 'http://127.0.0.1:4186', reuseExistingServer: false,
  },
});
