import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  forbidOnly: !!process.env.CI,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  reporter: [['list'], ['junit', { outputFile: 'test-results/e2e/results.xml' }]],
  outputDir: 'test-results/e2e',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
