import Stripe from 'stripe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getServiceRoleClient } from '@/lib/supabase'
import { acceptBillingWebhook } from '@/lib/server/billing/webhook'
import {
  createBillingRuntime,
  createStripeBillingReadPort,
  STRIPE_BILLING_API_VERSION,
} from '@/lib/server/billing/runtime'
import { createTargetBoundFetch } from '@/lib/server/supabase-target'

const config = {
  secretKey: 'sk_test_runtime_fixture',
  webhookSecret: 'whsec_runtime_fixture',
  stripeAccount: 'acct_fixture',
  workerSecret: 'a-worker-secret-containing-at-least-32-characters',
  supabaseOrigin: 'http://127.0.0.1:54321',
} as const

const event = {
  id: 'evt_runtime_fixture',
  type: 'invoice.paid',
  livemode: false,
  created: 1_800_000_000,
  data: {
    object: {
      id: 'in_runtime_fixture',
      customer: 'cus_runtime_fixture',
      parent: { subscription_details: { subscription: 'sub_runtime_fixture' } },
    },
  },
}

function signedHeader(payload: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const stripe = new Stripe(config.secretKey, { apiVersion: STRIPE_BILLING_API_VERSION })
  return stripe.webhooks.generateTestHeaderString({
    payload,
    secret: config.webhookSecret,
    timestamp,
  })
}

describe('Stripe billing runtime', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', config.supabaseOrigin)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_runtime_fixture')
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_runtime_fixture')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('pins the SDK version and verifies an official signed raw webhook payload', () => {
    const raw = Buffer.from(JSON.stringify(event))
    const runtime = createBillingRuntime(config)

    expect(runtime.verify(raw, signedHeader(raw.toString()))).toMatchObject(event)
  })

  it('uses the SDK default timestamp tolerance and rejects stale or changed signed payloads', () => {
    const raw = Buffer.from(JSON.stringify(event))
    const runtime = createBillingRuntime(config)
    const signature = signedHeader(raw.toString())

    expect(() => runtime.verify(raw, signedHeader(raw.toString(), Math.floor(Date.now() / 1000) - 301)))
      .toThrow()
    expect(() => runtime.verify(Buffer.from(`${raw.toString()} `), signature)).toThrow()
  })

  it('adapts the SDK current-account selector and expands optional invoice payments', async () => {
    const stripe = {
      accounts: { retrieve: vi.fn().mockResolvedValue({ id: config.stripeAccount }) },
      subscriptions: { retrieve: vi.fn() },
      invoices: { retrieve: vi.fn().mockResolvedValue({ id: 'in_runtime_fixture' }) },
      paymentIntents: { retrieve: vi.fn() },
      charges: { retrieve: vi.fn() },
    } as unknown as Stripe
    const port = createStripeBillingReadPort(stripe)

    await port.accounts.retrieve()
    await port.invoices.retrieve('in_runtime_fixture')

    expect(stripe.accounts.retrieve).toHaveBeenCalledWith(null)
    expect(stripe.invoices.retrieve).toHaveBeenCalledWith('in_runtime_fixture', {
      expand: ['payments'],
    })
  })

  it('rejects missing signatures before the runtime persists anything', async () => {
    const raw = Buffer.from(JSON.stringify(event))
    const runtime = createBillingRuntime(config)
    const record = vi.fn()

    await expect(acceptBillingWebhook({
      raw,
      signature: null,
      stripeAccount: config.stripeAccount,
      verify: runtime.verify,
      record,
    })).rejects.toThrow('Invalid Stripe signature')
    expect(record).not.toHaveBeenCalled()
  })

  it('uses the target-bound fetcher for the generated Supabase RPC client', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', {
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch
    const client = getServiceRoleClient({
      fetch: createTargetBoundFetch(config.supabaseOrigin, fetcher),
    })

    await client.rpc('billing_list_work_v1', { p_request: { limit: 1 } })

    expect(fetcher).toHaveBeenCalledWith(
      expect.stringMatching(/^http:\/\/127\.0\.0\.1:54321\//),
      expect.objectContaining({ redirect: 'manual' }),
    )
  })

  it('blocks a direct hosted target and rejects redirect responses', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'https://hosted.example.test' },
    })) as unknown as typeof fetch
    const targetBoundFetch = createTargetBoundFetch(config.supabaseOrigin, fetcher)

    await expect(targetBoundFetch('https://hosted.example.test/rest/v1/rpc')).rejects
      .toThrow('Supabase request escaped the validated project origin')
    await expect(targetBoundFetch('http://127.0.0.1:54321/rest/v1/rpc')).rejects
      .toThrow('Supabase request redirect was rejected')

    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:54321/rest/v1/rpc',
      expect.objectContaining({ redirect: 'manual' }),
    )
  })
})
