import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTeacherAttendanceController } from '@/hooks/useTeacherAttendanceController'
import type { TeacherAttendanceView } from '@/lib/teacher-attendance'
import type { Classroom } from '@/types'

const appMessageMock = vi.hoisted(() => ({
  showMessage: vi.fn(),
  clearMessage: vi.fn(),
}))

vi.mock('@/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui')>()
  return {
    ...actual,
    useAppMessage: () => appMessageMock,
  }
})

const classroom: Classroom = {
  id: 'classroom-1',
  teacher_id: 'teacher-1',
  title: 'Attendance Controller Classroom',
  class_code: 'ATTEND',
  theme_color: 'blue',
  term_label: null,
  allow_enrollment: true,
  start_date: null,
  end_date: null,
  lesson_plan_visibility: 'hidden',
  archived_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

const studentId = '10000000-0000-4000-8000-000000000001'

function attendanceView(classDate: string, pendingCommand = false): TeacherAttendanceView {
  return {
    classroomId: classroom.id,
    classDate,
    integration: 'ready',
    session: {
      state: 'open',
      opensAt: `${classDate}T12:45:00.000Z`,
      closesAt: `${classDate}T14:00:00.000Z`,
      sessionStartsAt: `${classDate}T13:00:00.000Z`,
      sessionEndsAt: `${classDate}T14:00:00.000Z`,
      presentThroughAt: `${classDate}T13:10:00.000Z`,
      absentAt: `${classDate}T14:00:00.000Z`,
      revision: 1,
      commandFailed: false,
    },
    sync: { state: 'current', confirmedAt: `${classDate}T13:20:00.000Z` },
    students: [{
      studentId,
      firstName: 'Ada',
      lastName: 'Lovelace',
      status: 'present',
      source: 'student_qr',
      checkedInAt: `${classDate}T13:05:00.000Z`,
      revision: 1,
      hasQrCheckIn: true,
      hasManualOverride: false,
      pendingCommand,
      commandFailed: false,
    }],
  }
}

function mockPendingMarksFetch(pendingCommand = false) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/teacher/attendance/session' && !init?.method) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(attendanceView(
          url.searchParams.get('date') ?? '2026-05-05',
          pendingCommand,
        )),
      }) as any
    }
    if (url.pathname === '/api/teacher/attendance/marks' && init?.method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ outcome: 'applied', appliedCount: 1 }),
      }) as any
    }
    if (url.pathname === '/api/teacher/attendance/check-ins' && init?.method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ outcome: 'pending' }),
      }) as any
    }
    throw new Error(`Unhandled fetch: ${url.toString()}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('useTeacherAttendanceController', () => {
  afterEach(() => {
    vi.useRealTimers()
    appMessageMock.showMessage.mockReset()
    appMessageMock.clearMessage.mockReset()
    vi.unstubAllGlobals()
  })

  it('rejects another command for a student who still owns a pending confirmation', async () => {
    const fetchMock = mockPendingMarksFetch()
    const { result } = renderHook(() => useTeacherAttendanceController({
      classroom,
      selectedDate: '2026-05-05',
      enabled: true,
      isActive: true,
    }))

    await waitFor(() => expect(result.current.view).not.toBeNull())
    vi.useFakeTimers()

    let firstCommand!: Promise<void>
    await act(async () => {
      firstCommand = result.current.submitMarks([studentId], 'late')
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_250)
      await firstCommand
    })
    expect(result.current.pendingStudentIds.has(studentId)).toBe(true)

    await act(async () => {
      void result.current.submitMarks([studentId], 'absent')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchMock.mock.calls.filter(([input, init]) => (
      new URL(String(input), 'http://localhost').pathname === '/api/teacher/attendance/marks'
      && init?.method === 'POST'
    ))).toHaveLength(1)
  })

  it.each([
    ['mark', (controller: ReturnType<typeof useTeacherAttendanceController>) =>
      controller.submitMarks([studentId], 'late')],
    ['check-in reset', (controller: ReturnType<typeof useTeacherAttendanceController>) =>
      controller.resetCheckIns([studentId])],
  ])('rejects a %s for a student with server-reported pending ownership', async (_label, invoke) => {
    const fetchMock = mockPendingMarksFetch(true)
    const confirmMock = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { result } = renderHook(() => useTeacherAttendanceController({
      classroom,
      selectedDate: '2026-05-05',
      enabled: true,
      isActive: true,
    }))

    await waitFor(() => expect(result.current.view).not.toBeNull())
    await act(async () => {
      void invoke(result.current)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
    expect(confirmMock).not.toHaveBeenCalled()
    confirmMock.mockRestore()
  })

  it('keeps a session retry pending while an older terminal failure is retained', async () => {
    let viewReads = 0
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/teacher/attendance/session' && !init?.method) {
        viewReads += 1
        const base = attendanceView('2026-05-05')
        const retryPending = viewReads === 2
        const retryConfirmed = viewReads >= 3
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ...base,
            session: {
              ...base.session,
              state: retryConfirmed ? 'closed' : 'open',
              revision: retryConfirmed ? 2 : 1,
              commandFailed: true,
            },
            sync: {
              state: retryPending ? 'pending' : 'current',
              confirmedAt: base.sync.confirmedAt,
            },
          }),
        }) as any
      }
      if (url.pathname === '/api/teacher/attendance/session' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ outcome: 'applied' }),
        }) as any
      }
      throw new Error(`Unhandled fetch: ${url.toString()}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useTeacherAttendanceController({
      classroom,
      selectedDate: '2026-05-05',
      enabled: true,
      isActive: true,
    }))

    await waitFor(() => expect(result.current.view).not.toBeNull())
    vi.useFakeTimers()

    let command!: Promise<void>
    await act(async () => {
      command = result.current.submitSessionCommand('close')
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
      await command
    })

    expect(viewReads).toBe(3)
    expect(result.current.localSessionPending).toBe(false)
    expect(appMessageMock.showMessage).toHaveBeenCalledWith({
      text: 'Attendance closed',
      tone: 'info',
    })
    expect(appMessageMock.showMessage).not.toHaveBeenCalledWith({
      text: 'Attendance could not be closed',
      tone: 'warning',
    })
  })

  it('keeps a check-in retry pending while an older terminal failure is retained', async () => {
    let viewReads = 0
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/teacher/attendance/session' && !init?.method) {
        viewReads += 1
        const base = attendanceView('2026-05-05')
        const retryPending = viewReads === 2
        const retryConfirmed = viewReads >= 3
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ...base,
            sync: {
              state: retryPending ? 'pending' : 'current',
              confirmedAt: base.sync.confirmedAt,
            },
            students: [{
              ...base.students[0],
              hasQrCheckIn: !retryConfirmed,
              checkedInAt: retryConfirmed ? null : base.students[0].checkedInAt,
              pendingCommand: retryPending,
              commandFailed: true,
            }],
          }),
        }) as any
      }
      if (url.pathname === '/api/teacher/attendance/check-ins' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ outcome: 'pending' }),
        }) as any
      }
      throw new Error(`Unhandled fetch: ${url.toString()}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const confirmMock = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { result } = renderHook(() => useTeacherAttendanceController({
      classroom,
      selectedDate: '2026-05-05',
      enabled: true,
      isActive: true,
    }))

    await waitFor(() => expect(result.current.view).not.toBeNull())
    vi.useFakeTimers()

    let command!: Promise<void>
    await act(async () => {
      command = result.current.resetCheckIns([studentId])
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
      await command
    })

    expect(viewReads).toBe(3)
    expect(result.current.pendingStudentIds.has(studentId)).toBe(false)
    expect(appMessageMock.showMessage).toHaveBeenCalledWith({
      text: '1 QR check-in removed',
      tone: 'info',
    })
    expect(appMessageMock.showMessage).not.toHaveBeenCalledWith({
      text: 'QR check-ins could not be removed',
      tone: 'warning',
    })
    confirmMock.mockRestore()
  })

  it('cancels foreground confirmation after an A to B to A view transition', async () => {
    mockPendingMarksFetch()
    const { result, rerender } = renderHook(
      ({ selectedDate }) => useTeacherAttendanceController({
        classroom,
        selectedDate,
        enabled: true,
        isActive: true,
      }),
      { initialProps: { selectedDate: '2026-05-05' } },
    )

    await waitFor(() => expect(result.current.view?.classDate).toBe('2026-05-05'))
    vi.useFakeTimers()

    let command!: Promise<void>
    await act(async () => {
      command = result.current.submitMarks([studentId], 'late')
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      rerender({ selectedDate: '2026-05-06' })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.pendingStudentIds.has(studentId)).toBe(false)
    await act(async () => {
      rerender({ selectedDate: '2026-05-05' })
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_250)
      await command
    })

    expect(result.current.pendingStudentIds.has(studentId)).toBe(false)
    expect(appMessageMock.showMessage).not.toHaveBeenCalledWith({
      text: 'Update sent; waiting for attendance confirmation',
      tone: 'info',
    })
  })
})
