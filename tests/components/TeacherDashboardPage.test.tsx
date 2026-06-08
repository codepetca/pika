import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  CreateClassroomModal: ({ isOpen, onSuccess }: any) => isOpen ? (
    <button
      type="button"
      onClick={() => onSuccess(createMockClassroom({ id: 'created', title: 'Created Class' }))}
    >
      Create mocked classroom
    </button>
  ) : null,
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
  attendanceByClassroom?: Record<string, AttendanceRecord[] | Promise<{ attendance: AttendanceRecord[]; dates: string[] }>>
  datesByClassroom?: Record<string, string[]>
  entriesByClassroom?: Record<string, Entry[]>
}) {
  const classrooms = options?.classrooms ?? [
    createMockClassroom({ id: 'c1', title: 'Dashboard Class', class_code: 'DASH1' }),
  ]

  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    if (url === '/api/auth/me' && method === 'GET') {
      return Promise.resolve(jsonResponse({
        user: { id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' },
      }))
    }

    if (url === '/api/teacher/classrooms' && method === 'GET') {
      return Promise.resolve(jsonResponse({ classrooms }))
    }

    if (url.startsWith('/api/teacher/attendance?classroom_id=') && method === 'GET') {
      const classroomId = new URL(url, 'http://localhost').searchParams.get('classroom_id') || ''
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

    if (url.startsWith('/api/student/entries?classroom_id=') && method === 'GET') {
      const classroomId = new URL(url, 'http://localhost').searchParams.get('classroom_id') || ''
      return Promise.resolve(jsonResponse({
        entries: options?.entriesByClassroom?.[classroomId] ?? [
          entry({
            studentId: 's1',
            classroomId,
            date: '2026-06-01',
            text: 'Focused entry text',
          }),
        ],
      }))
    }

    return Promise.reject(new Error(`Unexpected fetch: ${method} ${url}`))
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('Teacher dashboard page', () => {
  beforeEach(() => {
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

  it('loads entry details fresh when a present cell is opened', async () => {
    const fetchMock = installFetchMock()

    renderDashboard()

    await screen.findByText('student@example.com')
    fireEvent.click(screen.getByText('🟢'))

    expect(await screen.findByText('Focused entry text')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/student/entries?classroom_id=c1')
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
})
