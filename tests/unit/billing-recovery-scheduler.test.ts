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
const dueSecret = 'synthetic-due-' + 'c'.repeat(32)
const publishableKey = 'sb_publishable_synthetic'
const enabled = {
  BILLING_PAID_RECOVERY_ENABLED: 'true',
  BILLING_TRIAL_RECOVERY_ENABLED: 'true',
  BILLING_LIVE_PAYMENT_WORKER_SECRET: paidSecret,
  BILLING_LIVE_TRIAL_WORKER_SECRET: trialSecret,
  BILLING_RECOVERY_CHECK_SECRET: dueSecret,
  BILLING_RECOVERY_SUPABASE_PUBLISHABLE_KEY: publishableKey,
}
const config = JSON.parse(readFileSync(new URL('../../workers/billing-recovery/wrangler.jsonc', import.meta.url), 'utf8'))
const tick = { cron: '*/2 * * * *', scheduledTime: 1_794_178_080_000 }
const paidPath = 'https://pika.codepet.ca/api/billing/stripe/live/process'
const trialPath = 'https://pika.codepet.ca/api/billing/trial/process'
const duePath = 'https://zhioqbapgfcrronyuidm.supabase.co/rest/v1/rpc/billing_recovery_due_v1'
const paidReceipt = {
  purchases: { processed: 1, failed: 0 },
  reconciliation: { processed: 0, exceptions: 0 },
  closeouts: { processed: 0, exceptions: 0, attention: 0 },
  expiry: { processed: 0 },
  assignmentReleases: {},
}
const trialReceipt = { lifecycle: { processed: 0 }, assignmentReleases: {} }
const dueReceipt = (paid: string | null, trial: string | null, shared = {}) =>
  Response.json({ paid, trial, assignment_releases: false, email_notices: false, repolight: false, ...shared })
const fetchStub = vi.fn()
const dueCheckStub = vi.fn()

beforeEach(() => {
  fetchStub.mockReset()
  dueCheckStub.mockReset().mockImplementation(async (_url: string, request: RequestInit) => {
    const { p_paid, p_trial } = JSON.parse(String(request.body))
    return dueReceipt(p_paid ? 'due' : null, p_trial ? 'due' : null)
  })
  vi.stubGlobal('fetch', (url: string, request: RequestInit) => (
    url === duePath ? dueCheckStub(url, request) : fetchStub(url, request)
  ))
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
    expect(dueCheckStub).not.toHaveBeenCalled()
  })

  it('makes one Supabase check for both lanes and emits idle heartbeats without calling Vercel', async () => {
    dueCheckStub.mockResolvedValueOnce(dueReceipt('idle', 'idle'))
    await expect(worker.scheduled(tick, { ...enabled, BILLING_LIVE_EMAIL_NOTICES_ENABLED: 'true' })).resolves.toBeUndefined()
    expect(dueCheckStub).toHaveBeenCalledExactlyOnceWith(duePath, expect.objectContaining({
      method: 'POST', redirect: 'manual', signal: expect.any(AbortSignal),
      headers: {
        apikey: publishableKey, 'x-pika-billing-recovery-secret': dueSecret,
        'Content-Type': 'application/json', Accept: 'application/json',
      },
      body: JSON.stringify({
        p_paid: true, p_trial: true, p_installation: false, p_cancellation: false,
        p_scheduled_closeout: false, p_email: true, p_repolight: false, p_repolight_teacher_id: null,
      }),
    }))
    expect(fetchStub).not.toHaveBeenCalled()
    for (const lane of ['paid', 'trial']) {
      expect(console.info).toHaveBeenCalledWith(expect.objectContaining({
        event: 'pika_billing_recovery', lane, outcome: 'idle', scheduledAt: tick.scheduledTime,
      }))
    }
    expect(console.error).not.toHaveBeenCalled()
  })

  it.each([
    ['idle', false], ['unavailable', true],
  ])('calls only trial when paid is %s', async (paidStatus, shouldFail) => {
    dueCheckStub.mockResolvedValueOnce(dueReceipt(paidStatus, 'due'))
    fetchStub.mockResolvedValueOnce(Response.json(trialReceipt))
    const scheduled = worker.scheduled(tick, enabled)
    if (shouldFail) await expect(scheduled).rejects.toThrow('needs attention')
    else await expect(scheduled).resolves.toBeUndefined()
    expect(fetchStub).toHaveBeenCalledExactlyOnceWith(trialPath, expect.anything())
    if (shouldFail) expect(console.error).toHaveBeenCalledWith(expect.objectContaining({
      lane: 'paid', outcome: 'due_check_lane_unavailable',
    }))
  })

  it('calls one lane for shared work when the first receipt confirms it', async () => {
    dueCheckStub.mockResolvedValueOnce(dueReceipt('idle', 'idle', { assignment_releases: true }))
    fetchStub.mockResolvedValueOnce(Response.json(trialReceipt))
    await expect(worker.scheduled(tick, enabled)).resolves.toBeUndefined()
    expect(dueCheckStub).toHaveBeenCalledTimes(1)
    expect(fetchStub).toHaveBeenCalledExactlyOnceWith(trialPath, expect.anything())
    expect(console.info).toHaveBeenCalledWith(expect.objectContaining({ lane: 'paid', outcome: 'idle' }))
  })

  it('falls back to paid after a failed trial call when shared work is due', async () => {
    dueCheckStub.mockResolvedValueOnce(dueReceipt('idle', 'idle', { assignment_releases: true }))
    fetchStub.mockResolvedValueOnce(new Response(null, { status: 401 })).mockResolvedValueOnce(Response.json(paidReceipt))
    await expect(worker.scheduled(tick, enabled)).rejects.toThrow('needs attention')
    expect(dueCheckStub).toHaveBeenCalledTimes(1)
    expect(fetchStub.mock.calls.map(([url]) => url)).toEqual([trialPath, paidPath])
    expect(console.info).toHaveBeenCalledWith(expect.objectContaining({ lane: 'paid', outcome: 'ok' }))
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ lane: 'trial', outcome: 'http_error' }))
  })

  it('falls back when an independently due paid call never reaches due email work', async () => {
    dueCheckStub.mockResolvedValueOnce(dueReceipt('due', 'idle', { email_notices: true }))
    fetchStub.mockResolvedValueOnce(Response.json(paidReceipt))
      .mockResolvedValueOnce(Response.json({ ...trialReceipt, emailNotices: { processed: 1 } }))
    await expect(worker.scheduled(tick, { ...enabled, BILLING_LIVE_EMAIL_NOTICES_ENABLED: 'true' })).rejects.toThrow('needs attention')
    expect(dueCheckStub).toHaveBeenCalledTimes(1)
    expect(fetchStub.mock.calls.map(([url]) => url)).toEqual([paidPath, trialPath])
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ lane: 'paid', outcome: 'shared_recovery_unconfirmed' }))
  })

  it.each([
    ['off', false, null],
    ['full', true, null],
    ['e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1', true, 'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1'],
    ['invalid', false, null],
  ])('uses the configured RepoLight scope %s', async (scope, provision, teacherId) => {
    dueCheckStub.mockResolvedValueOnce(dueReceipt('idle', 'idle', { repolight: provision }))
    fetchStub.mockResolvedValueOnce(Response.json(trialReceipt))
    await expect(worker.scheduled(tick, { ...enabled, BILLING_RECOVERY_REPOLIGHT_SCOPE: scope })).resolves.toBeUndefined()
    expect(JSON.parse(dueCheckStub.mock.calls[0][1].body)).toMatchObject({
      p_repolight: provision, p_repolight_teacher_id: teacherId,
    })
    expect(fetchStub).toHaveBeenCalledTimes(provision ? 1 : 0)
  })

  it('does not repeat shared work when only an unrelated paid subtask failed', async () => {
    dueCheckStub.mockResolvedValueOnce(dueReceipt('due', 'idle', { assignment_releases: true }))
    fetchStub.mockResolvedValueOnce(Response.json({ ...paidReceipt, reconciliation: { failed: 1 } }))
    await expect(worker.scheduled(tick, enabled)).rejects.toThrow('needs attention')
    expect(fetchStub).toHaveBeenCalledExactlyOnceWith(paidPath, expect.anything())
  })

  it.each([
    [() => new Response(dueSecret, { status: 404 }), 'due_check_http_error'],
    [() => Response.json({ paid: false, trial: 'due' }), 'invalid_due_check_receipt'],
    [() => Response.json({ paid: 'idle', trial: 'due', extra: dueSecret }), 'invalid_due_check_receipt'],
    [() => { throw new Error(dueSecret) }, 'due_check_failed'],
  ])('reports an unusable check and skips both endpoints (%#)', async (response, outcome) => {
    dueCheckStub.mockImplementationOnce(response)
    await expect(worker.scheduled(tick, enabled)).rejects.toThrow('needs attention')
    expect(fetchStub).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledTimes(2)
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ lane: 'paid', outcome }))
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(dueSecret)
  })

  it('rejects invalid or reused due-check credentials before contacting either provider', async () => {
    for (const env of [
      { ...enabled, BILLING_RECOVERY_CHECK_SECRET: paidSecret },
      { ...enabled, BILLING_RECOVERY_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_synthetic' },
    ]) await expect(worker.scheduled(tick, env)).rejects.toThrow('needs attention')
    expect(dueCheckStub).not.toHaveBeenCalled()
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

  it('reports email attention on either worker without including recipient data', async () => {
    fetchStub.mockImplementation(async url => Response.json(url === paidPath ? paidReceipt : {
      ...trialReceipt, emailNotices: { processed: 2, sent: 1, attention: 1, recipient: 'teacher@example.invalid' },
    }))
    await expect(worker.scheduled(tick, enabled)).rejects.toThrow('needs attention')
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({
      lane: 'trial', outcome: 'needs_attention', issues: { emailNotices: { attention: 1 } },
      counts: expect.objectContaining({ emailNotices: { processed: 2, sent: 1 } }),
    }))
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('teacher@example.invalid')
    expect(console.info).toHaveBeenCalledWith(expect.objectContaining({ lane: 'paid', outcome: 'ok' }))
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
