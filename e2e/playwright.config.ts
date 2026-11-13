import { defineConfig, devices } from '@playwright/test';

const ci = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  // Jeden stack na běh; procesy spouští a uklízí globalSetup (vrací teardown).
  globalSetup: './tests/global-setup.ts',
  outputDir: './test-results',
  fullyParallel: true,
  workers: Number(process.env.E2E_WORKERS ?? 2),
  forbidOnly: ci,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: ci
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  use: {
    ...devices['Desktop Chrome'],
    locale: 'cs-CZ',
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    timezoneId: 'Europe/Prague',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium' }],
});
