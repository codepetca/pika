import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StudentAttendanceCheckIn } from '@/app/attendance/check-in/[token]/StudentAttendanceCheckIn'

describe('StudentAttendanceCheckIn', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders Bara authoritative success inside Pika', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      state: 'checked_in',
      title: 'You are checked in',
      description: 'Your attendance was recorded.',
      attendanceStatus: 'present',
      recordedAt: '2026-09-02T13:01:00.000Z',
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)

    render(<StudentAttendanceCheckIn entryToken="sealed-entry-token" canCheckIn />)

    expect(await screen.findByRole('heading', { name: 'You are checked in' })).toBeInTheDocument()
    expect(screen.getByText('Your attendance was recorded.')).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledWith('/api/student/attendance/check-in', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ entryToken: 'sealed-entry-token' }),
    }))
  })

  it('never claims success for an uncertain response and allows an explicit retry', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        state: 'already_checked_in',
        title: 'You are already checked in',
        description: 'No additional attendance record was created.',
        attendanceStatus: 'present',
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)

    render(<StudentAttendanceCheckIn entryToken="sealed-entry-token" canCheckIn />)
    expect(await screen.findByRole('heading', { name: 'We could not confirm check-in' }))
      .toBeInTheDocument()
    expect(screen.queryByText('You are checked in')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'You are already checked in' }))
      .toBeInTheDocument()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  })
})
