import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BillingAccessNotice } from '@/components/billing/BillingAccessNotice'
import { ClassroomBillingNotice } from '@/components/billing/ClassroomBillingNotice'

describe('ClassroomBillingNotice', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('links teachers to billing and clears the warning when renewed access is verified', async () => {
    const endsAt = '2026-11-08T19:30:42Z'
    const trial = { state: 'trial', plan: 'pro', classroomLimit: 5, accessEndsAt: endsAt, renewalAt: null,
      canStartPaidWork: true, retryable: false, accessNotice: 'ending_within_24_hours' }
    const paid = { ...trial, state: 'paid', accessEndsAt: null, renewalAt: endsAt, accessNotice: undefined }
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => trial })
      .mockResolvedValueOnce({ ok: true, json: async () => paid })
    vi.stubGlobal('fetch', fetch)

    render(<ClassroomBillingNotice />)
    expect(await screen.findByRole('link', { name: 'Plans and billing' })).toHaveAttribute('href', '/billing')
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Your Pro trial ends')
    expect(status.querySelector('time')).toHaveAttribute('datetime', endsAt)
    expect(fetch).toHaveBeenCalledWith('/api/billing/subscription', expect.objectContaining({ cache: 'no-store', headers: { 'x-pika-billing-access-notice': '1' } }))

    fireEvent.focus(window)
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })
})

describe('BillingAccessNotice', () => {
  it('announces the exact cutoff and what remains available after expiry', () => {
    const cutoff = '2026-11-08T19:30:42Z'
    render(<BillingAccessNotice notice="ended" accessEndsAt={cutoff} />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Access ended')
    expect(status).toHaveTextContent('Access to paid features ended')
    expect(status).toHaveTextContent('New paid classroom work and new RepoLight analysis are restricted.')
    expect(status).toHaveTextContent('Existing student work remains available.')
    expect(status.querySelector('time')).toHaveAttribute('datetime', cutoff)
  })
})
