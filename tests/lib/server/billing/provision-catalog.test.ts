import { describe, expect, it, vi } from 'vitest'
import { launchCatalog } from '@/lib/billing/launch-catalog'
import {
  CatalogProvisioningError,
  provisionLaunchCatalog,
  type BillingOfferingRegistration,
  type StripeCatalogProvisioningPorts,
} from '@/lib/server/billing/provision-catalog'

const env = {
  BILLING_SANDBOX_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'sk_test_fixture',
  STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
  STRIPE_ACCOUNT_ID: 'acct_fixture',
  BILLING_WORKER_SECRET: 'fixture-worker-secret-at-least-32-characters',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
}

const productIds = { basic: 'prod_basic', pro: 'prod_pro', max: 'prod_max' } as const
const dbId = (index: number) => `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`

function priceFor(variant = launchCatalog[0], active = true) {
  return {
    id: `price_${variant.plan}_${variant.currency}_${variant.interval}`,
    active, livemode: false, lookup_key: variant.catalogKey, product: productIds[variant.plan],
    currency: variant.currency, unit_amount: variant.unitAmountCents, billing_scheme: 'per_unit', type: 'recurring',
    recurring: { interval: variant.interval, interval_count: 1, usage_type: 'licensed' },
    custom_unit_amount: null, tiers_mode: null, transform_quantity: null,
  }
}

function fixture() {
  const prices = new Map<string, ReturnType<typeof priceFor>[]>()
  const registrations: BillingOfferingRegistration[] = []
  const ports: StripeCatalogProvisioningPorts = {
    retrieveAccount: vi.fn().mockResolvedValue({ id: 'acct_fixture' }),
    retrieveProduct: vi.fn().mockImplementation(async (id: string) => {
      const plan = (Object.keys(productIds) as Array<keyof typeof productIds>).find(key => productIds[key] === id)
      if (!plan) return { id, name: 'Unknown', active: true, livemode: false }
      return { id, name: ({ basic: 'Basic', pro: 'Pro', max: 'Max' } as const)[plan], active: true, livemode: false }
    }),
    listPricesByLookupKey: vi.fn().mockImplementation(async (lookupKey: string) => ({
      data: prices.get(lookupKey) ?? [], hasMore: false,
    })),
    createPrice: vi.fn().mockImplementation(async (params: Record<string, unknown>) => {
      const variant = launchCatalog.find(item => item.catalogKey === params.lookup_key)
      if (!variant) throw new Error('unexpected fixture')
      const price = priceFor(variant)
      prices.set(variant.catalogKey, [price])
      return price
    }),
    registerOffering: vi.fn().mockImplementation(async (request: BillingOfferingRegistration) => {
      registrations.push(request)
      const index = registrations.length
      return { offering_id: dbId(index), offering_version_id: dbId(index + 100) }
    }),
  }
  return { ports, prices, registrations }
}

async function provision(ports: StripeCatalogProvisioningPorts, overrides: Record<string, unknown> = {}) {
  return provisionLaunchCatalog({ ports, productIds, releaseVersionBase: 20, env, ...overrides })
}

describe('test-only launch catalog provisioning', () => {
  it('creates and registers exactly the fixed twelve-variant catalog as unavailable', async () => {
    const { ports, registrations } = fixture()
    const result = await provision(ports)

    expect(result.bindings).toHaveLength(12)
    expect(new Set(result.bindings.map(item => item.offeringVersionCatalogId)).size).toBe(12)
    expect(ports.retrieveAccount).toHaveBeenCalledTimes(1)
    expect(ports.retrieveProduct).toHaveBeenCalledTimes(3)
    expect(ports.createPrice).toHaveBeenCalledTimes(12)
    expect(ports.registerOffering).toHaveBeenCalledTimes(12)
    expect(registrations.map(request => request.version)).toEqual([
      20, 21, 22, 23, 20, 21, 22, 23, 20, 21, 22, 23,
    ])
    expect(registrations.every(request => request.availability.is_available === false)).toBe(true)
    expect(registrations.every(request => request.ai_definition === null)).toBe(true)
    expect(registrations[0].features).toEqual({
      catalog_key: launchCatalog[0].catalogKey,
      display_name: 'Basic',
      release_tag: 'launch-2026-09-26',
    })
    expect(ports.createPrice).toHaveBeenCalledWith(expect.objectContaining({
      active: true, billing_scheme: 'per_unit', currency: 'usd', lookup_key: launchCatalog[0].catalogKey,
      product: 'prod_basic', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
      transfer_lookup_key: false,
      unit_amount: 900,
    }), `pika-catalog:${launchCatalog[0].offeringVersionId}`)
  })

  it('reuses an exact verified price after a database registration failure', async () => {
    const { ports } = fixture()
    const register = ports.registerOffering as ReturnType<typeof vi.fn>
    register.mockRejectedValueOnce(new Error('database private detail'))
    await expect(provision(ports)).rejects.toMatchObject({ code: 'provider_unavailable' })
    expect(ports.createPrice).toHaveBeenCalledTimes(1)

    await provision(ports)
    expect(ports.createPrice).toHaveBeenCalledTimes(12)
  })

  it('refuses invalid sandbox state before retrieving products or writing', async () => {
    const { ports } = fixture()
    await expect(provision(ports, { env: { ...env, STRIPE_SECRET_KEY: 'sk_live_fixture' } }))
      .rejects.toMatchObject({ code: 'sandbox_invalid' })
    expect(ports.retrieveAccount).not.toHaveBeenCalled()
    expect(ports.createPrice).not.toHaveBeenCalled()
  })

  it.each([
    ['wrong account', (ports: StripeCatalogProvisioningPorts) => {
      ;(ports.retrieveAccount as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'acct_other' })
    }, 'stripe_account_invalid'],
    ['live product', (ports: StripeCatalogProvisioningPorts) => {
      ;(ports.retrieveProduct as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prod_basic', name: 'Basic', active: true, livemode: true,
      })
    }, 'product_invalid'],
  ])('rejects %s before price creation', async (_name, change, code) => {
    const { ports } = fixture()
    change(ports)
    await expect(provision(ports)).rejects.toMatchObject({ code })
    expect(ports.createPrice).not.toHaveBeenCalled()
  })

  it.each([
    ['wrong amount', (price: Record<string, unknown>) => { price.unit_amount = 1 }],
    ['wrong product', (price: Record<string, unknown>) => { price.product = 'prod_other' }],
    ['wrong interval', (price: Record<string, unknown>) => { (price.recurring as Record<string, unknown>).interval = 'year' }],
    ['live price', (price: Record<string, unknown>) => { price.livemode = true }],
  ])('rejects an existing %s without creating a replacement', async (_name, change) => {
    const { ports, prices } = fixture()
    const price = priceFor() as Record<string, unknown>
    change(price)
    prices.set(launchCatalog[0].catalogKey, [price as ReturnType<typeof priceFor>])
    await expect(provision(ports)).rejects.toMatchObject({ code: 'price_invalid' })
    expect(ports.createPrice).not.toHaveBeenCalled()
  })

  it.each(['duplicate', 'inactive'])('does not reuse an ambiguous or inactive price', async kind => {
    const { ports, prices } = fixture()
    const first = priceFor()
    prices.set(launchCatalog[0].catalogKey, kind === 'duplicate'
      ? [first, { ...first, id: 'price_duplicate' }]
      : [priceFor(launchCatalog[0], false)])
    await expect(provision(ports)).rejects.toMatchObject({ code: kind === 'duplicate' ? 'price_ambiguous' : 'price_invalid' })
    expect(ports.createPrice).not.toHaveBeenCalled()
  })

  it('publishes only when the caller explicitly requests it', async () => {
    const { ports, registrations } = fixture()
    await provision(ports, { publish: true })
    expect(registrations.every(request => request.availability.is_available)).toBe(true)
  })

  it('rejects malformed product mappings and release version bases before writes', async () => {
    const { ports } = fixture()
    await expect(provision(ports, { productIds: { basic: 'prod_basic', pro: 'prod_pro', max: 'prod_pro' } }))
      .rejects.toMatchObject({ code: 'product_mapping_invalid' })
    await expect(provision(ports, { releaseVersionBase: 0 })).rejects.toMatchObject({ code: 'release_version_invalid' })
    await expect(provision(ports, { releaseVersionBase: 2_147_483_645 }))
      .rejects.toMatchObject({ code: 'release_version_invalid' })
    expect(ports.retrieveAccount).not.toHaveBeenCalled()
    expect(ports.createPrice).not.toHaveBeenCalled()
  })

  it('does not expose provider failure details', async () => {
    const { ports } = fixture()
    ;(ports.retrieveAccount as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('sk_test_private'))
    await expect(provision(ports)).rejects.toEqual(new CatalogProvisioningError('provider_unavailable'))
  })
})
