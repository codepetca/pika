import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import TeacherDashboardPage from '@/app/teacher/dashboard/page'
import { AppMessageProvider, TooltipProvider } from '@/ui'
import { createMockClassroom } from '../helpers/mocks'
import { fetchJSONWithCache, invalidateCachedJSON } from '@/lib/request-cache'
import type { AttendanceRecord, Classroom, Entry } from '@/types'

const push = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

vi.mock('@/components/CreateClassroomModal', () => ({
  CreateClassroomModal: ({ isOpen, onSuccess, onBlueprintCreated }: any) => {
    const [blueprintCreated, setBlueprintCreated] = useState(false)
    return isOpen ? (
      <div role="dialog">
        {blueprintCreated ? <h2>Classroom Created</h2> : null}
      <button
        type="button"
        onClick={() => onSuccess(createMockClassroom({ id: 'created', title: 'Created Class' }))}
      >
        Create mocked classroom
      </button>
      <button
        type="button"
        onClick={() => {
          setBlueprintCreated(true)
          onBlueprintCreated(createMockClassroom({ id: 'blueprint-created', title: 'Blueprint Class' }))
        }}
      >
        Complete mocked blueprint classroom
      </button>
      </div>
    ) : null
  },
}))

vi.mock('@/components/UploadRosterModal', () => ({
  UploadRosterModal: ({ isOpen, onSuccess }: any) => isOpen ? (
    <button type="button" onClick={() => onSuccess()}>
      Complete roster upload
    </button>
  ) : null,
}))

vi.mock('@/components/Spinner', () => ({
  Spinner: () => <div>Loading...</div>,
}))

vi.mock('@/components/PageLayout', () => ({
  PageLayout: ({ children }: any) => <div>{children}</div>,
  PageContent: ({ children }: any) => <div>{children}</div>,
  PageActionBar: ({ primary, actions = [] }: any) => (
    <div>
      <div data-testid="dashboard-action-primary">{primary}</div>
      {actions.map((action: any) => (
        <button key={action.id} type="button" onClick={action.onSelect}>
          {action.label}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('@/lib/request-cache', () => ({
  fetchJSONWithCache: vi.fn((_key: string, load: () => Promise<unknown>) => load()),
  invalidateCachedJSON: vi.fn(),
  invalidateCachedJSONMatching: vi.fn(),
  prefetchJSON: vi.fn(),
}))

function renderDashboard() {
  return render(
    <TooltipProvider>
      <AppMessageProvider>
        <TeacherDashboardPage />
      </AppMessageProvider>
    </TooltipProvider>,
  )
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response
}

function attendanceRecord(options: {
  studentId: string
  email: string
  date: string
  present?: number
  absent?: number
}): AttendanceRecord {
  return {
    student_id: options.studentId,
    student_email: options.email,
    student_first_name: 'Student',
    student_last_name: options.studentId,
    dates: { [options.date]: 'present' },
    summary: {
      present: options.present ?? 1,
      absent: options.absent ?? 0,
    },
  }
}

function entry(options: { studentId: string; classroomId: string; date: string; text: string }): Entry {
  return {
    id: `${options.studentId}-${options.date}`,
    student_id: options.studentId,
    classroom_id: options.classroomId,
    date: options.date,
    text: options.text,
    rich_content: null,
    version: 1,
    minutes_reported: null,
    mood: null,
    created_at: '2026-06-01T12:00:00Z',
    updated_at: '2026-06-01T12:00:00Z',
    on_time: true,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function installFetchMock(options?: {
  classrooms?: Classroom[]
  classroomFailures?: number
  attendanceFailuresByClassroom?: Record<string, number>
  attendanceByClassroom?: Record<string, AttendanceRecord[] | Promise<{ attendance: AttendanceRecord[]; dates: string[] }>>
  datesByClassroom?: Record<string, string[]>
  entriesByClassroom?: Record<string, Entry[]>
  entryFailuresByScope?: Record<string, number>
  entriesByScope?: Record<string, Entry[] | Promise<Entry[]>>
}) {
  const classrooms = options?.classrooms ?? [
    createMockClassroom({ id: 'c1', title: 'Dashboard Class', class_code: 'DASH1' }),
  ]
  let classroomFailures = options?.classroomFailures ?? 0
  const attendanceFailuresByClassroom = { ...options?.attendanceFailuresByClassroom }
  const entryFailuresByScope = { ...options?.entryFailuresByScope }

  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    if (url === '/api/auth/me' && method === 'GET') {
      return Promise.resolve(jsonResponse({
        user: { id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' },
      }))
    }

    if (url === '/api/teacher/classrooms' && method === 'GET') {
      if (classroomFailures > 0) {
        classroomFailures -= 1
        return Promise.resolve(jsonResponse({ error: 'Classroom service unavailable' }, false))
      }
      return Promise.resolve(jsonResponse({ classrooms }))
    }

    if (url.startsWith('/api/teacher/attendance?classroom_id=') && method === 'GET') {
      const classroomId = new URL(url, 'http://localhost').searchParams.get('classroom_id') || ''
      if ((attendanceFailuresByClassroom[classroomId] ?? 0) > 0) {
        attendanceFailuresByClassroom[classroomId] -= 1
        return Promise.resolve(jsonResponse({ error: 'Attendance service unavailable' }, false))
      }
      const payload = options?.attendanceByClassroom?.[classroomId] ?? [
        attendanceRecord({
          studentId: 's1',
          email: 'student@example.com',
          date: '2026-06-01',
        }),
      ]
      if (payload instanceof Promise) {
        return Promise.resolve({
          ok: true,
          json: async () => payload,
        } as Response)
      }
      return Promise.resolve(jsonResponse({
        attendance: payload,
        dates: options?.datesByClassroom?.[classroomId] ?? ['2026-06-01'],
      }))
    }

    if (url.startsWith('/api/teacher/student-history?') && method === 'GET') {
      const searchParams = new URL(url, 'http://localhost').searchParams
      const classroomId = searchParams.get('classroom_id') || ''
      const studentId = searchParams.get('student_id')
      const date = searchParams.get('date')
      const scope = `${classroomId}:${studentId}:${date}`
      if ((entryFailuresByScope[scope] ?? 0) > 0) {
        entryFailuresByScope[scope] -= 1
        return Promise.resolve(jsonResponse({ error: 'Entry service unavailable' }, false))
      }
      const entries = options?.entriesByClassroom?.[classroomId] ?? [
        entry({
          studentId: 's1',
          classroomId,
          date: '2026-06-01',
          text: 'Focused entry text',
        }),
      ]
      const scopedEntries = options?.entriesByScope?.[scope] ?? entries.filter(candidate => (
        candidate.student_id === studentId && candidate.date === date
      ))
      return Promise.resolve(scopedEntries).then(resolvedEntries => jsonResponse({
        entries: resolvedEntries,
      }))
    }

    return Promise.reject(new Error(`Unexpected fetch: ${method} ${url}`))
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('Teacher dashboard page', () => {
  beforeEach(() => {
    window.localStorage.clear()
    push.mockReset()
    vi.mocked(fetchJSONWithCache).mockImplementation((_key, load) => load())
    vi.mocked(invalidateCachedJSON).mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads classrooms and attendance through the shared request cache', async () => {
    installFetchMock()

    renderDashboard()

    expect(await screen.findByText('student@example.com')).toBeInTheDocument()
    expect(fetchJSONWithCache).toHaveBeenCalledWith(
      'teacher-classrooms:teacher-1:active-list',
      expect.any(Function),
      20_000,
    )
    expect(fetchJSONWithCache).toHaveBeenCalledWith(
      'teacher-dashboard:attendance:c1',
      expect.any(Function),
      20_000,
    )
  })

  it('refreshes dashboard state without navigating when blueprint creation completes', async () => {
    installFetchMock({ classrooms: [] })

    renderDashboard()

    fireEvent.click(await screen.findByRole('button', { name: 'Create Classroom' }))
    fireEvent.click(screen.getByRole('button', { name: 'Complete mocked blueprint classroom' }))

    expect(await screen.findByText('student@example.com')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Classroom Created' })).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })

  it('sorts and resizes the shared attendance table and exposes log cells as buttons', async () => {
    installFetchMock({
      attendanceByClassroom: {
        c1: [
          attendanceRecord({
            studentId: 's2',
            email: 'zara@example.com',
            date: '2026-06-01',
            present: 4,
            absent: 1,
          }),
          attendanceRecord({
            studentId: 's1',
            email: 'ada@example.com',
            date: '2026-06-01',
            present: 1,
            absent: 4,
          }),
        ],
      },
    })

    renderDashboard()

    expect(await screen.findByText('ada@example.com')).toBeInTheDocument()
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('ada@example.com')

    fireEvent.click(screen.getByRole('button', { name: 'Present' }))
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('ada@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Present' }))
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('zara@example.com')

    const studentResize = screen.getByRole('separator', { name: 'Resize Student column' })
    fireEvent.keyDown(studentResize, { key: 'End' })
    expect(studentResize).toHaveAttribute('aria-valuenow', '360')
    expect(screen.getByRole('button', { name: 'Open ada@example.com log for 2026-06-01' })).toBeInTheDocument()
  })

  it('separates classroom load failures from empty state and retries', async () => {
    installFetchMock({ classroomFailures: 1 })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    renderDashboard()

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load classrooms')
    expect(screen.getByRole('heading', { level: 1, name: 'Could not load classrooms' })).toBeInTheDocument()
    expect(screen.queryByText('No Classrooms Yet')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('student@example.com')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Teacher dashboard' })).toHaveFocus()
    expect(consoleError).toHaveBeenCalled()
  })

  it('separates attendance failures from an empty roster and retries', async () => {
    installFetchMock({ attendanceFailuresByClassroom: { c1: 1 } })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    renderDashboard()

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load attendance')
    expect(screen.queryByText('No students enrolled yet')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('student@example.com')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Teacher dashboard' })).toHaveFocus()
    expect(invalidateCachedJSON).toHaveBeenCalledWith('teacher-dashboard:attendance:c1')
    expect(consoleError).toHaveBeenCalled()
  })

  it('does not expose permanent classroom deletion', async () => {
    const fetchMock = installFetchMock()

    renderDashboard()

    expect(await screen.findByText('student@example.com')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Delete classroom')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
  })

  it('loads entry details fresh when a present cell is opened', async () => {
    const fetchMock = installFetchMock()

    renderDashboard()

    await screen.findByText('student@example.com')
    fireEvent.click(screen.getByText('🟢'))

    expect(await screen.findByText('Focused entry text')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/teacher/student-history?classroom_id=c1&student_id=s1&date=2026-06-01&limit=1',
    )
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/student/entries')))
      .toBe(false)
  })

  it('opens a scoped dialog while an entry is loading', async () => {
    const pendingEntry = deferred<Entry[]>()
    installFetchMock({
      entriesByScope: {
        'c1:s1:2026-06-01': pendingEntry.promise,
      },
    })

    renderDashboard()

    const openLog = await screen.findByRole('button', {
      name: 'Open student@example.com log for 2026-06-01',
    })
    openLog.focus()
    fireEvent.click(openLog)

    expect(screen.getByRole('dialog', { name: 'student@example.com' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading log')

    await act(async () => {
      pendingEntry.resolve([
        entry({
          studentId: 's1',
          classroomId: 'c1',
          date: '2026-06-01',
          text: 'Loaded after waiting',
        }),
      ])
    })

    expect(await screen.findByText('Loaded after waiting')).toBeInTheDocument()
  })

  it('distinguishes an empty entry result from a request failure', async () => {
    installFetchMock({
      entriesByScope: {
        'c1:s1:2026-06-01': [],
      },
    })

    renderDashboard()

    fireEvent.click(await screen.findByRole('button', {
      name: 'Open student@example.com log for 2026-06-01',
    }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No log found'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a retryable entry failure and reloads the same scope', async () => {
    const pendingRetry = deferred<Entry[]>()
    const fetchMock = installFetchMock({
      entryFailuresByScope: {
        'c1:s1:2026-06-01': 1,
      },
      entriesByScope: {
        'c1:s1:2026-06-01': pendingRetry.promise,
      },
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    renderDashboard()

    fireEvent.click(await screen.findByRole('button', {
      name: 'Open student@example.com log for 2026-06-01',
    }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load log')
    const dialog = screen.getByRole('dialog', { name: 'student@example.com' })
    const retryButton = screen.getByRole('button', { name: 'Try again' })
    retryButton.focus()
    fireEvent.click(retryButton)

    expect(screen.getByRole('status')).toHaveTextContent('Loading log')
    expect(screen.getByRole('button', { name: 'Trying again' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Trying again' })).toHaveFocus()
    expect(dialog).toContainElement(document.activeElement)

    await act(async () => {
      pendingRetry.resolve([
        entry({
          studentId: 's1',
          classroomId: 'c1',
          date: '2026-06-01',
          text: 'Focused entry text',
        }),
      ])
    })

    expect(await screen.findByText('Focused entry text')).toBeInTheDocument()
    const entryUrl = '/api/teacher/student-history?classroom_id=c1&student_id=s1&date=2026-06-01&limit=1'
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === entryUrl)).toHaveLength(2)
  })

  it('ignores a pending entry after the dialog closes and restores focus', async () => {
    const pendingEntry = deferred<Entry[]>()
    installFetchMock({
      entriesByScope: {
        'c1:s1:2026-06-01': pendingEntry.promise,
      },
    })

    renderDashboard()

    const openLog = await screen.findByRole('button', {
      name: 'Open student@example.com log for 2026-06-01',
    })
    openLog.focus()
    fireEvent.click(openLog)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(openLog).toHaveFocus())

    await act(async () => {
      pendingEntry.resolve([
        entry({
          studentId: 's1',
          classroomId: 'c1',
          date: '2026-06-01',
          text: 'Stale closed response',
        }),
      ])
    })

    expect(screen.queryByText('Stale closed response')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not let an older student request replace a newer entry dialog', async () => {
    const firstEntry = deferred<Entry[]>()
    const secondEntry = deferred<Entry[]>()
    installFetchMock({
      attendanceByClassroom: {
        c1: [
          attendanceRecord({ studentId: 's1', email: 'first@example.com', date: '2026-06-01' }),
          attendanceRecord({ studentId: 's2', email: 'second@example.com', date: '2026-06-01' }),
        ],
      },
      entriesByScope: {
        'c1:s1:2026-06-01': firstEntry.promise,
        'c1:s2:2026-06-01': secondEntry.promise,
      },
    })

    renderDashboard()

    fireEvent.click(await screen.findByRole('button', {
      name: 'Open first@example.com log for 2026-06-01',
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', {
      name: 'Open second@example.com log for 2026-06-01',
    }))

    await act(async () => {
      secondEntry.resolve([
        entry({
          studentId: 's2',
          classroomId: 'c1',
          date: '2026-06-01',
          text: 'Second student entry',
        }),
      ])
    })
    expect(await screen.findByText('Second student entry')).toBeInTheDocument()

    await act(async () => {
      firstEntry.resolve([
        entry({
          studentId: 's1',
          classroomId: 'c1',
          date: '2026-06-01',
          text: 'Stale first student entry',
        }),
      ])
    })

    expect(screen.getByText('Second student entry')).toBeInTheDocument()
    expect(screen.queryByText('Stale first student entry')).not.toBeInTheDocument()
  })

  it('ignores a pending entry after switching classrooms', async () => {
    const pendingEntry = deferred<Entry[]>()
    const firstClassroom = createMockClassroom({ id: 'c1', title: 'First Class', class_code: 'FIRST' })
    const secondClassroom = createMockClassroom({ id: 'c2', title: 'Second Class', class_code: 'SECOND' })
    installFetchMock({
      classrooms: [firstClassroom, secondClassroom],
      attendanceByClassroom: {
        c2: [attendanceRecord({ studentId: 's2', email: 'second@example.com', date: '2026-06-01' })],
      },
      entriesByScope: {
        'c1:s1:2026-06-01': pendingEntry.promise,
      },
    })

    renderDashboard()

    const secondClassroomButton = await screen.findByRole('button', { name: /Second Class/ })
    fireEvent.click(screen.getByRole('button', {
      name: 'Open student@example.com log for 2026-06-01',
    }))
    expect(screen.getByRole('dialog', { name: 'student@example.com' })).toBeInTheDocument()

    fireEvent.click(secondClassroomButton)

    expect(await screen.findByText('second@example.com')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await act(async () => {
      pendingEntry.resolve([
        entry({
          studentId: 's1',
          classroomId: 'c1',
          date: '2026-06-01',
          text: 'Stale first-class entry',
        }),
      ])
    })

    expect(screen.queryByText('Stale first-class entry')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('invalidates and reloads attendance after roster upload', async () => {
    installFetchMock()

    renderDashboard()

    await screen.findByText('student@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Upload roster' }))
    fireEvent.click(screen.getByRole('button', { name: 'Complete roster upload' }))

    await waitFor(() => {
      expect(invalidateCachedJSON).toHaveBeenCalledWith('teacher-dashboard:attendance:c1')
    })
    expect(fetchJSONWithCache).toHaveBeenCalledWith(
      'teacher-dashboard:attendance:c1',
      expect.any(Function),
      20_000,
    )
  })

  it('shows a retryable attendance error when the roster-upload refresh fails', async () => {
    installFetchMock()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let attendanceLoadCount = 0
    vi.mocked(fetchJSONWithCache).mockImplementation((key, load) => {
      if (key === 'teacher-dashboard:attendance:c1') {
        attendanceLoadCount += 1
        if (attendanceLoadCount === 2) {
          return Promise.reject(new Error('Attendance refresh unavailable'))
        }
      }
      return load()
    })

    renderDashboard()

    await screen.findByText('student@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Upload roster' }))
    fireEvent.click(screen.getByRole('button', { name: 'Complete roster upload' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load attendance')
    expect(screen.queryByText('No students enrolled yet')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('student@example.com')).toBeInTheDocument()
    expect(attendanceLoadCount).toBe(3)
    expect(consoleError).toHaveBeenCalled()
  })

  it('keeps roster-upload attendance fresher than older in-flight attendance', async () => {
    const firstLoad = deferred<{ attendance: AttendanceRecord[]; dates: string[] }>()
    installFetchMock({
      attendanceByClassroom: {
        c1: firstLoad.promise,
      },
    })

    vi.mocked(fetchJSONWithCache).mockImplementation((key, load) => {
      if (key === 'teacher-dashboard:attendance:c1') {
        return load()
      }
      return load()
    })

    renderDashboard()

    await waitFor(() => {
      expect(fetchJSONWithCache).toHaveBeenCalledWith(
        'teacher-dashboard:attendance:c1',
        expect.any(Function),
        20_000,
      )
    })

    vi.mocked(fetchJSONWithCache).mockImplementation((key, load) => {
      if (key === 'teacher-dashboard:attendance:c1') {
        return Promise.resolve({
          attendance: [
            attendanceRecord({
              studentId: 'fresh',
              email: 'fresh@example.com',
              date: '2026-06-03',
            }),
          ],
          dates: ['2026-06-03'],
        })
      }
      return load()
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Upload roster' }))
    fireEvent.click(screen.getByRole('button', { name: 'Complete roster upload' }))

    expect(await screen.findByText('fresh@example.com')).toBeInTheDocument()

    await act(async () => {
      firstLoad.resolve({
        attendance: [
          attendanceRecord({
            studentId: 'stale',
            email: 'stale@example.com',
            date: '2026-06-01',
          }),
        ],
        dates: ['2026-06-01'],
      })
    })

    expect(screen.getByText('fresh@example.com')).toBeInTheDocument()
    expect(screen.queryByText('stale@example.com')).not.toBeInTheDocument()
  })

  it('ignores stale attendance responses after switching classrooms', async () => {
    const firstClassroom = createMockClassroom({ id: 'c1', title: 'First Class', class_code: 'FIRST' })
    const secondClassroom = createMockClassroom({ id: 'c2', title: 'Second Class', class_code: 'SECOND' })
    const firstLoad = deferred<{ attendance: AttendanceRecord[]; dates: string[] }>()
    const secondLoad = deferred<{ attendance: AttendanceRecord[]; dates: string[] }>()
    installFetchMock({
      classrooms: [firstClassroom, secondClassroom],
      attendanceByClassroom: {
        c1: firstLoad.promise,
        c2: secondLoad.promise,
      },
    })

    renderDashboard()

    fireEvent.click(await screen.findByRole('button', { name: /Second Class/ }))

    await act(async () => {
      secondLoad.resolve({
        attendance: [attendanceRecord({ studentId: 's2', email: 'second@example.com', date: '2026-06-02' })],
        dates: ['2026-06-02'],
      })
    })

    expect(await screen.findByText('second@example.com')).toBeInTheDocument()

    await act(async () => {
      firstLoad.resolve({
        attendance: [attendanceRecord({ studentId: 's1', email: 'first@example.com', date: '2026-06-01' })],
        dates: ['2026-06-01'],
      })
    })

    const actionPrimary = screen.getByTestId('dashboard-action-primary')
    expect(within(actionPrimary).getByText('Second Class')).toBeInTheDocument()
    expect(screen.getByText('second@example.com')).toBeInTheDocument()
    expect(screen.queryByText('first@example.com')).not.toBeInTheDocument()
  })

  it('does not show the prior roster when the newly selected classroom fails', async () => {
    const firstClassroom = createMockClassroom({ id: 'c1', title: 'First Class', class_code: 'FIRST' })
    const secondClassroom = createMockClassroom({ id: 'c2', title: 'Second Class', class_code: 'SECOND' })
    installFetchMock({
      classrooms: [firstClassroom, secondClassroom],
      attendanceFailuresByClassroom: { c2: 1 },
      attendanceByClassroom: {
        c1: [attendanceRecord({ studentId: 's1', email: 'first@example.com', date: '2026-06-01' })],
      },
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    renderDashboard()

    expect(await screen.findByText('first@example.com')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Second Class/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load attendance')
    expect(screen.queryByText('first@example.com')).not.toBeInTheDocument()
    expect(screen.queryByText('No students enrolled yet')).not.toBeInTheDocument()
  })
})
