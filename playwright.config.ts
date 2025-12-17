import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000'

export default defineConfig({
  testDir: './e2e',

  // Output directories
  snapshotDir: './e2e/__snapshots__',

  // Test execution settings
  fullyParallel: false, // Run tests serially for stability
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker to avoid race conditions

  // Reporter configuration
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }]
  ],

  // Global test settings
  use: {
    baseURL,

    // Collect screenshots on failure (assertion-specific screenshot options are in `expect.toHaveScreenshot`)
    screenshot: 'only-on-failure',

    // Wait for fonts to load
    actionTimeout: 10_000,
    navigationTimeout: 30_000,

    // Trace on first retry
    trace: 'on-first-retry',
  },

  // Snapshot comparison settings
  expect: {
    timeout: 30_000,
    toHaveScreenshot: {
      // Allow small pixel differences due to font rendering
      maxDiffPixels: 100,
      maxDiffPixelRatio: 0.01,

      // Animations disabled globally
      animations: 'disabled',
      caret: 'hide',

      // Optionally omitBackground/fullPage can be set per-test as needed
    },
  },

  // Projects define different test contexts
  projects: [
    // Setup project - runs first to create auth storage
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },

    // Desktop viewport - standard testing
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
      dependencies: ['setup'],
    },
  ],

  // Auto-start Next.js dev server
  webServer: {
    command: 'pnpm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
