import { z } from 'zod'
import { getLaunchCatalogVariantByKey, LAUNCH_CATALOG_RELEASE_TAG, REPOLIGHT_CATALOG_RELEASE_TAG } from '@/lib/billing/launch-catalog'
import { CheckoutOfferingSchema, EXCLUSIVE_TAX_CATALOG_SUFFIX, type CheckoutOffering } from '@/lib/server/billing/checkout-contracts'
import type { BillingCatalogItem } from '@/lib/server/billing/purchase-handlers'

/** Match immutable release identity as well as every approved commercial field. */
export type PurchaseCatalogRelease = typeof LAUNCH_CATALOG_RELEASE_TAG | typeof REPOLIGHT_CATALOG_RELEASE_TAG

function matchLaunchCheckoutVariant(offering: CheckoutOffering, release: PurchaseCatalogRelease, taxMode?: 'stripe_exclusive') {
  if (offering.tax_mode !== taxMode) return null
  const suffix = taxMode === 'stripe_exclusive' ? EXCLUSIVE_TAX_CATALOG_SUFFIX : ''
  if (!offering.catalog_key.endsWith(suffix)) return null
  const variant = getLaunchCatalogVariantByKey(offering.catalog_key.slice(0, offering.catalog_key.length - suffix.length))
  if (!variant || variant.releaseTag !== release || variant.legacyPlan !== offering.plan_key
    || variant.currency !== offering.currency || variant.interval !== offering.interval
    || variant.unitAmountCents !== offering.unit_amount
    || variant.activeClassroomCap !== offering.classroom_limit) return null
  return variant
}

export function validateLaunchCheckoutOffering(offering: CheckoutOffering, release: PurchaseCatalogRelease = LAUNCH_CATALOG_RELEASE_TAG, taxMode?: 'stripe_exclusive'): { lookupKey: string } | null {
  return matchLaunchCheckoutVariant(offering, release, taxMode) ? { lookupKey: offering.catalog_key } : null
}

export async function listLaunchPurchaseCatalog(input: {
  stripeAccount: string
  providerMode?: 'test' | 'live'
  release?: PurchaseCatalogRelease
  taxMode?: 'stripe_exclusive' | 'all'
  listOfferings(): Promise<unknown>
}): Promise<BillingCatalogItem[]> {
  const response = z.object({ items: z.array(CheckoutOfferingSchema).max(100) }).strict()
    .parse(await input.listOfferings())
  const seen = new Set<string>()
  const result = new Map<string, { item: BillingCatalogItem; isCurrent: boolean }>()
  for (const offering of response.items) {
    if (offering.stripe_account !== input.stripeAccount) throw new Error('Billing catalog account mismatch')
    if ((offering.provider_mode ?? 'test') !== (input.providerMode ?? 'test')) throw new Error('Billing catalog mode mismatch')
    const variant = matchLaunchCheckoutVariant(offering, input.release ?? LAUNCH_CATALOG_RELEASE_TAG,
      input.taxMode === 'all' ? offering.tax_mode : input.taxMode)
    if (!variant) continue
    if (seen.has(offering.catalog_key)) throw new Error('Billing catalog has conflicting available versions')
    seen.add(offering.catalog_key)
    const selection = `${variant.plan}:${variant.currency}:${variant.interval}`
    const isCurrent = variant.releaseTag === REPOLIGHT_CATALOG_RELEASE_TAG
    const existing = result.get(selection)
    if (existing && (existing.isCurrent || !isCurrent)) continue
    result.set(selection, { isCurrent, item: {
      offeringVersionId: offering.offering_version_id,
      plan: variant.plan, name: variant.displayName,
      currency: variant.currency, interval: variant.interval,
      unitAmount: variant.unitAmountCents, classroomLimit: variant.activeClassroomCap,
    } })
  }
  return [...result.values()].map(entry => entry.item)
}
