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
  LessonCalendar: ({ lessonPlans, assignments, announcements, tests = [], currentDate, onDateChange }: any) => (
    <div
      data-testid="lesson-calendar"
      data-current-date={currentDate.toISOString().slice(0, 10)}
      data-lesson-count={lessonPlans.length}
      data-assignment-count={assignments.length}
      data-test-count={tests.length}
      data-test-ids={tests.map((test: { id: string }) => test.id).join(',')}
      data-announcement-count={announcements.length}
      data-lesson-ids={lessonPlans.map((lesson: { id: string }) => lesson.id).join(',')}
      data-assignment-ids={assignments.map((assignment: { id: string }) => assignment.id).join(',')}
      data-announcement-ids={announcements.map((announcement: { id: string }) => announcement.id).join(',')}
    ><button onClick={() => onDateChange(new Date(2025, 2, 2, 12))}>Navigate future reminder</button></div>
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
    invalidateCachedJSON(`student-tests:${classroom.id}`)
    invalidateCachedJSON(`student-assignments:${classroom.id}`)
    invalidateCachedJSON(`student-announcements:${classroom.id}`)
    invalidateCachedJSON(`student-lesson-plans:${secondClassroom.id}:2025-01-01:2025-06-30`)
    invalidateCachedJSON(`student-tests:${secondClassroom.id}`)
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
    invalidateCachedJSON(`student-tests:${classroom.id}`)
    invalidateCachedJSON(`student-assignments:${classroom.id}`)
    invalidateCachedJSON(`student-announcements:${classroom.id}`)
    invalidateCachedJSON(`student-lesson-plans:${secondClassroom.id}:2025-01-01:2025-06-30`)
    invalidateCachedJSON(`student-tests:${secondClassroom.id}`)
    invalidateCachedJSON(`student-assignments:${secondClassroom.id}`)
    invalidateCachedJSON(`student-announcements:${secondClassroom.id}`)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('preserves student date navigation and Month/All selection without refetching term data', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ lesson_plans: [], assignments: [], announcements: [] }) })
    render(<StudentLessonCalendarTab showTests={false} classroom={classroom} />, { wrapper: Wrapper })
    await screen.findByTestId('lesson-calendar')
    const week = screen.getByRole('button', { name: 'Week', exact: true })
    expect(week).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Go to today' })).toBeInTheDocument()
    const readCount = fetchMock.mock.calls.length
    week.focus()
    fireEvent.keyDown(week, { key: 'ArrowRight' })
    expect(screen.getByRole('button', { name: 'Month', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Next', exact: true })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All', exact: true }))
    expect(screen.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: 'Next', exact: true })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Go to today' })).not.toBeInTheDocument()
    fireEvent.click(week)
    expect(week).toHaveAttribute('aria-pressed', 'true')
    expect(fetchMock).toHaveBeenCalledTimes(readCount)
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

    render(<StudentLessonCalendarTab showTests={false} classroom={classroom} />, { wrapper: Wrapper })

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

    render(<StudentLessonCalendarTab showTests={false} classroom={classroom} />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    // Wait a tick — no additional calls should fire
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not fetch or display classroom features hidden from students', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ lesson_plans: [], max_date: null }),
    })

    render(
      <StudentLessonCalendarTab showTests={false}
        classroom={classroom}
        showClasswork={false}
        showAnnouncements={false}
      />,
      { wrapper: Wrapper },
    )

    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toBeInTheDocument()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/lesson-plans')
    expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-assignment-count', '0')
    expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-announcement-count', '0')
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

    const first = render(<StudentLessonCalendarTab showTests={false} classroom={classroom} />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-count', '1')
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-assignment-count', '1')
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-announcement-count', '1')
    })

    first.unmount()
    render(<StudentLessonCalendarTab showTests={false} classroom={classroom} />, { wrapper: Wrapper })

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

    render(<StudentLessonCalendarTab showTests={false} classroom={classroom} />, { wrapper: Wrapper })

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

    render(<StudentLessonCalendarTab showTests={false} classroom={classroom} />, { wrapper: Wrapper })

    const retryButton = await screen.findByRole('button', { name: 'Retry assignments' })
    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-count', '1')
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-announcement-count', '1')
    })
    retryButton.focus()
    fireEvent.click(retryButton)

    expect(await screen.findByRole('button', { name: 'Retrying assignments' })).toBeDisabled()
    expect(document.activeElement).toBe(retryButton)

    await act(async () => {
      resolveAssignmentRetry({ ok: true, json: async () => ({ assignments: [{ id: 'assignment-1' }] }) })
      await assignmentRetry
    })

    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-assignment-count', '1')
      expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Calendar workspace' }))
    })
    expect(screen.queryByRole('button', { name: 'Retry assignments' })).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(assignmentReads).toBe(2)
  })

  it('keeps a retained class-day retry focused until failure or recovery settles', async () => {
    classDaysState.error = 'The class schedule could not be loaded.'
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => {
        if (url.includes('lesson-plans')) return { lesson_plans: [{ id: 'lesson-1' }] }
        if (url.includes('assignments')) return { assignments: [] }
        if (url.includes('announcements')) return { announcements: [] }
        return {}
      },
    }))

    const view = render(<StudentLessonCalendarTab showTests={false} classroom={classroom} />, { wrapper: Wrapper })
    const retryButton = await screen.findByRole('button', { name: 'Retry class days' })
    retryButton.focus()
    fireEvent.click(retryButton)

    classDaysState.isLoading = true
    view.rerender(<StudentLessonCalendarTab showTests={false} classroom={classroom} />)
    expect(screen.getByRole('button', { name: 'Retrying class days' })).toBeDisabled()
    expect(document.activeElement).toBe(retryButton)

    classDaysState.isLoading = false
    view.rerender(<StudentLessonCalendarTab showTests={false} classroom={classroom} />)
    expect(screen.getByRole('button', { name: 'Retry class days' })).toBeInTheDocument()
    expect(document.activeElement).toBe(retryButton)

    fireEvent.click(retryButton)
    classDaysState.isLoading = true
    view.rerender(<StudentLessonCalendarTab showTests={false} classroom={classroom} />)
    classDaysState.isLoading = false
    classDaysState.error = null
    view.rerender(<StudentLessonCalendarTab showTests={false} classroom={classroom} />)

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Calendar workspace' }))
    })
  })

  it('shows a retryable cold error when no calendar source loads', async () => {
    classDaysState.error = 'The class schedule could not be loaded.'
    classDaysState.hasLoadedSnapshot = false
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Failed' }) })

    render(<StudentLessonCalendarTab showTests={false} classroom={classroom} />, { wrapper: Wrapper })

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

    const view = render(<StudentLessonCalendarTab showTests={false} classroom={classroom} />, { wrapper: Wrapper })
    const retryButton = await screen.findByRole('button', { name: 'Retry assignments' })
    retryButton.focus()
    fireEvent.click(retryButton)
    expect(await screen.findByRole('button', { name: 'Retrying assignments' })).toBeDisabled()

    view.rerender(<StudentLessonCalendarTab showTests={false} classroom={secondClassroom} />)
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

    const view = render(<StudentLessonCalendarTab showTests={false} classroom={classroom} />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    view.rerender(<StudentLessonCalendarTab showTests={false} classroom={secondClassroom} />)

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
  it('retains future closed Test reminders on Calendar and reports a retryable source failure', async () => {
    let testReads = 0
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/tests?')) {
        testReads += 1
        return testReads === 1
          ? { ok: false, json: async () => ({ error: 'Unavailable' }) }
          : { ok: true, json: async () => ({ tests: [{ id: 'dated-test', title: 'Dated', test_date: '9999-03-01', status: 'closed', student_status: 'not_started' }] }) }
      }
      return { ok: true, json: async () => ({ lesson_plans: [], assignments: [], announcements: [] }) }
    })
    render(<StudentLessonCalendarTab classroom={classroom} showTests />, { wrapper: Wrapper })
    expect(await screen.findByRole('button', { name: 'Retry tests' })).toBeInTheDocument()
    expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-test-count', '0')
    fireEvent.click(screen.getByRole('button', { name: 'Retry tests' }))
    await waitFor(() => expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-test-ids', 'dated-test'))
    expect(testReads).toBe(2)
  })

  it('isolates late test list responses from a previous classroom', async () => {
    let resolveFirst!: (value: any) => void
    fetchMock.mockImplementation((url: string) => {
      if (url.includes(`/tests?classroom_id=${classroom.id}`)) return new Promise(resolve => { resolveFirst = resolve })
      return Promise.resolve({ ok: true, json: async () => ({ lesson_plans: [], assignments: [], announcements: [], tests: [{ id: 'second-test' }] }) })
    })
    const view = render(<StudentLessonCalendarTab classroom={classroom} showTests />, { wrapper: Wrapper })
    await waitFor(() => expect(resolveFirst).toBeTypeOf('function'))
    view.rerender(<StudentLessonCalendarTab classroom={secondClassroom} showTests />)
    await waitFor(() => expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-test-ids', 'second-test'))
    await act(async () => { resolveFirst({ ok: true, json: async () => ({ tests: [{ id: 'old-test' }] }) }) })
    expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-test-ids', 'second-test')
  })
  it.each([true, false])('allows future reminder navigation only with the permitted Tests source (%s)', async (showTests) => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({
      lesson_plans: [{ id: 'permitted-lesson' }], max_date: '2025-01-05',
      tests: [{ id: 'future-test', test_date: '2025-03-08' }], assignments: [], announcements: [],
    }) })
    render(<StudentLessonCalendarTab classroom={classroom} showTests={showTests} />, { wrapper: Wrapper })
    const calendar = await screen.findByTestId('lesson-calendar')
    const initialDate = calendar.getAttribute('data-current-date')
    fireEvent.click(screen.getByRole('button', { name: 'Navigate future reminder' }))
    expect(calendar).toHaveAttribute('data-current-date', showTests ? '2025-03-02' : initialDate)
    expect(calendar).toHaveAttribute('data-lesson-ids', 'permitted-lesson')
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/lesson-plans'))).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/tests?'))).toHaveLength(showTests ? 1 : 0)
  })

})
