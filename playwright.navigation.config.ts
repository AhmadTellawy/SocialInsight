import { defineConfig, devices } from '@playwright/test';

const port = 4175;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/navigation-e2e',
  workers: 2,
  fullyParallel: true,
  expect: { timeout: 20_000 },
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['json', { outputFile: 'tests/navigation-e2e/results/report.json' }]],
  outputDir: 'tests/navigation-e2e/results',
  use: { baseURL, serviceWorkers: 'block', screenshot: 'only-on-failure', trace: 'retain-on-failure', actionTimeout: 20_000 },
  projects: [
    { name: 'en-mobile', use: { ...devices['Pixel 5'], locale: 'en-US' } },
    { name: 'ar-mobile', use: { ...devices['Pixel 5'], locale: 'ar-JO' } },
    { name: 'en-desktop', use: { ...devices['Desktop Chrome'], locale: 'en-US' } },
  ],
  webServer: { command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`, url: baseURL, reuseExistingServer: false, timeout: 120_000 },
});


