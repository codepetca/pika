import { z } from 'zod'
import { getLaunchCatalogVariantByKey } from '@/lib/billing/launch-catalog'
import { CheckoutOfferingSchema, type CheckoutOffering } from '@/lib/server/billing/checkout-contracts'
import type { BillingCatalogItem } from '@/lib/server/billing/purchase-handlers'

/** Match immutable release identity as well as every approved commercial field. */
export function validateLaunchCheckoutOffering(offering: CheckoutOffering): { lookupKey: string } | null {
  const variant = getLaunchCatalogVariantByKey(offering.catalog_key)
  if (!variant || variant.legacyPlan !== offering.plan_key
    || variant.currency !== offering.currency || variant.interval !== offering.interval
    || variant.unitAmountCents !== offering.unit_amount
    || variant.activeClassroomCap !== offering.classroom_limit) return null
  return { lookupKey: variant.catalogKey }
}

export async function listLaunchPurchaseCatalog(input: {
  stripeAccount: string
  listOfferings(): Promise<unknown>
}): Promise<BillingCatalogItem[]> {
  const response = z.object({ items: z.array(CheckoutOfferingSchema).max(100) }).strict()
    .parse(await input.listOfferings())
  const seen = new Set<string>()
  const result: BillingCatalogItem[] = []
  for (const offering of response.items) {
    if (offering.stripe_account !== input.stripeAccount) throw new Error('Billing catalog account mismatch')
    const match = validateLaunchCheckoutOffering(offering)
    if (!match) continue
    if (seen.has(match.lookupKey)) throw new Error('Billing catalog has conflicting available versions')
    seen.add(match.lookupKey)
    const variant = getLaunchCatalogVariantByKey(match.lookupKey)!
    result.push({
      offeringVersionId: offering.offering_version_id,
      plan: variant.plan, name: variant.displayName,
      currency: variant.currency, interval: variant.interval,
      unitAmount: variant.unitAmountCents, classroomLimit: variant.activeClassroomCap,
    })
  }
  return result
}
