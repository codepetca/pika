import { describe, expect, it } from 'vitest'
import { readBillingPurchaseConfig } from '@/lib/server/billing/purchase-config'

const env = {
  BILLING_SANDBOX_ENABLED: 'true', BILLING_CHECKOUT_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_fixture',
  STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_ACCOUNT_ID: 'acct_fixture',
  BILLING_WORKER_SECRET: 'a'.repeat(32), NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  BILLING_APP_ORIGIN: 'http://localhost:3000',
}
describe('purchase origin isolation', () => {
  it('requires no purchase settings while disabled', () => {
    expect(readBillingPurchaseConfig({})).toBeNull()
    expect(readBillingPurchaseConfig({ ...env, BILLING_CHECKOUT_ENABLED: 'false', BILLING_APP_ORIGIN: '' })).toBeNull()
    expect(readBillingPurchaseConfig({ ...env, BILLING_SANDBOX_ENABLED: 'false' })).toBeNull()
  })
  it('pins the configured local origin', () => {
    expect(readBillingPurchaseConfig(env)?.appOrigin).toBe('http://localhost:3000')
  })
  it.each(['', 'https://example.com', 'http://localhost.evil:3000', 'http://localhost:3000/path',
    'http://user:pass@localhost:3000', 'http://localhost:3000?redirect=evil', 'http://localhost:3000#x',
  ])('rejects invalid return origin %s', value => {
    expect(() => readBillingPurchaseConfig({ ...env, BILLING_APP_ORIGIN: value })).toThrow('configuration is invalid')
  })
  it('retains the hosted runtime and live key prohibitions', () => {
    expect(() => readBillingPurchaseConfig({ ...env, VERCEL: '1' })).toThrow()
    expect(() => readBillingPurchaseConfig({ ...env, STRIPE_SECRET_KEY: 'sk_live_fixture' })).toThrow()
    expect(() => readBillingPurchaseConfig({ ...env, NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' })).toThrow()
  })
})
