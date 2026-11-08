import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readBillingPurchaseConfig, readBillingRecoveryConfig } from '@/lib/server/billing/purchase-config'
import { readBillingUpgradeConfig } from '@/lib/server/billing/upgrade-runtime'

const mocks = vi.hoisted(() => ({ purchase: vi.fn(), upgrade: vi.fn(), base: vi.fn(), lifecycle: vi.fn(), closeout: vi.fn(),
  reconcile: vi.fn(), upgrades: vi.fn(), applyDue: vi.fn(), closeDue: vi.fn(), auth: vi.fn(),
  schedule: vi.fn(), installSchedules: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRole: mocks.auth }))
vi.mock('@/lib/server/billing/runtime', () => ({ createBillingRuntime: mocks.base, STRIPE_BILLING_API_VERSION: '2026-08-26.dahlia' }))
vi.mock('@/lib/server/billing/purchase-runtime', () => ({ createBillingPurchaseRuntime: mocks.purchase }))
vi.mock('@/lib/server/billing/lifecycle-runtime', () => ({ createBillingLifecycleRuntime: mocks.lifecycle }))
vi.mock('@/lib/server/billing/closeout-runtime', () => ({ createBillingCloseoutRuntime: mocks.closeout }))
vi.mock('@/lib/server/billing/scheduled-plan-change-runtime', () => ({ createScheduledPlanChangeRuntime: mocks.schedule }))
vi.mock('@/lib/server/billing/upgrade-runtime', async importOriginal => ({
  ...await importOriginal<object>(), createBillingUpgradeRuntime: mocks.upgrade,
}))
import { POST } from '@/app/api/billing/stripe/process/route'
import { POST as checkout } from '@/app/api/billing/checkout/route'
import { POST as upgrade } from '@/app/api/billing/upgrade/route'
import { POST as confirm } from '@/app/api/billing/upgrade/confirm/route'
import { POST as schedule } from '@/app/api/billing/scheduled-change/route'
import { POST as confirmSchedule } from '@/app/api/billing/scheduled-change/confirm/route'

const env = {
  BILLING_SANDBOX_ENABLED: 'true', BILLING_CHECKOUT_ENABLED: 'false', BILLING_UPGRADES_ENABLED: 'false',
  BILLING_SCHEDULED_CHANGES_ENABLED: 'false', BILLING_SCHEDULED_RENEWALS_ENABLED: 'false',
  STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_ACCOUNT_ID: 'acct_fixture',
  BILLING_WORKER_SECRET: 'a'.repeat(32), NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  BILLING_APP_ORIGIN: 'http://localhost:3000',
}
const context = { params: Promise.resolve({}) }
const request = (authorization: string) => new NextRequest('http://localhost/api/billing/stripe/process', {
  method: 'POST', headers: { authorization },
})

describe('worker recovery independent of admission', () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    vi.stubEnv('VERCEL', ''); vi.stubEnv('VERCEL_ENV', '')
    mocks.base.mockReturnValue({ store: { listWork: vi.fn().mockResolvedValue({ items: [] }) } })
    mocks.reconcile.mockResolvedValue({ processed: 1, failed: 0 }); mocks.upgrades.mockResolvedValue({ processed: 1 })
    mocks.purchase.mockReturnValue({ reconcileCheckouts: mocks.reconcile }); mocks.upgrade.mockReturnValue({ processDue: mocks.upgrades })
    mocks.applyDue.mockResolvedValue({ processed: 0 }); mocks.closeDue.mockResolvedValue({ processed: 0 })
    mocks.lifecycle.mockReturnValue({ applyDue: mocks.applyDue }); mocks.closeout.mockReturnValue({ closeDueRenewals: mocks.closeDue })
    mocks.installSchedules.mockResolvedValue({ installed: 1 })
    mocks.schedule.mockReturnValue({ processDue: mocks.installSchedules })
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })
  it('keeps admission closed but runs both recovery queues after worker authentication', async () => {
    expect(readBillingPurchaseConfig(env)).toBeNull()
    expect(readBillingUpgradeConfig(env)).toBeNull()
    for (const customerRoute of [checkout, upgrade, confirm]) {
      expect((await customerRoute(request(''), context)).status).toBe(404)
    }
    expect(mocks.auth).not.toHaveBeenCalled()
    const response = await POST(request(`Bearer ${env.BILLING_WORKER_SECRET}`), context)
    expect(response.status).toBe(200)
    expect(mocks.reconcile).toHaveBeenCalledWith({ limit: 1 })
    expect(mocks.upgrades).toHaveBeenCalledWith({ limit: 1 })
    expect(mocks.purchase).toHaveBeenCalledWith(expect.objectContaining({ appOrigin: env.BILLING_APP_ORIGIN }))
    expect(mocks.upgrade).toHaveBeenCalledWith(expect.objectContaining({ appOrigin: env.BILLING_APP_ORIGIN }))
    expect(mocks.schedule).not.toHaveBeenCalled()
  })
  it('recovers an admitted schedule while new schedules and checkout are disabled', async () => {
    vi.stubEnv('BILLING_SCHEDULED_RENEWALS_ENABLED', 'true')
    for (const customerRoute of [schedule, confirmSchedule]) {
      expect((await customerRoute(request(''), context)).status).toBe(404)
    }
    expect(mocks.auth).not.toHaveBeenCalled()
    const response = await POST(request(`Bearer ${env.BILLING_WORKER_SECRET}`), context)
    expect(response.status).toBe(200)
    expect(mocks.installSchedules).toHaveBeenCalledWith({ limit: 1 })
    expect(await response.json()).toMatchObject({ scheduledChanges: { installed: 1 } })
  })
  it('rejects unauthenticated requests before any runtime loads', async () => {
    vi.stubEnv('BILLING_SCHEDULED_RENEWALS_ENABLED', 'true')
    const response = await POST(request('Bearer wrong'), context)
    expect(response.status).toBe(401)
    expect(mocks.base).not.toHaveBeenCalled(); expect(mocks.purchase).not.toHaveBeenCalled(); expect(mocks.upgrade).not.toHaveBeenCalled()
    expect(mocks.schedule).not.toHaveBeenCalled()
  })
  it('continues ordinary recovery if the scheduled installation lane fails', async () => {
    vi.stubEnv('BILLING_SCHEDULED_RENEWALS_ENABLED', 'true')
    mocks.installSchedules.mockRejectedValueOnce(new Error('private fixture detail'))
    const response = await POST(request(`Bearer ${env.BILLING_WORKER_SECRET}`), context)
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result).toMatchObject({ scheduledChanges: { failed: 1, diagnosticId: expect.any(String) } })
    expect(JSON.stringify(result)).not.toContain('private fixture detail')
    expect(mocks.reconcile).toHaveBeenCalledWith({ limit: 1 })
    expect(mocks.closeDue).toHaveBeenCalledWith({ limit: 1 })
  })
  it.each([undefined, ''])('allows the base, lifecycle and closeout worker without a configured app origin (%s)', async origin => {
    vi.stubEnv('BILLING_APP_ORIGIN', origin)
    const response = await POST(request(`Bearer ${env.BILLING_WORKER_SECRET}`), context)
    expect(response.status).toBe(200)
    expect(mocks.purchase).not.toHaveBeenCalled(); expect(mocks.upgrade).not.toHaveBeenCalled()
    expect(mocks.applyDue).toHaveBeenCalled(); expect(mocks.closeDue).toHaveBeenCalled()
  })
  it.each(['https://example.com', 'http://localhost:3000/path', 'http://localhost.evil:3000'])('fails closed on configured origin %s', async origin => {
    vi.stubEnv('BILLING_APP_ORIGIN', origin)
    const response = await POST(request(`Bearer ${env.BILLING_WORKER_SECRET}`), context)
    expect(response.status).toBe(500)
    expect(mocks.purchase).not.toHaveBeenCalled(); expect(mocks.upgrade).not.toHaveBeenCalled()
  })
  it('preserves sandbox, target and key restrictions', () => {
    expect(readBillingRecoveryConfig({ ...env, BILLING_SANDBOX_ENABLED: 'false' })).toBeNull()
    expect(() => readBillingRecoveryConfig({ ...env, STRIPE_SECRET_KEY: 'sk_live_fixture' })).toThrow()
    expect(() => readBillingRecoveryConfig({ ...env, NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' })).toThrow()
    expect(() => readBillingRecoveryConfig({ ...env, VERCEL: '1' })).toThrow()
  })
})
