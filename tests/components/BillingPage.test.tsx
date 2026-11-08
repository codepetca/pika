import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BillingPage } from '@/app/billing/BillingPage'

const free = { state: 'free', plan: 'free', classroomLimit: 0, accessEndsAt: null, renewalAt: null, canStartPaidWork: false, retryable: false,
  options: { trialAvailable: true, checkoutAvailable: true, pendingCheckoutId: null, paidTerms: null, hasBillingCustomer: false } }
const item = { offeringVersionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', plan: 'pro', name: 'Pro', currency: 'cad', interval: 'year', unitAmount: 27900, classroomLimit: 5 }
const json = (data: unknown, status = 200) => Promise.resolve({ ok: status === 200, status, json: async () => data } as Response)

describe('BillingPage', () => {
  beforeEach(() => { sessionStorage.clear(); history.replaceState({}, '', '/billing') })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
  it('starts the explicit cardless trial and reports ineligibility', async () => {
    const fetch = vi.fn((url: string) => url.endsWith('/subscription') ? json(free) : url.endsWith('/catalog') ? json({ items: [item] }) : json({}, 409))
    vi.stubGlobal('fetch', fetch)
    render(<BillingPage userId="teacher" />)
    expect(await screen.findByText(/without a card or automatic charge/)).toBeInTheDocument()
    expect(screen.getByText(/Full annual amount charged upfront/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start 30-day Pro trial' }))
    expect(await screen.findByText(/cannot start a trial/)).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/billing/trial', expect.objectContaining({ method: 'POST' }))
  })
  it('reuses the operation when checkout needs retry', async () => {
    const fetch = vi.fn((url: string) => url.endsWith('/subscription') ? json(free) : url.endsWith('/catalog') ? json({ items: [item] }) : json({}, 500))
    vi.stubGlobal('fetch', fetch)
    render(<BillingPage userId="teacher" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to checkout' }))
    await screen.findByText(/Could not start checkout/)
    fireEvent.click(screen.getByRole('button', { name: 'Continue to checkout' }))
    await waitFor(() => expect(fetch.mock.calls.filter(call => call[0] === '/api/billing/checkout')).toHaveLength(2))
    const calls = fetch.mock.calls.filter(call => call[0] === '/api/billing/checkout') as unknown as [string, RequestInit][]
    const operationId = JSON.parse(calls[0][1].body as string).operationId
    expect(operationId).toEqual(JSON.parse(calls[1][1].body as string).operationId)
    expect(sessionStorage.getItem(`pika-billing-attempt:teacher:${operationId}`)).toBe(item.offeringVersionId)
  })
  it('uses verified checkout status instead of the success redirect', async () => {
    history.replaceState({}, '', '/billing?checkout=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&result=success')
    vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/subscription') ? json(free) : url.endsWith('/catalog') ? json({ items: [] }) : json({ attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'payment_pending', checkoutUrl: null })))
    render(<BillingPage userId="teacher" />)
    expect(await screen.findByText('Payment or plan access is being checked.')).toBeInTheDocument()
    expect(screen.queryByText('Payment and plan access confirmed.')).not.toBeInTheDocument()
  })
  it('resumes an unfinished checkout reported by the account even without return parameters', async () => {
    const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const fetch = vi.fn((url: string) => url.endsWith('/subscription') ? json({
      ...free, options: { ...free.options, trialAvailable: false, checkoutAvailable: false, pendingCheckoutId: attemptId },
    }) : url.endsWith('/catalog') ? json({ items: [item] }) : json({ attemptId, status: 'checkout_open', checkoutUrl: 'https://checkout.stripe.com/c/pay/fixture' }))
    vi.stubGlobal('fetch', fetch)
    render(<BillingPage userId="teacher" />)
    expect(await screen.findByRole('button', { name: 'Resume checkout' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start 30-day Pro trial' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue to checkout' })).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(`/api/billing/checkout/${attemptId}`, { cache: 'no-store' })
  })

  it('prefers the account’s unfinished checkout to a stale return URL', async () => {
    const oldAttempt = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const pendingAttempt = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    history.replaceState({}, '', `/billing?checkout=${oldAttempt}&result=success`)
    const fetch = vi.fn((url: string) => url.endsWith('/subscription') ? json({
      ...free, options: { ...free.options, checkoutAvailable: false, pendingCheckoutId: pendingAttempt },
    }) : url.endsWith('/catalog') ? json({ items: [item] }) : url.endsWith(oldAttempt)
      ? json({ attemptId: oldAttempt, status: 'expired', checkoutUrl: null })
      : json({ attemptId: pendingAttempt, status: 'checkout_open', checkoutUrl: 'https://checkout.stripe.com/c/pay/current' }))
    vi.stubGlobal('fetch', fetch)
    render(<BillingPage userId="teacher" />)
    expect(await screen.findByRole('button', { name: 'Resume checkout' })).toBeInTheDocument()
    expect(screen.queryByText('Checkout expired.')).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(`/api/billing/checkout/${pendingAttempt}`, { cache: 'no-store' })
  })

  it('polls a success return whose server status is still open', async () => {
    const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    history.replaceState({}, '', `/billing?checkout=${attemptId}&result=success`)
    vi.useFakeTimers()
    try {
      const status = vi.fn()
        .mockImplementationOnce(() => json({ attemptId, status: 'checkout_open', checkoutUrl: 'https://checkout.stripe.com/c/pay/current' }))
        .mockImplementation(() => json({ attemptId, status: 'active', checkoutUrl: null }))
      vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/subscription') ? json(free)
        : url.endsWith('/catalog') ? json({ items: [] }) : status()))
      render(<BillingPage userId="teacher" />)
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(screen.getByText('Payment or plan access is being checked.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Resume checkout' })).not.toBeInTheDocument()
      await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
      expect(screen.getByText('Payment and plan access confirmed.')).toBeInTheDocument()
      expect(status).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })

  it('shows disabled configuration without purchase actions', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({}, 404)))
    render(<BillingPage userId="teacher" />)
    expect(await screen.findByText('Billing is unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue to checkout' })).not.toBeInTheDocument()
  })
})
