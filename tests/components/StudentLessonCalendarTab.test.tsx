import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { StudentLessonCalendarTab } from '@/app/classrooms/[classroomId]/StudentLessonCalendarTab'
import { createMockClassroom } from '../helpers/mocks'
import { invalidateCachedJSON } from '@/lib/request-cache'
import { AppMessageProvider } from '@/ui'
import type { ReactNode } from 'react'

const classDaysState = vi.hoisted(() => ({
  classDays: [],
  error: null as string | null,
  hasLoadedSnapshot: true,
  isLoading: false,
  refresh: vi.fn(async () => {}),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/hooks/useClassDays', () => ({
  useClassDaysContext: () => classDaysState,
}))

vi.mock('@/lib/cookies', () => ({
  readCookie: () => 'week',
  writeCookie: vi.fn(),
}))

vi.mock('@/components/LessonCalendar', () => ({
  LessonCalendar: ({ lessonPlans, assignments, announcements }: any) => (
    <div
      data-testid="lesson-calendar"
      data-lesson-count={lessonPlans.length}
      data-assignment-count={assignments.length}
      data-announcement-count={announcements.length}
      data-lesson-ids={lessonPlans.map((lesson: { id: string }) => lesson.id).join(',')}
      data-assignment-ids={assignments.map((assignment: { id: string }) => assignment.id).join(',')}
      data-announcement-ids={announcements.map((announcement: { id: string }) => announcement.id).join(',')}
    />
  ),
  CalendarViewMode: {},
}))

function Wrapper({ children }: { children: ReactNode }) {
  return <AppMessageProvider>{children}</AppMessageProvider>
}

describe('StudentLessonCalendarTab', () => {
  const classroom = createMockClassroom({
    start_date: '2025-01-01',
    end_date: '2025-06-30',
  })
  const secondClassroom = createMockClassroom({
    id: 'classroom-2',
    start_date: '2025-01-01',
    end_date: '2025-06-30',
  })
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    invalidateCachedJSON(`student-lesson-plans:${classroom.id}:2025-01-01:2025-06-30`)
    invalidateCachedJSON(`student-assignments:${classroom.id}`)
    invalidateCachedJSON(`student-announcements:${classroom.id}`)
    invalidateCachedJSON(`student-lesson-plans:${secondClassroom.id}:2025-01-01:2025-06-30`)
    invalidateCachedJSON(`student-assignments:${secondClassroom.id}`)
    invalidateCachedJSON(`student-announcements:${secondClassroom.id}`)
    classDaysState.classDays = []
    classDaysState.error = null
    classDaysState.hasLoadedSnapshot = true
    classDaysState.isLoading = false
    classDaysState.refresh.mockClear()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    invalidateCachedJSON(`student-lesson-plans:${classroom.id}:2025-01-01:2025-06-30`)
    invalidateCachedJSON(`student-assignments:${classroom.id}`)
    invalidateCachedJSON(`student-announcements:${classroom.id}`)
    invalidateCachedJSON(`student-lesson-plans:${secondClassroom.id}:2025-01-01:2025-06-30`)
    invalidateCachedJSON(`student-assignments:${secondClassroom.id}`)
    invalidateCachedJSON(`student-announcements:${secondClassroom.id}`)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('fires all 3 API calls in parallel via Promise.all (#306)', async () => {
    // Track the order calls were initiated
    const callOrder: string[] = []
    let resolveAll: (() => void)[] = []

    fetchMock.mockImplementation((url: string) => {
      callOrder.push(url)
      return new Promise((resolve) => {
        resolveAll.push(() =>
          resolve({
            ok: true,
            json: async () => {
              if (url.includes('lesson-plans')) return { lesson_plans: [] }
              if (url.includes('assignments')) return { assignments: [] }
              if (url.includes('announcements')) return { announcements: [] }
              return {}
            },
          })
        )
      })
    })

    render(<StudentLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })

    // All 3 fetches should be initiated before any resolve
    await waitFor(() => {
      expect(callOrder).toHaveLength(3)
    })

    expect(callOrder.some((u) => u.includes('lesson-plans'))).toBe(true)
    expect(callOrder.some((u) => u.includes('assignments'))).toBe(true)
    expect(callOrder.some((u) => u.includes('announcements'))).toBe(true)

    // Resolve all fetches and flush resulting state updates.
    await act(async () => {
      resolveAll.forEach((resolve) => resolve())
      await Promise.resolve()
    })
  })

  it('fires exactly 3 fetch calls total (not 3 separate useEffects)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ lesson_plans: [], assignments: [], announcements: [] }),
    })

    render(<StudentLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    // Wait a tick — no additional calls should fire
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('reuses calendar data cache keys on remount', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => {
        if (url.includes('lesson-plans')) return { lesson_plans: [{ id: 'lesson-1' }] }
        if (url.includes('assignments')) return { assignments: [{ id: 'assignment-1' }] }
        if (url.includes('announcements')) return { announcements: [{ id: 'announcement-1' }] }
        return {}
      },
    }))

    const first = render(<StudentLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-count', '1')
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-assignment-count', '1')
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-announcement-count', '1')
    })

    first.unmount()
    render(<StudentLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-count', '1')
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-assignment-count', '1')
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-announcement-count', '1')
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)

    const urls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(urls.filter((url) => url.includes('lesson-plans'))).toHaveLength(1)
    expect(urls.filter((url) => url.includes('assignments'))).toHaveLength(1)
    expect(urls.filter((url) => url.includes('announcements'))).toHaveLength(1)
  })

  it('keeps lesson plans visible when ancillary calendar reads fail', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('assignments')) {
        return {
          ok: false,
          json: async () => ({ error: 'Failed' }),
        }
      }

      return {
        ok: true,
        json: async () => {
          if (url.includes('lesson-plans')) return { lesson_plans: [{ id: 'lesson-1' }] }
          if (url.includes('announcements')) return { announcements: [{ id: 'announcement-1' }] }
          return {}
        },
      }
    })

    render(<StudentLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-count', '1')
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-assignment-count', '0')
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-announcement-count', '1')
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Some calendar information could not be loaded')
    expect(screen.getByRole('button', { name: 'Retry assignments' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('retries only the failed calendar source and adds its recovered data', async () => {
    let assignmentReads = 0
    let resolveAssignmentRetry!: (value: any) => void
    const assignmentRetry = new Promise<any>((resolve) => {
      resolveAssignmentRetry = resolve
    })
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('assignments')) {
        assignmentReads += 1
        if (assignmentReads === 1) {
          return Promise.resolve({ ok: false, json: async () => ({ error: 'Failed' }) })
        }
        return assignmentRetry
      }
      return Promise.resolve({
        ok: true,
        json: async () => url.includes('lesson-plans')
          ? { lesson_plans: [{ id: 'lesson-1' }] }
          : { announcements: [{ id: 'announcement-1' }] },
      })
    })

    render(<StudentLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })

    const retryButton = await screen.findByRole('button', { name: 'Retry assignments' })
    retryButton.focus()
    fireEvent.click(retryButton)

    expect(await screen.findByRole('button', { name: 'Retrying assignments' })).toBeDisabled()
    expect(document.activeElement).toBe(retryButton)

    resolveAssignmentRetry({ ok: true, json: async () => ({ assignments: [{ id: 'assignment-1' }] }) })

    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-assignment-count', '1')
      expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Calendar workspace' }))
    })
    expect(screen.queryByRole('button', { name: 'Retry assignments' })).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(assignmentReads).toBe(2)
  })

  it('shows a retryable cold error when no calendar source loads', async () => {
    classDaysState.error = 'The class schedule could not be loaded.'
    classDaysState.hasLoadedSnapshot = false
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Failed' }) })

    render(<StudentLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })

    expect(await screen.findByRole('heading', { name: "Calendar couldn't load" })).toBeInTheDocument()
    expect(screen.queryByTestId('lesson-calendar')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(classDaysState.refresh).toHaveBeenCalledTimes(1)
  })

  it('does not carry retry focus intent into another classroom', async () => {
    let resolveFirstClassroomRetry!: (value: any) => void
    const firstClassroomRetry = new Promise<any>((resolve) => {
      resolveFirstClassroomRetry = resolve
    })
    let firstClassroomAssignmentReads = 0

    fetchMock.mockImplementation((url: string) => {
      if (url.includes(`classroom_id=${classroom.id}`)) {
        firstClassroomAssignmentReads += 1
        if (firstClassroomAssignmentReads === 1) {
          return Promise.resolve({ ok: false, json: async () => ({ error: 'Failed' }) })
        }
        return firstClassroomRetry
      }
      if (url.includes('lesson-plans')) {
        const lessonId = url.includes(secondClassroom.id) ? 'classroom-2-lesson' : 'classroom-1-lesson'
        return Promise.resolve({ ok: true, json: async () => ({ lesson_plans: [{ id: lessonId }] }) })
      }
      if (url.includes('assignments')) {
        return Promise.resolve({ ok: true, json: async () => ({ assignments: [{ id: 'classroom-2-assignment' }] }) })
      }
      if (url.includes('announcements')) return Promise.resolve({ ok: true, json: async () => ({ announcements: [] }) })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    const view = render(<StudentLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })
    const retryButton = await screen.findByRole('button', { name: 'Retry assignments' })
    retryButton.focus()
    fireEvent.click(retryButton)
    expect(await screen.findByRole('button', { name: 'Retrying assignments' })).toBeDisabled()

    view.rerender(<StudentLessonCalendarTab classroom={secondClassroom} />)
    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-ids', 'classroom-2-lesson')
    })
    expect(document.activeElement).not.toBe(screen.getByRole('region', { name: 'Calendar workspace' }))

    resolveFirstClassroomRetry({ ok: true, json: async () => ({ assignments: [] }) })
  })

  it('ignores late calendar responses after switching classrooms', async () => {
    type PendingFetch = {
      url: string
      resolve: (value: { ok: boolean; json: () => Promise<Record<string, unknown>> }) => void
    }
    const pending: PendingFetch[] = []

    fetchMock.mockImplementation((url: string) => (
      new Promise((resolve) => {
        pending.push({ url, resolve: resolve as PendingFetch['resolve'] })
      })
    ))

    function payloadFor(url: string, classroomId: string) {
      if (url.includes('lesson-plans')) {
        return { lesson_plans: [{ id: `${classroomId}-lesson` }], max_date: '2025-06-30' }
      }
      if (url.includes('assignments')) {
        return { assignments: [{ id: `${classroomId}-assignment` }] }
      }
      if (url.includes('announcements')) {
        return { announcements: [{ id: `${classroomId}-announcement` }] }
      }
      return {}
    }

    async function resolveClassroom(classroomId: string) {
      await act(async () => {
        pending
          .filter((request) => request.url.includes(classroomId))
          .forEach((request) => {
            request.resolve({
              ok: true,
              json: async () => payloadFor(request.url, classroomId),
            })
          })
        await Promise.resolve()
      })
    }

    const view = render(<StudentLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    view.rerender(<StudentLessonCalendarTab classroom={secondClassroom} />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(6)
    })

    await resolveClassroom(classroom.id)

    expect(screen.queryByTestId('lesson-calendar')).not.toBeInTheDocument()

    await resolveClassroom(secondClassroom.id)

    await waitFor(() => {
      const calendar = screen.getByTestId('lesson-calendar')
      expect(calendar).toHaveAttribute('data-lesson-ids', 'classroom-2-lesson')
      expect(calendar).toHaveAttribute('data-assignment-ids', 'classroom-2-assignment')
      expect(calendar).toHaveAttribute('data-announcement-ids', 'classroom-2-announcement')
    })
  })
})
