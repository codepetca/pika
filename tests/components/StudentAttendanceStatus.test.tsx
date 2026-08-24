import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  resolveVisibleStudentAttendanceState,
  StudentAttendanceStatus,
  useStudentAttendanceStatusView,
} from '@/components/StudentAttendanceStatus'
import {
  clearAuthoritativeStudentAttendanceConfirmation,
  fetchStudentAttendanceStatus,
  invalidateStudentAttendanceStatus,
  preserveAuthoritativeStudentAttendanceConfirmation,
} from '@/lib/student-attendance-client'

const classroomOne = '20000000-0000-4000-8000-000000000001'
const studentOne = '30000000-0000-4000-8000-000000000001'
const studentTwo = '30000000-0000-4000-8000-000000000002'

describe('StudentAttendanceStatus', () => {
  afterEach(() => {
    invalidateStudentAttendanceStatus()
    clearAuthoritativeStudentAttendanceConfirmation()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function HookHarness() {
    const { view, refreshing, now } = useStudentAttendanceStatusView(
      studentOne,
    )
    return <StudentAttendanceStatus
      state={view?.classrooms.find((item) => item.classroomId === classroomOne)}
      refreshing={refreshing}
      now={now}
      variant="banner"
    />
  }

  function statusResponse(body: unknown) {
    const payload = {
      studentId: studentOne,
      ...(body as Record<string, unknown>),
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Pika-Student-Id': String(payload.studentId),
      },
    })
  }

  function statusFailure(studentId: string) {
    return new Response(JSON.stringify({
      error: 'Attendance status is temporarily unavailable',
    }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'X-Pika-Student-Id': studentId,
      },
    })
  }

  async function flushAsyncState() {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('shows the concise QR-preserving prompt only in the matching open classroom', () => {
    render(<StudentAttendanceStatus
      state={{ classroomId: classroomOne, state: 'open', opensAt: null, closesAt: null }}
      variant="banner"
    />)

    expect(screen.getByText('Scan QR for Attendance')).toBeInTheDocument()
    expect(screen.queryByText('Attendance check-in is open')).not.toBeInTheDocument()
    expect(screen.queryByText('Scan the QR shown by your teacher.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('uses only a subtle QR-scan indicator on the classroom index', () => {
    render(<StudentAttendanceStatus
      state={{ classroomId: classroomOne, state: 'open', opensAt: null, closesAt: null }}
      variant="index"
    />)

    const status = screen.getByRole('status', { name: 'Attendance check-in is open' })
    expect(status).toHaveTextContent('')
    expect(status).toHaveClass('shadow-sm', 'ring-1', 'ring-primary/30')
    expect(status).not.toHaveClass('motion-safe:animate-pulse')
    expect(status.querySelector('.lucide-scan-qr-code')).toBeInTheDocument()
    expect(screen.queryByText(/Scan your teacher’s QR/i)).not.toBeInTheDocument()
  })

  it('shows only the student’s own confirmed status and Toronto time', () => {
    render(<StudentAttendanceStatus
      state={{
        classroomId: classroomOne,
        state: 'confirmed',
        opensAt: null,
        closesAt: null,
        attendanceStatus: 'late',
        confirmedAt: '2026-08-23T13:07:00.000Z',
      }}
      variant="banner"
    />)

    expect(screen.getByText('Checked in — Late')).toBeInTheDocument()
    expect(screen.getByText(/Confirmed at 9:07 a\.m\. EDT\./i)).toBeInTheDocument()
  })

  it('suppresses an open prompt at the known close instant', () => {
    expect(resolveVisibleStudentAttendanceState({
      classroomId: classroomOne,
      state: 'open',
      opensAt: '2026-08-23T13:00:00.000Z',
      closesAt: '2026-08-23T14:00:00.000Z',
    }, new Date('2026-08-23T14:00:00.000Z'))).toBeNull()
  })

  it('forces a timed network refresh when a scheduled session opens inside the cache TTL', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T13:00:00.000Z'))
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(statusResponse({
        classrooms: [{
          classroomId: classroomOne,
          state: 'scheduled',
          opensAt: '2026-08-23T13:00:02.000Z',
          closesAt: '2026-08-23T14:00:00.000Z',
        }],
        nextRefreshAt: '2026-08-23T13:00:02.000Z',
        serverNow: '2026-08-23T13:00:00.000Z',
      }))
      .mockResolvedValueOnce(statusResponse({
        classrooms: [{
          classroomId: classroomOne,
          state: 'open',
          opensAt: '2026-08-23T13:00:02.000Z',
          closesAt: '2026-08-23T14:00:00.000Z',
        }],
        nextRefreshAt: '2026-08-23T13:00:17.000Z',
        serverNow: '2026-08-23T13:00:02.000Z',
      }))
    vi.stubGlobal('fetch', fetchMock)

    render(<HookHarness />)
    await flushAsyncState()
    expect(screen.queryByText('Scan QR for Attendance')).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Scan QR for Attendance')).toBeInTheDocument()
  })

  it('hides at a sub-second exact close and retries a failed refresh without stale QR copy', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T13:59:59.900Z'))
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(statusResponse({
        classrooms: [{
          classroomId: classroomOne,
          state: 'open',
          opensAt: '2026-08-23T13:00:00.000Z',
          closesAt: '2026-08-23T14:00:00.000Z',
        }],
        nextRefreshAt: '2026-08-23T14:00:00.000Z',
        serverNow: '2026-08-23T13:59:59.900Z',
      }))
      .mockRejectedValue(new Error('service unavailable'))
    vi.stubGlobal('fetch', fetchMock)

    render(<HookHarness />)
    await flushAsyncState()
    expect(screen.getByText('Scan QR for Attendance')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Scan QR for Attendance')).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(screen.queryByText('Scan QR for Attendance')).not.toBeInTheDocument()
  })

  it.each([
    {
      name: 'Toronto midnight',
      now: '2026-08-24T03:59:59.900Z',
      validUntil: '2026-08-24T04:00:00.000Z',
      closesAt: '2026-08-23T14:00:00.000Z',
    },
    {
      name: 'an overnight close',
      now: '2026-08-24T04:59:59.900Z',
      validUntil: '2026-08-24T05:00:00.000Z',
      closesAt: '2026-08-24T05:00:00.000Z',
    },
  ])('hides an expired confirmation at $name even when refreshes fail', async ({
    now,
    validUntil,
    closesAt,
  }) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(now))
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(statusResponse({
        classrooms: [{
          classroomId: classroomOne,
          state: 'confirmed',
          opensAt: '2026-08-23T13:00:00.000Z',
          closesAt,
          attendanceStatus: 'present',
          confirmedAt: '2026-08-23T13:07:00.000Z',
          validUntil,
        }],
        nextRefreshAt: validUntil,
        serverNow: now,
      }))
      .mockRejectedValue(new Error('service unavailable'))
    vi.stubGlobal('fetch', fetchMock)

    render(<HookHarness />)
    await flushAsyncState()
    expect(screen.getByText('Checked in — Present')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Checked in — Present')).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(screen.queryByText('Checked in — Present')).not.toBeInTheDocument()
  })

  it.each([
    ['two hours ahead', '2026-08-23T15:59:59.900Z'],
    ['two hours behind', '2026-08-23T11:59:59.900Z'],
  ])('uses server time when the device clock is %s', async (_label, clientNow) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(clientNow))
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(statusResponse({
        classrooms: [{
          classroomId: classroomOne,
          state: 'open',
          opensAt: '2026-08-23T13:00:00.000Z',
          closesAt: '2026-08-23T14:00:00.000Z',
        }],
        nextRefreshAt: '2026-08-23T14:00:00.000Z',
        serverNow: '2026-08-23T13:59:59.900Z',
      }))
      .mockRejectedValue(new Error('service unavailable'))
    vi.stubGlobal('fetch', fetchMock)

    render(<HookHarness />)
    await flushAsyncState()
    expect(screen.getByText('Scan QR for Attendance')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Scan QR for Attendance')).not.toBeInTheDocument()
  })

  it('keeps server time advancing when a cached view remounts just before close', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2036-08-23T13:59:59.800Z'))
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(statusResponse({
        classrooms: [{
          classroomId: classroomOne,
          state: 'open',
          opensAt: '2026-08-23T13:00:00.000Z',
          closesAt: '2026-08-23T14:00:00.000Z',
        }],
        nextRefreshAt: '2026-08-23T14:00:00.000Z',
        serverNow: '2026-08-23T13:59:59.800Z',
      }))
      .mockRejectedValue(new Error('service unavailable'))
    vi.stubGlobal('fetch', fetchMock)

    const firstMount = render(<HookHarness />)
    await flushAsyncState()
    expect(screen.getByText('Scan QR for Attendance')).toBeInTheDocument()
    firstMount.unmount()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    render(<HookHarness />)
    await flushAsyncState()
    expect(screen.getByText('Scan QR for Attendance')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(screen.queryByText('Scan QR for Attendance')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('preserves an authoritative duplicate-scan confirmation while projection remains open', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2036-08-23T13:00:00.000Z'))
    preserveAuthoritativeStudentAttendanceConfirmation({
      studentId: studentOne,
      classroomId: classroomOne,
      attendanceStatus: 'present',
      confirmedAt: '2026-08-23T13:01:00.000Z',
    })
    const fetchMock = vi.fn().mockResolvedValue(statusResponse({
      classrooms: [{
        classroomId: classroomOne,
        state: 'open',
        opensAt: '2026-08-23T13:00:00.000Z',
        closesAt: '2026-08-23T14:00:00.000Z',
      }],
      nextRefreshAt: '2026-08-23T13:00:15.000Z',
      serverNow: '2026-08-23T13:01:01.000Z',
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(<HookHarness />)
    await flushAsyncState()

    expect(screen.getByText('Checked in — Present')).toBeInTheDocument()
    expect(screen.queryByText('Scan QR for Attendance')).not.toBeInTheDocument()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Checked in — Present')).toBeInTheDocument()
  })

  it('bounds projection-convergence reads to one refresh per five seconds', async () => {
    vi.useFakeTimers()
    preserveAuthoritativeStudentAttendanceConfirmation({
      studentId: studentOne,
      classroomId: classroomOne,
      attendanceStatus: 'present',
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(statusResponse({
      classrooms: [{
        classroomId: classroomOne,
        state: 'open',
        opensAt: '2026-08-23T13:00:00.000Z',
        closesAt: '2026-08-23T14:00:00.000Z',
      }],
      nextRefreshAt: '2026-08-23T13:01:16.000Z',
      serverNow: '2026-08-23T13:01:01.000Z',
    })))

    const view = await fetchStudentAttendanceStatus(studentOne, { forceNetwork: true })

    expect(view.classrooms[0]).toEqual(expect.objectContaining({
      state: 'confirmed',
      attendanceStatus: 'present',
    }))
    expect(view.nextRefreshAt).toBe('2026-08-23T13:01:06.000Z')
  })

  it('caps a positive handoff at the open occurrence close', async () => {
    vi.useFakeTimers()
    preserveAuthoritativeStudentAttendanceConfirmation({
      studentId: studentOne,
      classroomId: classroomOne,
      attendanceStatus: 'present',
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(statusResponse({
      classrooms: [{
        classroomId: classroomOne,
        state: 'open',
        opensAt: '2026-08-23T13:00:00.000Z',
        closesAt: '2026-08-23T14:00:00.000Z',
      }],
      nextRefreshAt: '2026-08-23T14:00:00.000Z',
      serverNow: '2026-08-23T13:59:59.900Z',
    })))

    const view = await fetchStudentAttendanceStatus(studentOne, { forceNetwork: true })

    expect(view.classrooms[0]).toEqual(expect.objectContaining({
      state: 'confirmed',
      validUntil: '2026-08-23T14:00:00.000Z',
    }))
    expect(view.nextRefreshAt).toBe('2026-08-23T14:00:00.000Z')
  })

  it.each(['closed', 'scheduled', 'no_session'] as const)(
    'clears a prior-occurrence handoff when the projection becomes %s',
    async (state) => {
      preserveAuthoritativeStudentAttendanceConfirmation({
        studentId: studentOne,
        classroomId: classroomOne,
        attendanceStatus: 'present',
      })
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(statusResponse({
        classrooms: [{
          classroomId: classroomOne,
          state,
          opensAt: state === 'no_session' ? null : '2026-08-24T13:00:00.000Z',
          closesAt: state === 'no_session' ? null : '2026-08-24T14:00:00.000Z',
        }],
        nextRefreshAt: '2026-08-24T04:00:00.000Z',
        serverNow: '2026-08-24T04:00:00.000Z',
      })))

      const view = await fetchStudentAttendanceStatus(studentOne, { forceNetwork: true })

      expect(view.classrooms[0]?.state).toBe(state)
    },
  )

  it('never transfers an authoritative confirmation to another student', async () => {
    preserveAuthoritativeStudentAttendanceConfirmation({
      studentId: '30000000-0000-4000-8000-000000000002',
      classroomId: classroomOne,
      attendanceStatus: 'present',
      confirmedAt: '2026-08-23T13:01:00.000Z',
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(statusResponse({
      classrooms: [{
        classroomId: classroomOne,
        state: 'open',
        opensAt: '2026-08-23T13:00:00.000Z',
        closesAt: '2026-08-23T14:00:00.000Z',
      }],
      nextRefreshAt: null,
      serverNow: '2026-08-23T13:01:01.000Z',
    })))

    render(<HookHarness />)
    await flushAsyncState()

    expect(screen.getByText('Scan QR for Attendance')).toBeInTheDocument()
    expect(screen.queryByText('Checked in — Present')).not.toBeInTheDocument()
  })

  it('rejects and does not cache a status response authenticated as another student', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(statusResponse({
        studentId: studentTwo,
        classrooms: [{
          classroomId: classroomOne,
          state: 'confirmed',
          opensAt: '2026-08-23T13:00:00.000Z',
          closesAt: '2026-08-23T14:00:00.000Z',
          attendanceStatus: 'present',
          confirmedAt: '2026-08-23T13:01:00.000Z',
          validUntil: '2026-08-24T04:00:00.000Z',
        }],
        nextRefreshAt: null,
        serverNow: '2026-08-23T13:01:01.000Z',
      }))
      .mockResolvedValueOnce(statusResponse({
        classrooms: [{
          classroomId: classroomOne,
          state: 'open',
          opensAt: '2026-08-23T13:00:00.000Z',
          closesAt: '2026-08-23T14:00:00.000Z',
        }],
        nextRefreshAt: null,
        serverNow: '2026-08-23T13:01:02.000Z',
      }))
    vi.stubGlobal('fetch', fetchMock)

    render(<HookHarness />)
    await flushAsyncState()
    expect(screen.queryByText('Checked in — Present')).not.toBeInTheDocument()

    const recovered = await fetchStudentAttendanceStatus(studentOne)
    expect(recovered.studentId).toBe(studentOne)
    expect(recovered.classrooms[0]?.state).toBe('open')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('clears a visible view and overlay on a differently authenticated failure', async () => {
    vi.useFakeTimers()
    preserveAuthoritativeStudentAttendanceConfirmation({
      studentId: studentOne,
      classroomId: classroomOne,
      attendanceStatus: 'present',
    })
    const openView = {
      classrooms: [{
        classroomId: classroomOne,
        state: 'open',
        opensAt: '2026-08-23T13:00:00.000Z',
        closesAt: '2026-08-23T14:00:00.000Z',
      }],
      nextRefreshAt: '2026-08-23T13:01:02.000Z',
      serverNow: '2026-08-23T13:01:01.000Z',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(statusResponse(openView))
      .mockResolvedValueOnce(statusFailure(studentTwo))
      .mockResolvedValueOnce(statusResponse({ ...openView, nextRefreshAt: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<HookHarness />)
    await flushAsyncState()
    expect(screen.getByText('Checked in — Present')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(screen.queryByText('Checked in — Present')).not.toBeInTheDocument()
    expect(screen.queryByText('Scan QR for Attendance')).not.toBeInTheDocument()

    const recovered = await fetchStudentAttendanceStatus(studentOne)
    expect(recovered.classrooms[0]?.state).toBe('open')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('clears the handoff when attendance becomes unavailable for the classroom', async () => {
    preserveAuthoritativeStudentAttendanceConfirmation({
      studentId: studentOne,
      classroomId: classroomOne,
      attendanceStatus: 'present',
      confirmedAt: '2026-08-23T13:01:00.000Z',
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(statusResponse({
      classrooms: [{
        classroomId: classroomOne,
        state: 'unavailable',
        opensAt: null,
        closesAt: null,
      }],
      nextRefreshAt: null,
      serverNow: '2026-08-23T13:01:01.000Z',
    })))

    render(<HookHarness />)
    await flushAsyncState()

    expect(screen.queryByText('Checked in — Present')).not.toBeInTheDocument()
    expect(screen.queryByText('Scan QR for Attendance')).not.toBeInTheDocument()
  })
})
