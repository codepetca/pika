import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
const occurrenceBinding = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

describe('StudentAttendanceCheckIn', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('binds the handoff to the POST-authenticated student returned by the server', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      state: 'checked_in',
      title: 'You are checked in',
      description: 'Your attendance was recorded.',
      attendanceStatus: 'present',
      recordedAt: '2026-09-02T13:01:00.000Z',
      classroomId: '20000000-0000-4000-8000-000000000001',
      classroomName: 'PPZ3C — Health for Life',
      studentId,
      occurrenceBinding,
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)

    render(<StudentAttendanceCheckIn entryToken="sealed-entry-token" canCheckIn />)

    expect(await screen.findByRole('heading', { name: 'You are checked in' })).toBeInTheDocument()
    expect(screen.getByText('PPZ3C — Health for Life')).toBeInTheDocument()
    expect(screen.getByText('9:01 AM')).toBeInTheDocument()
    expect(screen.queryByText('Pika attendance')).not.toBeInTheDocument()
    expect(screen.queryByText('Your attendance was recorded.')).not.toBeInTheDocument()
    expect(screen.queryByText(/Confirmed|EDT|EST/)).not.toBeInTheDocument()
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
      occurrenceBinding,
      attendanceStatus: 'present',
      confirmedAt: '2026-09-02T13:01:00.000Z',
    })
    expect(attendanceClientMocks.invalidate).toHaveBeenCalledWith(studentId)
  })

  it('shows a classroom name longer than 200 characters without losing the confirmation', async () => {
    const classroomName = 'Health and Wellness '.repeat(20).trim()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      state: 'checked_in', title: 'You are checked in',
      description: 'Your attendance was recorded.', classroomName,
      recordedAt: '2026-10-08T13:06:00.000Z',
    }), { status: 200 })))
    render(<StudentAttendanceCheckIn entryToken="sealed-entry-token" canCheckIn />)
    expect(await screen.findByRole('heading', { name: 'You are checked in' })).toBeVisible()
    expect(screen.getByText(classroomName)).toBeVisible()
    expect(screen.getByText('9:06 AM')).toBeVisible()
  })

  it('retains keyboard focus on the semantic return link as confirmation updates its destination', async () => {
    let resolveCheckIn!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>(resolve => {
      resolveCheckIn = resolve
    })))
    const user = userEvent.setup()
    render(<StudentAttendanceCheckIn entryToken="sealed-entry-token" canCheckIn />)

    const loadingReturn = screen.getByRole('link', { name: 'Back to classrooms', exact: true })
    expect(loadingReturn).toHaveAttribute('href', '/classrooms')
    await user.tab()
    expect(loadingReturn).toHaveFocus()

    await act(async () => resolveCheckIn(new Response(JSON.stringify({
      state: 'checked_in',
      title: 'You are checked in',
      description: 'Your attendance was recorded.',
      classroomId: '20000000-0000-4000-8000-000000000001',
    }), { status: 200 })))

    const confirmedReturn = await screen.findByRole('link', { name: 'Back to classroom', exact: true })
    expect(confirmedReturn).toBe(loadingReturn)
    expect(confirmedReturn).toHaveFocus()
    expect(confirmedReturn).toHaveAttribute('href', '/classrooms/20000000-0000-4000-8000-000000000001?tab=today')
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
        classroomName: 'PPZ3C — Health for Life',
        recordedAt: '2026-01-08T14:06:00.000Z',
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)

    render(<StudentAttendanceCheckIn entryToken="sealed-entry-token" canCheckIn classroomName="PPZ3C — Health for Life" />)
    expect(await screen.findByRole('heading', { name: 'Not checked-in' }))
      .toBeInTheDocument()
    expect(screen.getByText('PPZ3C — Health for Life')).toBeInTheDocument()
    expect(screen.queryByText(/It is safe to retry/)).not.toBeInTheDocument()
    expect(screen.queryByText('You are checked in')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'You are already checked in' }))
      .toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to classroom' })).toBeInTheDocument()
    expect(screen.getByText('PPZ3C — Health for Life')).toBeInTheDocument()
    expect(screen.getByText('9:06 AM')).toBeInTheDocument()
    expect(screen.queryByText('No additional attendance record was created.')).not.toBeInTheDocument()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    const firstBody = JSON.parse(fetcher.mock.calls[0][1].body)
    const retryBody = JSON.parse(fetcher.mock.calls[1][1].body)
    expect(retryBody.attemptId).toBe(firstBody.attemptId)
  })

  it('resolves a stable classroom QR after authentication and clearly shows closed attendance', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      state: 'closed',
      title: 'Attendance is not open',
      description: 'This classroom poster works when your teacher opens attendance.',
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)

    render(
      <StudentAttendanceCheckIn
        entryToken={'a'.repeat(43)}
        canCheckIn
        mode="classroom"
        classroomName="PPZ3C — Health for Life"
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Attendance is not open' })).toBeVisible()
    expect(screen.getByText('PPZ3C — Health for Life')).toBeVisible()
    expect(screen.getByText('This classroom poster works when your teacher opens attendance.'))
      .toBeVisible()
    expect(fetcher).toHaveBeenCalledWith(
      '/api/student/attendance/classroom-check-in',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      classroomQrToken: 'a'.repeat(43),
    })
  })

  it('renders a revoked classroom QR as a title-only terminal state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      state: 'invalid',
      title: 'This classroom QR is no longer valid',
    }), { status: 200 })))

    render(
      <StudentAttendanceCheckIn
        entryToken={'a'.repeat(43)}
        canCheckIn
        mode="classroom"
      />,
    )

    expect(await screen.findByRole('heading', { name: 'This classroom QR is no longer valid' })).toBeVisible()
    expect(screen.queryByText('Ask your teacher for the current classroom attendance poster.'))
      .not.toBeInTheDocument()
  })
})
