import { describe, expect, it, vi } from 'vitest'
import { acceptBillingWebhook, readBillingWebhookBody } from '@/lib/server/billing/webhook'

const event = {
  id: 'evt_fixture', type: 'invoice.paid', livemode: false,
  created: 1800000000,
  data: { object: { id: 'in_fixture', customer: 'cus_fixture',
    parent: { subscription_details: { subscription: 'sub_fixture' } },
    customer_email: 'must-not-persist@example.test' } },
}

describe('durable verified Stripe intake', () => {
  it('verifies original bytes and persists only minimal references before returning', async () => {
    const raw = Buffer.from(JSON.stringify(event))
    const verify = vi.fn().mockReturnValue(event)
    const record = vi.fn().mockResolvedValue({ status: 'accepted', event_inbox_id: 'fixture' })
    await acceptBillingWebhook({ raw, signature: 'signature', stripeAccount: 'acct_fixture', verify, record })
    expect(verify).toHaveBeenCalledWith(raw, 'signature')
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      event_id: 'evt_fixture', stripe_account: 'acct_fixture',
      event_created_at: new Date(event.created * 1000).toISOString(),
      payload: { object_id: 'in_fixture', customer_id: 'cus_fixture', subscription_id: 'sub_fixture' },
    }))
    expect(JSON.stringify(record.mock.calls)).not.toContain('must-not-persist')
    expect(record.mock.calls[0][0].received_at).not.toBe(record.mock.calls[0][0].event_created_at)
  })
  it('does not acknowledge failed persistence', async () => {
    await expect(acceptBillingWebhook({ raw: Buffer.from('{}'), signature: 's',
      stripeAccount: 'acct_fixture', verify: () => event,
      record: async () => { throw new Error('database unavailable') },
    })).rejects.toThrow('database unavailable')
  })
  it.each([
    { ...event, livemode: true },
    { ...event, account: 'acct_other' },
    { ...event, id: 'unrecognized' },
  ])('rejects incompatible verified events before persistence', async (invalid) => {
    const record = vi.fn()
    await expect(acceptBillingWebhook({ raw: Buffer.from('{}'), signature: 's',
      stripeAccount: 'acct_fixture', verify: () => invalid, record,
    })).rejects.toThrow()
    expect(record).not.toHaveBeenCalled()
  })
  it('does not persist signature failures or oversized requests', async () => {
    const record = vi.fn()
    const verify = vi.fn(() => { throw new Error('raw provider error contains secrets') })
    await expect(acceptBillingWebhook({ raw: Buffer.from('{}'), signature: 'bad',
      stripeAccount: 'acct_fixture', verify, record,
    })).rejects.toThrow('Invalid Stripe signature')
    await expect(acceptBillingWebhook({ raw: Buffer.alloc(262145), signature: 's',
      stripeAccount: 'acct_fixture', verify, record,
    })).rejects.toThrow('Webhook body is too large')
    expect(record).not.toHaveBeenCalled()
  })
  it('bounds streamed bytes even when the caller lies about Content-Length', async () => {
    let cancelled = false
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(262145)) },
      cancel() { cancelled = true },
    })
    const request = new Request('http://localhost/webhook', {
      method: 'POST', body, headers: { 'Content-Length': '2' }, duplex: 'half',
    } as RequestInit)
    await expect(readBillingWebhookBody(request)).rejects.toThrow('Webhook body is too large')
    expect(cancelled).toBe(true)
  })
  it('preserves original byte content across chunks', async () => {
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(Buffer.from('{ "original":'))
      controller.enqueue(Buffer.from(' true }'))
      controller.close()
    } })
    const request = new Request('http://localhost/webhook', {
      method: 'POST', body, duplex: 'half',
    } as RequestInit)
    expect((await readBillingWebhookBody(request)).toString()).toBe('{ "original": true }')
  })
})
