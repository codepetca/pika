import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000'
const resolvedBaseUrl = new URL(baseURL)
const resolvedPort = resolvedBaseUrl.port || (resolvedBaseUrl.protocol === 'https:' ? '443' : '80')
const webServerCommand = `ENABLE_UI_GALLERY=true PIKA_E2E_FIXTURES=true pnpm exec next dev --port ${resolvedPort}`
const experienceMatrixSpec = /experience-matrix\.spec\.ts/
const patternLabSpec = /ui-pattern-lab\.spec\.ts/

const desktop = {
  ...devices['Desktop Chrome'],
  viewport: { width: 1440, height: 900 },
}

const mobile = {
  ...devices['Desktop Chrome'],
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  hasTouch: true,
  isMobile: true,
}

export default defineConfig({
  testDir: './e2e',

  // Output directories
  snapshotDir: './e2e/__snapshots__',

  // Test execution settings
  // Each file remains internally serial. CI uses two workers only after shared
  // database mutations were reduced to seeded state or desktop-only contracts.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 1,

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

    // Keep the broad suite on one project. The focused experience contract runs
    // across every project so CI does not multiply expensive feature E2E specs.
    {
      name: 'chromium-desktop',
      testIgnore: patternLabSpec,
      metadata: { theme: 'light', viewport: 'desktop' },
      use: {
        ...desktop,
        colorScheme: 'light',
      },
      dependencies: ['setup'],
    },
    {
      name: 'pattern-lab-desktop-light',
      testMatch: patternLabSpec,
      metadata: { theme: 'light', viewport: 'desktop' },
      use: {
        ...desktop,
        colorScheme: 'light',
      },
    },
    {
      name: 'pattern-lab-desktop-dark',
      testMatch: patternLabSpec,
      metadata: { theme: 'dark', viewport: 'desktop' },
      use: {
        ...desktop,
        colorScheme: 'dark',
      },
    },
    {
      name: 'pattern-lab-mobile-light',
      testMatch: patternLabSpec,
      metadata: { theme: 'light', viewport: 'mobile' },
      use: {
        ...mobile,
        colorScheme: 'light',
      },
    },
    {
      name: 'pattern-lab-mobile-dark',
      testMatch: patternLabSpec,
      metadata: { theme: 'dark', viewport: 'mobile' },
      use: {
        ...mobile,
        colorScheme: 'dark',
      },
    },
    {
      name: 'chromium-desktop-dark',
      testMatch: experienceMatrixSpec,
      metadata: { theme: 'dark', viewport: 'desktop' },
      use: {
        ...desktop,
        colorScheme: 'dark',
      },
      dependencies: ['setup'],
    },
    {
      name: 'chromium-mobile-light',
      testMatch: experienceMatrixSpec,
      metadata: { theme: 'light', viewport: 'mobile' },
      use: {
        ...mobile,
        colorScheme: 'light',
      },
      dependencies: ['setup'],
    },
    {
      name: 'chromium-mobile-dark',
      testMatch: experienceMatrixSpec,
      metadata: { theme: 'dark', viewport: 'mobile' },
      use: {
        ...mobile,
        colorScheme: 'dark',
      },
      dependencies: ['setup'],
    },
  ],

  // Auto-start Next.js dev server
  webServer: {
    command: webServerCommand,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
