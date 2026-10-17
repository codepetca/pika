import assert from 'node:assert/strict'
import { defineConfig } from '@playwright/test'
import { join } from 'node:path'
import { setDefaultResultOrder } from 'node:dns'
import { contextualTestConfigBinding, CONTEXTUAL_TEST_CHROME } from './e2e/helpers/contextual-test-admission'
const binding = contextualTestConfigBinding()
assert(binding.proofScope === 'vertical-v1' || binding.proofScope === 'vertical-grade-return-v1' || binding.proofScope === 'lifecycle-permissions-v1')
// The public cookie origin is localhost; the sole admitted socket is IPv4.
setDefaultResultOrder('ipv4first')
export default defineConfig({
  testDir: './e2e', testMatch: 'contextual-test-vertical.spec.ts', fullyParallel: false, workers: 1,
  retries: 0, maxFailures: 1, forbidOnly: true, timeout: 2700000, globalTimeout: 2700000,
  globalSetup: './e2e/helpers/contextual-test-admission.ts', reporter: [['./e2e/helpers/contextual-test-startup-reporter.ts']],
  outputDir: join(binding.outputDir, 'runner-output'),
  use: { baseURL: 'http://localhost:3117', browserName: 'chromium', headless: false,
    launchOptions: { executablePath: CONTEXTUAL_TEST_CHROME, args: ['--start-maximized', '--host-resolver-rules=MAP localhost 127.0.0.1'] },
    serviceWorkers: 'block', actionTimeout: 30000, navigationTimeout: 30000, screenshot: 'off', trace: 'off', video: 'off' },
  expect: { timeout: 30000 },
})
