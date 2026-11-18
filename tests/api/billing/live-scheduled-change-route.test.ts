import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), config: vi.fn(), rpc: vi.fn(), serviceRole: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRole: mocks.auth }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.serviceRole }))
vi.mock('@/lib/server/billing/live-target', () => ({ readBillingLiveScheduledChangeConfig: mocks.config }))
vi.mock('@/lib/server/billing/purchase-config', () => ({ readBillingPurchaseConfig: () => null }))

import { GET, POST as reserve } from '@/app/api/billing/scheduled-change/route'
import { POST as confirm } from '@/app/api/billing/scheduled-change/confirm/route'

const origin = 'https://pika.codepet.ca'
const url = origin + '/api/billing/scheduled-change'
const context = { params: Promise.resolve({}) }
const operationId = '11111111-1111-4111-8111-111111111111'
const offeringVersionId = '22222222-2222-4222-8222-222222222222'
const subject = '33333333-3333-4333-8333-333333333333'
const target = { p_project_ref: 'abcdefghijklmnopqrst', p_stripe_account: 'acct_LiveScheduled' }
const quote = { operation_id: operationId, state: 'quoted', effective_at: '2027-01-01T00:00:00Z',
  expires_at: '2026-12-01T00:00:00Z', plan_key: 'plus', currency: 'cad', interval: 'year',
  recurring_amount: 27900, classroom_limit: 5, due_now: 0 }

function post(body: object, requestOrigin = origin, path = url) {
  return new NextRequest(path, { method: 'POST',
    headers: { 'content-type': 'application/json', origin: requestOrigin }, body: JSON.stringify(body) })
}

function response(data: unknown, error: { code: string; message: string } | null = null) {
  return { abortSignal: async () => ({ data, error }) }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ id: subject })
  mocks.config.mockReturnValue({ appOrigin: origin, projectRef: target.p_project_ref, stripeAccount: target.p_stripe_account,
    supabaseOrigin: 'https://abcdefghijklmnopqrst.supabase.co' })
  mocks.serviceRole.mockReturnValue({ rpc: mocks.rpc })
})

describe('live scheduled change routes', () => {
  it('uses exact scoped RPCs for authenticated quote and idempotent confirmation', async () => {
    mocks.rpc.mockReturnValueOnce(response(quote)).mockReturnValueOnce(response({ ...quote, state: 'confirmed' }))
    const review = await reserve(post({ operationId, offeringVersionId }), context)
    expect(review.status).toBe(200)
    expect(await review.json()).toMatchObject({ operationId, state: 'quoted', plan: 'pro', recurringAmount: 27900, dueNow: 0 })
    const accepted = await confirm(post({ operationId }, origin, url + '/confirm'), context)
    expect(accepted.status).toBe(200)
    expect(accepted.headers.get('cache-control')).toBe('private, no-store')
    expect(await accepted.json()).toMatchObject({ operationId, state: 'confirmed' })
    expect(mocks.rpc.mock.calls).toEqual([
      ['billing_reserve_live_scheduled_plan_change_v1', { ...target, p_request: {
        subject_user_id: subject, operation_id: operationId, target_offering_version_id: offeringVersionId,
      } }],
      ['billing_confirm_live_scheduled_plan_change_v1', { ...target, p_request: {
        subject_user_id: subject, operation_id: operationId,
      } }],
    ])
    expect(mocks.auth).toHaveBeenCalledWith('teacher')
  })

  it('requires readiness for offers and maps an atomic admission pause to a conflict', async () => {
    mocks.rpc.mockReturnValueOnce(response(false)).mockReturnValueOnce(response(null,
      { code: '55000', message: 'billing_live_scheduled_change_admission_unavailable' }))
    const offers = await GET(new NextRequest(url), context)
    expect(offers.status).toBe(409)
    expect(offers.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.rpc.mock.calls).toEqual([['billing_live_scheduled_customer_ready_v1', target]])
    expect((await reserve(post({ operationId, offeringVersionId }), context)).status).toBe(409)
  })

  it('uses the authenticated Max binding to list a matching taxed Pro renewal offer', async () => {
    const taxed = { offering_version_id: offeringVersionId, plan_key: 'plus', stripe_account: target.p_stripe_account,
      provider_mode: 'live', stripe_product_id: 'prod_Pro', stripe_price_id: 'price_TaxedPro', currency: 'cad',
      interval: 'year', unit_amount: 27900, classroom_limit: 5, catalog_key: 'pika:repolight-2026-10-29:pro:cad:year:stripe-exclusive',
      tax_mode: 'stripe_exclusive' }
    mocks.rpc.mockReturnValueOnce(response(true)).mockReturnValueOnce(response({ items: [taxed] }))
    const offers = await GET(new NextRequest(url), context)
    expect(offers.status).toBe(200)
    expect(await offers.json()).toEqual({ items: [{ offeringVersionId, plan: 'pro', name: 'Pro',
      currency: 'cad', interval: 'year', unitAmount: 27900, classroomLimit: 5 }] })
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'billing_list_live_scheduled_change_offerings_v1',
      { ...target, p_request: { subject_user_id: subject } })
  })

  it('blocks disabled catalog access and cross-origin writes before touching the database', async () => {
    expect((await reserve(post({ operationId, offeringVersionId }, 'https://foreign.example'), context)).status).toBe(403)
    mocks.config.mockReturnValue(null)
    expect((await GET(new NextRequest(url), context)).status).toBe(404)
    expect(mocks.serviceRole).not.toHaveBeenCalled()
  })
})
