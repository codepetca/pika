import { defineConfig } from '@playwright/test'
import { join } from 'node:path'
import { diagnosticAdmissionFromEnvironment, DIAGNOSTIC_CHROME } from './scripts/contextual-browser-diagnostic-data'

const admission = diagnosticAdmissionFromEnvironment()
export default defineConfig({
  testDir: './e2e', testMatch: 'contextual-browser-diagnostic.spec.ts',
  fullyParallel: false, workers: 1, retries: 0, maxFailures: 1, forbidOnly: true,
  timeout: 30000, globalTimeout: Math.min(30000, admission.deadline - Date.now()),
  reporter: [['./e2e/helpers/contextual-browser-diagnostic-reporter.ts']],
  globalSetup: './e2e/helpers/contextual-browser-diagnostic-setup.ts',
  preserveOutput: 'never',
  outputDir: join(admission.outputDir, 'runner-output'),
  use: { browserName: 'chromium', headless: false,
    launchOptions: { executablePath: DIAGNOSTIC_CHROME, args: ['--start-maximized'], timeout: 30000 },
    serviceWorkers: 'block', actionTimeout: 30000, navigationTimeout: 30000,
    screenshot: 'off', trace: 'off', video: 'off',
  },
})
