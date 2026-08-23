import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  resolveVisibleStudentAttendanceState,
  StudentAttendanceStatus,
  useStudentAttendanceStatusView,
} from '@/components/StudentAttendanceStatus'
import { invalidateStudentAttendanceStatus } from '@/lib/student-attendance-client'

const classroomOne = '20000000-0000-4000-8000-000000000001'

describe('StudentAttendanceStatus', () => {
  afterEach(() => {
    invalidateStudentAttendanceStatus()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function HookHarness() {
    const { view, refreshing, now } = useStudentAttendanceStatusView(
      '30000000-0000-4000-8000-000000000001',
    )
    return <StudentAttendanceStatus
      state={view?.classrooms.find((item) => item.classroomId === classroomOne)}
      refreshing={refreshing}
      now={now}
      variant="banner"
    />
  }

  function statusResponse(body: unknown) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  async function flushAsyncState() {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('shows the QR-preserving prompt only in the matching open classroom', () => {
    render(<StudentAttendanceStatus
      state={{ classroomId: classroomOne, state: 'open', opensAt: null, closesAt: null }}
      variant="banner"
    />)

    expect(screen.getByText('Attendance check-in is open')).toBeInTheDocument()
    expect(screen.getByText('Scan the QR shown by your teacher.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
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
      }))
      .mockResolvedValueOnce(statusResponse({
        classrooms: [{
          classroomId: classroomOne,
          state: 'open',
          opensAt: '2026-08-23T13:00:02.000Z',
          closesAt: '2026-08-23T14:00:00.000Z',
        }],
        nextRefreshAt: '2026-08-23T13:00:17.000Z',
      }))
    vi.stubGlobal('fetch', fetchMock)

    render(<HookHarness />)
    await flushAsyncState()
    expect(screen.queryByText('Attendance check-in is open')).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Attendance check-in is open')).toBeInTheDocument()
  })

  it('hides at the exact close instant and retries a failed refresh without stale QR copy', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T13:59:58.000Z'))
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(statusResponse({
        classrooms: [{
          classroomId: classroomOne,
          state: 'open',
          opensAt: '2026-08-23T13:00:00.000Z',
          closesAt: '2026-08-23T14:00:00.000Z',
        }],
        nextRefreshAt: '2026-08-23T14:00:00.000Z',
      }))
      .mockRejectedValue(new Error('service unavailable'))
    vi.stubGlobal('fetch', fetchMock)

    render(<HookHarness />)
    await flushAsyncState()
    expect(screen.getByText('Attendance check-in is open')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Attendance check-in is open')).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(screen.queryByText('Scan the QR shown by your teacher.')).not.toBeInTheDocument()
  })
})
