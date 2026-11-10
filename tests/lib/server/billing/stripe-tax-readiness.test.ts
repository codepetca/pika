import { describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import { isStripeTaxReady } from '@/lib/server/billing/stripe-tax-readiness'

function fixture() {
  const account = { id: 'acct_live' }
  const settings = { livemode: true, status: 'active', defaults: { provider: 'stripe' } }
  const registration = { livemode: true, status: 'active', country: 'CA', active_from: 0, expires_at: null,
    country_options: { ca: { type: 'standard' } } }
  const sdk = { accounts: { retrieve: vi.fn(async () => account) }, tax: {
    settings: { retrieve: vi.fn(async () => settings) },
    registrations: { list: vi.fn(async () => ({ has_more: false, data: [registration] })) },
  } }
  return { sdk, account, settings, registration }
}
describe('Stripe Tax admission readiness', () => {
  it('requires a live active merchant, settings and federal registration', async () => {
    const f = fixture()
    expect(await isStripeTaxReady(f.sdk as unknown as Stripe, 'acct_live')).toBe(true)
    f.registration.country_options.ca.type = 'province_standard'
    expect(await isStripeTaxReady(f.sdk as unknown as Stripe, 'acct_live')).toBe(false)
    f.registration.country_options.ca.type = 'standard'
    f.settings.status = 'pending'
    expect(await isStripeTaxReady(f.sdk as unknown as Stripe, 'acct_live')).toBe(false)
    f.settings.status = 'active'; f.account.id = 'acct_other'
    expect(await isStripeTaxReady(f.sdk as unknown as Stripe, 'acct_live')).toBe(false)
  })
  it('fails closed on incomplete listings and provider errors', async () => {
    const f = fixture()
    f.sdk.tax.registrations.list.mockResolvedValueOnce({ has_more: true, data: [f.registration] })
    expect(await isStripeTaxReady(f.sdk as unknown as Stripe, 'acct_live')).toBe(false)
    f.sdk.tax.settings.retrieve.mockRejectedValueOnce(new Error('unavailable'))
    expect(await isStripeTaxReady(f.sdk as unknown as Stripe, 'acct_live')).toBe(false)
  })
})
