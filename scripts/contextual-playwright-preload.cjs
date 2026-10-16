'use strict'
// Explicit --require only. Inherited by Playwright's forked workers through
// execArgv; never loaded by the app, ordinary tests, or normal development.
const assert = require('node:assert/strict')
try {
  const rehearsal = process.env.PIKA_CONTEXTUAL_TEST_REHEARSAL === 'true'
  const diagnostic = process.env.PIKA_BROWSER_DIAGNOSTIC === 'true'
  assert(rehearsal !== diagnostic, 'Private redirect preload scope')
  require('./contextual-playwright-redirect-guard.cjs').installContextualRedirectInterception()
} catch {
  throw new Error('Private redirect interception preload rejected')
}
