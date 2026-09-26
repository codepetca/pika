import { describe, expect, it } from 'vitest'
import { readBillingSandboxConfig } from '@/lib/server/billing/config'

const env = {
  BILLING_SANDBOX_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'sk_test_fixture',
  STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
  STRIPE_ACCOUNT_ID: 'acct_fixture',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  BILLING_WORKER_SECRET: 'fixture-worker-secret-at-least-32-characters',
}

describe('billing sandbox isolation', () => {
  it('is disabled unless explicitly enabled', () => {
    expect(readBillingSandboxConfig({})).toBeNull()
    expect(readBillingSandboxConfig({ ...env, BILLING_SANDBOX_ENABLED: 'false' })).toBeNull()
  })
  it('accepts only the explicit local sandbox', () => {
    expect(readBillingSandboxConfig(env)?.supabaseOrigin).toBe('http://127.0.0.1:54321')
  })
  it.each([
    { STRIPE_SECRET_KEY: 'sk_live_fixture' },
    { STRIPE_SECRET_KEY: '' },
    { STRIPE_WEBHOOK_SECRET: '' },
    { STRIPE_ACCOUNT_ID: '' },
    { BILLING_WORKER_SECRET: 'short' },
    { VERCEL_ENV: 'production' },
    { VERCEL: '1' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' },
    { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1.example.com:54321' },
    { NEXT_PUBLIC_SUPABASE_URL: 'http://user:password@127.0.0.1:54321' },
    { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321/other' },
    { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321?redirect=external' },
  ])('rejects unsafe or incomplete configuration %j', (override) => {
    expect(() => readBillingSandboxConfig({ ...env, ...override })).toThrow('Billing sandbox configuration is invalid')
  })
})
