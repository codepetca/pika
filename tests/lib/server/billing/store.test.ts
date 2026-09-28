import { describe, expect, it, vi } from 'vitest'
import { createBillingStore } from '@/lib/server/billing/store'

const receipt = {
  stripe_account: 'acct_fixture', event_id: 'evt_fixture', event_type: 'invoice.paid',
  payload_hash: 'a'.repeat(64), received_at: '2026-09-26T12:00:00.000Z',
  event_created_at: '2026-09-25T12:00:00.000Z',
  payload: { object_id: 'in_fixture', customer_id: 'cus_fixture', subscription_id: 'sub_fixture' },
}

describe('billing persistence boundary', () => {
  it('only confirms an explicitly durable accepted or duplicate receipt', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      status: 'duplicate', event_inbox_id: '11111111-1111-4111-8111-111111111111',
    }, error: null })
    expect(await createBillingStore({ rpc }).recordEvent(receipt)).toMatchObject({ status: 'duplicate' })
    expect(rpc).toHaveBeenCalledWith('billing_record_event_v1', { p_request: receipt })
  })
  it.each([null, {}, { status: 'accepted' }])('rejects ambiguous success %j', async data => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null })
    await expect(createBillingStore({ rpc }).recordEvent(receipt)).rejects.toThrow('receipt could not be confirmed')
  })
  it('does not expose database error details', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'private customer identity' } })
    await expect(createBillingStore({ rpc }).recordEvent(receipt)).rejects.toThrow('Billing database operation failed')
  })
})
