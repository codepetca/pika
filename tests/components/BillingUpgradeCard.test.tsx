import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BillingUpgradeCard } from '@/app/billing/BillingUpgradeCard'

const offer = { offeringVersionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', plan: 'pro' as const, name: 'Pro' as const,
  currency: 'cad' as const, interval: 'year' as const, unitAmount: 27900, classroomLimit: 5 }
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const quote = { plan: 'pro', currency: 'cad', unusedCreditAmount: -3000, remainingChargeAmount: 8000, amountDue: 5000,
  nextRenewalAt: '2030-01-01T00:00:00Z', nextRecurringAmount: 27900, expiresAt: '2029-12-01T00:00:00Z',
  quoteRevision: 2, quoteDigest: 'a'.repeat(64) }
const quoted = { operationId, status: 'quoted', quote }
const json = (value: unknown, status = 200) => Promise.resolve({ ok: status === 200, status, json: async () => value } as Response)

describe('BillingUpgradeCard', () => {
  beforeEach(() => { sessionStorage.clear(); vi.spyOn(crypto, 'randomUUID').mockReturnValue(operationId) })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
  it('displays the server quote and confirms only its revision and digest', async () => {
    const fetch = vi.fn((url: string) => url.endsWith('/confirm') ? json({ operationId, status: 'payment_pending', quote: null }) : json(quoted))
    vi.stubGlobal('fetch', fetch); const onActivated = vi.fn()
    render(<BillingUpgradeCard userId="teacher" offers={[offer]} onActivated={onActivated} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review upgrade' }))
    expect(await screen.findByText('Amount due now: CAD 50.00')).toBeInTheDocument()
    expect(screen.getByText('Unused credit: −CAD 30.00')).toBeInTheDocument()
    expect(screen.getByText('Remaining charge for Pro: CAD 80.00')).toBeInTheDocument()
    expect(screen.getByText(/Next renewal: CAD 279.00 \/ year/)).toBeInTheDocument()
    expect(screen.getByText(/no tax or discounts/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm upgrade and pay CAD 50.00' }))
    expect(await screen.findByText(/not active yet/)).toBeInTheDocument()
    expect(onActivated).not.toHaveBeenCalled()
    const call = fetch.mock.calls.find(([url]) => url.endsWith('/confirm')) as unknown as [string, RequestInit]
    expect(JSON.parse(call[1].body as string)).toEqual({ operationId, quoteRevision: 2, quoteDigest: quote.quoteDigest })
  })
  it('retries an uncertain confirmation with the same quote and only reports active after checking', async () => {
    let confirms = 0
    const fetch = vi.fn((url: string) => url.endsWith('/confirm') ? (++confirms === 1 ? Promise.reject(new Error('network')) : json({ operationId, status: 'payment_pending', quote: null }))
      : url.endsWith(operationId) ? json({ operationId, status: 'active', quote: null }) : json(quoted))
    vi.stubGlobal('fetch', fetch); const activated = vi.fn()
    render(<BillingUpgradeCard userId="teacher" offers={[offer]} onActivated={activated} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review upgrade' }))
    fireEvent.click(await screen.findByRole('button', { name: /Confirm upgrade/ }))
    await screen.findByText(/Confirmation could not be verified/)
    fireEvent.click(screen.getByRole('button', { name: /Confirm upgrade/ }))
    await screen.findByText(/not active yet/)
    const calls = fetch.mock.calls.filter(([url]) => url.endsWith('/confirm')) as unknown as [string, RequestInit][]
    expect(calls[0][1].body).toBe(calls[1][1].body)
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }))
    expect(await screen.findByText('Your upgrade is active.')).toBeInTheDocument()
    expect(activated).toHaveBeenCalledOnce()
  })
  it('reuses the operation after an uncertain start', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('network')); vi.stubGlobal('fetch', fetch)
    render(<BillingUpgradeCard userId="teacher" offers={[offer]} onActivated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review upgrade' }))
    await screen.findByText(/Could not prepare/)
    fireEvent.click(screen.getByRole('button', { name: 'Retry quote' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetch.mock.calls[0][1].body).operationId).toBe(JSON.parse(fetch.mock.calls[1][1].body).operationId)
  })
  it('clears a rejected reservation only after an authenticated status read confirms it is absent', async () => {
    const fetch = vi.fn((url: string) => url.endsWith(operationId)
      ? json({ error: 'Upgrade operation not found' }, 404) : json({ error: 'Ineligible' }, 409))
    vi.stubGlobal('fetch', fetch)
    render(<BillingUpgradeCard userId="teacher" offers={[offer]} onActivated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review upgrade' }))
    await screen.findByText(/Could not prepare/)
    expect(screen.getByRole('combobox')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }))
    expect(await screen.findByText(/You can request a new quote/)).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toBeEnabled()
    expect(sessionStorage.getItem('pika-billing-upgrade:teacher')).toBeNull()
  })

  it('keeps an uncertain reservation even if it has not appeared in a status read yet', async () => {
    const fetch = vi.fn((url: string) => url.endsWith(operationId)
      ? json({ error: 'Upgrade operation not found' }, 404) : Promise.reject(new Error('network')))
    vi.stubGlobal('fetch', fetch)
    render(<BillingUpgradeCard userId="teacher" offers={[offer]} onActivated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review upgrade' }))
    await screen.findByText(/Could not prepare/)
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }))
    await screen.findByText(/Could not check/)
    expect(sessionStorage.getItem('pika-billing-upgrade:teacher')).toContain(operationId)
    expect(screen.getByRole('button', { name: 'Retry quote' })).toBeEnabled()
  })

  it('rejects mismatched operation and quote without exposing confirmation', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ ...quoted, operationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })))
    render(<BillingUpgradeCard userId="teacher" offers={[offer]} onActivated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review upgrade' }))
    await screen.findByText(/Could not prepare/)
    expect(screen.queryByRole('button', { name: /Confirm upgrade/ })).not.toBeInTheDocument()
  })
  it('recovers a stored operation and displays support attention', async () => {
    sessionStorage.setItem('pika-billing-upgrade:teacher', JSON.stringify({ id: operationId, offeringId: offer.offeringVersionId }))
    const fetch = vi.fn(() => json({ operationId, status: 'attention', quote: null })); vi.stubGlobal('fetch', fetch)
    render(<BillingUpgradeCard userId="teacher" offers={[]} catalog={[offer]} onActivated={vi.fn()} />)
    expect(await screen.findByText(/Please contact support/)).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(`/api/billing/upgrade/${operationId}`, { cache: 'no-store' })
  })
})
