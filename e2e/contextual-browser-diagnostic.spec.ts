import { test, expect } from '@playwright/test'
import { diagnosticAdmissionFromEnvironment, diagnosticWrite, DIAGNOSTIC_VERSION } from '../scripts/contextual-browser-diagnostic-data'

// The same standard browser fixture launches the same headed pinned Chrome.
// Only a fresh offline context and its initial blank page are exercised.
test('private browser fixture diagnostic', async ({ browser }) => {
  const admission = diagnosticAdmissionFromEnvironment()
  const receipt = { version: 1, fixtureEntered: true, versionMatched: false, contextCreated: false, blankPageCreated: false, contextClosed: false, blockedRequests: 0 }
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined
  try {
    receipt.versionMatched = browser.version() === DIAGNOSTIC_VERSION; expect(receipt.versionMatched).toBe(true)
    context = await browser.newContext({ offline: true, serviceWorkers: 'block' }); receipt.contextCreated = true
    await context.route('**/*', async route => { receipt.blockedRequests = Math.min(2, receipt.blockedRequests + 1); await route.abort('blockedbyclient') })
    const page = await context.newPage(); receipt.blankPageCreated = true
    expect(page.url()).toBe('about:blank'); expect(receipt.blockedRequests).toBe(0)
  } finally {
    try { if (context) { await context.close(); receipt.contextClosed = true } }
    finally { diagnosticWrite(admission.outputDir, 'lifecycle.json', receipt) }
  }
})
