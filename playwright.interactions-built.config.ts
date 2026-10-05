import { defineConfig } from '@playwright/test';
import base from './playwright.interactions.config';

export default defineConfig({
  ...base,
  metadata: { builtPwa: true },
  reporter: [['list'], ['json', { outputFile: 'tests/interactions-e2e/results/built-report.json' }]],
  outputDir: 'tests/interactions-e2e/results/built-artifacts',
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 4196', url: 'http://127.0.0.1:4196', reuseExistingServer: false, timeout: 60000 },
});
