import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ send: vi.fn(), logError: vi.fn() }))
vi.mock('@/lib/brevo', () => ({ sendBrevoEmail: mocks.send }))
vi.mock('@/lib/server/diagnostics', () => ({ logServerError: mocks.logError }))

import { deliverBillingEmailNotices, processLiveBillingEmailNotices } from '@/lib/server/billing/email-notices'

const notice = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  claim_token: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  recipient: 'teacher@example.invalid',
  kind: 'renewal_failed',
  source: 'paid',
  access_ends_at: '2026-11-08T22:30:42Z',
}
const empty = { status: 'empty', attention: 0 }
const config = { projectRef: 'zhioqbapgfcrronyuidm', stripeAccount: 'acct_EmailFixture', appOrigin: 'https://pika.codepet.ca' }
const scope = { p_project_ref: config.projectRef, p_stripe_account: config.stripeAccount }
const claimed = (overrides = {}) => ({ status: 'claimed', attention: 0, notice: { ...notice, ...overrides } })

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('BILLING_LIVE_EMAIL_NOTICES_ENABLED', 'false')
  mocks.logError.mockReturnValue('notice-diagnostic')
})
afterEach(() => vi.unstubAllEnvs())

function ports(reply: unknown = claimed()) {
  return {
    claim: vi.fn().mockResolvedValueOnce(reply).mockResolvedValue(empty),
    finish: vi.fn().mockResolvedValue({ status: 'sent' }),
    send: vi.fn().mockResolvedValue({ messageId: 'message' }),
  }
}

describe('billing email notice delivery', () => {
  it('uses the exact verified cutoff and the authenticated payment-management route', async () => {
    const transport = ports()
    await expect(deliverBillingEmailNotices(transport)).resolves.toEqual({ processed: 1, sent: 1, attention: 0 })
    expect(transport.send).toHaveBeenCalledExactlyOnceWith({
      to: notice.recipient, subject: 'Update your Pika payment method',
      textContent: expect.stringContaining('Nov 8, 2026, 5:30:42 p.m. EST unless the payment succeeds.'),
      tags: ['pika-billing-' + notice.id],
    })
    expect(transport.send.mock.calls[0][0].textContent).toContain('Update your payment method\nhttps://pika.codepet.ca/billing')
    expect(transport.finish).toHaveBeenCalledExactlyOnceWith({ id: notice.id, claim_token: notice.claim_token, outcome: 'sent' })
    expect(transport.claim).toHaveBeenCalledBefore(transport.send)
  })

  it.each([
    ['cancellation', 'paid', 'Your Pika subscription will end'],
    ['ending_7_days', 'trial', 'Your Pika Pro trial ends soon'],
    ['ending_24_hours', 'paid', 'Your paid Pika access ends within 24 hours'],
    ['expired', 'trial', 'Your access to paid Pika features ended'],
  ])('renders %s with a safe subject for %s', async (kind, source, subject) => {
    const transport = ports(claimed({ kind, source }))
    await deliverBillingEmailNotices(transport)
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ subject,
      textContent: expect.stringContaining('Existing student work remains available.') }))
    if (kind === 'expired') expect(transport.send.mock.calls[0][0].textContent)
      .toContain('Starting new paid classroom work or new RepoLight analysis requires an eligible plan.')
  })

  it.each(['throw', 'missing receipt'])('routes an ambiguous %s to attention without another send', async scenario => {
    const transport = ports()
    if (scenario === 'throw') transport.send.mockRejectedValue(new Error('private recipient or provider data'))
    else transport.send.mockResolvedValue({})
    transport.finish.mockResolvedValue({ status: 'attention' })
    await expect(deliverBillingEmailNotices(transport)).resolves.toEqual({ processed: 1, sent: 0, attention: 1 })
    expect(transport.send).toHaveBeenCalledOnce()
    expect(transport.finish).toHaveBeenCalledExactlyOnceWith({ id: notice.id, claim_token: notice.claim_token, outcome: 'attention' })
  })

  it('does not send again when acceptance was followed by a lost acknowledgement', async () => {
    const transport = ports()
    transport.finish.mockRejectedValue(new Error('Unavailable'))
    await expect(deliverBillingEmailNotices(transport)).rejects.toThrow('Unavailable')
    transport.claim.mockResolvedValueOnce({ status: 'empty', attention: 1 })
    await expect(deliverBillingEmailNotices(transport)).resolves.toEqual({ processed: 0, sent: 0, attention: 1 })
    expect(transport.send).toHaveBeenCalledOnce()
  })

  it('bounds processing and refuses a malformed private claim', async () => {
    const malformed = ports(claimed({ recipient: 'not an email' }))
    await expect(deliverBillingEmailNotices(malformed)).rejects.toThrow(/^Billing email claim is invalid$/)
    expect(malformed.send).not.toHaveBeenCalled()
    const transport = ports()
    transport.claim.mockResolvedValue(claimed())
    await deliverBillingEmailNotices(transport)
    expect(transport.claim).toHaveBeenCalledTimes(2)
    expect(transport.send).toHaveBeenCalledTimes(2)
  })
})

describe('live email delivery gate', () => {
  const rpc = vi.fn()
  const client = { rpc } as unknown as Parameters<typeof processLiveBillingEmailNotices>[0]

  function production() {
    vi.stubEnv('BILLING_LIVE_EMAIL_NOTICES_ENABLED', 'true')
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('ENABLE_MOCK_EMAIL', 'false')
    vi.stubEnv('BREVO_API_KEY', 'test-api-key')
  }

  it('does no queue or provider work by default or in a mock environment', async () => {
    await expect(processLiveBillingEmailNotices(client, config)).resolves.toBeUndefined()
    production()
    vi.stubEnv('ENABLE_MOCK_EMAIL', 'true')
    await expect(processLiveBillingEmailNotices(client, config)).resolves.toMatchObject({ failed: 1 })
    expect(rpc).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('uses the pinned service RPC and propagates only numeric results', async () => {
    production()
    const response = vi.fn().mockResolvedValueOnce({ data: claimed(), error: null })
      .mockResolvedValueOnce({ data: { status: 'sent' }, error: null })
      .mockResolvedValueOnce({ data: empty, error: null })
    rpc.mockReturnValue({ abortSignal: response })
    mocks.send.mockResolvedValue({ messageId: 'message' })
    await expect(processLiveBillingEmailNotices(client, config)).resolves.toEqual({ processed: 1, sent: 1, attention: 0 })
    expect(rpc).toHaveBeenNthCalledWith(1, 'billing_claim_live_email_notice_v1', scope)
    expect(rpc).toHaveBeenNthCalledWith(2, 'billing_finish_live_email_notice_v1', {
      ...scope, p_request: { id: notice.id, claim_token: notice.claim_token, outcome: 'sent' },
    })
    expect(response).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })
})
