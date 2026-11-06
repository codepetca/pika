import { describe, expect, it } from 'vitest'
import { launchCatalog, repolightCatalog, REPOLIGHT_CATALOG_RELEASE_TAG } from '@/lib/billing/launch-catalog'
import { listLaunchPurchaseCatalog, validateLaunchCheckoutOffering } from '@/lib/server/billing/purchase-catalog'
import type { CheckoutOffering } from '@/lib/server/billing/checkout-contracts'

function offering(index = 0): CheckoutOffering {
  const variant = repolightCatalog[index]
  return {
    offering_version_id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, '0')}`,
    catalog_key: variant.catalogKey, plan_key: variant.legacyPlan,
    stripe_account: 'acct_fixture', stripe_product_id: 'prod_fixture', stripe_price_id: `price_fixture${index}`,
    currency: variant.currency, interval: variant.interval,
    unit_amount: variant.unitAmountCents, classroom_limit: variant.activeClassroomCap,
  }
}
describe('available launch purchase catalog', () => {
  it('maps all12 immutable variants to public names without provider references or provisional promises', async () => {
    const items = await listLaunchPurchaseCatalog({ stripeAccount: 'acct_fixture', release: REPOLIGHT_CATALOG_RELEASE_TAG,
      listOfferings: async () => ({ items: repolightCatalog.map((_, index) => offering(index)) }) })
    expect(items).toHaveLength(12)
    expect(items.filter(item => item.plan === 'max').every(item => item.classroomLimit === 12)).toBe(true)
    expect(items.filter(item => item.plan === 'pro').every(item => item.name === 'Pro' && item.classroomLimit === 5)).toBe(true)
    expect(JSON.stringify(items)).not.toMatch(/price_fixture|provisional|grading/)
  })
  it('allows only the new release for fresh purchases', async () => {
    const current = offering(4)
    const old = { ...current, offering_version_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      catalog_key: launchCatalog[4].catalogKey, stripe_price_id: 'price_historical' }
    expect(validateLaunchCheckoutOffering(old, REPOLIGHT_CATALOG_RELEASE_TAG)).toBeNull()
    expect(await listLaunchPurchaseCatalog({ stripeAccount: 'acct_fixture', release: REPOLIGHT_CATALOG_RELEASE_TAG, listOfferings: async () => ({ items: [old] }) })).toEqual([])
    expect(validateLaunchCheckoutOffering(current, REPOLIGHT_CATALOG_RELEASE_TAG)).not.toBeNull()
    for (const items of [[old, current], [current, old]]) {
      const result = await listLaunchPurchaseCatalog({ stripeAccount: 'acct_fixture', release: REPOLIGHT_CATALOG_RELEASE_TAG, listOfferings: async () => ({ items }) })
      expect(result).toHaveLength(1)
      expect(result[0].offeringVersionId).toBe(current.offering_version_id)
    }
  })
  it.each(['unit_amount', 'classroom_limit'] as const)('rejects a changed %s even with the valid catalog key', field => {
    const candidate = offering()
    expect(validateLaunchCheckoutOffering({ ...candidate, [field]: candidate[field] + 1 }, REPOLIGHT_CATALOG_RELEASE_TAG)).toBeNull()
  })
  it('rejects a reused display name or unknown release identity', () => {
    expect(validateLaunchCheckoutOffering({ ...offering(4), plan_key: 'pro' }, REPOLIGHT_CATALOG_RELEASE_TAG)).toBeNull()
    expect(validateLaunchCheckoutOffering({ ...offering(), catalog_key: 'future-release' })).toBeNull()
  })
  it('defaults to the historical release until explicitly switched', async () => {
    const current = offering(4)
    const historical = { ...current, catalog_key: launchCatalog[4].catalogKey }
    expect(validateLaunchCheckoutOffering(historical)).not.toBeNull()
    expect(validateLaunchCheckoutOffering(current)).toBeNull()
    const result = await listLaunchPurchaseCatalog({ stripeAccount: 'acct_fixture', listOfferings: async () => ({ items: [historical, current] }) })
    expect(result).toHaveLength(1)
    expect(result[0].offeringVersionId).toBe(historical.offering_version_id)
  })
  it('does not choose between duplicate available versions arbitrarily', async () => {
    await expect(listLaunchPurchaseCatalog({ stripeAccount: 'acct_fixture', release: REPOLIGHT_CATALOG_RELEASE_TAG,
      listOfferings: async () => ({ items: [offering(), { ...offering(), offering_version_id: offering(1).offering_version_id }] }),
    })).rejects.toThrow('conflicting available versions')
  })
  it('rejects a cross-account catalog before exposing prices', async () => {
    await expect(listLaunchPurchaseCatalog({ stripeAccount: 'acct_other',
      listOfferings: async () => ({ items: [offering()] }),
    })).rejects.toThrow('account mismatch')
  })
})
