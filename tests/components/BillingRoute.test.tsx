import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  redirect: vi.fn((url: string) => { throw new Error(url) }),
  isBillingPurchaseAvailable: vi.fn(),
}))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/auth', () => ({ getCurrentUser: mocks.getCurrentUser }))
vi.mock('@/lib/server/auth-redirect', () => ({ getServerLoginRedirectPath: () => Promise.resolve('/login') }))
vi.mock('@/lib/server/billing/purchase-config', () => ({ isBillingPurchaseAvailable: mocks.isBillingPurchaseAvailable }))
vi.mock('@/lib/server/billing/portal-config', () => ({ readBillingPortalConfig: () => null }))
vi.mock('@/lib/server/billing/upgrade-runtime', () => ({ readBillingUpgradeConfig: () => null }))
vi.mock('@/components/AppShell', () => ({ AppShell: () => null }))

import Page from '@/app/billing/page'

beforeEach(() => vi.clearAllMocks())

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
  })
})
