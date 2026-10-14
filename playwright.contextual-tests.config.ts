/** Separate opt-in configuration: no seeded shared DB, auth setup or auto-server. */
import { defineConfig } from '@playwright/test'
import { join } from 'node:path'
import { contextualTestConfigBinding, CONTEXTUAL_TEST_CHROME } from './e2e/helpers/contextual-test-admission'

// Reads only an explicitly supplied private binding. No server/browser/DB at
// collection, no canonical env fallback, and no adoption/deletion of old output.
const binding = contextualTestConfigBinding()

export default defineConfig({
  testDir: './e2e', testMatch: 'contextual-test-lifecycle.spec.ts',
  fullyParallel: false, workers: 1, retries: 0, maxFailures: 1, forbidOnly: true,
  timeout: 2700000, globalTimeout: 2700000,
  globalSetup: './e2e/helpers/contextual-test-admission.ts',
  reporter: [['./e2e/helpers/contextual-test-startup-reporter.ts']],
  outputDir: join(binding.outputDir, 'runner-output'),
  use: {
    baseURL: 'http://localhost:3117', browserName: 'chromium', headless: false,
    launchOptions: { executablePath: CONTEXTUAL_TEST_CHROME, args: ['--start-maximized'] },
    serviceWorkers: 'block', actionTimeout: 30000, navigationTimeout: 30000,
    screenshot: 'off', trace: 'off', video: 'off',
  },
  expect: { timeout: 30000 },
})
