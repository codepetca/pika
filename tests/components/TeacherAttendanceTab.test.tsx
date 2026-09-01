import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TeacherAttendanceTab } from '@/app/classrooms/[classroomId]/TeacherAttendanceTab'
import type { TeacherAttendanceView } from '@/lib/teacher-attendance'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'
import type { TeacherAttendancePolicy } from '@/lib/teacher-attendance-policy'
import { AppMessageProvider, TooltipProvider } from '@/ui'
import type { Classroom, Entry } from '@/types'

const todayMock = vi.hoisted(() => ({
  today: '2026-05-06',
}))

const appMessageMock = vi.hoisted(() => ({
  showMessage: vi.fn(),
  clearMessage: vi.fn(),
}))

vi.mock('@/lib/timezone', () => ({
  getTodayInToronto: () => todayMock.today,
}))

const classDaysMock = vi.hoisted(() => ({
  defaultClassDays: [
    {
      id: 'day-1',
      classroom_id: 'classroom-1',
      date: '2026-05-05',
      prompt_text: null,
      is_class_day: true,
    },
  ],
  classDays: [
    {
      id: 'day-1',
      classroom_id: 'classroom-1',
      date: '2026-05-05',
      prompt_text: null,
      is_class_day: true,
    },
  ],
  error: null as string | null,
  hasLoadedSnapshot: true,
  isLoading: false,
  refresh: vi.fn(),
}))

vi.mock('@/hooks/useClassDays', () => ({
  useClassDaysContext: () => ({
    classDays: classDaysMock.classDays,
    error: classDaysMock.error,
    hasLoadedSnapshot: classDaysMock.hasLoadedSnapshot,
    isLoading: classDaysMock.isLoading,
    refresh: classDaysMock.refresh,
  }),
}))

vi.mock('@/components/StudentLogHistory', () => ({
  StudentLogHistory: ({ studentId }: { studentId: string }) => (
    <div data-testid="student-log-history">History for {studentId}</div>
  ),
}))

vi.mock('@/app/classrooms/[classroomId]/LogSummary', () => ({
  LogSummary: () => (
    <div data-testid="class-log-summary">Cached class summary</div>
  ),
}))

vi.mock('@/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui')>()
  return {
    ...actual,
    useAppMessage: () => appMessageMock,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    RefreshingIndicator: () => <div data-testid="refreshing-indicator" />,
  }
})

const classroom: Classroom = {
  id: 'classroom-1',
  teacher_id: 'teacher-1',
  title: 'Daily Test Classroom',
  class_code: 'ABC123',
  theme_color: 'blue',
  term_label: null,
  allow_enrollment: true,
  start_date: null,
  end_date: null,
  lesson_plan_visibility: 'hidden',
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const secondClassroom: Classroom = {
  ...classroom,
  id: 'classroom-2',
  title: 'Second Classroom',
  class_code: 'DEF456',
}

function entry(overrides: Partial<Entry>): Entry {
  return {
    id: 'entry-1',
    student_id: 'student-1',
    classroom_id: 'classroom-1',
    date: '2026-05-05',
    text: 'Today I worked carefully.',
    rich_content: null,
    version: 1,
    minutes_reported: null,
    mood: null,
    created_at: '2026-05-05T12:00:00.000Z',
    updated_at: '2026-05-05T12:00:00.000Z',
    on_time: true,
    ...overrides,
  }
}

const longLogText =
  'Today I worked on my persuasive letter about bike lanes and revised my thesis after getting peer feedback from my table group.'

function mockJson(data: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(data) }) as any
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function mockLogsFetch() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/teacher/logs?')) {
      return mockJson({
        logs: [
          {
            student_id: 'student-1',
            student_email: 'student1@example.com',
            student_first_name: 'Student1',
            student_last_name: 'Test',
            entry: entry({ text: longLogText }),
            history_preview: [],
          },
          {
            student_id: 'student-2',
            student_email: 'student2@example.com',
            student_first_name: 'Student2',
            student_last_name: 'Test',
            entry: null,
            history_preview: [],
          },
        ],
      })
    }
    throw new Error(`Unhandled fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function combinedAttendanceView(
  overrides: Partial<TeacherAttendanceView> = {},
): TeacherAttendanceView {
  return {
    classroomId: classroom.id,
    classDate: '2026-05-05',
    integration: 'ready',
    session: {
      state: 'open',
      opensAt: '2026-05-05T12:45:00.000Z',
      closesAt: '2026-05-05T14:00:00.000Z',
      sessionStartsAt: '2026-05-05T13:00:00.000Z',
      sessionEndsAt: '2026-05-05T14:00:00.000Z',
      presentThroughAt: '2026-05-05T13:10:00.000Z',
      absentAt: '2026-05-05T14:00:00.000Z',
      revision: 4,
      pendingCommand: false,
      commandFailed: false,
    },
    sync: { state: 'current', confirmedAt: '2026-05-05T13:16:00.000Z' },
    students: [
      {
        studentId: 'student-1',
        firstName: 'Student1',
        lastName: 'Test',
        status: 'present',
        source: 'student_qr',
        checkedInAt: '2026-05-05T13:15:00.000Z',
        revision: 2,
        hasQrCheckIn: true,
        hasManualOverride: false,
        pendingCommand: false,
        commandFailed: false,
      },
      {
        studentId: 'student-2',
        firstName: 'Student2',
        lastName: 'Test',
        status: 'absent',
        source: 'system',
        checkedInAt: null,
        revision: 1,
        hasQrCheckIn: false,
        hasManualOverride: false,
        pendingCommand: false,
        commandFailed: false,
      },
    ],
    ...overrides,
  }
}

function mockCombinedFetch(attendanceView = combinedAttendanceView()) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/teacher/logs?')) {
      return mockJson({
        logs: [
          {
            student_id: 'student-1',
            student_email: 'student1@example.com',
            student_first_name: 'Student1',
            student_last_name: 'Test',
            entry: entry({ text: longLogText }),
            history_preview: [],
          },
          {
            student_id: 'student-2',
            student_email: 'student2@example.com',
            student_first_name: 'Student2',
            student_last_name: 'Test',
            entry: null,
            history_preview: [],
          },
        ],
      })
    }
    if (url.startsWith('/api/teacher/attendance/session?')) {
      return mockJson(attendanceView)
    }
    if (url.startsWith('/api/teacher/attendance/policy?')) {
      return mockJson({ policy: classroomPolicy() })
    }
    throw new Error(`Unhandled fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function classroomPolicy(): TeacherAttendancePolicy {
  return {
    classroomId: classroom.id, timezone: 'America/Toronto',
    sessionStartsLocal: '14:00', sessionEndsLocal: '15:00', sessionEndDayOffset: 0,
    entryOpensMinutesBefore: 10, presentGraceMinutes: 5,
    entryClosesMinutesBeforeEnd: 10, absentMinutesBeforeEnd: 0,
    enabled: true, revision: 1, updatedAt: '2026-05-05T12:00:00Z',
  }
}

function mockCombinedCommandFetch() {
  let attendance = combinedAttendanceView()
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('/api/teacher/logs?')) {
      return mockJson({
        logs: attendance.students.map((student, index) => ({
          student_id: student.studentId,
          student_email: `${student.studentId}@example.com`,
          student_first_name: student.firstName,
          student_last_name: student.lastName,
          entry: index === 0 ? entry({ student_id: student.studentId, text: longLogText }) : null,
          history_preview: [],
        })),
      })
    }
    if (url.startsWith('/api/teacher/attendance/session?')) {
      return mockJson(attendance)
    }
    if (url === '/api/teacher/attendance/marks' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as {
        marks: Array<{ student_id: string; status: 'automatic' | 'present' | 'late' | 'absent' }>
      }
      attendance = {
        ...attendance,
        students: attendance.students.map((student) => {
          const mark = body.marks.find((candidate) => candidate.student_id === student.studentId)
          if (!mark) return student
          return {
            ...student,
            status: mark.status === 'automatic' ? 'present' : mark.status,
            source: mark.status === 'automatic' ? 'student_qr' : 'staff',
            revision: (student.revision ?? 0) + 1,
            hasManualOverride: mark.status !== 'automatic',
          }
        }),
      }
      return mockJson({ outcome: 'applied', appliedCount: body.marks.length })
    }
    if (url === '/api/teacher/attendance/session' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { command: 'open' | 'close' }
      attendance = {
        ...attendance,
        session: {
          ...attendance.session,
          state: body.command === 'open' ? 'open' : 'closed',
          revision: (attendance.session.revision ?? 0) + 1,
        },
      }
      return mockJson({ outcome: 'applied' })
    }
    if (url.startsWith('/api/teacher/attendance/qr?')) {
      return mockJson({
        entryPath: `/attendance/check-in/${'a'.repeat(80)}`,
        expiresAt: '2099-05-05T14:00:00.000Z',
        revision: 4,
      })
    }
    throw new Error(`Unhandled fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function mockManyLogsFetch(count = 30) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/teacher/logs?')) {
      return mockJson({
        logs: Array.from({ length: count }, (_, index) => {
          const number = String(index + 1).padStart(2, '0')
          const studentId = `student-${number}`
          return {
            student_id: studentId,
            student_email: `${studentId}@example.com`,
            student_first_name: `Student${number}`,
            student_last_name: 'Test',
            entry: index % 2 === 0 ? entry({ id: `entry-${number}`, student_id: studentId }) : null,
            history_preview: [],
          }
        }),
      })
    }
    throw new Error(`Unhandled fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('TeacherAttendanceTab', () => {
  afterEach(() => {
    cleanup()
    invalidateCachedJSONMatching('teacher-attendance-policy:')
    vi.useRealTimers()
    window.localStorage.clear()
    todayMock.today = '2026-05-06'
    classDaysMock.classDays = [...classDaysMock.defaultClassDays]
    classDaysMock.error = null
    classDaysMock.hasLoadedSnapshot = true
    classDaysMock.isLoading = false
    classDaysMock.refresh.mockReset()
    appMessageMock.showMessage.mockReset()
    appMessageMock.clearMessage.mockReset()
    vi.unstubAllGlobals()
  })

  it('keeps saved hours on past, current, and future dates, separate from the QR window', async () => {
    const fetchMock = mockCombinedFetch()
    render(<TooltipProvider><AppMessageProvider>
      <TeacherAttendanceTab classroom={classroom} attendanceEnabled />
    </AppMessageProvider></TooltipProvider>)
    const hours = await screen.findByRole('button', { name: 'Attendance hours, 2:00 PM to 3:00 PM' })
    expect(hours).toHaveTextContent('2:00 PM - 3:00 PM')
    expect(hours).not.toHaveTextContent('8:45')
    expect(screen.getByRole('button', { name: 'Select Daily date' })).toHaveTextContent('Tue May 5')
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }))
    expect(screen.getByRole('button', { name: 'Select Daily date' })).toHaveTextContent('Wed May 6')
    expect(hours).toHaveTextContent('2:00 PM - 3:00 PM')
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }))
    expect(screen.getByRole('button', { name: 'Select Daily date' })).toHaveTextContent('Thu May 7')
    expect(hours).toHaveTextContent('2:00 PM - 3:00 PM')
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/teacher/attendance/policy?'))).toHaveLength(1)
  })

  it('shows a policy read failure as unavailable, not as unset hours', async () => {
    const fetchMock = mockCombinedFetch()
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((input) => String(input).startsWith('/api/teacher/attendance/policy?')
      ? mockJson({ error: 'Unavailable' }, false) : original(input))
    render(<TooltipProvider><AppMessageProvider>
      <TeacherAttendanceTab classroom={classroom} attendanceEnabled />
    </AppMessageProvider></TooltipProvider>)
    expect(await screen.findByRole('button', { name: 'Attendance hours unavailable' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Attendance hours could not be loaded')
    expect(screen.queryByRole('button', { name: 'Set attendance hours' })).not.toBeInTheDocument()
  })

  it('preserves the archived read-only occurrence display without calling the active-policy API', async () => {
    const fetchMock = mockCombinedFetch()
    render(<TooltipProvider><AppMessageProvider>
      <TeacherAttendanceTab classroom={{ ...classroom, archived_at: '2026-05-06T12:00:00Z' }} attendanceEnabled />
    </AppMessageProvider></TooltipProvider>)
    expect(await screen.findByText('8:45 AM - 10:00 AM')).toBeVisible()
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/teacher/attendance/policy?'))).toBe(false)
    expect(screen.queryByText(/Attendance hours could not be loaded/)).not.toBeInTheDocument()
  })

  it('shows a full-width table with a truncated day-log column when no student is selected', async () => {
    mockLogsFetch()

    render(<TeacherAttendanceTab classroom={classroom} />)

    const logText = await screen.findByText(longLogText)
    const logHeader = screen.getByRole('columnheader', {
      name: 'Log 1 complete, 1 incomplete',
    })
    const logSortButton = within(logHeader).getByRole('button', {
      name: 'Log 1 complete, 1 incomplete',
    })
    const logLabel = within(logSortButton).getByText('Log')
    const logCounts = within(logSortButton).getByLabelText('1 complete, 1 incomplete')

    expect(logHeader).toHaveAttribute('aria-sort', 'none')
    expect(logLabel.nextElementSibling).toBe(logCounts)
    expect(screen.queryByRole('columnheader', { name: 'Status' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Attendance students' })).toHaveAttribute(
      'aria-keyshortcuts',
      'ArrowUp ArrowDown Home End Escape',
    )
    expect(logText).toHaveClass('truncate')
    expect(logText).toHaveAttribute('title', longLogText)
    expect(screen.getByLabelText('Complete')).toBeInTheDocument()
    expect(screen.getByLabelText('Incomplete')).toBeInTheDocument()
    const summaryTitle = screen.getByText('Class Log Summary')
    expect(summaryTitle).toBeInTheDocument()
    expect(summaryTitle.parentElement).not.toHaveClass('border-b', 'border-border')
    expect(summaryTitle.parentElement).toHaveClass('pt-3')
    expect(summaryTitle.parentElement).not.toHaveClass('min-h-10')
    expect(screen.getByTestId('class-log-summary')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hide class log summary' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show class log summary' })).not.toBeInTheDocument()
    const summaryResizeHandle = screen.getByRole('separator', { name: 'Resize class log summary' })
    expect(summaryResizeHandle).toBeInTheDocument()
    expect(summaryResizeHandle).not.toHaveClass('border-b', 'border-border')
    expect(screen.queryByRole('separator', { name: 'Resize Daily panes' })).not.toBeInTheDocument()

    const firstColumnResize = screen.getByRole('separator', { name: 'Resize First column' })
    expect(firstColumnResize).toHaveAttribute('aria-valuemin', '60')
    expect(firstColumnResize).toHaveAttribute('aria-valuemax', '160')
    expect(firstColumnResize).toHaveAttribute('aria-valuenow', '72')
    expect(firstColumnResize).toHaveClass('min-h-control', 'min-w-control')
    fireEvent.keyDown(firstColumnResize, { key: 'Home' })
    expect(firstColumnResize).toHaveAttribute('aria-valuenow', '60')
    fireEvent.keyDown(firstColumnResize, { key: 'ArrowRight' })
    expect(firstColumnResize).toHaveAttribute('aria-valuenow', '68')
    fireEvent.keyDown(firstColumnResize, { key: 'End' })
    expect(firstColumnResize).toHaveAttribute('aria-valuenow', '160')
    expect(screen.getByRole('separator', { name: 'Resize Last column' })).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: 'Resize ID column' })).toBeInTheDocument()

    const tableRegion = screen.getByRole('region', { name: 'Attendance students' })
    tableRegion.focus()
    fireEvent.keyDown(tableRegion, { key: 'ArrowDown' })
    const selectedRow = screen.getByRole('row', { name: /Student1 Test/ })
    expect(selectedRow).toHaveAttribute('id', 'attendance-student-row-student-1')
    expect(selectedRow).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => {
      expect(selectedRow).toHaveFocus()
    })
  })

  it('keeps the Daily-only state to its date selector, ID menu, and existing log table', async () => {
    mockLogsFetch()

    render(<TeacherAttendanceTab classroom={classroom} attendanceEnabled={false} />)

    await screen.findByRole('columnheader', { name: /^Log/ })
    expect(screen.getByRole('button', { name: 'Select Daily date' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Check-in' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Student actions/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Refresh attendance' })).not.toBeInTheDocument()
  })

  it('opens the Daily More menu from the keyboard and restores trigger focus on close', async () => {
    mockLogsFetch()
    const user = userEvent.setup()

    render(<TeacherAttendanceTab classroom={classroom} attendanceEnabled={false} />)

    const trigger = await screen.findByRole('button', { name: 'More actions' })
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('menuitem', { name: 'Hide ID column' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menuitem', { name: 'Hide ID column' })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'More actions' })).toHaveFocus()
    })
  })

  it('closes the Daily More menu with Escape without closing the selected log workspace', async () => {
    mockLogsFetch()
    const user = userEvent.setup()

    render(<TeacherAttendanceTab classroom={classroom} attendanceEnabled={false} />)

    await user.click(await screen.findByRole('cell', { name: 'Student1', exact: true }))
    expect(await screen.findByTestId('student-log-history')).toHaveTextContent('History for student-1')

    const trigger = screen.getByRole('button', { name: 'More actions' })
    await user.click(trigger)
    expect(screen.getByRole('menuitem', { name: 'Hide ID column' })).toHaveFocus()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menuitem', { name: 'Hide ID column' })).not.toBeInTheDocument()
    expect(screen.getByTestId('student-log-history')).toHaveTextContent('History for student-1')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'More actions' })).toHaveFocus()
    })
  })

  it('adds authoritative attendance controls and columns while preserving logs and fully hiding ID', async () => {
    mockCombinedFetch()
    const user = userEvent.setup()

    render(
      <TooltipProvider>
        <AppMessageProvider>
          <TeacherAttendanceTab classroom={classroom} attendanceEnabled />
        </AppMessageProvider>
      </TooltipProvider>,
    )

    expect(await screen.findByRole('columnheader', { name: 'Check-in' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'First' }).closest('thead')).toHaveClass(
      'sticky',
      'top-0',
    )
    expect(screen.getByText(longLogText)).toHaveAttribute('title', longLogText)
    expect(screen.getByRole('button', { name: 'Show QR' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop QR check-in' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Refresh attendance' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Student actions (select students to enable)' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Sort Present first, 1 student' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sort Absent first, 1 student' })).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Select Student1 Test' }))
    expect(screen.getByRole('button', { name: 'Student actions for 1 selected' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Hide ID column' }))

    expect(screen.queryByRole('columnheader', { name: 'ID' })).not.toBeInTheDocument()
    expect(screen.queryByRole('separator', { name: 'Resize ID column' })).not.toBeInTheDocument()
    expect(window.localStorage.getItem('teacher-daily:show-id')).toBe('false')
  })

  it('shows selection controls only when the selected attendance session can be marked', async () => {
    mockCombinedFetch(combinedAttendanceView({
      session: {
        ...combinedAttendanceView().session,
        state: 'scheduled',
      },
    }))

    render(
      <TooltipProvider>
        <AppMessageProvider>
          <TeacherAttendanceTab classroom={classroom} attendanceEnabled />
        </AppMessageProvider>
      </TooltipProvider>,
    )

    expect(await screen.findByRole('columnheader', { name: 'Check-in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open QR check-in' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Student actions/ })).not.toBeInTheDocument()
    const statusGroup = screen.getByRole('group', {
      name: 'Attendance status for Student1 Test',
    })
    for (const button of within(statusGroup).getAllByRole('button')) {
      expect(button).toBeDisabled()
    }
  })

  it('keeps selection controls available for closed-session corrections', async () => {
    mockCombinedFetch(combinedAttendanceView({
      session: {
        ...combinedAttendanceView().session,
        state: 'closed',
      },
    }))
    const user = userEvent.setup()

    render(
      <TooltipProvider>
        <AppMessageProvider>
          <TeacherAttendanceTab classroom={classroom} attendanceEnabled />
        </AppMessageProvider>
      </TooltipProvider>,
    )

    const studentCheckbox = await screen.findByRole('checkbox', {
      name: 'Select Student1 Test',
    })
    expect(screen.getByRole('checkbox', { name: 'Select all students' })).toBeEnabled()
    expect(screen.getByRole('button', {
      name: 'Student actions (select students to enable)',
    })).toBeDisabled()

    await user.click(studentCheckbox)
    expect(screen.getByRole('button', { name: 'Student actions for 1 selected' })).toBeEnabled()
  })

  it('hides and restores the relative date from Daily More actions', async () => {
    mockLogsFetch()
    const user = userEvent.setup()

    const view = render(<TeacherAttendanceTab classroom={classroom} attendanceEnabled={false} />)

    const dateButton = await screen.findByRole('button', { name: 'Select Daily date' })
    expect(dateButton).toHaveTextContent('Tue May 5Yesterday')

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Hide relative date' }))

    expect(dateButton).toHaveTextContent('Tue May 5')
    expect(within(dateButton).queryByText('Yesterday')).not.toBeInTheDocument()
    expect(dateButton.querySelector('[aria-hidden="true"]')).toHaveClass('text-xs', 'leading-4')
    expect(window.localStorage.getItem('teacher-daily:show-relative-date')).toBe('false')

    view.unmount()
    render(<TeacherAttendanceTab classroom={classroom} attendanceEnabled={false} />)

    const restoredDateButton = await screen.findByRole('button', { name: 'Select Daily date' })
    await waitFor(() => {
      expect(within(restoredDateButton).queryByText('Yesterday')).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Show relative date' }))

    expect(restoredDateButton).toHaveTextContent('Tue May 5Yesterday')
    expect(window.localStorage.getItem('teacher-daily:show-relative-date')).toBe('true')
  })

  it('stacks QR override recovery inside the compact attendance status column', async () => {
    const base = combinedAttendanceView()
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/teacher/logs?')) {
        return mockJson({
          logs: base.students.map((student) => ({
            student_id: student.studentId,
            student_email: `${student.studentId}@example.com`,
            student_first_name: student.firstName,
            student_last_name: student.lastName,
            entry: null,
            history_preview: [],
          })),
        })
      }
      if (url.startsWith('/api/teacher/attendance/session?')) {
        return mockJson({
          ...base,
          students: base.students.map((student, index) => index === 0 ? {
            ...student,
            status: 'late',
            source: 'staff',
            hasQrCheckIn: true,
            hasManualOverride: true,
          } : student),
        })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <TooltipProvider>
        <AppMessageProvider>
          <TeacherAttendanceTab classroom={classroom} attendanceEnabled />
        </AppMessageProvider>
      </TooltipProvider>,
    )

    const statusGroup = await screen.findByRole('group', {
      name: 'Attendance status for Student1 Test',
    })
    const undo = screen.getByRole('button', {
      name: 'Undo manual attendance change for Student1 Test',
    })
    expect(statusGroup.parentElement).toHaveClass('flex-col', 'items-end', 'gap-0')
    expect(undo).toBeInTheDocument()
    expect(document.querySelector('colgroup col:last-child')).toHaveClass('w-40')
  })

  it('keeps the entitled Attendance table stable while a date projection is not configured', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/teacher/logs?')) {
        return mockJson({
          logs: [{
            student_id: 'student-1',
            student_email: 'student1@example.com',
            student_first_name: 'Student1',
            student_last_name: 'Test',
            entry: entry({ text: longLogText }),
            history_preview: [],
          }],
        })
      }
      if (url.startsWith('/api/teacher/attendance/session?')) {
        return mockJson(combinedAttendanceView({
          integration: 'not_configured',
          session: {
            ...combinedAttendanceView().session,
            state: 'not_scheduled',
            opensAt: null,
            closesAt: null,
            sessionStartsAt: null,
            sessionEndsAt: null,
            presentThroughAt: null,
            absentAt: null,
            revision: null,
          },
        }))
      }
      if (url.startsWith('/api/teacher/attendance/policy?')) {
        return mockJson({ policy: null })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <TooltipProvider>
        <AppMessageProvider>
          <TeacherAttendanceTab classroom={classroom} attendanceEnabled />
        </AppMessageProvider>
      </TooltipProvider>,
    )

    expect(await screen.findByRole('columnheader', { name: 'Check-in' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Sort attendance by status' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show QR' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Student actions/ })).not.toBeInTheDocument()
    const timingTrigger = screen.getByRole('button', { name: 'Set attendance hours' })
    expect(timingTrigger).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Attendance hours are not configured. Daily logs remain available.',
    )

    await user.click(timingTrigger)
    expect(await screen.findByRole('heading', { name: 'Attendance timing' })).toBeInTheDocument()
    expect(await screen.findByLabelText('Session starts*')).toHaveValue('09:00')
  })

  it('closes selected-student actions with Escape without closing the selected log workspace', async () => {
    mockCombinedFetch()
    const user = userEvent.setup()

    render(
      <TooltipProvider>
        <AppMessageProvider>
          <TeacherAttendanceTab classroom={classroom} attendanceEnabled />
        </AppMessageProvider>
      </TooltipProvider>,
    )

    await user.click(await screen.findByRole('cell', { name: 'Student1', exact: true }))
    expect(await screen.findByTestId('student-log-history')).toHaveTextContent('History for student-1')
    await user.click(screen.getByRole('checkbox', { name: 'Select Student1 Test' }))

    const trigger = screen.getByRole('button', { name: 'Student actions for 1 selected' })
    await user.click(trigger)
    expect(screen.getByRole('menuitem', { name: 'Present' })).toHaveFocus()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menuitem', { name: 'Present' })).not.toBeInTheDocument()
    expect(screen.getByTestId('student-log-history')).toHaveTextContent('History for student-1')
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('sends row and session commands through the authoritative Attendance routes', async () => {
    const fetchMock = mockCombinedCommandFetch()
    const user = userEvent.setup()

    render(
      <TooltipProvider>
        <AppMessageProvider>
          <TeacherAttendanceTab classroom={classroom} attendanceEnabled />
        </AppMessageProvider>
      </TooltipProvider>,
    )

    const status = await screen.findByRole('group', {
      name: 'Attendance status for Student1 Test',
    })
    await user.click(within(status).getByRole('button', { name: 'Late' }))

    await waitFor(() => {
      expect(within(screen.getByRole('group', {
        name: 'Attendance status for Student1 Test',
      })).getByRole('button', { name: 'Late' })).toHaveAttribute('aria-pressed', 'true')
    })

    const marksCall = fetchMock.mock.calls.find(([input]) => String(input) === '/api/teacher/attendance/marks')
    expect(marksCall?.[1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(String(marksCall?.[1]?.body))).toMatchObject({
      classroom_id: classroom.id,
      date: '2026-05-05',
      marks: [{
        student_id: 'student-1',
        status: 'late',
        reason_code: 'staff_correction',
      }],
    })

    await user.click(screen.getByRole('button', { name: 'Stop QR check-in' }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Stop QR check-in' })).not.toBeInTheDocument()
    })
    const sessionCall = fetchMock.mock.calls.find(([input, init]) => (
      String(input) === '/api/teacher/attendance/session' && init?.method === 'POST'
    ))
    expect(JSON.parse(String(sessionCall?.[1]?.body))).toMatchObject({
      classroom_id: classroom.id,
      date: '2026-05-05',
      command: 'close',
    })
  })

  it('keeps revalidating a pending mark until confirmation arrives after the bounded poll', async () => {
    let attendanceReadCount = 0
    const initialAttendance = combinedAttendanceView()
    const confirmedAttendance = combinedAttendanceView({
      students: initialAttendance.students.map((student) => student.studentId === 'student-1'
        ? {
            ...student,
            status: 'late',
            source: 'staff',
            revision: (student.revision ?? 0) + 1,
            hasManualOverride: true,
          }
        : student),
    })
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/teacher/logs?')) {
        return mockJson({
          logs: initialAttendance.students.map((student, index) => ({
            student_id: student.studentId,
            student_email: `${student.studentId}@example.com`,
            student_first_name: student.firstName,
            student_last_name: student.lastName,
            entry: index === 0 ? entry({ student_id: student.studentId, text: longLogText }) : null,
            history_preview: [],
          })),
        })
      }
      if (url.startsWith('/api/teacher/attendance/session?')) {
        attendanceReadCount += 1
        return mockJson(attendanceReadCount >= 10 ? confirmedAttendance : initialAttendance)
      }
      if (url === '/api/teacher/attendance/marks' && init?.method === 'POST') {
        return mockJson({ outcome: 'accepted', appliedCount: 0 })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <TooltipProvider>
        <AppMessageProvider>
          <TeacherAttendanceTab classroom={classroom} attendanceEnabled />
        </AppMessageProvider>
      </TooltipProvider>,
    )

    const initialStatus = await screen.findByRole('group', {
      name: 'Attendance status for Student1 Test',
    })
    vi.useFakeTimers()

    await act(async () => {
      fireEvent.click(within(initialStatus).getByRole('button', { name: 'Late' }))
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_250)
    })

    const waitingLateButton = within(screen.getByRole('group', {
      name: 'Attendance status for Student1 Test',
    })).getByRole('button', { name: 'Late' })
    expect(attendanceReadCount).toBe(9)
    expect(waitingLateButton).toBeDisabled()
    expect(waitingLateButton).toHaveAttribute('aria-pressed', 'false')
    expect(appMessageMock.showMessage).toHaveBeenCalledWith({
      text: 'Update sent; waiting for attendance confirmation',
      tone: 'info',
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })

    const confirmedLateButton = within(screen.getByRole('group', {
      name: 'Attendance status for Student1 Test',
    })).getByRole('button', { name: 'Late' })
    expect(attendanceReadCount).toBe(10)
    expect(confirmedLateButton).toBeEnabled()
    expect(confirmedLateButton).toHaveAttribute('aria-pressed', 'true')
    expect(appMessageMock.showMessage).toHaveBeenCalledWith({
      text: '1 student marked late',
      tone: 'info',
    })
  })

  it('releases a pending session action when background confirmation reports terminal failure', async () => {
    let attendanceReadCount = 0
    const initialAttendance = combinedAttendanceView()
    const failedAttendance = combinedAttendanceView({
      session: {
        ...initialAttendance.session,
        commandFailed: true,
      },
    })
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/teacher/logs?')) {
        return mockJson({
          logs: initialAttendance.students.map((student) => ({
            student_id: student.studentId,
            student_email: `${student.studentId}@example.com`,
            student_first_name: student.firstName,
            student_last_name: student.lastName,
            entry: null,
            history_preview: [],
          })),
        })
      }
      if (url.startsWith('/api/teacher/attendance/session?')) {
        attendanceReadCount += 1
        return mockJson(attendanceReadCount >= 10 ? failedAttendance : initialAttendance)
      }
      if (url === '/api/teacher/attendance/session' && init?.method === 'POST') {
        return mockJson({ outcome: 'pending' })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <TooltipProvider>
        <AppMessageProvider>
          <TeacherAttendanceTab classroom={classroom} attendanceEnabled />
        </AppMessageProvider>
      </TooltipProvider>,
    )

    const stopButton = await screen.findByRole('button', { name: 'Stop QR check-in' })
    vi.useFakeTimers()
    await act(async () => {
      fireEvent.click(stopButton)
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_250)
    })
    expect(screen.getByRole('button', { name: 'Stop QR check-in' })).toBeDisabled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })

    expect(attendanceReadCount).toBe(10)
    expect(screen.getByRole('button', { name: 'Stop QR check-in' })).toBeEnabled()
    expect(appMessageMock.showMessage).toHaveBeenCalledWith({
      text: 'Attendance could not be closed',
      tone: 'warning',
    })
  })

  it('disables session actions while the authoritative view owns a pending command', async () => {
    const base = combinedAttendanceView()
    const pendingView = combinedAttendanceView({
      session: { ...base.session, pendingCommand: true },
      sync: { ...base.sync, state: 'pending' },
    })
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/teacher/logs?')) {
        return mockJson({
          logs: base.students.map((student) => ({
            student_id: student.studentId,
            student_email: `${student.studentId}@example.com`,
            student_first_name: student.firstName,
            student_last_name: student.lastName,
            entry: null,
            history_preview: [],
          })),
        })
      }
      if (url.startsWith('/api/teacher/attendance/session?')) return mockJson(pendingView)
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <TooltipProvider>
        <AppMessageProvider>
          <TeacherAttendanceTab classroom={classroom} attendanceEnabled />
        </AppMessageProvider>
      </TooltipProvider>,
    )

    expect(await screen.findByRole('button', { name: 'Stop QR check-in' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Show QR' })).toBeDisabled()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
  })

  it('loads the Pika-owned QR presentation from the combined Daily action bar', async () => {
    mockCombinedCommandFetch()
    const user = userEvent.setup()

    render(
      <TooltipProvider>
        <AppMessageProvider>
          <TeacherAttendanceTab classroom={classroom} attendanceEnabled />
        </AppMessageProvider>
      </TooltipProvider>,
    )

    await user.click(await screen.findByRole('button', { name: 'Show QR' }))

    const dialog = await screen.findByRole('dialog', { name: 'Attendance QR' })
    expect(within(dialog).getByLabelText('Student attendance check-in QR code')).toBeInTheDocument()
    expect(within(dialog).getByText('Scan to check in through Pika')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
    expect(within(dialog).getAllByRole('button', { name: 'Close' })[0]).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Attendance QR' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show QR' })).toHaveFocus()
  })

  it('keeps selection-aware bulk Attendance actions in the combined action bar', async () => {
    const fetchMock = mockCombinedCommandFetch()
    const user = userEvent.setup()

    render(
      <TooltipProvider>
        <AppMessageProvider>
          <TeacherAttendanceTab classroom={classroom} attendanceEnabled />
        </AppMessageProvider>
      </TooltipProvider>,
    )

    await screen.findByRole('columnheader', { name: 'Check-in' })
    await user.click(screen.getByRole('checkbox', { name: 'Select all students' }))
    await user.click(screen.getByRole('button', { name: 'Student actions for 2 selected' }))
    await user.click(within(
      screen.getByRole('menu', { name: 'Selected student attendance actions' }),
    ).getByRole('menuitem', { name: 'Absent' }))

    await waitFor(() => {
      expect(screen.getByRole('button', {
        name: 'Student actions (select students to enable)',
      })).toBeDisabled()
    })
    const marksCall = fetchMock.mock.calls.find(([input]) => String(input) === '/api/teacher/attendance/marks')
    expect(JSON.parse(String(marksCall?.[1]?.body)).marks).toEqual([
      {
        student_id: 'student-1',
        status: 'absent',
        reason_code: 'staff_correction',
      },
      {
        student_id: 'student-2',
        status: 'absent',
        reason_code: 'staff_correction',
      },
    ])
  })

  it('limits select-all and bulk marks to students rendered by Daily logs', async () => {
    let attendance = combinedAttendanceView()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/teacher/logs?')) {
        const visibleStudent = attendance.students[0]
        return mockJson({
          logs: [{
            student_id: visibleStudent.studentId,
            student_email: `${visibleStudent.studentId}@example.com`,
            student_first_name: visibleStudent.firstName,
            student_last_name: visibleStudent.lastName,
            entry: null,
            history_preview: [],
          }],
        })
      }
      if (url.startsWith('/api/teacher/attendance/session?')) return mockJson(attendance)
      if (url === '/api/teacher/attendance/marks' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as {
          marks: Array<{ student_id: string; status: 'present' | 'late' | 'absent' | 'automatic' }>
        }
        attendance = {
          ...attendance,
          students: attendance.students.map((student) => {
            const mark = body.marks.find((candidate) => candidate.student_id === student.studentId)
            return mark ? {
              ...student,
              status: mark.status === 'automatic' ? 'present' : mark.status,
              revision: (student.revision ?? 0) + 1,
            } : student
          }),
        }
        return mockJson({ outcome: 'applied', appliedCount: body.marks.length })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(
      <TooltipProvider>
        <AppMessageProvider>
          <TeacherAttendanceTab classroom={classroom} attendanceEnabled />
        </AppMessageProvider>
      </TooltipProvider>,
    )

    await screen.findByRole('checkbox', { name: 'Select Student1 Test' })
    expect(screen.queryByRole('checkbox', { name: 'Select Student2 Test' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Select all students' }))
    await user.click(screen.getByRole('button', { name: 'Student actions for 1 selected' }))
    await user.click(within(
      screen.getByRole('menu', { name: 'Selected student attendance actions' }),
    ).getByRole('menuitem', { name: 'Absent' }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input) === '/api/teacher/attendance/marks')).toBe(true)
    })
    const marksCall = fetchMock.mock.calls.find(([input]) => String(input) === '/api/teacher/attendance/marks')
    expect(JSON.parse(String(marksCall?.[1]?.body)).marks).toEqual([{
      student_id: 'student-1',
      status: 'absent',
      reason_code: 'staff_correction',
    }])
  })

  it('sorts the combined Log column by complete and incomplete status', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/teacher/logs?')) {
        return mockJson({
          logs: [
            {
              student_id: 'student-incomplete',
              student_email: 'incomplete@example.com',
              student_first_name: 'Alex',
              student_last_name: 'Alpha',
              entry: null,
              history_preview: [],
            },
            {
              student_id: 'student-complete',
              student_email: 'complete@example.com',
              student_first_name: 'Zoe',
              student_last_name: 'Zulu',
              entry: entry({ id: 'entry-complete', student_id: 'student-complete' }),
              history_preview: [],
            },
          ],
        })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<TeacherAttendanceTab classroom={classroom} />)

    const logSortButton = await screen.findByRole('button', {
      name: 'Log 1 complete, 1 incomplete',
    })

    logSortButton.focus()
    expect(logSortButton).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('columnheader', { name: 'Log 1 complete, 1 incomplete' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Zulu')

    await user.keyboard(' ')
    expect(screen.getByRole('columnheader', { name: 'Log 1 complete, 1 incomplete' })).toHaveAttribute(
      'aria-sort',
      'descending',
    )
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Alpha')
  })

  it('resizes Daily identity columns by pointer and clamps them to their minimum width', async () => {
    mockLogsFetch()

    render(<TeacherAttendanceTab classroom={classroom} />)

    const firstColumnResize = await screen.findByRole('separator', {
      name: 'Resize First column',
    })

    const pointerDown = new Event('pointerdown', { bubbles: true })
    Object.defineProperty(pointerDown, 'clientX', { value: 100 })
    fireEvent(firstColumnResize, pointerDown)
    const pointerMove = new Event('pointermove', { bubbles: true })
    Object.defineProperty(pointerMove, 'clientX', { value: 70 })
    window.dispatchEvent(pointerMove)
    window.dispatchEvent(new Event('pointerup', { bubbles: true }))

    await waitFor(() => {
      expect(firstColumnResize).toHaveAttribute('aria-valuenow', '60')
    })
    expect(document.body.style.cursor).toBe('')
  })

  it('shows a retryable error instead of prior-date or empty-roster data after a failed read', async () => {
    classDaysMock.classDays = [
      ...classDaysMock.defaultClassDays,
      {
        id: 'day-2',
        classroom_id: 'classroom-1',
        date: '2026-05-06',
        prompt_text: null,
        is_class_day: true,
      },
    ]
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const retryRequest = deferred<any>()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(await mockJson({
        logs: [{
          student_id: 'student-1',
          student_email: 'student1@example.com',
          student_first_name: 'Student1',
          student_last_name: 'Test',
          entry: entry({ text: longLogText }),
          history_preview: [],
        }],
      }))
      .mockResolvedValueOnce(await mockJson({ error: 'Attendance unavailable' }, false))
      .mockImplementationOnce(() => retryRequest.promise)
    vi.stubGlobal('fetch', fetchMock)

    render(<TeacherAttendanceTab classroom={classroom} />)

    expect(await screen.findByText(longLogText)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }))

    await waitFor(() => {
      expect(screen.queryByText(longLogText)).not.toBeInTheDocument()
    })
    expect(screen.queryByText('Student1')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Attendance unavailable')
    expect(screen.queryByText('No students enrolled')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
    expect(screen.queryByText('No students enrolled')).not.toBeInTheDocument()

    await act(async () => {
      retryRequest.resolve(await mockJson({ logs: [] }))
    })

    expect(await screen.findByText('No students enrolled')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('shows a retryable schedule error instead of treating failed class days as a non-class day', async () => {
    classDaysMock.classDays = []
    classDaysMock.error = 'The class schedule could not be loaded.'
    classDaysMock.hasLoadedSnapshot = false
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<TeacherAttendanceTab classroom={classroom} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Class schedule unavailable')
    expect(screen.queryByText('Not a class day')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(classDaysMock.refresh).toHaveBeenCalledOnce()
  })

  it('keeps the attendance table visible when a schedule refresh fails', async () => {
    const fetchMock = mockLogsFetch()
    const view = render(<TeacherAttendanceTab classroom={classroom} />)

    expect(await screen.findByText(longLogText)).toBeInTheDocument()

    classDaysMock.error = 'The class schedule could not be loaded.'
    classDaysMock.hasLoadedSnapshot = true
    view.rerender(<TeacherAttendanceTab classroom={classroom} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The latest class schedule could not be loaded.'
    )
    expect(screen.getByText(longLogText)).toBeInTheDocument()
    expect(screen.queryByText('Class schedule unavailable')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('moves between days from the attendance-style date selector', async () => {
    const fetchMock = mockLogsFetch()
    const onDateChange = vi.fn()

    render(<TeacherAttendanceTab classroom={classroom} onDateChange={onDateChange} />)

    await screen.findByRole('columnheader', { name: /^Log/ })

    const contextBar = screen.getByRole('region', { name: 'Daily controls' })
    const scrollPane = screen.getByTestId('daily-student-scroll-pane')
    const workspaceFrame = scrollPane.parentElement?.parentElement?.parentElement
    expect(contextBar).toHaveClass('grid', 'relative', 'z-floating')
    expect(scrollPane).toHaveClass('rounded-lg')
    expect(workspaceFrame).toHaveClass('rounded-none', 'border-0', 'bg-page')
    expect(screen.getByRole('columnheader', { name: /^Log/ }).closest('thead')).toHaveClass('bg-surface-3')
    const previousButton = screen.getByRole('button', { name: 'Previous day' })
    const nextButton = screen.getByRole('button', { name: 'Next day' })
    expect(screen.getByRole('button', { name: 'Select Daily date' })).toHaveTextContent('Tue May 5Yesterday')

    fireEvent.click(nextButton)

    await waitFor(() => {
      expect(onDateChange).toHaveBeenLastCalledWith('2026-05-06')
    })
    expect(screen.getByRole('button', { name: 'Select Daily date' })).toHaveTextContent('Wed May 6Today')

    fireEvent.click(previousButton)

    await waitFor(() => {
      expect(onDateChange).toHaveBeenLastCalledWith('2026-05-05')
    })
    expect(screen.getByRole('button', { name: 'Select Daily date' })).toHaveTextContent('Tue May 5Yesterday')
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  it('omits the relative date label for forward Daily dates', async () => {
    classDaysMock.classDays = [
      ...classDaysMock.defaultClassDays,
      {
        id: 'day-2',
        classroom_id: 'classroom-1',
        date: '2026-05-06',
        prompt_text: null,
        is_class_day: true,
      },
    ]
    mockLogsFetch()

    render(<TeacherAttendanceTab classroom={classroom} />)

    await screen.findByRole('columnheader', { name: /^Log/ })
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }))

    const contextBar = screen.getByRole('region', { name: 'Daily controls' })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Select Daily date' })).toHaveTextContent('Thu May 7')
    })
    const dateButton = screen.getByRole('button', { name: 'Select Daily date' })
    expect(within(dateButton).queryByText('Today')).not.toBeInTheDocument()
    expect(within(dateButton).queryByText(/ago$/)).not.toBeInTheDocument()
  })

  it('shows previous and next arrows around the Daily date picker', async () => {
    mockLogsFetch()

    render(<TeacherAttendanceTab classroom={classroom} />)

    await screen.findByRole('columnheader', { name: /^Log/ })

    expect(screen.getByRole('button', { name: 'Select Daily date' })).toHaveTextContent('Tue May 5')
    expect(screen.getByRole('button', { name: 'Previous day' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next day' })).toBeInTheDocument()
  })

  it('keeps day navigation deterministic after the Toronto date rolls over', async () => {
    classDaysMock.classDays = [
      ...classDaysMock.defaultClassDays,
      {
        id: 'day-2',
        classroom_id: 'classroom-1',
        date: '2026-05-06',
        prompt_text: null,
        is_class_day: true,
      },
    ]
    const onDateChange = vi.fn()
    mockLogsFetch()

    render(<TeacherAttendanceTab classroom={classroom} onDateChange={onDateChange} />)

    await screen.findByRole('columnheader', { name: /^Log/ })
    expect(screen.getByRole('button', { name: 'Select Daily date' })).toHaveTextContent('Tue May 5')

    todayMock.today = '2026-05-07'
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }))

    await waitFor(() => {
      expect(onDateChange).toHaveBeenLastCalledWith('2026-05-06')
    })
    expect(screen.getByRole('button', { name: 'Select Daily date' })).toHaveTextContent('Wed May 6')

    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }))

    await waitFor(() => {
      expect(onDateChange).toHaveBeenLastCalledWith('2026-05-05')
    })
    expect(screen.getByRole('button', { name: 'Select Daily date' })).toHaveTextContent('Tue May 5')
  })

  it('collapses and restores the class log summary from a double click', async () => {
    mockLogsFetch()

    render(<TeacherAttendanceTab classroom={classroom} />)

    const panel = await screen.findByRole('region', { name: 'Class Log Summary' })
    expect(await screen.findByTestId('class-log-summary')).toBeInTheDocument()
    expect(panel).toHaveStyle({ height: '180px' })
    expect(panel).toHaveAttribute('data-state', 'expanded')

    fireEvent.doubleClick(panel)

    expect(screen.queryByTestId('class-log-summary')).not.toBeInTheDocument()
    expect(panel).toHaveStyle({ height: '40px' })
    expect(panel).toHaveAttribute('data-state', 'collapsed')
    expect(screen.getByText('Log Summary')).toBeInTheDocument()

    fireEvent.doubleClick(panel)

    expect(await screen.findByTestId('class-log-summary')).toBeInTheDocument()
    expect(panel).toHaveStyle({ height: '180px' })
    expect(panel).toHaveAttribute('data-state', 'expanded')
  })

  it('resizes the class log summary card from the handle with keyboard controls', async () => {
    mockLogsFetch()

    render(<TeacherAttendanceTab classroom={classroom} />)

    const panel = await screen.findByRole('region', { name: 'Class Log Summary' })
    const separator = screen.getByRole('separator', { name: 'Resize class log summary' })

    expect(panel).toHaveStyle({ height: '180px' })
    expect(separator).toHaveClass('cursor-ns-resize')

    fireEvent.keyDown(separator, { key: 'ArrowUp' })
    expect(panel).toHaveStyle({ height: '212px' })

    fireEvent.keyDown(separator, { key: 'ArrowDown' })
    expect(panel).toHaveStyle({ height: '180px' })

    fireEvent.keyDown(separator, { key: 'ArrowUp' })
    fireEvent.keyDown(separator, { key: 'Enter' })
    expect(panel).toHaveStyle({ height: '180px' })
  })

  it('reopens the collapsed class log summary by dragging the handle upward', async () => {
    mockLogsFetch()

    render(<TeacherAttendanceTab classroom={classroom} />)

    const panel = await screen.findByRole('region', { name: 'Class Log Summary' })

    fireEvent.doubleClick(panel)
    expect(panel).toHaveStyle({ height: '40px' })
    expect(panel).toHaveAttribute('data-state', 'collapsed')

    fireEvent(
      screen.getByRole('separator', { name: 'Resize class log summary' }),
      new MouseEvent('pointerdown', { clientY: 300, bubbles: true })
    )
    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 90, bubbles: true }))
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))

    expect(await screen.findByTestId('class-log-summary')).toBeInTheDocument()
    expect(panel).toHaveStyle({ height: '250px' })
    expect(panel).toHaveAttribute('data-state', 'expanded')
  })

  it('returns to the full-width log table after deselecting a selected student', async () => {
    mockLogsFetch()

    render(<TeacherAttendanceTab classroom={classroom} />)

    const studentCell = await screen.findByRole('cell', { name: 'Student1', exact: true })
    fireEvent.click(studentCell)

    expect(await screen.findByTestId('student-log-history')).toHaveTextContent('History for student-1')
    expect(within(screen.getByRole('cell', { name: 'Student1', exact: true })).getByText('Student1')).toHaveClass('truncate')
    expect(screen.getByRole('separator', { name: 'Resize Daily panes' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', {
      name: 'Log 1 complete, 1 incomplete',
    })).toHaveAttribute('aria-sort', 'none')
    expect(screen.queryByTestId('class-log-summary')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('cell', { name: 'Student1', exact: true }))

    await waitFor(() => {
      expect(screen.queryByRole('separator', { name: 'Resize Daily panes' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('columnheader', { name: /^Log/ })).toBeInTheDocument()
    expect(screen.getByTestId('class-log-summary')).toBeInTheDocument()
  })

  it('restores the student table scroll position after opening a selected Daily workspace', async () => {
    let latestAnimationFrame: FrameRequestCallback | null = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      latestAnimationFrame = callback
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    mockManyLogsFetch()

    render(<TeacherAttendanceTab classroom={classroom} />)

    await screen.findByRole('cell', { name: 'Student25', exact: true })

    const scrollPane = screen.getByTestId('daily-student-scroll-pane') as HTMLDivElement
    scrollPane.scrollTop = 520
    fireEvent.scroll(scrollPane)

    fireEvent.click(screen.getByRole('cell', { name: 'Student25', exact: true }))

    expect(await screen.findByTestId('student-log-history')).toHaveTextContent('History for student-25')

    const selectedScrollPane = screen.getByTestId('daily-student-scroll-pane') as HTMLDivElement
    selectedScrollPane.scrollTop = 0
    act(() => {
      latestAnimationFrame?.(0)
    })

    expect(selectedScrollPane.scrollTop).toBe(520)
  })

  it('deselects the selected student when Escape is pressed', async () => {
    mockLogsFetch()

    render(<TeacherAttendanceTab classroom={classroom} />)

    fireEvent.click(await screen.findByRole('cell', { name: 'Student1', exact: true }))

    expect(await screen.findByTestId('student-log-history')).toHaveTextContent('History for student-1')
    expect(screen.getByRole('separator', { name: 'Resize Daily panes' })).toBeInTheDocument()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    await waitFor(() => {
      expect(screen.queryByRole('separator', { name: 'Resize Daily panes' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('columnheader', { name: /^Log/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Attendance students' })).toHaveFocus()
  })

  it('deselects the selected student when clicking outside the selected workspace', async () => {
    mockLogsFetch()

    render(<TeacherAttendanceTab classroom={classroom} />)

    fireEvent.click(await screen.findByRole('cell', { name: 'Student1', exact: true }))

    const historyPane = await screen.findByTestId('student-log-history')
    expect(historyPane).toHaveTextContent('History for student-1')

    fireEvent.pointerDown(historyPane)
    expect(screen.getByRole('separator', { name: 'Resize Daily panes' })).toBeInTheDocument()

    fireEvent.pointerDown(document.body)

    await waitFor(() => {
      expect(screen.queryByRole('separator', { name: 'Resize Daily panes' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('columnheader', { name: /^Log/ })).toBeInTheDocument()
  })

  it('uses entry animations when switching between the full table and selected workspace', async () => {
    mockLogsFetch()

    const { container } = render(<TeacherAttendanceTab classroom={classroom} />)

    await screen.findByRole('columnheader', { name: /^Log/ })
    expect(container.querySelector('.daily-table-enter')).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('cell', { name: 'Student1', exact: true }))

    expect(await screen.findByTestId('student-log-history')).toHaveTextContent('History for student-1')
    expect(container.querySelector('.daily-workspace-enter')).toBeInTheDocument()
    expect(container.querySelector('.daily-inspector-enter')).toBeInTheDocument()

    fireEvent.pointerDown(document.body)

    await waitFor(() => {
      expect(screen.queryByRole('separator', { name: 'Resize Daily panes' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('columnheader', { name: /^Log/ })).toBeInTheDocument()
    expect(container.querySelector('.daily-table-enter')).toBeInTheDocument()
  })

  it('ignores an older classroom log request after switching classrooms', async () => {
    const firstRequest = deferred<any>()
    classDaysMock.classDays = [
      {
        id: 'day-1',
        classroom_id: 'classroom-1',
        date: '2026-05-05',
        prompt_text: null,
        is_class_day: true,
      },
    ]

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/teacher/logs?classroom_id=classroom-1&date=2026-05-05') {
        return firstRequest.promise
      }
      if (url === '/api/teacher/logs?classroom_id=classroom-2&date=2026-05-05') {
        return mockJson({
          logs: [
            {
              student_id: 'student-2',
              student_email: 'student2@example.com',
              student_first_name: 'Second',
              student_last_name: 'Student',
              entry: entry({ id: 'entry-2', student_id: 'student-2', classroom_id: 'classroom-2', date: '2026-05-05' }),
              history_preview: [],
            },
          ],
        })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { rerender } = render(<TeacherAttendanceTab classroom={classroom} />)

    classDaysMock.classDays = [
      {
        id: 'day-2',
        classroom_id: 'classroom-2',
        date: '2026-05-05',
        prompt_text: null,
        is_class_day: true,
      },
    ]

    rerender(<TeacherAttendanceTab classroom={secondClassroom} />)

    expect(await screen.findByRole('cell', { name: 'Second', exact: true })).toBeInTheDocument()
    expect(screen.queryByRole('cell', { name: 'Student1', exact: true })).not.toBeInTheDocument()

    firstRequest.resolve(await mockJson({
      logs: [
        {
          student_id: 'student-1',
          student_email: 'student1@example.com',
          student_first_name: 'Student1',
          student_last_name: 'Test',
          entry: entry({ text: longLogText }),
          history_preview: [],
        },
      ],
    }))

    await waitFor(() => {
      expect(screen.queryByRole('cell', { name: 'Student1', exact: true })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('cell', { name: 'Second', exact: true })).toBeInTheDocument()
  })
})
