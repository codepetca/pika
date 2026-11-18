import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), config: vi.fn(), rpc: vi.fn(), rpcFactory: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRole: mocks.auth }))
vi.mock('@/lib/server/billing/live-target', () => ({ readBillingLivePaymentWorkerConfig: mocks.config }))
vi.mock('@/lib/server/billing/scheduled-cancellation-runtime', () => ({ createLiveScheduledCancellationRpc: mocks.rpcFactory }))
import { GET, POST } from '@/app/api/billing/scheduled-change/cancellation/route'
const scheduleOperationId = '11111111-1111-4111-8111-111111111111'
const operationId = '22222222-2222-4222-8222-222222222222'
const status = { scheduleOperationId, cancellationOperationId: operationId, state: 'cancel_pending',
  effectiveAt: '2027-01-01T00:00:00Z', canCancel: false, canUndo: false }
const context = { params: Promise.resolve({}) }
function post(body: unknown, origin = 'https://pika.codepet.ca') {
  return new NextRequest('https://pika.codepet.ca/api/billing/scheduled-change/cancellation', { method: 'POST',
    headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) })
}
beforeEach(() => {
  vi.resetAllMocks(); process.env.BILLING_LIVE_SCHEDULED_CANCELLATION_ENABLED = 'true'
  mocks.auth.mockResolvedValue({ id: 'subject' }); mocks.config.mockReturnValue({ appOrigin: 'https://pika.codepet.ca' })
  mocks.rpcFactory.mockReturnValue(mocks.rpc); mocks.rpc.mockResolvedValue(status)
})
describe('scheduled cancellation route', () => {
  it('returns private no-store status using the authenticated subject', async () => {
    const response = await GET(new NextRequest('https://pika.codepet.ca/api/billing/scheduled-change/cancellation'), context)
    expect(response.status).toBe(200); expect(await response.json()).toEqual(status)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.auth).toHaveBeenCalledWith('teacher')
    expect(mocks.rpc).toHaveBeenCalledWith('billing_get_live_scheduled_cancellation_v1', { subject_user_id: 'subject' })
  })
  it('requires exact origin and only sends the authenticated request to SQL', async () => {
    const body = { action: 'cancel', scheduleOperationId, operationId }
    expect((await POST(post(body, 'https://evil.example'), context)).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
    const response = await POST(post(body), context)
    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('billing_request_live_scheduled_cancellation_v1', { subject_user_id: 'subject',
      schedule_operation_id: scheduleOperationId, operation_id: operationId, action: 'cancel' })
  })
  it('rejects untrusted fields and closes the disabled gate without reads', async () => {
    expect((await POST(post({ action: 'cancel', scheduleOperationId, operationId, subject_user_id: 'other' }), context)).status).toBe(400)
    process.env.BILLING_LIVE_SCHEDULED_CANCELLATION_ENABLED = 'false'
    const response = await GET(new NextRequest('https://pika.codepet.ca/api/billing/scheduled-change/cancellation'), context)
    expect(response.status).toBe(404); expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
