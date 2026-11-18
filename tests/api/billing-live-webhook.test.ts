import { NextRequest } from 'next/server'
import Stripe from 'stripe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn(), response: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.client }))

import { POST } from '@/app/api/billing/stripe/live/webhook/route'

const projectRef = 'zhioqbapgfcrronyuidm'
const stripeAccount = 'acct_LiveReceiptFixture'
const origin = 'https://pika.codepet.ca'
const secret = 'whsec_LiveSigningSecretFixture'
const context = { params: Promise.resolve({}) }
const invoice = { id: 'in_Fixture', livemode: true, customer: 'cus_Fixture', subscription: 'sub_Fixture' }
const event = {
  id: 'evt_Fixture', object: 'event', livemode: true, type: 'invoice.paid', created: 1794160000,
  data: { object: invoice },
}

function request(payload = JSON.stringify(event), signingSecret = secret) {
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: signingSecret })
  return new NextRequest(`${origin}/api/billing/stripe/live/webhook`, {
    method: 'POST', body: payload, headers: { 'stripe-signature': signature },
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  for (const [name, value] of Object.entries({
    BILLING_LIVE_WEBHOOK_ENABLED: 'true', BILLING_SANDBOX_ENABLED: 'false',
    VERCEL: '1', VERCEL_ENV: 'production', VERCEL_TARGET_ENV: 'production',
    NEXT_PUBLIC_APP_URL: origin, NEXT_PUBLIC_SUPABASE_URL: `https://${projectRef}.supabase.co`,
    STRIPE_LIVE_ACCOUNT_ID: stripeAccount, STRIPE_LIVE_WEBHOOK_SECRET: secret,
    STRIPE_WEBHOOK_SECRET: 'whsec_SandboxSigningSecretFixture',
  })) vi.stubEnv(name, value)
  mocks.client.mockReturnValue({ rpc: mocks.rpc })
  mocks.rpc.mockReturnValue({ abortSignal: mocks.response })
})

afterEach(() => vi.unstubAllEnvs())

describe('live Stripe webhook', () => {
  it('defaults off before constructing a database client', async () => {
    vi.stubEnv('BILLING_LIVE_WEBHOOK_ENABLED', undefined)
    expect((await POST(request(), context)).status).toBe(404)
    expect(mocks.client).not.toHaveBeenCalled()
  })

  it.each([
    ['VERCEL_ENV', 'preview'],
    ['BILLING_SANDBOX_ENABLED', 'true'],
    ['NEXT_PUBLIC_SUPABASE_URL', 'https://untrusted.example'],
    ['STRIPE_WEBHOOK_SECRET', secret],
  ])('fails closed with invalid %s', async (name, value) => {
    vi.stubEnv(name, value)
    expect((await POST(request(), context)).status).toBe(500)
    expect(mocks.client).not.toHaveBeenCalled()
  })

  it.each([
    [{ ...event, livemode: false }, secret],
    [{ ...event, data: { object: { ...invoice, livemode: false } } }, secret],
    [{ ...event, account: stripeAccount }, secret],
    [{ ...event, context: 'acct_Organization' }, secret],
    [event, 'whsec_wrongSignatureFixture'],
  ])('rejects mixed-mode, delegated or incorrectly signed deliveries', async (payload, signingSecret) => {
    expect((await POST(request(JSON.stringify(payload), signingSecret), context)).status).toBe(400)
    expect(mocks.client).not.toHaveBeenCalled()
  })

  it.each(['accepted', 'duplicate'])('acknowledges only a confirmed %s receipt on the pinned target', async status => {
    mocks.response.mockResolvedValue({ data: { status, event_inbox_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, error: null })
    const response = await POST(request(), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('billing_record_live_event_v1', {
      p_project_ref: projectRef,
      p_request: {
        stripe_account: stripeAccount, provider_mode: 'live', event_id: event.id,
        payload_hash: expect.stringMatching(/^[a-f0-9]{64}$/), event_type: event.type,
        event_created_at: expect.any(String), received_at: expect.any(String),
        payload: { object_id: invoice.id, customer_id: invoice.customer, subscription_id: invoice.subscription },
      },
    })
    expect(mocks.response).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal))
  })

  it.each([['55000', 503], ['23505', 409], ['08000', 500]])('does not acknowledge a database error %s', async (code, status) => {
    mocks.response.mockResolvedValue({ data: null, error: { code, message: 'private fixture detail' } })
    const response = await POST(request(), context)
    expect(response.status).toBe(status)
    expect(await response.text()).not.toContain('private fixture detail')
  })
})
