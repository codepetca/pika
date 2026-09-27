/**
 * The approved commercial catalog for the initial paid-billing launch.
 *
 * This is deliberately data-only. It identifies offerings independently from
 * any payment provider and does not grant access, reserve AI usage, or enable
 * billing. Provider price IDs and customer-specific purchases belong to the
 * server-side billing boundary.
 */

export const LAUNCH_CATALOG_RELEASE_TAG = 'launch-2026-09-26' as const

export const launchPlanKeys = ['basic', 'pro', 'max'] as const
export type LaunchPlanKey = typeof launchPlanKeys[number]

export const launchLegacyPlanKeys = ['basic', 'plus', 'pro'] as const
export type LaunchLegacyPlanKey = typeof launchLegacyPlanKeys[number]

export const launchCatalogCurrencies = ['usd', 'cad'] as const
export type LaunchCatalogCurrency = typeof launchCatalogCurrencies[number]

export const launchCatalogIntervals = ['month', 'year'] as const
export type LaunchCatalogInterval = typeof launchCatalogIntervals[number]

type ProvisionalMonthlyAiAllowance = Readonly<{
  readonly status: 'provisional'
  readonly reset: 'monthly'
  readonly includedStudentGradingRuns: number
}>

export type LaunchCatalogVariant = Readonly<{
  /** Stable provider-independent key for this exact plan, currency, and interval. */
  readonly catalogKey: string
  readonly releaseTag: typeof LAUNCH_CATALOG_RELEASE_TAG
  /** Catalog identifier only, never a database UUID; shared by a plan's variants. */
  readonly offeringId: string
  /** Catalog identifier only, never a database UUID; unique per immutable price variant. */
  readonly offeringVersionId: string
  readonly plan: LaunchPlanKey
  readonly displayName: 'Basic' | 'Pro' | 'Max'
  readonly legacyPlan: LaunchLegacyPlanKey
  readonly currency: LaunchCatalogCurrency
  readonly interval: LaunchCatalogInterval
  readonly unitAmountCents: number
  readonly activeClassroomCap: number
  /** Metadata only; it is never an entitlement or usage reservation. */
  readonly provisionalMonthlyAiAllowance: ProvisionalMonthlyAiAllowance | null
}>

export const launchTrial = Object.freeze({
  releaseTag: LAUNCH_CATALOG_RELEASE_TAG,
  durationDays: 30,
  plan: 'pro' as const,
  activeClassroomCap: 5,
  provisionalStudentGradingRunsTotal: 30,
  aiAllowanceStatus: 'provisional' as const,
})

const planTerms = Object.freeze({
  basic: Object.freeze({
    displayName: 'Basic' as const,
    legacyPlan: 'basic' as const,
    activeClassroomCap: 2,
    provisionalMonthlyAiAllowance: null,
  }),
  pro: Object.freeze({
    displayName: 'Pro' as const,
    legacyPlan: 'plus' as const,
    activeClassroomCap: 5,
    provisionalMonthlyAiAllowance: Object.freeze({
      status: 'provisional' as const,
      reset: 'monthly' as const,
      includedStudentGradingRuns: 300,
    }),
  }),
  max: Object.freeze({
    displayName: 'Max' as const,
    legacyPlan: 'pro' as const,
    activeClassroomCap: 12,
    provisionalMonthlyAiAllowance: Object.freeze({
      status: 'provisional' as const,
      reset: 'monthly' as const,
      includedStudentGradingRuns: 1_000,
    }),
  }),
})

const pricesCents = Object.freeze({
  basic: Object.freeze({
    usd: Object.freeze({ month: 900, year: 9_900 }),
    cad: Object.freeze({ month: 1_300, year: 13_900 }),
  }),
  pro: Object.freeze({
    usd: Object.freeze({ month: 1_900, year: 19_900 }),
    cad: Object.freeze({ month: 2_700, year: 27_900 }),
  }),
  max: Object.freeze({
    usd: Object.freeze({ month: 3_900, year: 39_900 }),
    cad: Object.freeze({ month: 5_500, year: 55_900 }),
  }),
})

function createVariant(
  plan: LaunchPlanKey,
  currency: LaunchCatalogCurrency,
  interval: LaunchCatalogInterval,
): LaunchCatalogVariant {
  const terms = planTerms[plan]
  return Object.freeze({
    catalogKey: `pika:${LAUNCH_CATALOG_RELEASE_TAG}:${plan}:${currency}:${interval}`,
    releaseTag: LAUNCH_CATALOG_RELEASE_TAG,
    offeringId: `pika:offering:${plan}`,
    offeringVersionId: `pika:offering:${plan}:${LAUNCH_CATALOG_RELEASE_TAG}:${currency}:${interval}`,
    plan,
    displayName: terms.displayName,
    legacyPlan: terms.legacyPlan,
    currency,
    interval,
    unitAmountCents: pricesCents[plan][currency][interval],
    activeClassroomCap: terms.activeClassroomCap,
    provisionalMonthlyAiAllowance: terms.provisionalMonthlyAiAllowance,
  })
}

export const launchCatalog = Object.freeze(
  launchPlanKeys.flatMap((plan) =>
    launchCatalogCurrencies.flatMap((currency) =>
      launchCatalogIntervals.map((interval) => createVariant(plan, currency, interval)),
    ),
  ),
) as readonly LaunchCatalogVariant[]

const catalogBySelection = new Map(
  launchCatalog.map((variant) => [
    `${variant.plan}:${variant.currency}:${variant.interval}`,
    variant,
  ]),
)

const catalogByKey = new Map(launchCatalog.map((variant) => [variant.catalogKey, variant]))

const publicPlanToLegacyPlan = Object.freeze({
  basic: 'basic',
  pro: 'plus',
  max: 'pro',
} as const satisfies Record<LaunchPlanKey, LaunchLegacyPlanKey>)

const legacyPlanToPublicPlan = Object.freeze({
  basic: 'basic',
  plus: 'pro',
  pro: 'max',
} as const satisfies Record<LaunchLegacyPlanKey, LaunchPlanKey>)

function isLaunchPlanKey(value: unknown): value is LaunchPlanKey {
  return typeof value === 'string' && (launchPlanKeys as readonly string[]).includes(value)
}

function isLaunchLegacyPlanKey(value: unknown): value is LaunchLegacyPlanKey {
  return typeof value === 'string' && (launchLegacyPlanKeys as readonly string[]).includes(value)
}

function isLaunchCatalogCurrency(value: unknown): value is LaunchCatalogCurrency {
  return typeof value === 'string' && (launchCatalogCurrencies as readonly string[]).includes(value)
}

function isLaunchCatalogInterval(value: unknown): value is LaunchCatalogInterval {
  return typeof value === 'string' && (launchCatalogIntervals as readonly string[]).includes(value)
}

/** Converts only the explicitly approved launch name mapping. */
export function toLegacyPlanKey(plan: unknown): LaunchLegacyPlanKey | null {
  return isLaunchPlanKey(plan) ? publicPlanToLegacyPlan[plan] : null
}

/** Converts only the explicitly approved legacy runtime mapping. */
export function toLaunchPlanKey(legacyPlan: unknown): LaunchPlanKey | null {
  return isLaunchLegacyPlanKey(legacyPlan) ? legacyPlanToPublicPlan[legacyPlan] : null
}

/** Returns the exact approved launch catalog variant, or null for invalid input. */
export function getLaunchCatalogVariant(
  plan: unknown,
  currency: unknown,
  interval: unknown,
): LaunchCatalogVariant | null {
  if (!isLaunchPlanKey(plan) || !isLaunchCatalogCurrency(currency) || !isLaunchCatalogInterval(interval)) {
    return null
  }
  return catalogBySelection.get(`${plan}:${currency}:${interval}`) ?? null
}

/** Returns the variant for one canonical catalog key, or null for invalid input. */
export function getLaunchCatalogVariantByKey(catalogKey: unknown): LaunchCatalogVariant | null {
  return typeof catalogKey === 'string' ? catalogByKey.get(catalogKey) ?? null : null
}
