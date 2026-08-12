import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// The remote dev container ships Chromium at /opt/pw-browsers/chromium;
// elsewhere Playwright's own browser resolution applies.
const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;

export default defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:4174',
    viewport: { width: 1600, height: 1000 },
    ...(exe ? { launchOptions: { executablePath: exe } } : {}),
  },
  webServer: {
    command: 'npm run preview',
    port: 4174,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
