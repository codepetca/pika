import { describe, expect, it, vi } from 'vitest'
import {
  createStripePlanChangeProvider, createLiveScheduledCancellationProvider, stripeScheduledCancellationIdempotencyKey, stripePlanChangeIdempotencyKey, StripePlanChangeContractError,
  type StripePlanChangeOperation,
} from '@/lib/server/billing/stripe-plan-change-provider'

const operation: StripePlanChangeOperation & { scheduleId: string } = {
  operationId: 'b87b8adf-3637-4c93-a017-abf7ef171d64',
  stripeAccount: 'acct_Pika',
  stripeCustomerId: 'cus_Pika',
  stripeSubscriptionId: 'sub_Pika',
  source: { priceId: 'price_Max', productId: 'prod_Max', currency: 'cad', interval: 'year', unitAmount: 12000 },
  target: { priceId: 'price_Pro', productId: 'prod_Pro', currency: 'cad', interval: 'month', unitAmount: 800 },
  paidPeriodStart: '2026-01-31T17:30:00.000Z',
  effectiveAt: '2027-01-31T17:30:00.000Z',
  scheduleId: 'sub_sched_Pika',
}
const seconds = (date: string) => Date.parse(date) / 1000
const starts = seconds(operation.paidPeriodStart)
const effective = seconds(operation.effectiveAt)
const targetEnd = seconds('2027-02-28T17:30:00.000Z')
const created = seconds('2027-01-30T19:00:00.000Z')
const replayUntil = '2027-01-31T16:00:00.000Z'
const attachedId = operation.scheduleId
const { scheduleId: _, ...unattached } = operation

function price(terms: StripePlanChangeOperation['source']) {
  return { id: terms.priceId, product: terms.productId, currency: terms.currency, unit_amount: terms.unitAmount,
    livemode: false, active: true, type: 'recurring', billing_scheme: 'per_unit',
    recurring: { interval: terms.interval, interval_count: 1, usage_type: 'licensed' } }
}

function subscription(schedule: string | null, after = false) {
  return {
    id: operation.stripeSubscriptionId, object: 'subscription', livemode: false,
    customer: { id: operation.stripeCustomerId, object: 'customer', livemode: false, discount: null },
    schedule, status: after ? 'past_due' : 'active', currency: 'cad', collection_method: 'charge_automatically',
    automatic_tax: { enabled: false }, cancel_at: null, cancel_at_period_end: false,
    pause_collection: null, pending_update: null, default_payment_method: 'pm_Pika',
    latest_invoice: { status: after ? 'open' : 'paid', livemode: false,
      customer: operation.stripeCustomerId, amount_remaining: after ? 800 : 0 },
    items: { has_more: false, data: [{ price: price(after ? operation.target : operation.source), quantity: 1,
      current_period_start: after ? effective : starts, current_period_end: after ? targetEnd : effective }] },
  }
}

function schedule(configured: boolean, after = false) {
  const source = { start_date: starts, end_date: effective, currency: 'cad',
    items: [{ price: operation.source.priceId, quantity: 1, tax_rates: [] as unknown[] }],
    default_payment_method: 'pm_Pika', billing_cycle_anchor: 'automatic',
    proration_behavior: configured ? 'none' : 'create_prorations' }
  const target = { ...source, start_date: effective, end_date: targetEnd,
    billing_cycle_anchor: 'phase_start', items: [{ price: operation.target.priceId, quantity: 1, tax_rates: [] as unknown[] }] }
  const current = after ? target : source
  return {
    id: attachedId, object: 'subscription_schedule', created, customer: operation.stripeCustomerId, livemode: false,
    subscription: operation.stripeSubscriptionId, status: 'active', end_behavior: 'release',
    current_phase: { start_date: current.start_date, end_date: current.end_date },
    metadata: configured ? { pika_plan_change_operation: operation.operationId } : {},
    default_settings: { billing_cycle_anchor: 'automatic' },
    phases: configured ? [source, target] : [source],
  }
}

function creationEvents(key: string | null) {
  return { has_more: false, data: [{
    type: 'subscription_schedule.created', created, livemode: false,
    request: { idempotency_key: key },
    data: { object: { id: attachedId, object: 'subscription_schedule', livemode: false,
      customer: operation.stripeCustomerId, subscription: operation.stripeSubscriptionId } },
  }] }
}

function fixture() {
  const port = {
    retrieveAccount: vi.fn(async () => ({ id: operation.stripeAccount })),
    retrieveSubscription: vi.fn<() => Promise<unknown>>(async () => subscription(attachedId)),
    retrievePrice: vi.fn<(_id: string) => Promise<unknown>>(async id => price(id === operation.target.priceId ? operation.target : operation.source)),
    retrieveSchedule: vi.fn<() => Promise<unknown>>(async () => schedule(false)),
    listCreationEvents: vi.fn(async () => creationEvents(null)),
    attachSchedule: vi.fn(async () => schedule(false)),
    updateSchedule: vi.fn(async () => schedule(true)),
  }
  const now = vi.fn(() => created * 1000)
  const provider = createStripePlanChangeProvider(port, now)
  const attach = {
    operation: unattached, idempotencyKey: stripePlanChangeIdempotencyKey(operation.operationId, 'attach'),
    replayUntil, beforeMutation: vi.fn(async () => true),
  }
  const configure = {
    operation, idempotencyKey: stripePlanChangeIdempotencyKey(operation.operationId, 'configure'),
    replayUntil, beforeMutation: vi.fn(async () => true),
  }
  return { port, provider, attach, configure, now }
}

describe('Stripe renewal-boundary plan change', () => {
  it('attaches to the exact subscription using only from_subscription and its stable idempotency key', async () => {
    const { port, provider, attach } = fixture()
    port.retrieveSubscription.mockResolvedValueOnce(subscription(null))
    await expect(provider.attach(attach)).resolves.toEqual({ kind: 'attached', scheduleId: attachedId })
    expect(attach.beforeMutation).toHaveBeenCalledOnce()
    expect(port.attachSchedule).toHaveBeenCalledExactlyOnceWith({ from_subscription: operation.stripeSubscriptionId },
      { idempotencyKey: attach.idempotencyKey })
    expect(port.updateSchedule).not.toHaveBeenCalled()
  })

  it('recovers the same attached schedule after a lost create response without a second write', async () => {
    const { port, provider, attach } = fixture()
    port.retrieveSubscription.mockResolvedValueOnce(subscription(null))
    port.attachSchedule.mockRejectedValueOnce(new Error('Response lost'))
    await expect(provider.attach(attach)).rejects.toThrow('Response lost')
    port.listCreationEvents.mockResolvedValueOnce(creationEvents(attach.idempotencyKey))
    await expect(provider.attach(attach)).resolves.toEqual({ kind: 'attached', scheduleId: attachedId })
    expect(port.listCreationEvents).toHaveBeenCalledExactlyOnceWith(created)
    expect(port.attachSchedule).toHaveBeenCalledOnce()
  })

  it('does not adopt an existing schedule without exact request evidence', async () => {
    const { port, provider, attach } = fixture()
    port.listCreationEvents.mockResolvedValueOnce(creationEvents('other-operation'))
    await expect(provider.attach(attach)).rejects.toThrow(StripePlanChangeContractError)
    expect(attach.beforeMutation).not.toHaveBeenCalled()
    expect(port.attachSchedule).not.toHaveBeenCalled()
  })

  it('configures one target interval and release, then verifies the schedule while the source is still current', async () => {
    const { port, provider, configure } = fixture()
    port.retrieveSchedule.mockResolvedValueOnce(schedule(false)).mockResolvedValue(schedule(true))
    await expect(provider.configure(configure)).resolves.toEqual({ kind: 'configured', scheduleId: attachedId })
    expect(configure.beforeMutation).toHaveBeenCalledOnce()
    const phase = { proration_behavior: 'none', automatic_tax: { enabled: false }, collection_method: 'charge_automatically',
      discounts: '', default_payment_method: 'pm_Pika' }
    expect(port.updateSchedule).toHaveBeenCalledExactlyOnceWith(attachedId, {
      end_behavior: 'release', proration_behavior: 'none', metadata: { pika_plan_change_operation: operation.operationId },
      phases: [{
        ...phase, start_date: starts, end_date: effective, items: [{ price: operation.source.priceId, quantity: 1 }],
      }, {
        ...phase, start_date: effective, duration: { interval: 'month', interval_count: 1 },
        billing_cycle_anchor: 'phase_start', items: [{ price: operation.target.priceId, quantity: 1 }],
      }],
    }, { idempotencyKey: configure.idempotencyKey })
    await expect(provider.verify(operation)).resolves.toEqual({
      kind: 'configured', scheduleId: attachedId, effectiveAt: operation.effectiveAt,
    })
    await expect(provider.configure(configure)).resolves.toEqual({ kind: 'configured', scheduleId: attachedId })
    expect(port.updateSchedule).toHaveBeenCalledOnce()
  })

  it('reports configured but grants no payment or access evidence during a failed target renewal', async () => {
    const { port, provider, now } = fixture()
    now.mockReturnValue(effective * 1000)
    port.retrieveSubscription.mockResolvedValue(subscription(attachedId, true))
    port.retrieveSchedule.mockResolvedValue(schedule(true, true))
    await expect(provider.verify(operation)).resolves.toEqual({
      kind: 'configured', scheduleId: attachedId, effectiveAt: operation.effectiveAt,
    })
  })

  it('does not send a POST after an attach or configure fence is lost', async () => {
    const { port, provider, attach, configure } = fixture()
    port.retrieveSubscription.mockResolvedValueOnce(subscription(null))
    attach.beforeMutation.mockResolvedValueOnce(false)
    configure.beforeMutation.mockResolvedValueOnce(false)
    await expect(provider.attach(attach)).resolves.toEqual({ kind: 'stale' })
    await expect(provider.configure(configure)).resolves.toEqual({ kind: 'stale' })
    expect(port.attachSchedule).not.toHaveBeenCalled()
    expect(port.updateSchedule).not.toHaveBeenCalled()
  })

  it('does not replay a write after the persisted deadline or cutoff passes inside the fence', async () => {
    const { port, provider, attach, configure, now } = fixture()
    port.retrieveSubscription.mockResolvedValueOnce(subscription(null))
    now.mockReturnValueOnce(created * 1000).mockReturnValue(Date.parse(replayUntil))
    await expect(provider.attach(attach)).rejects.toThrow(StripePlanChangeContractError)
    now.mockReturnValue(created * 1000)
    configure.beforeMutation.mockImplementationOnce(async () => { now.mockReturnValue(effective * 1000); return true })
    await expect(provider.configure(configure)).rejects.toThrow(StripePlanChangeContractError)
    expect(port.attachSchedule).not.toHaveBeenCalled()
    expect(port.updateSchedule).not.toHaveBeenCalled()
  })

  it('requires account identity, paid source, mode and exact schedule ownership before any write', async () => {
    const { port, provider, attach, configure } = fixture()
    port.retrieveAccount.mockResolvedValueOnce({ id: 'acct_Other' })
    await expect(provider.attach(attach)).rejects.toThrow(StripePlanChangeContractError)
    expect(port.retrieveSubscription).not.toHaveBeenCalled()
    port.retrieveSubscription.mockResolvedValueOnce({ ...subscription(null), livemode: true })
    await expect(provider.attach(attach)).rejects.toThrow(StripePlanChangeContractError)
    const unpaid = subscription(null)
    unpaid.latest_invoice.status = 'open'
    port.retrieveSubscription.mockResolvedValueOnce(unpaid)
    await expect(provider.attach(attach)).rejects.toThrow(StripePlanChangeContractError)
    port.retrieveSubscription.mockResolvedValueOnce(subscription('sub_sched_Foreign'))
    await expect(provider.configure(configure)).rejects.toThrow(StripePlanChangeContractError)
    expect(port.attachSchedule).not.toHaveBeenCalled()
    expect(port.updateSchedule).not.toHaveBeenCalled()
  })

  it('distinguishes absent configuration from changed ownership, prices and phase times', async () => {
    const { port, provider, configure } = fixture()
    port.retrieveSubscription.mockResolvedValueOnce(subscription(null))
    await expect(provider.verify(operation)).resolves.toEqual({ kind: 'absent' })
    await expect(provider.verify(operation)).resolves.toEqual({ kind: 'absent' })
    const mismatched = schedule(true)
    mismatched.phases[1].end_date++
    port.retrieveSchedule.mockResolvedValueOnce(mismatched)
    await expect(provider.verify(operation)).rejects.toThrow(StripePlanChangeContractError)
    const foreign = schedule(true)
    foreign.metadata = { pika_plan_change_operation: 'other' }
    port.retrieveSchedule.mockResolvedValueOnce(foreign)
    await expect(provider.configure(configure)).rejects.toThrow(StripePlanChangeContractError)
    port.retrievePrice.mockResolvedValueOnce({ ...price(operation.target), unit_amount: 700 })
    await expect(provider.configure(configure)).rejects.toThrow(StripePlanChangeContractError)
    expect(port.updateSchedule).not.toHaveBeenCalled()
  })

  it('rejects a taxed or discounted schedule and a different idempotency key without mutation', async () => {
    const { port, provider, attach, configure } = fixture()
    const taxed = schedule(false)
    taxed.phases[0].items[0].tax_rates = ['txr_Other']
    port.retrieveSchedule.mockResolvedValueOnce(taxed)
    await expect(provider.configure(configure)).rejects.toThrow(StripePlanChangeContractError)
    port.retrieveSubscription.mockResolvedValueOnce({
      ...subscription(null), customer: { ...subscription(null).customer, discount: { id: 'di_Other' } },
    })
    await expect(provider.attach(attach)).rejects.toThrow(StripePlanChangeContractError)
    await expect(provider.attach({ ...attach, idempotencyKey: 'other' })).rejects.toThrow(StripePlanChangeContractError)
    expect(port.updateSchedule).not.toHaveBeenCalled()
    expect(port.attachSchedule).not.toHaveBeenCalled()
  })
})

describe('live plan change scope', () => {
  const scope = { providerMode: 'live', stripeAccount: operation.stripeAccount } as const
  function liveFixture() {
    const f = fixture()
    const sub = subscription(attachedId)
    sub.livemode = true; sub.customer.livemode = true; sub.latest_invoice.livemode = true
    sub.items.data[0].price.livemode = true
    Object.assign(sub.latest_invoice, { id: 'in_Paid' })
    f.configure.operation = { ...f.configure.operation, providerMode: 'live', lastPaidInvoiceId: 'in_Paid' }
    const rawSchedule = schedule(false); rawSchedule.livemode = true
    const rawConfigured = schedule(true); rawConfigured.livemode = true
    f.port.retrieveSubscription.mockResolvedValue(sub)
    f.port.retrieveSchedule.mockResolvedValueOnce(rawSchedule).mockResolvedValue(rawConfigured)
    f.port.retrievePrice.mockImplementation(async id => ({ ...price(id === operation.target.priceId ? operation.target : operation.source), livemode: true }))
    f.port.updateSchedule.mockResolvedValue(rawConfigured)
    return { ...f, sub, rawSchedule, rawConfigured, provider: createStripePlanChangeProvider(f.port, f.now, scope) }
  }
  it('configures and verifies only matching live evidence under the stale fence', async () => {
    const f = liveFixture()
    await expect(f.provider.configure(f.configure)).resolves.toMatchObject({ kind: 'configured' })
    expect(f.port.updateSchedule).toHaveBeenCalledOnce()
    await expect(f.provider.verify(f.configure.operation)).resolves.toMatchObject({ kind: 'configured' })
  })
  it('rejects mismatched scope, raw account and nested mode before writes', async () => {
    const f = liveFixture()
    await expect(createStripePlanChangeProvider(f.port, f.now, { ...scope, stripeAccount: 'acct_Other' }).configure(f.configure)).rejects.toThrow()
    expect(f.port.retrieveAccount).not.toHaveBeenCalled()
    f.port.retrieveAccount.mockResolvedValueOnce({ id: 'acct_Other' })
    await expect(f.provider.configure(f.configure)).rejects.toThrow()
    f.sub.customer.livemode = false
    await expect(f.provider.configure(f.configure)).rejects.toThrow()
    expect(f.port.updateSchedule).not.toHaveBeenCalled()
  })
  it('rejects a different current paid invoice before a write', async () => {
    const f = liveFixture()
    Object.assign(f.sub.latest_invoice, { id: 'in_Other' })
    await expect(f.provider.configure(f.configure)).rejects.toThrow(StripePlanChangeContractError)
    expect(f.configure.beforeMutation).not.toHaveBeenCalled()
    expect(f.port.updateSchedule).not.toHaveBeenCalled()
  })
  it('can verify after renewal when the current invoice is the new target invoice', async () => {
    const f = liveFixture()
    f.now.mockReturnValue(effective * 1000)
    const after = subscription(attachedId, true)
    after.livemode = true; after.customer.livemode = true; after.latest_invoice.livemode = true
    after.items.data[0].price.livemode = true
    Object.assign(after.latest_invoice, { id: 'in_NewRenewal' })
    const afterSchedule = schedule(true, true); afterSchedule.livemode = true
    f.port.retrieveSubscription.mockResolvedValue(after)
    f.port.retrieveSchedule.mockReset().mockResolvedValue(afterSchedule)
    await expect(f.provider.verify(f.configure.operation)).resolves.toMatchObject({ kind: 'configured' })
  })
  it('rejects live operations missing their exact invoice identity', async () => {
    const f = liveFixture()
    delete f.configure.operation.lastPaidInvoiceId
    await expect(f.provider.configure(f.configure)).rejects.toThrow(StripePlanChangeContractError)
    expect(f.port.retrieveAccount).not.toHaveBeenCalled()
  })
  it('rejects test-mode schedule and does not write when the fence is stale', async () => {
    const f = liveFixture()
    f.rawSchedule.livemode = false
    await expect(f.provider.configure(f.configure)).rejects.toThrow()
    f.port.retrieveSchedule.mockResolvedValue(f.rawSchedule)
    f.rawSchedule.livemode = true
    f.configure.beforeMutation.mockResolvedValue(false)
    await expect(f.provider.configure(f.configure)).resolves.toEqual({ kind: 'stale' })
    expect(f.port.updateSchedule).not.toHaveBeenCalled()
  })
})


describe('live saved schedule cancellation and undo', () => {
  const scope = { providerMode: 'live', stripeAccount: operation.stripeAccount } as const
  const cancellationOperationId = 'c87b8adf-3637-4c93-a017-abf7ef171d64'
  function live() {
    const f = fixture()
    const sub = subscription(attachedId)
    sub.livemode = true; sub.customer.livemode = true; sub.latest_invoice.livemode = true
    sub.items.data[0].price.livemode = true
    Object.assign(sub.latest_invoice, { id: 'in_Paid' })
    const raw = schedule(true); raw.livemode = true
    f.port.retrieveSubscription.mockResolvedValue(sub)
    f.port.retrieveSchedule.mockResolvedValue(raw)
    f.port.retrievePrice.mockImplementation(async id => ({ ...price(id === operation.target.priceId ? operation.target : operation.source), livemode: true }))
    const input = { operation: { ...operation, providerMode: 'live' as const, lastPaidInvoiceId: 'in_Paid' },
      cancellationOperationId, replayUntil, beforeMutation: vi.fn(async () => true) }
    const setCanceled = () => {
      Object.assign(sub, { cancel_at: effective })
      Object.assign(raw, { end_behavior: 'cancel', phases: [raw.phases[0]], metadata: {
        pika_plan_change_operation: operation.operationId, pika_cancellation_operation: cancellationOperationId } })
    }
    const setScheduled = () => { Object.assign(sub, { cancel_at: null }); const restored = schedule(true)
      Object.assign(raw, { end_behavior: 'release', phases: restored.phases, metadata: restored.metadata }) }
    return { ...f, sub, raw, input, setCanceled, setScheduled, provider: createLiveScheduledCancellationProvider(f.port, scope, f.now) }
  }
  it('cancels and undoes the saved schedule with fresh fences, exact phases, and action keys', async () => {
    const f = live()
    f.port.updateSchedule.mockImplementation(async (_id, params) => {
      if (params.end_behavior === 'cancel') f.setCanceled(); else f.setScheduled()
      return f.raw
    })
    await expect(f.provider.cancel(f.input)).resolves.toEqual({ kind: 'cancel_scheduled' })
    expect(f.port.updateSchedule.mock.calls[0][1]).toMatchObject({ end_behavior: 'cancel', proration_behavior: 'none',
      metadata: { pika_plan_change_operation: operation.operationId, pika_cancellation_operation: cancellationOperationId },
      phases: [{ start_date: starts, end_date: effective, items: [{ price: operation.source.priceId, quantity: 1 }] }] })
    expect(f.port.updateSchedule.mock.calls[0][2].idempotencyKey).toBe(stripeScheduledCancellationIdempotencyKey(cancellationOperationId, 'cancel'))
    await expect(f.provider.undo(f.input)).resolves.toEqual({ kind: 'scheduled' })
    expect(f.port.updateSchedule.mock.calls[1][1]).toMatchObject({ end_behavior: 'release',
      metadata: { pika_plan_change_operation: operation.operationId, pika_cancellation_operation: '' },
      phases: [expect.any(Object), { start_date: effective, billing_cycle_anchor: 'phase_start', items: [{ price: operation.target.priceId, quantity: 1 }] }] })
    expect(f.port.updateSchedule.mock.calls[1][2].idempotencyKey).toBe(stripeScheduledCancellationIdempotencyKey(cancellationOperationId, 'undo'))
    expect(f.input.beforeMutation).toHaveBeenCalledTimes(2)
  })
  it('recovers an ambiguous cancellation and undo from the verified provider state without another write', async () => {
    const f = live()
    f.port.updateSchedule.mockImplementationOnce(async () => { f.setCanceled(); throw new Error('lost') })
    await expect(f.provider.cancel(f.input)).rejects.toThrow('lost')
    await expect(f.provider.cancel(f.input)).resolves.toEqual({ kind: 'cancel_scheduled' })
    f.port.updateSchedule.mockImplementationOnce(async () => { f.setScheduled(); throw new Error('lost') })
    await expect(f.provider.undo(f.input)).rejects.toThrow('lost')
    await expect(f.provider.undo(f.input)).resolves.toEqual({ kind: 'scheduled' })
    expect(f.port.updateSchedule).toHaveBeenCalledTimes(2)
  })
  it('does not accept a write response without a matching fresh read', async () => {
    const f = live()
    f.port.updateSchedule.mockResolvedValue(f.raw)
    await expect(f.provider.cancel(f.input)).rejects.toThrow(StripePlanChangeContractError)
    expect(f.port.retrieveSubscription).toHaveBeenCalledTimes(2)
    expect(f.port.retrieveSchedule).toHaveBeenCalledTimes(2)
  })
  it('recovers restored target phase after cutoff without any Stripe write', async () => {
    const f = live(); f.now.mockReturnValue(effective * 1000)
    const target = subscription(attachedId, true); target.livemode = true; target.customer.livemode = true
    target.latest_invoice.livemode = true; target.items.data[0].price.livemode = true
    Object.assign(target.latest_invoice, { id: 'in_Target' })
    const next = schedule(true, true); next.livemode = true
    f.port.retrieveSubscription.mockResolvedValue(target); f.port.retrieveSchedule.mockResolvedValue(next)
    await expect(f.provider.read(f.input)).resolves.toEqual({ kind: 'restored_after_cutoff' })
    await expect(f.provider.undo(f.input)).resolves.toEqual({ kind: 'restored_after_cutoff' })
    expect(f.input.beforeMutation).not.toHaveBeenCalled(); expect(f.port.updateSchedule).not.toHaveBeenCalled()
  })
  it('rereads once when one observation crosses the cutoff, with no provider write', async () => {
    const f = live()
    const target = subscription(attachedId, true); target.livemode = true; target.customer.livemode = true
    target.latest_invoice.livemode = true; target.items.data[0].price.livemode = true
    const next = schedule(true, true); next.livemode = true
    f.port.retrieveSubscription.mockImplementation(async () => { f.now.mockReturnValue(effective * 1000); return target })
    f.port.retrieveSchedule.mockResolvedValue(next)
    await expect(f.provider.read(f.input)).resolves.toEqual({ kind: 'restored_after_cutoff' })
    expect(f.port.retrieveSubscription).toHaveBeenCalledTimes(2)
    expect(f.port.updateSchedule).not.toHaveBeenCalled()
  })
  it('does not write when the cutoff arrives during the authorization fence', async () => {
    const f = live()
    f.input.beforeMutation.mockImplementation(async () => { f.now.mockReturnValue(effective * 1000); return true })
    await expect(f.provider.cancel(f.input)).resolves.toEqual({ kind: 'transition_pending' })
    expect(f.port.updateSchedule).not.toHaveBeenCalled()
  })
  it('does not hand off a target phase with a foreign marker or wrong terms', async () => {
    const f = live(); f.now.mockReturnValue(effective * 1000)
    const target = subscription(attachedId, true); target.livemode = true; target.customer.livemode = true
    target.latest_invoice.livemode = true; target.items.data[0].price.livemode = true
    const next = schedule(true, true); next.livemode = true
    next.metadata.pika_plan_change_operation = '11111111-1111-4111-8111-111111111111'
    f.port.retrieveSubscription.mockResolvedValue(target); f.port.retrieveSchedule.mockResolvedValue(next)
    await expect(f.provider.read(f.input)).rejects.toThrow(StripePlanChangeContractError)
    expect(f.port.updateSchedule).not.toHaveBeenCalled()
  })
  it('defers an exact old source phase while Stripe crosses the cutoff', async () => {
    const f = live(); f.now.mockReturnValue(effective * 1000)
    await expect(f.provider.read(f.input)).resolves.toEqual({ kind: 'transition_pending' })
    f.setCanceled()
    await expect(f.provider.read(f.input)).resolves.toEqual({ kind: 'transition_pending' })
    expect(f.port.updateSchedule).not.toHaveBeenCalled()
  })
  it('proves the observed completed terminal shape without initiating a write', async () => {
    const f = live(); f.setCanceled(); f.now.mockReturnValue(effective * 1000)
    Object.assign(f.sub, { status: 'canceled', ended_at: effective, canceled_at: created })
    Object.assign(f.raw, { status: 'completed', completed_at: effective, current_phase: null })
    await expect(f.provider.read(f.input)).resolves.toEqual({ kind: 'completed' })
    await expect(f.provider.cancel(f.input)).resolves.toEqual({ kind: 'completed' })
    await expect(f.provider.undo(f.input)).rejects.toThrow(StripePlanChangeContractError)
    expect(f.port.updateSchedule).not.toHaveBeenCalled()
  })
  it.each(['account', 'customer', 'subscription', 'price', 'phase', 'schedule-mode'] as const)(
    'rejects %s evidence before a cancellation write', async field => {
      const f = live()
      if (field === 'account') f.port.retrieveAccount.mockResolvedValue({ id: 'acct_Other' })
      if (field === 'customer') f.sub.customer.id = 'cus_Other'
      if (field === 'subscription') f.sub.id = 'sub_Other'
      if (field === 'price') f.sub.items.data[0].price.id = 'price_Other'
      if (field === 'phase') f.raw.phases[0].end_date = effective - 1
      if (field === 'schedule-mode') f.raw.livemode = false
      await expect(f.provider.cancel(f.input)).rejects.toThrow(StripePlanChangeContractError)
      expect(f.port.updateSchedule).not.toHaveBeenCalled()
    })
  it('fails closed on stale fence, foreign invoice, mode and operation marker', async () => {
    const f = live(); f.input.beforeMutation.mockResolvedValueOnce(false)
    await expect(f.provider.cancel(f.input)).resolves.toEqual({ kind: 'stale' })
    Object.assign(f.sub.latest_invoice, { id: 'in_Other' })
    await expect(f.provider.cancel(f.input)).rejects.toThrow(StripePlanChangeContractError)
    Object.assign(f.sub.latest_invoice, { id: 'in_Paid' }); f.setCanceled()
    Object.assign(f.raw, { metadata: { pika_plan_change_operation: operation.operationId, pika_cancellation_operation: 'other' } })
    await expect(f.provider.undo(f.input)).rejects.toThrow(StripePlanChangeContractError)
    expect(() => createLiveScheduledCancellationProvider(f.port, { ...scope, providerMode: 'test' }, f.now)).toThrow()
    expect(f.port.updateSchedule).not.toHaveBeenCalled()
  })
})
