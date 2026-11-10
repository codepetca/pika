import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BillingPage } from '@/app/billing/BillingPage'

const free = { state: 'free', plan: 'free', classroomLimit: 0, accessEndsAt: null, renewalAt: null, canStartPaidWork: false, retryable: false,
  options: { trialAvailable: true, checkoutAvailable: true, pendingCheckoutId: null, paidTerms: null, hasBillingCustomer: false } }
const item = { offeringVersionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', plan: 'pro', name: 'Pro', currency: 'cad', interval: 'year', unitAmount: 27900, classroomLimit: 5 }
const json = (data: unknown, status = 200) => Promise.resolve({ ok: status === 200, status, json: async () => data } as Response)
const scheduleId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const cancellationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const effectiveAt = '2026-12-08T23:10:00Z'
const paidMax = { ...free, state: 'paid', plan: 'max', classroomLimit: 12, renewalAt: effectiveAt, canStartPaidWork: true,
  options: { ...free.options, trialAvailable: false, checkoutAvailable: false, hasBillingCustomer: true,
    paidTerms: { currency: 'cad', interval: 'year', unitAmount: 55900, upgradeAvailable: false } } }

describe('BillingPage', () => {
  beforeEach(() => { sessionStorage.clear(); history.replaceState({}, '', '/billing') })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('shows an exact Pro quote and reloads the durable installation status after confirmation', async () => {
    const user = userEvent.setup()
    let installed = false
    const fetch = vi.fn((url: string, options?: RequestInit) => {
      if (url.endsWith('/subscription')) return json(paidMax)
      if (url.endsWith('/catalog')) return json({ items: [] })
      if (url.endsWith('/cancellation')) return json(installed ? { scheduleOperationId: scheduleId, cancellationOperationId: null,
        state: 'install_pending', effectiveAt, canCancel: false, canUndo: false } : null)
      if (url.endsWith('/scheduled-change') && options?.method !== 'POST') return json({ items: [item] })
      if (url.endsWith('/confirm')) installed = true
      return json({ operationId: JSON.parse(options?.body as string).operationId, state: installed ? 'confirmed' : 'quoted', plan: 'pro',
        effectiveAt, expiresAt: new Date(Date.now() + 600_000).toISOString(), currency: 'cad', interval: 'year',
        recurringAmount: 27900, classroomLimit: 5, dueNow: 0 })
    })
    vi.stubGlobal('fetch', fetch)
    render(<BillingPage userId="teacher" scheduledBillingAvailable />)
    await user.click(await screen.findByRole('button', { name: 'Review change to Pro' }))
    const dialog = await screen.findByRole('dialog', { name: 'Schedule a change to Pro?' })
    expect(within(dialog).getByText(/CAD 279.00 per year/)).toHaveTextContent('No payment is due today.')
    const confirm = within(dialog).getByRole('button', { name: 'Schedule change' })
    confirm.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Your change to Pro is being scheduled.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Scheduled plan change' })).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Review change to Pro' })).not.toBeInTheDocument()
  })

  it('uses the same owned cancellation operation for undo and keeps the paid Max status', async () => {
    const user = userEvent.setup()
    let status = { scheduleOperationId: scheduleId, cancellationOperationId: null as string | null,
      state: 'scheduled', effectiveAt, canCancel: true, canUndo: false }
    const fetch = vi.fn((url: string, options?: RequestInit) => {
      if (url.endsWith('/subscription')) return json(paidMax)
      if (url.endsWith('/catalog') || url.endsWith('/scheduled-change')) return json({ items: [] })
      if (options?.method === 'POST') {
        const input = JSON.parse(options.body as string)
        expect(input.scheduleOperationId).toBe(scheduleId)
        if (input.action === 'undo') expect(input.operationId).toBe(status.cancellationOperationId)
        status = { ...status, cancellationOperationId: input.operationId, state: input.action === 'cancel' ? 'cancel_scheduled' : 'undone',
          canCancel: input.action === 'undo', canUndo: input.action === 'cancel' }
      }
      return json(status)
    })
    sessionStorage.setItem(`pika-billing-cancel:teacher:${scheduleId}`, cancellationId)
    vi.stubGlobal('fetch', fetch)
    render(<BillingPage userId="teacher" scheduledBillingAvailable />)
    const cancel = await screen.findByRole('button', { name: 'Cancel renewal' })
    cancel.focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Cancel renewal?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel renewal' }))
    expect(await screen.findByText('Renewal cancellation scheduled.')).toBeInTheDocument()
    expect(status.cancellationOperationId).toBe(cancellationId)
    expect(screen.getByText('12 active classrooms')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo cancellation' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Undo cancellation?' })).getByRole('button', { name: 'Restore renewal' }))
    expect(await screen.findByText('Renewal restored. Change to Pro scheduled.')).toBeInTheDocument()
  })

  it('keeps the completed BillingScheduledChangeCard visible after returning on Free', async () => {
    const fetch = vi.fn((url: string) => url.endsWith('/subscription')
      ? json({ ...free, options: { ...free.options, hasBillingCustomer: true } })
      : url.endsWith('/catalog') ? json({ items: [] })
      : json({ scheduleOperationId: scheduleId, cancellationOperationId: cancellationId,
        state: 'completed', effectiveAt, canCancel: false, canUndo: false }))
    vi.stubGlobal('fetch', fetch)
    render(<BillingPage userId="teacher" scheduledBillingAvailable />)
    expect(await screen.findByText('Your paid Max term ended.')).toBeInTheDocument()
    expect(screen.getByText(/Max access ended Dec/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo cancellation' })).not.toBeInTheDocument()
  })

  it.each([
    [true, 'Manage billing'],
    [false, 'Invoices and payment method'],
  ])('names the portal action for its cancellation capabilities and supports keyboard activation', async (portalCancellationAvailable, label) => {
    const user = userEvent.setup()
    const paid = { ...free, state: 'paid', plan: 'pro', classroomLimit: 5, canStartPaidWork: true,
      options: { ...free.options, trialAvailable: false, checkoutAvailable: false, hasBillingCustomer: true } }
    const fetch = vi.fn((url: string) => url.endsWith('/subscription') ? json(paid)
      : url.endsWith('/catalog') ? json({ items: [] }) : json({}, 503))
    vi.stubGlobal('fetch', fetch)
    render(<BillingPage userId="teacher" portalAvailable portalCancellationAvailable={portalCancellationAvailable} />)
    const action = await screen.findByRole('button', { name: label })
    action.focus()
    await user.keyboard('{Enter}')
    expect(fetch).toHaveBeenCalledWith('/api/billing/portal', { method: 'POST' })
  })
  it('loads and starts a trial without catalog or checkout access', async () => {
    const pendingCheckoutId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    history.replaceState({}, '', `/billing?checkout=${pendingCheckoutId}&result=success`)
    const activeTrial = { ...free, state: 'trial', plan: 'pro', classroomLimit: 5, canStartPaidWork: true,
      accessEndsAt: '2026-12-08T18:00:00Z', options: { ...free.options, trialAvailable: false } }
    let started = false
    const fetch = vi.fn((url: string) => {
      if (url === '/api/billing/subscription') return json(started ? activeTrial : {
        ...free, options: { ...free.options, pendingCheckoutId },
      })
      if (url === '/api/billing/trial') { started = true; return json(activeTrial) }
      throw new Error(`Unexpected request ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    render(<BillingPage userId="teacher" purchaseAvailable={false} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start 30-day Pro trial' }))
    expect(await screen.findByText('5 active classrooms')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Checkout status' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Choose a paid plan' })).not.toBeInTheDocument()
    expect(fetch.mock.calls.every(([url]) => ['/api/billing/subscription', '/api/billing/trial'].includes(url))).toBe(true)
  })

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
