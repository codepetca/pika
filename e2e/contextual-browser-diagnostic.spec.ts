import { test, expect } from '@playwright/test'
import { diagnosticAdmissionFromEnvironment, diagnosticWrite, DIAGNOSTIC_VERSION } from '../scripts/contextual-browser-diagnostic-data'
import { runLoginBodyDiagnostic } from './helpers/contextual-browser-login-diagnostic'

// The same standard browser fixture launches the same headed pinned Chrome.
// The body-read mode is bound into the exclusive admission, never an env switch.
const optedIn = process.env.PIKA_BROWSER_DIAGNOSTIC === 'true'
const admission = optedIn ? diagnosticAdmissionFromEnvironment() : undefined
test.skip(!optedIn, 'Requires the explicitly admitted private browser diagnostic')
test('private browser fixture diagnostic', async ({ browser }) => {
  if (admission!.mode === 'login-body') {
    const versionMatched = browser.version() === DIAGNOSTIC_VERSION
    expect(versionMatched).toBe(true)
    const result = await runLoginBodyDiagnostic(browser, Math.min(admission!.deadline, Date.now() + 20000))
    diagnosticWrite(admission!.outputDir, 'lifecycle.json', { version: 1, mode: 'login-body', versionMatched, ...result })
    // Successful measurement is not Pika/login acceptance. A reproduced stall
    // remains a recorded observation, not a reason to retry this diagnostic.
    expect(result.contextClosed && result.serverClosed && result.socketsRemaining === 0).toBe(true)
    expect(result.originalSeen && result.bodyDone && result.bodyVerified).toBe(true)
    expect(result.unexpectedRequests).toBe(0); expect(result.failure).toBe(false)
    expect(result.overflow).toBe(false)
    return
  }
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
    finally { diagnosticWrite(admission!.outputDir, 'lifecycle.json', receipt) }
  }
})
