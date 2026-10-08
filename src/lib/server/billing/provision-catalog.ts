import Stripe from 'stripe'
import {
  LAUNCH_CATALOG_RELEASE_TAG,
  launchCatalog,
  launchPlanKeys,
  type LaunchCatalogVariant,
  type LaunchPlanKey,
} from '@/lib/billing/launch-catalog'
import { readBillingSandboxConfig } from '@/lib/server/billing/config'
import type { Json } from '@/types/database.generated'

type StripeCatalogProduct = Readonly<{
  id: string
  name: string
  active: boolean
  livemode: boolean
}>

type StripeCatalogPrice = Readonly<{
  id: string
  active: boolean
  livemode: boolean
  lookup_key: string | null
  product: string
  currency: string
  unit_amount: number | null
  billing_scheme: string
  type: string
  recurring: Readonly<{ interval: string; interval_count: number; usage_type: string }> | null
  currency_options?: Readonly<Record<string, unknown>>
  custom_unit_amount: unknown
  tiers_mode: unknown
  transform_quantity: unknown
}>

export type BillingOfferingRegistration = Readonly<{
  plan_key: 'basic' | 'plus' | 'pro'
  version: number
  stripe_account: string
  provider_mode: 'test'
  stripe_product_id: string
  stripe_price_id: string
  currency: 'usd' | 'cad'
  unit_amount: number
  interval: 'month' | 'year'
  classroom_limit: number
  features: Readonly<{
    catalog_key: string
    display_name: string
    release_tag: typeof LAUNCH_CATALOG_RELEASE_TAG
  }>
  ai_definition: null
  availability: Readonly<{ is_available: boolean }>
}>

export type StripeCatalogProvisioningPorts = Readonly<{
  retrieveAccount(): Promise<unknown>
  retrieveProduct(productId: string): Promise<unknown>
  listPricesByLookupKey(lookupKey: string): Promise<Readonly<{
    data: readonly unknown[]
    hasMore: boolean
  }>>
  createPrice(params: Stripe.PriceCreateParams, idempotencyKey: string): Promise<unknown>
  registerOffering(request: BillingOfferingRegistration): Promise<unknown>
}>

export type BillingCatalogRpcClient = Readonly<{
  rpc(name: 'billing_register_offering_v1', args: { p_request: Json }): PromiseLike<{
    data: unknown
    error: unknown
  }>
}>

export type CatalogProductIds = Readonly<Record<LaunchPlanKey, string>>

export type LaunchCatalogProvisioningBinding = Readonly<{
  catalogKey: string
  offeringVersionCatalogId: string
  stripeProductId: string
  stripePriceId: string
  offeringId: string
  offeringVersionId: string
}>

export type LaunchCatalogProvisioningResult = Readonly<{
  releaseTag: typeof LAUNCH_CATALOG_RELEASE_TAG
  bindings: readonly LaunchCatalogProvisioningBinding[]
}>

export class CatalogProvisioningError extends Error {
  constructor(readonly code: string) {
    super('Billing catalog provisioning could not be completed')
  }
}

const productIdPattern = /^prod_[A-Za-z0-9]+$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const maximumBillingOfferingVersion = 2_147_483_647
const versionOffsets = Object.freeze({
  'usd:month': 0,
  'usd:year': 1,
  'cad:month': 2,
  'cad:year': 3,
} as const)

function fail(code: string): never {
  throw new CatalogProvisioningError(code)
}

function noProviderDetails<T>(call: () => Promise<T>): Promise<T> {
  return call().catch(() => fail('provider_unavailable'))
}

function safeConfig(env: NodeJS.ProcessEnv): ReturnType<typeof readBillingSandboxConfig> {
  try {
    return readBillingSandboxConfig(env)
  } catch {
    return fail('sandbox_invalid')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function productFrom(value: unknown): StripeCatalogProduct | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string'
    || typeof value.active !== 'boolean' || typeof value.livemode !== 'boolean') return null
  return value as StripeCatalogProduct
}

function productIdFromPrice(value: unknown): string | null {
  if (typeof value === 'string') return value
  return isRecord(value) && typeof value.id === 'string' ? value.id : null
}

function priceFrom(value: unknown): StripeCatalogPrice | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.active !== 'boolean'
    || typeof value.livemode !== 'boolean' || (value.lookup_key !== null && typeof value.lookup_key !== 'string')
    || typeof value.currency !== 'string' || (value.unit_amount !== null && typeof value.unit_amount !== 'number')
    || typeof value.billing_scheme !== 'string' || typeof value.type !== 'string') return null
  const product = productIdFromPrice(value.product)
  const recurring = value.recurring
  if (value.currency_options !== undefined && !isRecord(value.currency_options)) return null
  if (!product || (recurring !== null && (!isRecord(recurring) || typeof recurring.interval !== 'string'
    || typeof recurring.interval_count !== 'number' || typeof recurring.usage_type !== 'string'))) return null
  return {
    id: value.id, active: value.active, livemode: value.livemode, lookup_key: value.lookup_key,
    product, currency: value.currency, unit_amount: value.unit_amount, billing_scheme: value.billing_scheme,
    type: value.type, recurring: recurring as StripeCatalogPrice['recurring'],
    currency_options: isRecord(value.currency_options) ? value.currency_options : undefined,
    custom_unit_amount: value.custom_unit_amount, tiers_mode: value.tiers_mode,
    transform_quantity: value.transform_quantity,
  }
}

function registrationFrom(value: unknown): { offeringId: string; offeringVersionId: string } | null {
  if (!isRecord(value) || typeof value.offering_id !== 'string' || typeof value.offering_version_id !== 'string'
    || !uuidPattern.test(value.offering_id) || !uuidPattern.test(value.offering_version_id)) return null
  return { offeringId: value.offering_id, offeringVersionId: value.offering_version_id }
}

function checkedProductIds(value: unknown): CatalogProductIds {
  if (!isRecord(value) || Object.keys(value).length !== launchPlanKeys.length) fail('product_mapping_invalid')
  const ids = {} as Record<LaunchPlanKey, string>
  for (const plan of launchPlanKeys) {
    const id = value[plan]
    if (typeof id !== 'string' || !productIdPattern.test(id)) fail('product_mapping_invalid')
    ids[plan] = id
  }
  if (new Set(Object.values(ids)).size !== launchPlanKeys.length) fail('product_mapping_invalid')
  return Object.freeze(ids)
}

function checkedReleaseVersionBase(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1
    || (value as number) > maximumBillingOfferingVersion - 3) {
    return fail('release_version_invalid')
  }
  return value as number
}

function checkedPublish(value: unknown): boolean {
  if (value === undefined) return false
  return typeof value === 'boolean' ? value : fail('publish_invalid')
}

function versionFor(variant: LaunchCatalogVariant, releaseVersionBase: number): number {
  return releaseVersionBase + versionOffsets[`${variant.currency}:${variant.interval}`]
}

function assertCatalogShape(): void {
  if (launchCatalog.length !== 12 || new Set(launchCatalog.map(variant => variant.catalogKey)).size !== 12
    || new Set(launchCatalog.map(variant => variant.offeringVersionId)).size !== 12) fail('catalog_invalid')
}

function assertProduct(product: unknown, variant: LaunchCatalogVariant, expectedId: string): void {
  const parsed = productFrom(product)
  if (!parsed || parsed.id !== expectedId || !parsed.active || parsed.livemode || parsed.name !== variant.displayName) {
    fail('product_invalid')
  }
}

function assertPrice(value: unknown, variant: LaunchCatalogVariant, productId: string): StripeCatalogPrice {
  const price = priceFrom(value)
  if (!price || !price.active || price.livemode || price.lookup_key !== variant.catalogKey
    || price.product !== productId || price.currency !== variant.currency || price.unit_amount !== variant.unitAmountCents
    || price.billing_scheme !== 'per_unit' || price.type !== 'recurring' || !price.recurring
    || price.recurring.interval !== variant.interval || price.recurring.interval_count !== 1
    || price.recurring.usage_type !== 'licensed' || price.custom_unit_amount !== null
    || price.tiers_mode !== null || price.transform_quantity !== null
    || (price.currency_options !== undefined && Object.keys(price.currency_options).length > 0)) fail('price_invalid')
  return price
}

function registrationFor(
  variant: LaunchCatalogVariant,
  stripeAccount: string,
  stripeProductId: string,
  stripePriceId: string,
  releaseVersionBase: number,
  publish: boolean,
): BillingOfferingRegistration {
  return {
    plan_key: variant.legacyPlan,
    version: versionFor(variant, releaseVersionBase),
    stripe_account: stripeAccount,
    provider_mode: 'test',
    stripe_product_id: stripeProductId,
    stripe_price_id: stripePriceId,
    currency: variant.currency,
    unit_amount: variant.unitAmountCents,
    interval: variant.interval,
    classroom_limit: variant.activeClassroomCap,
    features: {
      catalog_key: variant.catalogKey,
      display_name: variant.displayName,
      release_tag: LAUNCH_CATALOG_RELEASE_TAG,
    },
    ai_definition: null,
    availability: { is_available: publish },
  }
}

async function ensurePrice(
  ports: StripeCatalogProvisioningPorts,
  variant: LaunchCatalogVariant,
  productId: string,
): Promise<StripeCatalogPrice> {
  const listed = await noProviderDetails(() => ports.listPricesByLookupKey(variant.catalogKey))
  if (!isRecord(listed) || !Array.isArray(listed.data) || listed.hasMore !== false) fail('price_ambiguous')
  if (listed.data.length > 1) fail('price_ambiguous')
  if (listed.data.length === 1) return assertPrice(listed.data[0], variant, productId)

  const created = await noProviderDetails(() => ports.createPrice({
    active: true,
    billing_scheme: 'per_unit',
    currency: variant.currency,
    lookup_key: variant.catalogKey,
    product: productId,
    recurring: { interval: variant.interval, interval_count: 1, usage_type: 'licensed' },
    transfer_lookup_key: false,
    unit_amount: variant.unitAmountCents,
  }, `pika-catalog:${variant.offeringVersionId}`))
  return assertPrice(created, variant, productId)
}

/** Builds the real Stripe SDK adapter; callers supply the database registration port. */
export function createStripeCatalogProvisioningPorts(
  stripe: Stripe,
  registerOffering: StripeCatalogProvisioningPorts['registerOffering'],
): StripeCatalogProvisioningPorts {
  return {
    retrieveAccount: () => stripe.accounts.retrieve(null),
    retrieveProduct: productId => stripe.products.retrieve(productId),
    async listPricesByLookupKey(lookupKey) {
      const [active, inactive] = await Promise.all([
        stripe.prices.list({ active: true, lookup_keys: [lookupKey], limit: 100 }),
        stripe.prices.list({ active: false, lookup_keys: [lookupKey], limit: 100 }),
      ])
      return { data: [...active.data, ...inactive.data], hasMore: active.has_more || inactive.has_more }
    },
    createPrice: (params, idempotencyKey) => stripe.prices.create(params, { idempotencyKey }),
    registerOffering,
  }
}

/** Supplies the existing immutable offering RPC as a narrowly scoped port. */
export function createBillingCatalogRegistrationPort(client: BillingCatalogRpcClient) {
  return async (request: BillingOfferingRegistration): Promise<unknown> => {
    try {
      const { data, error } = await client.rpc('billing_register_offering_v1', { p_request: request as Json })
      if (error) fail('registration_unavailable')
      return data
    } catch (error) {
      if (error instanceof CatalogProvisioningError) throw error
      return fail('registration_unavailable')
    }
  }
}

/**
 * Provisions only the approved test catalog. It cannot enable billing; offering
 * availability remains false unless an explicit caller requests publication.
 * The existing immutable registration RPC applies that flag only while creating
 * a version; it never changes an already registered version's availability.
 */
export async function provisionLaunchCatalog(input: Readonly<{
  ports: StripeCatalogProvisioningPorts
  productIds: unknown
  releaseVersionBase: unknown
  /** Applied only when the immutable database version is first registered. */
  publish?: unknown
  env?: NodeJS.ProcessEnv
}>): Promise<LaunchCatalogProvisioningResult> {
  const config = safeConfig(input.env ?? process.env)
  if (!config) fail('sandbox_disabled')
  const productIds = checkedProductIds(input.productIds)
  const releaseVersionBase = checkedReleaseVersionBase(input.releaseVersionBase)
  const publish = checkedPublish(input.publish)
  assertCatalogShape()

  const account = await noProviderDetails(() => input.ports.retrieveAccount())
  if (!isRecord(account) || account.id !== config.stripeAccount) fail('stripe_account_invalid')

  for (const plan of launchPlanKeys) {
    const variant = launchCatalog.find(item => item.plan === plan)
    if (!variant) fail('catalog_invalid')
    const product = await noProviderDetails(() => input.ports.retrieveProduct(productIds[plan]))
    assertProduct(product, variant, productIds[plan])
  }

  const bindings: LaunchCatalogProvisioningBinding[] = []
  for (const variant of launchCatalog) {
    const stripeProductId = productIds[variant.plan]
    const price = await ensurePrice(input.ports, variant, stripeProductId)
    const registration = await noProviderDetails(() => input.ports.registerOffering(registrationFor(
      variant, config.stripeAccount, stripeProductId, price.id, releaseVersionBase, publish,
    )))
    const registered = registrationFrom(registration)
    if (!registered) fail('registration_invalid')
    bindings.push(Object.freeze({
      catalogKey: variant.catalogKey,
      offeringVersionCatalogId: variant.offeringVersionId,
      stripeProductId,
      stripePriceId: price.id,
      offeringId: registered.offeringId,
      offeringVersionId: registered.offeringVersionId,
    }))
  }
  return Object.freeze({ releaseTag: LAUNCH_CATALOG_RELEASE_TAG, bindings: Object.freeze(bindings) })
}
