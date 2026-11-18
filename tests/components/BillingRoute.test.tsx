import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  redirect: vi.fn((url: string) => { throw new Error(url) }),
  notFound: vi.fn(() => { throw new Error('Fixture not found') }),
  isBillingPurchaseAvailable: vi.fn(),
  isBillingLiveTrialAvailable: vi.fn(),
  isBillingLivePaymentAvailable: vi.fn(),
  readBillingPortalConfig: vi.fn(),
  readBillingUpgradeConfig: vi.fn(),
}))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, notFound: mocks.notFound }))
vi.mock('@/lib/auth', () => ({ getCurrentUser: mocks.getCurrentUser }))
vi.mock('@/lib/server/auth-redirect', () => ({ getServerLoginRedirectPath: () => Promise.resolve('/login') }))
vi.mock('@/lib/server/billing/purchase-config', () => ({ isBillingPurchaseAvailable: mocks.isBillingPurchaseAvailable }))
vi.mock('@/lib/server/billing/live-target', () => ({ isBillingLiveTrialAvailable: mocks.isBillingLiveTrialAvailable,
  isBillingLivePaymentAvailable: mocks.isBillingLivePaymentAvailable }))
vi.mock('@/lib/server/billing/portal-config', () => ({ readBillingPortalConfig: mocks.readBillingPortalConfig }))
vi.mock('@/lib/server/billing/upgrade-runtime', () => ({ readBillingUpgradeConfig: mocks.readBillingUpgradeConfig }))
vi.mock('@/components/AppShell', () => ({ AppShell: () => null }))
vi.mock('@/app/__ui/UiGallery', () => ({ UiGallery: () => null }))

import Page from '@/app/billing/page'
import PatternLabPage from '@/app/pattern-lab/page'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isBillingLivePaymentAvailable.mockReturnValue(false)
  mocks.isBillingLiveTrialAvailable.mockReturnValue(false)
})
afterEach(() => vi.unstubAllEnvs())

describe('billing page access', () => {
  it('redirects unauthenticated accounts to sign in', async () => {
    mocks.getCurrentUser.mockResolvedValue(null)
    await expect(Page()).rejects.toThrow('/login')
    expect(mocks.isBillingPurchaseAvailable).not.toHaveBeenCalled()
  })

  it('redirects student accounts before reading billing configuration', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'student', role: 'student' })
    await expect(Page()).rejects.toThrow('/classrooms')
    expect(mocks.isBillingPurchaseAvailable).not.toHaveBeenCalled()
    expect(mocks.isBillingLiveTrialAvailable).not.toHaveBeenCalled()
  })

  it('opens the teacher billing page for trial status alone', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'teacher', role: 'teacher' })
    mocks.isBillingPurchaseAvailable.mockReturnValue(false)
    mocks.isBillingLiveTrialAvailable.mockReturnValue(true)
    const page = await Page()
    expect(page.props.billingAvailable).toBe(true)
    expect(page.props.children.props).toMatchObject({
      billingAvailable: true, purchaseAvailable: false, portalAvailable: false, upgradesAvailable: false,
    })
    expect(mocks.readBillingPortalConfig).not.toHaveBeenCalled()
    expect(mocks.readBillingUpgradeConfig).not.toHaveBeenCalled()
  })

  it('limits the actionable Billing pattern to an anonymous teacher fixture', async () => {
    vi.stubEnv('ENABLE_UI_GALLERY', 'true')
    vi.stubEnv('PIKA_E2E_FIXTURES', 'true')
    const pattern = (role: string) => PatternLabPage({ searchParams: Promise.resolve({ role, fixture: 'billing-trial' }) })
    await expect(pattern('student')).rejects.toThrow('Fixture not found')
    expect(mocks.getCurrentUser).not.toHaveBeenCalled()

    mocks.getCurrentUser.mockResolvedValue({ id: 'teacher', role: 'teacher' })
    await expect(pattern('teacher')).rejects.toThrow('Fixture not found')
    mocks.getCurrentUser.mockResolvedValue(null)
    expect((await pattern('teacher')).props.children.props.purchaseAvailable).toBe(false)
  })

  it('shows the live paid and portal options with a separate rollout from trials and upgrades', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'teacher', role: 'teacher' })
    mocks.isBillingPurchaseAvailable.mockReturnValue(false)
    mocks.isBillingLivePaymentAvailable.mockReturnValue(true)
    mocks.readBillingPortalConfig.mockReturnValue({ portalConfigurationId: 'bpc_Live' })
    expect((await Page()).props.children.props).toMatchObject({
      billingAvailable: true, purchaseAvailable: true, portalAvailable: true,
      portalCancellationAvailable: true, upgradesAvailable: false,
    })
    expect(mocks.readBillingUpgradeConfig).not.toHaveBeenCalled()
  })
})
