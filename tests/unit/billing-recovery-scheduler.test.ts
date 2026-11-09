import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../../workers/billing-recovery/worker.mjs'
import { POST as paidPost } from '@/app/api/billing/stripe/live/process/route'
import { POST as trialPost } from '@/app/api/billing/trial/process/route'

const handlers = vi.hoisted(() => ({ paid: vi.fn(), trial: vi.fn(), paidConfig: vi.fn(), trialConfig: vi.fn() }))
vi.mock('@/lib/server/billing/live-target', () => ({
  readBillingLivePaymentWorkerConfig: handlers.paidConfig,
  readBillingLiveTrialConfig: handlers.trialConfig,
}))
vi.mock('@/lib/server/billing/payment-runtime', () => ({ processLiveBillingPaymentLifecycle: handlers.paid }))
vi.mock('@/lib/server/billing/lifecycle-runtime', () => ({ processLiveTrialLifecycle: handlers.trial }))

const paidSecret = 'synthetic-paid-' + 'a'.repeat(32)
const trialSecret = 'synthetic-trial-' + 'b'.repeat(32)
const enabled = {
  BILLING_PAID_RECOVERY_ENABLED: 'true',
  BILLING_TRIAL_RECOVERY_ENABLED: 'true',
  BILLING_LIVE_PAYMENT_WORKER_SECRET: paidSecret,
  BILLING_LIVE_TRIAL_WORKER_SECRET: trialSecret,
}
const config = JSON.parse(readFileSync(new URL('../../workers/billing-recovery/wrangler.jsonc', import.meta.url), 'utf8'))
const tick = { cron: '*/2 * * * *', scheduledTime: 1_794_178_080_000 }
const paidPath = 'https://pika.codepet.ca/api/billing/stripe/live/process'
const trialPath = 'https://pika.codepet.ca/api/billing/trial/process'
const paidReceipt = {
  purchases: { processed: 1, failed: 0 },
  reconciliation: { processed: 0, exceptions: 0 },
  closeouts: { processed: 0, exceptions: 0, attention: 0 },
  expiry: { processed: 0 },
  assignmentReleases: {},
}
const trialReceipt = { lifecycle: { processed: 0 }, assignmentReleases: {} }
const fetchStub = vi.fn()

beforeEach(() => {
  fetchStub.mockReset()
  vi.stubGlobal('fetch', fetchStub)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Pika billing recovery scheduler', () => {
  it('packages a private two-minute trigger with both recovery switches off', async () => {
    expect(worker).not.toHaveProperty('fetch')
    expect(config).toMatchObject({ workers_dev: false, preview_urls: false, main: 'worker.mjs',
      triggers: { crons: [tick.cron] }, vars: { BILLING_PAID_RECOVERY_ENABLED: 'false', BILLING_TRIAL_RECOVERY_ENABLED: 'false' } })
    await expect(worker.scheduled(tick, config.vars)).resolves.toBeUndefined()
    await expect(worker.scheduled({ ...tick, cron: '* * * * *' }, enabled)).rejects.toThrow('Unexpected')
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('invokes both exact POST routes with independent credentials and no redirects', async () => {
    fetchStub.mockImplementation(async url => Response.json(url === paidPath ? paidReceipt : trialReceipt))
    await expect(worker.scheduled(tick, enabled)).resolves.toBeUndefined()
    for (const [path, secret] of [[paidPath, paidSecret], [trialPath, trialSecret]]) {
      expect(fetchStub).toHaveBeenCalledWith(path, expect.objectContaining({
        method: 'POST', redirect: 'manual', headers: { Authorization: 'Bearer ' + secret, Accept: 'application/json' },
        signal: expect.any(AbortSignal),
      }))
    }
    expect(fetchStub).toHaveBeenCalledTimes(2)
    expect(console.info).toHaveBeenCalledTimes(2)
    expect(console.info).toHaveBeenCalledWith(expect.objectContaining({ lane: 'paid', outcome: 'ok',
      counts: { purchases: { processed: 1 }, reconciliation: { processed: 0 }, closeouts: { processed: 0 }, expiry: { processed: 0 } } }))
    expect(console.error).not.toHaveBeenCalled()
  })

  it('passes the separate bearer credentials through Pika’s live POST handlers', async () => {
    const stripeAccount = 'acct_RecoveryWorkerFixture'
    handlers.paidConfig.mockReturnValue({ stripeAccount, workerSecret: paidSecret, checkoutAdmissionEnabled: false })
    handlers.trialConfig.mockReturnValue({ stripeAccount, workerSecret: trialSecret, admissionEnabled: false })
    handlers.paid.mockReset().mockResolvedValue(paidReceipt)
    handlers.trial.mockReset().mockResolvedValue(trialReceipt)
    fetchStub.mockImplementation(async (url: string, options: RequestInit) => {
      const route = url === paidPath ? paidPost : trialPost
      return route(new NextRequest(url, options), { params: Promise.resolve({}) })
    })
    await expect(worker.scheduled(tick, enabled)).resolves.toBeUndefined()
    expect(handlers.paid).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      stripeAccount, checkoutAdmissionEnabled: false,
    }))
    expect(handlers.trial).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      stripeAccount, admissionEnabled: false,
    }))
    await expect(worker.scheduled(tick, { ...enabled, BILLING_LIVE_PAYMENT_WORKER_SECRET: trialSecret,
      BILLING_LIVE_TRIAL_WORKER_SECRET: paidSecret })).rejects.toThrow('needs attention')
    expect(handlers.paid).toHaveBeenCalledTimes(1)
    expect(handlers.trial).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ lane: 'paid', outcome: 'http_error', status: 401 }))
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ lane: 'trial', outcome: 'http_error', status: 401 }))
  })

  it('continues the healthy lane when the other has an invalid credential', async () => {
    fetchStub.mockResolvedValue(Response.json(trialReceipt))
    await expect(worker.scheduled(tick, { ...enabled, BILLING_LIVE_PAYMENT_WORKER_SECRET: 'short' })).rejects.toThrow('needs attention')
    expect(fetchStub).toHaveBeenCalledExactlyOnceWith(trialPath, expect.anything())
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ lane: 'paid', outcome: 'invalid_secret' }))
  })

  it('rejects a reused token before either invocation', async () => {
    await expect(worker.scheduled(tick, { ...enabled, BILLING_LIVE_TRIAL_WORKER_SECRET: paidSecret })).rejects.toThrow('distinct')
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('keeps the enabled lane running while the other credential is disabled', async () => {
    fetchStub.mockResolvedValue(Response.json(paidReceipt))
    await expect(worker.scheduled(tick, { ...enabled, BILLING_TRIAL_RECOVERY_ENABLED: 'false',
      BILLING_LIVE_TRIAL_WORKER_SECRET: paidSecret })).resolves.toBeUndefined()
    expect(fetchStub).toHaveBeenCalledExactlyOnceWith(paidPath, expect.anything())
  })

  it('records approved success counts from sparse receipts without logging arbitrary fields', async () => {
    fetchStub.mockResolvedValue(Response.json({ ...paidReceipt,
      assignmentReleases: { released: 2, suppressed: 1, assignmentId: paidSecret },
      scheduledInstallations: { installed: 1, debug: paidSecret },
      scheduledCancellations: { restored_after_cutoff: 1, providerId: paidSecret } }))
    await expect(worker.scheduled(tick, { ...enabled, BILLING_TRIAL_RECOVERY_ENABLED: 'false' })).resolves.toBeUndefined()
    expect(console.info).toHaveBeenCalledWith(expect.objectContaining({ lane: 'paid', outcome: 'ok',
      counts: expect.objectContaining({ assignmentReleases: { released: 2, suppressed: 1 },
        scheduledInstallations: { installed: 1 }, scheduledCancellations: { restored_after_cutoff: 1 } }) }))
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(paidSecret)
  })

  it('fails a 200 with partial recovery failures and emits only sanitized issue counts', async () => {
    fetchStub.mockImplementation(async url => Response.json(url === paidPath
      ? { ...paidReceipt, reconciliation: { failed: 1, diagnosticId: paidSecret },
        closeouts: { processed: 1, attention: 1 }, scheduledCancellations: { attention: 1 } }
      : trialReceipt))
    await expect(worker.scheduled(tick, enabled)).rejects.toThrow('needs attention')
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ lane: 'paid', outcome: 'needs_attention',
      issues: { reconciliation: { failed: 1 }, closeouts: { attention: 1 }, scheduledCancellations: { attention: 1 } } }))
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(paidSecret)
    expect(console.info).toHaveBeenCalledWith(expect.objectContaining({ lane: 'trial', outcome: 'ok' }))
  })

  it.each([
    ['redirect', () => new Response(null, { status: 307, headers: { Location: 'https://foreign.example/redirect' } }), 'http_error'],
    ['non-success', () => new Response(paidSecret, { status: 503 }), 'http_error'],
    ['malformed', () => Response.json({ purchases: {}, reconciliation: {}, closeouts: {}, expiry: {}, assignmentReleases: {} }), 'invalid_receipt'],
    ['oversized', () => Response.json({ ...paidReceipt, debug: paidSecret.repeat(400) }), 'invalid_receipt'],
    ['non-JSON', () => new Response(paidSecret), 'invalid_receipt'],
  ])('rejects %s receipts with a single bounded attempt', async (_name, response, outcome) => {
    fetchStub.mockResolvedValue(response())
    await expect(worker.scheduled(tick, { ...enabled, BILLING_TRIAL_RECOVERY_ENABLED: 'false' })).rejects.toThrow('needs attention')
    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ lane: 'paid', outcome }))
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(paidSecret)
  })

  it('logs a transport rejection without including the raw error', async () => {
    fetchStub.mockRejectedValue(new Error(paidSecret))
    await expect(worker.scheduled(tick, { ...enabled, BILLING_TRIAL_RECOVERY_ENABLED: 'false' })).rejects.toThrow('needs attention')
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ lane: 'paid', outcome: 'request_failed' }))
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(paidSecret)
  })
})
