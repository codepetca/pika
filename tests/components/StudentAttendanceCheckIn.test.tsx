import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StudentAttendanceCheckIn } from '@/app/attendance/check-in/[token]/StudentAttendanceCheckIn'

const attendanceClientMocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  preserve: vi.fn(),
}))

vi.mock('@/lib/student-attendance-client', () => ({
  invalidateStudentAttendanceStatus: attendanceClientMocks.invalidate,
  preserveAuthoritativeStudentAttendanceConfirmation: attendanceClientMocks.preserve,
}))

const studentId = '30000000-0000-4000-8000-000000000001'

describe('StudentAttendanceCheckIn', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders Bara authoritative success inside Pika', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      state: 'checked_in',
      title: 'You are checked in',
      description: 'Your attendance was recorded.',
      attendanceStatus: 'present',
      recordedAt: '2026-09-02T13:01:00.000Z',
      classroomId: '20000000-0000-4000-8000-000000000001',
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)

    render(<StudentAttendanceCheckIn
      entryToken="sealed-entry-token"
      canCheckIn
      studentId={studentId}
    />)

    expect(await screen.findByRole('heading', { name: 'You are checked in' })).toBeInTheDocument()
    expect(screen.getByText('Your attendance was recorded.')).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledWith('/api/student/attendance/check-in', expect.objectContaining({
      method: 'POST',
    }))
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body).toMatchObject({ entryToken: 'sealed-entry-token' })
    expect(body.attemptId).toMatch(/^[0-9a-f-]{36}$/)
    expect(screen.getByRole('link', { name: 'Back to classroom' })).toHaveAttribute(
      'href',
      '/classrooms/20000000-0000-4000-8000-000000000001?tab=today',
    )
    expect(attendanceClientMocks.preserve).toHaveBeenCalledWith({
      studentId,
      classroomId: '20000000-0000-4000-8000-000000000001',
      attendanceStatus: 'present',
      confirmedAt: '2026-09-02T13:01:00.000Z',
    })
    expect(attendanceClientMocks.invalidate).toHaveBeenCalledWith(studentId)
  })

  it('never claims success for an uncertain response and allows an explicit retry', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        state: 'already_checked_in',
        title: 'You are already checked in',
        description: 'No additional attendance record was created.',
        attendanceStatus: 'present',
        classroomId: '20000000-0000-4000-8000-000000000001',
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)

    render(<StudentAttendanceCheckIn entryToken="sealed-entry-token" canCheckIn />)
    expect(await screen.findByRole('heading', { name: 'We could not confirm check-in' }))
      .toBeInTheDocument()
    expect(screen.queryByText('You are checked in')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'You are already checked in' }))
      .toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to classroom' })).toBeInTheDocument()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    const firstBody = JSON.parse(fetcher.mock.calls[0][1].body)
    const retryBody = JSON.parse(fetcher.mock.calls[1][1].body)
    expect(retryBody.attemptId).toBe(firstBody.attemptId)
  })
})
