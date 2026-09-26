import { describe, expect, it } from 'vitest'
import {
  LAUNCH_CATALOG_RELEASE_TAG,
  getLaunchCatalogVariant,
  getLaunchCatalogVariantByKey,
  launchCatalog,
  launchTrial,
  toLaunchPlanKey,
  toLegacyPlanKey,
} from '@/lib/billing/launch-catalog'

const expectedPrices = {
  basic: { usd: { month: 900, year: 9_900 }, cad: { month: 1_300, year: 13_900 } },
  pro: { usd: { month: 1_900, year: 19_900 }, cad: { month: 2_700, year: 27_900 } },
  max: { usd: { month: 3_900, year: 39_900 }, cad: { month: 5_500, year: 55_900 } },
} as const

describe('launch catalog', () => {
  it('publishes the complete approved plan, currency, and interval matrix', () => {
    expect(launchCatalog).toHaveLength(12)
    expect(new Set(launchCatalog.map((variant) => variant.catalogKey)).size).toBe(12)
    expect(new Set(launchCatalog.map((variant) => variant.offeringVersionId)).size).toBe(12)

    for (const [plan, currencyPrices] of Object.entries(expectedPrices)) {
      for (const [currency, intervalPrices] of Object.entries(currencyPrices)) {
        for (const [interval, unitAmountCents] of Object.entries(intervalPrices)) {
          const variant = getLaunchCatalogVariant(plan, currency, interval)
          expect(variant).toMatchObject({
            catalogKey: `pika:${LAUNCH_CATALOG_RELEASE_TAG}:${plan}:${currency}:${interval}`,
            releaseTag: LAUNCH_CATALOG_RELEASE_TAG,
            offeringId: `pika:offering:${plan}`,
            offeringVersionId: `pika:offering:${plan}:${LAUNCH_CATALOG_RELEASE_TAG}:${currency}:${interval}`,
            plan,
            currency,
            interval,
            unitAmountCents,
          })
        }
      }
    }
  })

  it('uses provider-independent catalog identifiers rather than database UUIDs', () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    for (const variant of launchCatalog) {
      expect(variant.offeringId).toMatch(/^pika:offering:/)
      expect(variant.offeringId).not.toMatch(uuid)
      expect(variant.offeringVersionId).toMatch(/^pika:offering:/)
      expect(variant.offeringVersionId).not.toMatch(uuid)
    }
  })

  it('uses the approved classroom caps and explicit legacy-name mapping', () => {
    expect(getLaunchCatalogVariant('basic', 'usd', 'month')).toMatchObject({
      activeClassroomCap: 2,
      displayName: 'Basic',
      legacyPlan: 'basic',
    })
    expect(getLaunchCatalogVariant('pro', 'usd', 'month')).toMatchObject({
      activeClassroomCap: 5,
      displayName: 'Pro',
      legacyPlan: 'plus',
    })
    expect(getLaunchCatalogVariant('max', 'usd', 'month')).toMatchObject({
      activeClassroomCap: 12,
      displayName: 'Max',
      legacyPlan: 'pro',
    })
  })

  it('looks up an offering only by its exact canonical catalog key', () => {
    const variant = getLaunchCatalogVariant('max', 'cad', 'year')
    expect(getLaunchCatalogVariantByKey(variant?.catalogKey)).toBe(variant)
    expect(getLaunchCatalogVariantByKey(`pika:${LAUNCH_CATALOG_RELEASE_TAG}:max:cad:year:stripe`)).toBeNull()
    expect(getLaunchCatalogVariantByKey(null)).toBeNull()
  })

  it('does not confuse the legacy pro key with the launch Pro offering', () => {
    expect(toLegacyPlanKey('pro')).toBe('plus')
    expect(toLaunchPlanKey('plus')).toBe('pro')
    expect(toLaunchPlanKey('pro')).toBe('max')
  })

  it('keeps candidate AI quantities as provisional catalog metadata only', () => {
    expect(getLaunchCatalogVariant('basic', 'cad', 'year')?.provisionalMonthlyAiAllowance).toBeNull()
    expect(getLaunchCatalogVariant('pro', 'cad', 'year')?.provisionalMonthlyAiAllowance).toEqual({
      status: 'provisional', reset: 'monthly', includedStudentGradingRuns: 300,
    })
    expect(getLaunchCatalogVariant('max', 'usd', 'month')?.provisionalMonthlyAiAllowance).toEqual({
      status: 'provisional', reset: 'monthly', includedStudentGradingRuns: 1_000,
    })
  })

  it('records the isolated 30-day Pro trial with a total provisional allowance', () => {
    expect(launchTrial).toEqual({
      releaseTag: LAUNCH_CATALOG_RELEASE_TAG,
      durationDays: 30,
      plan: 'pro',
      activeClassroomCap: 5,
      provisionalStudentGradingRunsTotal: 30,
      aiAllowanceStatus: 'provisional',
    })
  })

  it.each([
    ['free', 'usd', 'month'],
    ['pro', 'eur', 'month'],
    ['pro', 'usd', 'week'],
    ['pro', null, 'month'],
    [null, 'usd', 'month'],
    ['max', 'cad', undefined],
  ])('fails closed for unsupported lookup input %j, %j, %j', (plan, currency, interval) => {
    expect(getLaunchCatalogVariant(plan, currency, interval)).toBeNull()
  })

  it.each([null, undefined, '', 'free', 'Plus', 'MAX', 1])('fails closed for invalid public plan %j', (plan) => {
    expect(toLegacyPlanKey(plan)).toBeNull()
  })

  it.each([null, undefined, '', 'free', 'Basic', 'PLUS', 1])('fails closed for invalid legacy plan %j', (plan) => {
    expect(toLaunchPlanKey(plan)).toBeNull()
  })
})
