import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TeacherLessonCalendarTab } from '@/app/classrooms/[classroomId]/TeacherLessonCalendarTab'
import { createMockClassroom } from '../helpers/mocks'
import { AppMessageProvider, TooltipProvider } from '@/ui'
import { invalidateTeacherLessonPlansForClassroom } from '@/lib/teacher-lesson-plans-client'
import { invalidateCachedJSON } from '@/lib/request-cache'
import type { CalendarSidebarState } from '@/app/classrooms/[classroomId]/TeacherLessonCalendarTab'
import type { LessonPlan } from '@/types'
import type { ReactNode } from 'react'
import { TEACHER_ASSIGNMENTS_UPDATED_EVENT } from '@/lib/events'
import { resetTeacherLessonPlanMutationQueuesForTests } from '@/lib/teacher-lesson-plan-mutation-queue'

const sidebarState = vi.hoisted(() => ({
  isOpen: false,
  toggle: vi.fn(),
  setOpen: vi.fn(),
}))

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

vi.mock('@/components/layout', () => ({
  useRightSidebar: () => ({
    toggle: sidebarState.toggle,
    isOpen: sidebarState.isOpen,
    setOpen: sidebarState.setOpen,
    enabled: true,
    cssWidth: '300px',
  }),
}))

vi.mock('@/contexts/MarkdownPreferenceContext', () => ({
  useMarkdownPreference: () => ({ showMarkdown: true, mounted: true }),
}))

vi.mock('@/components/LessonCalendar', () => ({
  LessonCalendar: ({ lessonPlans, assignments, announcements, onContentChange }: any) => (
    <div
      data-testid="lesson-calendar"
      data-lesson-count={lessonPlans.length}
      data-lesson-classrooms={lessonPlans.map((plan: LessonPlan) => plan.classroom_id).join(',')}
      data-lesson-content={lessonPlans.map((plan: LessonPlan) => plan.content_markdown).join(',')}
      data-assignment-classrooms={assignments.map((assignment: any) => assignment.classroom_id).join(',')}
      data-assignment-ids={assignments.map((assignment: any) => assignment.id).join(',')}
      data-announcement-classrooms={announcements.map((announcement: any) => announcement.classroom_id).join(',')}
    >
      <button type="button" onClick={() => onContentChange?.('2025-01-06', 'Updated lesson')}>
        Edit lesson
      </button>
      <button type="button" onClick={() => onContentChange?.('2025-01-06', 'Newest lesson')}>
        Edit lesson again
      </button>
      <button type="button" onClick={() => onContentChange?.('2025-01-07', 'Second date lesson')}>
        Edit second date
      </button>
    </div>
  ),
  CalendarViewMode: {},
}))

function lessonPlan(overrides: Partial<LessonPlan> = {}): LessonPlan {
  return {
    id: 'lesson-1',
    classroom_id: 'classroom-1',
    date: '2025-01-06',
    content: { type: 'doc', content: [] },
    content_markdown: 'Original lesson',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <AppMessageProvider>
      <TooltipProvider>{children}</TooltipProvider>
    </AppMessageProvider>
  )
}

describe('TeacherLessonCalendarTab', () => {
  const classroom = createMockClassroom({
    id: 'classroom-1',
    start_date: '2025-01-01',
    end_date: '2025-06-30',
  })
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetTeacherLessonPlanMutationQueuesForTests()
    invalidateTeacherLessonPlansForClassroom(classroom.id)
    invalidateCachedJSON(`teacher-assignments:${classroom.id}`)
    invalidateCachedJSON(`teacher-announcements:${classroom.id}`)
    sidebarState.isOpen = false
    sidebarState.toggle.mockReset()
    sidebarState.setOpen.mockReset()
    classDaysState.classDays = []
    classDaysState.error = null
    classDaysState.hasLoadedSnapshot = true
    classDaysState.isLoading = false
    classDaysState.refresh.mockClear()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    resetTeacherLessonPlanMutationQueuesForTests()
    invalidateTeacherLessonPlansForClassroom(classroom.id)
    invalidateCachedJSON(`teacher-assignments:${classroom.id}`)
    invalidateCachedJSON(`teacher-announcements:${classroom.id}`)
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not fetch or display classroom features hidden from teachers', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ lesson_plans: [] }),
    })

    render(
      <TeacherLessonCalendarTab
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
    expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-assignment-ids', '')
    expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-announcement-classrooms', '')
  })

  it('reuses cached teacher lesson plans on remount', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => {
        if (url.includes('lesson-plans')) return { lesson_plans: [lessonPlan()] }
        if (url.includes('assignments')) return { assignments: [] }
        if (url.includes('announcements')) return { announcements: [] }
        return {}
      },
    }))

    const first = render(<TeacherLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-count', '1')
    })

    first.unmount()
    render(<TeacherLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-count', '1')
    })

    const urls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(urls.filter((url) => url.includes('/lesson-plans?'))).toHaveLength(1)
    expect(urls.filter((url) => url.includes('/assignments'))).toHaveLength(1)
    expect(urls.filter((url) => url.includes('/announcements'))).toHaveLength(1)
  })

  it('keeps successful sources visible and retries only failed assignments', async () => {
    let assignmentReads = 0
    const assignmentRetry = deferred<any>()
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('assignments')) {
        assignmentReads += 1
        if (assignmentReads === 1) {
          return Promise.resolve({ ok: false, json: async () => ({ error: 'Failed' }) })
        }
        return assignmentRetry.promise
      }
      return Promise.resolve({
        ok: true,
        json: async () => {
          if (url.includes('lesson-plans')) return { lesson_plans: [lessonPlan()] }
          if (url.includes('announcements')) return { announcements: [{ id: 'announcement-1', classroom_id: classroom.id }] }
          return {}
        },
      })
    })

    render(<TeacherLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-count', '1')
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-announcement-classrooms', classroom.id)
    })
    const retryButton = screen.getByRole('button', { name: 'Retry assignments' })
    retryButton.focus()
    fireEvent.click(retryButton)

    expect(await screen.findByRole('button', { name: 'Retrying assignments' })).toBeDisabled()
    expect(document.activeElement).toBe(retryButton)

    assignmentRetry.resolve({
      ok: true,
      json: async () => ({ assignments: [{ id: 'assignment-1', classroom_id: classroom.id }] }),
    })

    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-assignment-classrooms', classroom.id)
      expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Calendar workspace' }))
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(assignmentReads).toBe(2)
  })

  it('keeps a retained class-day retry focused until failure or recovery settles', async () => {
    classDaysState.error = 'The class schedule could not be loaded.'
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => {
        if (url.includes('lesson-plans')) return { lesson_plans: [lessonPlan()] }
        if (url.includes('assignments')) return { assignments: [] }
        if (url.includes('announcements')) return { announcements: [] }
        return {}
      },
    }))

    const view = render(<TeacherLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })
    const retryButton = await screen.findByRole('button', { name: 'Retry class days' })
    retryButton.focus()
    fireEvent.click(retryButton)

    classDaysState.isLoading = true
    view.rerender(<TeacherLessonCalendarTab classroom={classroom} />)
    expect(screen.getByRole('button', { name: 'Retrying class days' })).toBeDisabled()
    expect(document.activeElement).toBe(retryButton)

    classDaysState.isLoading = false
    view.rerender(<TeacherLessonCalendarTab classroom={classroom} />)
    expect(screen.getByRole('button', { name: 'Retry class days' })).toBeInTheDocument()
    expect(document.activeElement).toBe(retryButton)

    fireEvent.click(retryButton)
    classDaysState.isLoading = true
    view.rerender(<TeacherLessonCalendarTab classroom={classroom} />)
    classDaysState.isLoading = false
    classDaysState.error = null
    view.rerender(<TeacherLessonCalendarTab classroom={classroom} />)

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Calendar workspace' }))
    })
  })

  it('keeps local lesson edits while a retained snapshot refresh is in flight', async () => {
    const refreshedLessonPlans = deferred<any>()
    const autosave = deferred<any>()
    let lessonPlanReads = 0
    let latestSidebarState: CalendarSidebarState | null = null

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/lesson-plans/bulk') && init?.method === 'PUT') {
        return Promise.resolve({ ok: true, json: async () => ({}) })
      }
      if (url.includes('/lesson-plans/2025-01-06') && init?.method === 'PUT') {
        return autosave.promise
      }
      if (url.includes('lesson-plans')) {
        lessonPlanReads += 1
        if (lessonPlanReads === 1) {
          return Promise.resolve({ ok: true, json: async () => ({ lesson_plans: [lessonPlan()] }) })
        }
        return refreshedLessonPlans.promise
      }
      if (url.includes('assignments')) return Promise.resolve({ ok: true, json: async () => ({ assignments: [] }) })
      if (url.includes('announcements')) return Promise.resolve({ ok: true, json: async () => ({ announcements: [] }) })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    sidebarState.isOpen = true
    render(
      <TeacherLessonCalendarTab
        classroom={classroom}
        onSidebarStateChange={(state) => {
          latestSidebarState = state
        }}
      />,
      { wrapper: Wrapper },
    )

    await waitFor(() => expect(latestSidebarState?.markdownContent).toContain('Original lesson'))
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Edit lesson' }))
    expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-content', 'Updated lesson')

    await act(async () => {
      vi.advanceTimersByTime(10_000)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/lesson-plans/2025-01-06') && init?.method === 'PUT')).toBe(true)
    vi.useRealTimers()

    act(() => latestSidebarState?.onMarkdownChange('## 2025-01-06\nUpdated lesson'))
    let markdownSave!: Promise<void>
    act(() => {
      markdownSave = latestSidebarState!.onSave()
    })
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/lesson-plans/bulk'))).toBe(false)

    autosave.resolve({
      ok: true,
      json: async () => ({ lesson_plan: lessonPlan({ content_markdown: 'Updated lesson' }) }),
    })
    await act(async () => markdownSave)
    await waitFor(() => expect(lessonPlanReads).toBe(2))
    const mutationUrls = fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'PUT')
      .map(([url]) => String(url))
    expect(mutationUrls).toEqual([
      `/api/teacher/classrooms/${classroom.id}/lesson-plans/2025-01-06`,
      `/api/teacher/classrooms/${classroom.id}/lesson-plans/bulk`,
    ])

    refreshedLessonPlans.resolve({ ok: true, json: async () => ({ lesson_plans: [lessonPlan()] }) })
    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-content', 'Updated lesson')
    })
  })

  it('does not carry retry focus intent into another classroom', async () => {
    const secondClassroom = createMockClassroom({
      id: 'classroom-2',
      start_date: '2025-01-01',
      end_date: '2025-06-30',
    })
    const firstClassroomRetry = deferred<any>()
    let firstClassroomAssignmentReads = 0

    invalidateTeacherLessonPlansForClassroom(secondClassroom.id)
    invalidateCachedJSON(`teacher-assignments:${secondClassroom.id}`)
    invalidateCachedJSON(`teacher-announcements:${secondClassroom.id}`)

    fetchMock.mockImplementation((url: string) => {
      if (url.includes(`classroom_id=${classroom.id}`)) {
        firstClassroomAssignmentReads += 1
        if (firstClassroomAssignmentReads === 1) {
          return Promise.resolve({ ok: false, json: async () => ({ error: 'Failed' }) })
        }
        return firstClassroomRetry.promise
      }
      if (url.includes('lesson-plans')) {
        const classroomId = url.includes(secondClassroom.id) ? secondClassroom.id : classroom.id
        return Promise.resolve({ ok: true, json: async () => ({ lesson_plans: [lessonPlan({ classroom_id: classroomId })] }) })
      }
      if (url.includes('assignments')) {
        return Promise.resolve({ ok: true, json: async () => ({ assignments: [{ id: 'assignment-2', classroom_id: secondClassroom.id }] }) })
      }
      if (url.includes('announcements')) return Promise.resolve({ ok: true, json: async () => ({ announcements: [] }) })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    const view = render(<TeacherLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })
    const retryButton = await screen.findByRole('button', { name: 'Retry assignments' })
    retryButton.focus()
    fireEvent.click(retryButton)
    expect(await screen.findByRole('button', { name: 'Retrying assignments' })).toBeDisabled()

    view.rerender(<TeacherLessonCalendarTab classroom={secondClassroom} />)
    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-classrooms', secondClassroom.id)
    })
    expect(document.activeElement).not.toBe(screen.getByRole('region', { name: 'Calendar workspace' }))

    firstClassroomRetry.resolve({ ok: true, json: async () => ({ assignments: [] }) })
  })

  it('shows a retryable cold error when no calendar source loads', async () => {
    classDaysState.error = 'The class schedule could not be loaded.'
    classDaysState.hasLoadedSnapshot = false
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'Failed' }) })

    render(<TeacherLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })

    expect(await screen.findByRole('heading', { name: "Calendar couldn't load" })).toBeInTheDocument()
    expect(screen.queryByTestId('lesson-calendar')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(classDaysState.refresh).toHaveBeenCalledTimes(1)
  })

  it('retains the last assignment snapshot when an event refresh fails', async () => {
    let assignmentReads = 0
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('assignments')) {
        assignmentReads += 1
        if (assignmentReads === 2) {
          return { ok: false, json: async () => ({ error: 'Failed' }) }
        }
        return {
          ok: true,
          json: async () => ({
            assignments: [{
              id: assignmentReads === 1 ? 'assignment-1' : 'assignment-2',
              classroom_id: classroom.id,
            }],
          }),
        }
      }
      return {
        ok: true,
        json: async () => url.includes('lesson-plans')
          ? { lesson_plans: [lessonPlan()] }
          : { announcements: [] },
      }
    })

    render(<TeacherLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-assignment-ids', 'assignment-1')
    })

    window.dispatchEvent(new CustomEvent(TEACHER_ASSIGNMENTS_UPDATED_EVENT, {
      detail: { classroomId: classroom.id },
    }))

    await screen.findByRole('button', { name: 'Retry assignments' })
    expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-assignment-ids', 'assignment-1')

    fireEvent.click(screen.getByRole('button', { name: 'Retry assignments' }))

    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-assignment-ids', 'assignment-2')
    })
    expect(assignmentReads).toBe(3)
  })

  it('ignores stale classroom-scoped loads after the classroom changes', async () => {
    const secondClassroom = createMockClassroom({
      id: 'classroom-2',
      start_date: '2025-01-01',
      end_date: '2025-06-30',
    })
    const firstLessonPlansRequest = deferred<any>()
    const firstAssignmentsRequest = deferred<any>()
    const firstAnnouncementsRequest = deferred<any>()
    const secondLessonPlansRequest = deferred<any>()
    const secondAssignmentsRequest = deferred<any>()
    const secondAnnouncementsRequest = deferred<any>()

    invalidateTeacherLessonPlansForClassroom(secondClassroom.id)
    invalidateCachedJSON(`teacher-assignments:${secondClassroom.id}`)
    invalidateCachedJSON(`teacher-announcements:${secondClassroom.id}`)

    fetchMock.mockImplementation((url: string) => {
      if (url.includes(`/api/teacher/classrooms/${classroom.id}/lesson-plans`)) {
        return firstLessonPlansRequest.promise
      }
      if (url.includes(`/api/teacher/classrooms/${secondClassroom.id}/lesson-plans`)) {
        return secondLessonPlansRequest.promise
      }
      if (url.includes(`classroom_id=${classroom.id}`)) {
        return firstAssignmentsRequest.promise
      }
      if (url.includes(`classroom_id=${secondClassroom.id}`)) {
        return secondAssignmentsRequest.promise
      }
      if (url.includes(`/api/teacher/classrooms/${classroom.id}/announcements`)) {
        return firstAnnouncementsRequest.promise
      }
      if (url.includes(`/api/teacher/classrooms/${secondClassroom.id}/announcements`)) {
        return secondAnnouncementsRequest.promise
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    const view = render(<TeacherLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })

    view.rerender(<TeacherLessonCalendarTab classroom={secondClassroom} />)

    secondLessonPlansRequest.resolve({
      ok: true,
      json: async () => ({
        lesson_plans: [lessonPlan({ id: 'lesson-2', classroom_id: secondClassroom.id })],
      }),
    })
    secondAssignmentsRequest.resolve({
      ok: true,
      json: async () => ({ assignments: [{ id: 'assignment-2', classroom_id: secondClassroom.id }] }),
    })
    secondAnnouncementsRequest.resolve({
      ok: true,
      json: async () => ({ announcements: [{ id: 'announcement-2', classroom_id: secondClassroom.id }] }),
    })

    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-classrooms', secondClassroom.id)
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-assignment-classrooms', secondClassroom.id)
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-announcement-classrooms', secondClassroom.id)
    })

    firstLessonPlansRequest.resolve({
      ok: true,
      json: async () => ({
        lesson_plans: [lessonPlan({ id: 'lesson-1', classroom_id: classroom.id })],
      }),
    })
    firstAssignmentsRequest.resolve({
      ok: true,
      json: async () => ({ assignments: [{ id: 'assignment-1', classroom_id: classroom.id }] }),
    })
    firstAnnouncementsRequest.resolve({
      ok: true,
      json: async () => ({ announcements: [{ id: 'announcement-1', classroom_id: classroom.id }] }),
    })

    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-classrooms', secondClassroom.id)
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-assignment-classrooms', secondClassroom.id)
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-announcement-classrooms', secondClassroom.id)
    })
  })

  it('hides previous classroom data while the next classroom loads', async () => {
    const secondClassroom = createMockClassroom({
      id: 'classroom-2',
      start_date: '2025-01-01',
      end_date: '2025-06-30',
    })
    const secondLessonPlansRequest = deferred<any>()
    const secondAssignmentsRequest = deferred<any>()
    const secondAnnouncementsRequest = deferred<any>()

    invalidateTeacherLessonPlansForClassroom(secondClassroom.id)
    invalidateCachedJSON(`teacher-assignments:${secondClassroom.id}`)
    invalidateCachedJSON(`teacher-announcements:${secondClassroom.id}`)

    fetchMock.mockImplementation((url: string) => {
      if (url.includes(`/api/teacher/classrooms/${classroom.id}/lesson-plans`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            lesson_plans: [lessonPlan({ id: 'lesson-1', classroom_id: classroom.id })],
          }),
        })
      }
      if (url.includes(`classroom_id=${classroom.id}`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ assignments: [{ id: 'assignment-1', classroom_id: classroom.id }] }),
        })
      }
      if (url.includes(`/api/teacher/classrooms/${classroom.id}/announcements`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ announcements: [{ id: 'announcement-1', classroom_id: classroom.id }] }),
        })
      }
      if (url.includes(`/api/teacher/classrooms/${secondClassroom.id}/lesson-plans`)) {
        return secondLessonPlansRequest.promise
      }
      if (url.includes(`classroom_id=${secondClassroom.id}`)) {
        return secondAssignmentsRequest.promise
      }
      if (url.includes(`/api/teacher/classrooms/${secondClassroom.id}/announcements`)) {
        return secondAnnouncementsRequest.promise
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    const view = render(<TeacherLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-classrooms', classroom.id)
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-assignment-classrooms', classroom.id)
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-announcement-classrooms', classroom.id)
    })

    view.rerender(<TeacherLessonCalendarTab classroom={secondClassroom} />)

    expect(screen.queryByTestId('lesson-calendar')).not.toBeInTheDocument()

    secondLessonPlansRequest.resolve({
      ok: true,
      json: async () => ({
        lesson_plans: [lessonPlan({ id: 'lesson-2', classroom_id: secondClassroom.id })],
      }),
    })
    secondAssignmentsRequest.resolve({
      ok: true,
      json: async () => ({ assignments: [{ id: 'assignment-2', classroom_id: secondClassroom.id }] }),
    })
    secondAnnouncementsRequest.resolve({
      ok: true,
      json: async () => ({ announcements: [{ id: 'announcement-2', classroom_id: secondClassroom.id }] }),
    })

    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-classrooms', secondClassroom.id)
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-assignment-classrooms', secondClassroom.id)
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-announcement-classrooms', secondClassroom.id)
    })
  })

  it('clears open markdown sidebar content on classroom change and blocks saving until reloaded', async () => {
    const secondClassroom = createMockClassroom({
      id: 'classroom-2',
      start_date: '2025-01-01',
      end_date: '2025-06-30',
    })
    const secondLessonPlansRequest = deferred<any>()
    let latestSidebarState: CalendarSidebarState | null = null

    invalidateTeacherLessonPlansForClassroom(secondClassroom.id)
    invalidateCachedJSON(`teacher-assignments:${secondClassroom.id}`)
    invalidateCachedJSON(`teacher-announcements:${secondClassroom.id}`)

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        throw new Error(`Unexpected save: ${url}`)
      }
      if (url.includes(`/api/teacher/classrooms/${classroom.id}/lesson-plans`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            lesson_plans: [lessonPlan({ id: 'lesson-1', classroom_id: classroom.id })],
          }),
        })
      }
      if (url.includes(`/api/teacher/classrooms/${secondClassroom.id}/lesson-plans`)) {
        return secondLessonPlansRequest.promise
      }
      if (url.includes('assignments')) return Promise.resolve({ ok: true, json: async () => ({ assignments: [] }) })
      if (url.includes('announcements')) return Promise.resolve({ ok: true, json: async () => ({ announcements: [] }) })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    sidebarState.isOpen = true
    const view = render(
      <TeacherLessonCalendarTab
        classroom={classroom}
        onSidebarStateChange={(state) => {
          latestSidebarState = state
        }}
      />,
      { wrapper: Wrapper },
    )

    await waitFor(() => {
      expect(latestSidebarState?.markdownContent).toContain('Original lesson')
    })

    view.rerender(
      <TeacherLessonCalendarTab
        classroom={secondClassroom}
        onSidebarStateChange={(state) => {
          latestSidebarState = state
        }}
      />,
    )

    await waitFor(() => {
      expect(latestSidebarState?.markdownContent).toBe('')
    })

    await act(async () => {
      latestSidebarState?.onSave()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(latestSidebarState?.markdownError).toBe('Lesson plans are still loading')
    })

    secondLessonPlansRequest.resolve({
      ok: true,
      json: async () => ({
        lesson_plans: [
          lessonPlan({
            id: 'lesson-2',
            classroom_id: secondClassroom.id,
            content_markdown: 'Second classroom lesson',
          }),
        ],
      }),
    })

    await waitFor(() => {
      expect(latestSidebarState?.markdownContent).toContain('Second classroom lesson')
    })
  })

  it('retains a failed bulk draft for its originating classroom only', async () => {
    const secondClassroom = createMockClassroom({
      id: 'classroom-2',
      start_date: '2025-01-01',
      end_date: '2025-06-30',
    })
    const bulkSave = deferred<any>()
    let latestSidebarState: CalendarSidebarState | null = null

    invalidateTeacherLessonPlansForClassroom(secondClassroom.id)
    invalidateCachedJSON(`teacher-assignments:${secondClassroom.id}`)
    invalidateCachedJSON(`teacher-announcements:${secondClassroom.id}`)

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/lesson-plans/bulk') && init?.method === 'PUT') return bulkSave.promise
      if (url.includes('lesson-plans')) {
        const isSecond = url.includes(secondClassroom.id)
        return Promise.resolve({
          ok: true,
          json: async () => ({
            lesson_plans: [lessonPlan({
              classroom_id: isSecond ? secondClassroom.id : classroom.id,
              content_markdown: isSecond ? 'Second classroom lesson' : 'Original lesson',
            })],
          }),
        })
      }
      if (url.includes('assignments')) return Promise.resolve({ ok: true, json: async () => ({ assignments: [] }) })
      if (url.includes('announcements')) return Promise.resolve({ ok: true, json: async () => ({ announcements: [] }) })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    sidebarState.isOpen = true
    const renderTab = (activeClassroom = classroom) => (
      <TeacherLessonCalendarTab
        classroom={activeClassroom}
        onSidebarStateChange={(state) => { latestSidebarState = state }}
      />
    )
    const view = render(renderTab(), { wrapper: Wrapper })
    await waitFor(() => expect(latestSidebarState?.markdownContent).toContain('Original lesson'))

    act(() => latestSidebarState?.onMarkdownChange('## 2025-01-06\nExact failed draft'))
    let savePromise!: Promise<void>
    act(() => { savePromise = latestSidebarState!.onSave() })
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/lesson-plans/bulk'))).toBe(true))

    view.rerender(renderTab(secondClassroom))
    await waitFor(() => expect(latestSidebarState?.markdownContent).toContain('Second classroom lesson'))

    bulkSave.resolve({ ok: false, json: async () => ({ error: 'Bulk A failed' }) })
    await act(async () => savePromise)
    expect(latestSidebarState?.markdownError).not.toBe('Bulk A failed')

    view.rerender(renderTab())
    await waitFor(() => {
      expect(latestSidebarState?.markdownContent).toBe('## 2025-01-06\nExact failed draft')
      expect(latestSidebarState?.markdownError).toBe('Bulk A failed')
    })
  })

  it('does not let an earlier visit bulk success close a later visit sidebar', async () => {
    const secondClassroom = createMockClassroom({
      id: 'classroom-2',
      start_date: '2025-01-01',
      end_date: '2025-06-30',
    })
    const bulkSave = deferred<any>()
    let latestSidebarState: CalendarSidebarState | null = null

    invalidateTeacherLessonPlansForClassroom(secondClassroom.id)
    invalidateCachedJSON(`teacher-assignments:${secondClassroom.id}`)
    invalidateCachedJSON(`teacher-announcements:${secondClassroom.id}`)

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/lesson-plans/bulk') && init?.method === 'PUT') return bulkSave.promise
      if (url.includes('lesson-plans')) {
        const classroomId = url.includes(secondClassroom.id) ? secondClassroom.id : classroom.id
        return Promise.resolve({
          ok: true,
          json: async () => ({ lesson_plans: [lessonPlan({ classroom_id: classroomId })] }),
        })
      }
      if (url.includes('assignments')) return Promise.resolve({ ok: true, json: async () => ({ assignments: [] }) })
      if (url.includes('announcements')) return Promise.resolve({ ok: true, json: async () => ({ announcements: [] }) })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    sidebarState.isOpen = true
    const renderTab = (activeClassroom = classroom) => (
      <TeacherLessonCalendarTab
        classroom={activeClassroom}
        onSidebarStateChange={(state) => { latestSidebarState = state }}
      />
    )
    const view = render(renderTab(), { wrapper: Wrapper })
    await waitFor(() => expect(latestSidebarState?.markdownContent).toContain('Original lesson'))
    act(() => latestSidebarState?.onMarkdownChange('## 2025-01-06\nSaved draft'))
    let savePromise!: Promise<void>
    act(() => { savePromise = latestSidebarState!.onSave() })
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/lesson-plans/bulk'))).toBe(true))

    view.rerender(renderTab(secondClassroom))
    await waitFor(() => expect(latestSidebarState?.markdownContent).not.toBe(''))
    view.rerender(renderTab())
    await waitFor(() => expect(latestSidebarState?.markdownContent).toBe('## 2025-01-06\nSaved draft'))
    sidebarState.setOpen.mockClear()

    bulkSave.resolve({ ok: true, json: async () => ({ lesson_plans: [] }) })
    await act(async () => savePromise)

    expect(sidebarState.setOpen).not.toHaveBeenCalledWith(false)
    expect(latestSidebarState?.markdownError).toBeNull()
  })

  it('keeps an identical later draft when an earlier bulk save succeeds', async () => {
    const secondClassroom = createMockClassroom({
      id: 'classroom-2',
      start_date: '2025-01-01',
      end_date: '2025-06-30',
    })
    const firstBulkSave = deferred<any>()
    let bulkSaveCount = 0
    let latestSidebarState: CalendarSidebarState | null = null

    invalidateTeacherLessonPlansForClassroom(secondClassroom.id)
    invalidateCachedJSON(`teacher-assignments:${secondClassroom.id}`)
    invalidateCachedJSON(`teacher-announcements:${secondClassroom.id}`)

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/lesson-plans/bulk') && init?.method === 'PUT') {
        bulkSaveCount += 1
        if (bulkSaveCount === 1) return firstBulkSave.promise
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: 'Later identical save failed' }),
        })
      }
      if (/\/lesson-plans\/2025-01-06$/.test(url) && init?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ lesson_plan: lessonPlan({ content_markdown: 'Updated lesson' }) }),
        })
      }
      if (url.includes('lesson-plans')) {
        const classroomId = url.includes(secondClassroom.id) ? secondClassroom.id : classroom.id
        return Promise.resolve({
          ok: true,
          json: async () => ({ lesson_plans: [lessonPlan({ classroom_id: classroomId })] }),
        })
      }
      if (url.includes('assignments')) return Promise.resolve({ ok: true, json: async () => ({ assignments: [] }) })
      if (url.includes('announcements')) return Promise.resolve({ ok: true, json: async () => ({ announcements: [] }) })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    sidebarState.isOpen = true
    const renderTab = (activeClassroom = classroom) => (
      <TeacherLessonCalendarTab
        classroom={activeClassroom}
        onSidebarStateChange={(state) => { latestSidebarState = state }}
      />
    )
    const view = render(renderTab(), { wrapper: Wrapper })
    await waitFor(() => expect(latestSidebarState?.markdownContent).toContain('Original lesson'))

    const identicalDraft = '## 2025-01-06\nIdentical draft'
    act(() => latestSidebarState?.onMarkdownChange(identicalDraft))
    let earlierSave!: Promise<void>
    act(() => { earlierSave = latestSidebarState!.onSave() })
    await waitFor(() => expect(bulkSaveCount).toBe(1))

    view.rerender(renderTab(secondClassroom))
    await waitFor(() => expect(latestSidebarState?.markdownContent).not.toBe(''))
    view.rerender(renderTab())
    await waitFor(() => expect(latestSidebarState?.markdownContent).toBe(identicalDraft))

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Edit lesson' }))
    await act(async () => {
      vi.advanceTimersByTime(10_000)
      await Promise.resolve()
      await Promise.resolve()
    })
    let laterSave!: Promise<void>
    act(() => { laterSave = latestSidebarState!.onSave() })

    firstBulkSave.resolve({ ok: true, json: async () => ({ lesson_plans: [] }) })
    await act(async () => {
      await earlierSave
      await laterSave
    })

    expect(latestSidebarState?.markdownContent).toBe(identicalDraft)
    expect(latestSidebarState?.markdownError).toBe('Later identical save failed')
    expect(sidebarState.setOpen).not.toHaveBeenCalledWith(false)
    vi.useRealTimers()
  })

  it('ignores late autosave responses after the classroom changes', async () => {
    const secondClassroom = createMockClassroom({
      id: 'classroom-2',
      start_date: '2025-01-01',
      end_date: '2025-06-30',
    })
    const firstAutosaveRequest = deferred<any>()

    invalidateTeacherLessonPlansForClassroom(secondClassroom.id)
    invalidateCachedJSON(`teacher-assignments:${secondClassroom.id}`)
    invalidateCachedJSON(`teacher-announcements:${secondClassroom.id}`)

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes(`/api/teacher/classrooms/${classroom.id}/lesson-plans/2025-01-06`) && init?.method === 'PUT') {
        return firstAutosaveRequest.promise
      }
      if (url.includes(`/api/teacher/classrooms/${classroom.id}/lesson-plans`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            lesson_plans: [lessonPlan({ id: 'lesson-1', classroom_id: classroom.id })],
          }),
        })
      }
      if (url.includes(`/api/teacher/classrooms/${secondClassroom.id}/lesson-plans`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            lesson_plans: [lessonPlan({ id: 'lesson-2', classroom_id: secondClassroom.id })],
          }),
        })
      }
      if (url.includes(`classroom_id=${classroom.id}`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ assignments: [{ id: 'assignment-1', classroom_id: classroom.id }] }),
        })
      }
      if (url.includes(`classroom_id=${secondClassroom.id}`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ assignments: [{ id: 'assignment-2', classroom_id: secondClassroom.id }] }),
        })
      }
      if (url.includes(`/api/teacher/classrooms/${classroom.id}/announcements`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ announcements: [{ id: 'announcement-1', classroom_id: classroom.id }] }),
        })
      }
      if (url.includes(`/api/teacher/classrooms/${secondClassroom.id}/announcements`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ announcements: [{ id: 'announcement-2', classroom_id: secondClassroom.id }] }),
        })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    const view = render(<TeacherLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-classrooms', classroom.id)
    })

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Edit lesson' }))

    await act(async () => {
      vi.advanceTimersByTime(10_000)
      await Promise.resolve()
      await Promise.resolve()
    })
    vi.useRealTimers()

    expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url).includes(`/api/teacher/classrooms/${classroom.id}/lesson-plans/2025-01-06`) &&
      init?.method === 'PUT'
    )).toBe(true)

    view.rerender(<TeacherLessonCalendarTab classroom={secondClassroom} />)

    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-classrooms', secondClassroom.id)
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-assignment-classrooms', secondClassroom.id)
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-announcement-classrooms', secondClassroom.id)
    })

    firstAutosaveRequest.resolve({
      ok: true,
      json: async () => ({
        lesson_plan: lessonPlan({
          id: 'lesson-1',
          classroom_id: classroom.id,
          content_markdown: 'Late saved lesson',
        }),
      }),
    })

    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-classrooms', secondClassroom.id)
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-assignment-classrooms', secondClassroom.id)
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-announcement-classrooms', secondClassroom.id)
    })
  })

  it('ignores an autosave from an earlier visit after returning to the classroom', async () => {
    const secondClassroom = createMockClassroom({
      id: 'classroom-2',
      start_date: '2025-01-01',
      end_date: '2025-06-30',
    })
    const firstVisitAutosave = deferred<any>()
    let classroomAAutosaves = 0

    invalidateTeacherLessonPlansForClassroom(secondClassroom.id)
    invalidateCachedJSON(`teacher-assignments:${secondClassroom.id}`)
    invalidateCachedJSON(`teacher-announcements:${secondClassroom.id}`)

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes(`/api/teacher/classrooms/${classroom.id}/lesson-plans/2025-01-06`) && init?.method === 'PUT') {
        classroomAAutosaves += 1
        if (classroomAAutosaves === 1) return firstVisitAutosave.promise
        return Promise.resolve({
          ok: true,
          json: async () => ({ lesson_plan: lessonPlan({ content_markdown: 'Updated lesson' }) }),
        })
      }
      if (url.includes('lesson-plans')) {
        const classroomId = url.includes(secondClassroom.id) ? secondClassroom.id : classroom.id
        return Promise.resolve({
          ok: true,
          json: async () => ({ lesson_plans: [lessonPlan({ classroom_id: classroomId })] }),
        })
      }
      if (url.includes('assignments')) return Promise.resolve({ ok: true, json: async () => ({ assignments: [] }) })
      if (url.includes('announcements')) return Promise.resolve({ ok: true, json: async () => ({ announcements: [] }) })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    const view = render(<TeacherLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })
    await waitFor(() => expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-classrooms', classroom.id))

    fireEvent.click(screen.getByRole('button', { name: 'Edit lesson' }))
    view.rerender(<TeacherLessonCalendarTab classroom={secondClassroom} />)
    await waitFor(() => expect(classroomAAutosaves).toBe(1))
    await waitFor(() => expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-classrooms', secondClassroom.id))

    view.rerender(<TeacherLessonCalendarTab classroom={classroom} />)
    await waitFor(() => expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-classrooms', classroom.id))
    fireEvent.click(screen.getByRole('button', { name: 'Edit lesson' }))
    expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-content', 'Updated lesson')

    firstVisitAutosave.resolve({
      ok: true,
      json: async () => ({ lesson_plan: lessonPlan({ content_markdown: 'Late saved lesson' }) }),
    })
    await act(async () => firstVisitAutosave.promise)

    expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-content', 'Updated lesson')
  })

  it('serializes repeated inline saves so the newest value commits last', async () => {
    const firstSave = deferred<any>()
    const saveBodies: string[] = []

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/lesson-plans/2025-01-06') && init?.method === 'PUT') {
        saveBodies.push(String(init.body))
        if (saveBodies.length === 1) return firstSave.promise
        return Promise.resolve({
          ok: true,
          json: async () => ({ lesson_plan: lessonPlan({ content_markdown: 'Newest lesson' }) }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => {
          if (url.includes('lesson-plans')) return { lesson_plans: [lessonPlan()] }
          if (url.includes('assignments')) return { assignments: [] }
          if (url.includes('announcements')) return { announcements: [] }
          return {}
        },
      })
    })

    render(<TeacherLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })
    await screen.findByTestId('lesson-calendar')

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Edit lesson' }))
    await act(async () => {
      vi.advanceTimersByTime(10_000)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(JSON.parse(saveBodies[0])).toMatchObject({
      content_markdown: 'Updated lesson',
      mutation: { sequence: 1 },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit lesson again' }))
    await act(async () => {
      vi.advanceTimersByTime(10_000)
      await Promise.resolve()
    })
    expect(saveBodies).toHaveLength(1)

    firstSave.resolve({
      ok: true,
      json: async () => ({ lesson_plan: lessonPlan({ content_markdown: 'Updated lesson' }) }),
    })
    await act(async () => {
      await firstSave.promise
      await Promise.resolve()
      await vi.runAllTimersAsync()
    })

    expect(saveBodies.map((body) => JSON.parse(body))).toEqual([
      expect.objectContaining({ content_markdown: 'Updated lesson', mutation: expect.objectContaining({ sequence: 1 }) }),
      expect.objectContaining({ content_markdown: 'Newest lesson', mutation: expect.objectContaining({ sequence: 2 }) }),
    ])
    vi.useRealTimers()
  })

  it('sends a newer pending edit directly on unload while an older save is in flight', async () => {
    const firstSave = deferred<any>()
    const secondSave = deferred<any>()
    const saveBodies: Array<{ content_markdown: string; mutation: { client_id: string; sequence: number } }> = []

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/lesson-plans/2025-01-06') && init?.method === 'PUT') {
        saveBodies.push(JSON.parse(String(init.body)))
        return saveBodies.length === 1 ? firstSave.promise : secondSave.promise
      }
      return Promise.resolve({
        ok: true,
        json: async () => {
          if (url.includes('lesson-plans')) return { lesson_plans: [lessonPlan()] }
          if (url.includes('assignments')) return { assignments: [] }
          if (url.includes('announcements')) return { announcements: [] }
          return {}
        },
      })
    })

    render(<TeacherLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })
    await screen.findByTestId('lesson-calendar')

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Edit lesson' }))
    await act(async () => {
      vi.advanceTimersByTime(10_000)
      await Promise.resolve()
      await Promise.resolve()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Edit lesson again' }))

    await act(async () => {
      window.dispatchEvent(new Event('beforeunload'))
      await Promise.resolve()
    })

    expect(saveBodies).toHaveLength(3)
    expect(saveBodies[0]).toMatchObject({ content_markdown: 'Updated lesson', mutation: { sequence: 1 } })
    expect(saveBodies[1]).toMatchObject({ content_markdown: 'Updated lesson', mutation: { sequence: 1 } })
    expect(saveBodies[2]).toMatchObject({ content_markdown: 'Newest lesson', mutation: { sequence: 2 } })
    expect(saveBodies[2].mutation.client_id).toBe(saveBodies[0].mutation.client_id)

    secondSave.resolve({
      ok: true,
      json: async () => ({ applied: true, lesson_plan: lessonPlan({ content_markdown: 'Newest lesson' }) }),
    })
    firstSave.resolve({
      ok: true,
      json: async () => ({ applied: false, lesson_plan: lessonPlan({ content_markdown: 'Newest lesson' }) }),
    })
    await act(async () => {
      await Promise.all([firstSave.promise, secondSave.promise])
    })

    expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-content', 'Newest lesson')
    vi.useRealTimers()
  })

  it('sends a queue-blocked second date directly during unload', async () => {
    const firstSave = deferred<any>()
    const saves: Array<{ date: string; content: string }> = []

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const dateMatch = url.match(/lesson-plans\/(2025-01-\d{2})$/)
      if (dateMatch && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body))
        saves.push({ date: dateMatch[1], content: body.content_markdown })
        if (saves.length === 1) return firstSave.promise
        return Promise.resolve({
          ok: true,
          json: async () => ({ applied: true, lesson_plan: lessonPlan({ date: dateMatch[1] }) }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => {
          if (url.includes('lesson-plans')) return { lesson_plans: [lessonPlan()] }
          if (url.includes('assignments')) return { assignments: [] }
          if (url.includes('announcements')) return { announcements: [] }
          return {}
        },
      })
    })

    render(<TeacherLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })
    await screen.findByTestId('lesson-calendar')

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Edit lesson' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit second date' }))
    await act(async () => {
      vi.advanceTimersByTime(10_000)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(saves).toEqual([{ date: '2025-01-06', content: 'Updated lesson' }])
    await act(async () => {
      window.dispatchEvent(new Event('beforeunload'))
      await Promise.resolve()
    })
    expect(saves).toContainEqual({ date: '2025-01-07', content: 'Second date lesson' })

    firstSave.resolve({
      ok: true,
      json: async () => ({ applied: true, lesson_plan: lessonPlan({ content_markdown: 'Updated lesson' }) }),
    })
    await act(async () => {
      await firstSave.promise
      await Promise.resolve()
      await Promise.resolve()
    })
    vi.useRealTimers()
  })

  it('starts a queued bulk save with keepalive during unload', async () => {
    const inlineSave = deferred<any>()
    let latestSidebarState: CalendarSidebarState | null = null
    const bulkBodies: Array<{ mutation: { sequence: number }; plans: unknown[] }> = []

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/lesson-plans/2025-01-06') && init?.method === 'PUT') return inlineSave.promise
      if (url.includes('/lesson-plans/bulk') && init?.method === 'PUT') {
        bulkBodies.push(JSON.parse(String(init.body)))
        return Promise.resolve({ ok: true, json: async () => ({ lesson_plans: [] }) })
      }
      return Promise.resolve({
        ok: true,
        json: async () => {
          if (url.includes('lesson-plans')) return { lesson_plans: [lessonPlan()] }
          if (url.includes('assignments')) return { assignments: [] }
          if (url.includes('announcements')) return { announcements: [] }
          return {}
        },
      })
    })

    sidebarState.isOpen = true
    render(
      <TeacherLessonCalendarTab
        classroom={classroom}
        onSidebarStateChange={(state) => { latestSidebarState = state }}
      />,
      { wrapper: Wrapper },
    )
    await waitFor(() => expect(latestSidebarState?.markdownContent).toContain('Original lesson'))

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Edit lesson' }))
    await act(async () => {
      vi.advanceTimersByTime(10_000)
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => latestSidebarState?.onMarkdownChange('## 2025-01-06\nBulk lesson'))
    let bulkSave!: Promise<void>
    act(() => { bulkSave = latestSidebarState!.onSave() })

    await act(async () => {
      window.dispatchEvent(new Event('beforeunload'))
      await Promise.resolve()
    })
    expect(bulkBodies).toHaveLength(1)
    expect(bulkBodies[0]).toMatchObject({ mutation: { sequence: 2 } })

    inlineSave.resolve({
      ok: true,
      json: async () => ({ lesson_plan: lessonPlan({ content_markdown: 'Updated lesson' }) }),
    })
    await act(async () => bulkSave)
    expect(bulkBodies).toHaveLength(2)
    expect(bulkBodies[1].mutation).toEqual(bulkBodies[0].mutation)
    vi.useRealTimers()
  })

  it('retains a failed inline save and retries it', async () => {
    let saves = 0
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/lesson-plans/2025-01-06') && init?.method === 'PUT') {
        saves += 1
        if (saves === 1) {
          return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'Failed' }) })
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ lesson_plan: lessonPlan({ content_markdown: 'Updated lesson' }) }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => {
          if (url.includes('lesson-plans')) return { lesson_plans: [lessonPlan()] }
          if (url.includes('assignments')) return { assignments: [] }
          if (url.includes('announcements')) return { announcements: [] }
          return {}
        },
      })
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<TeacherLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })
    await screen.findByTestId('lesson-calendar')

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Edit lesson' }))
    await act(async () => {
      vi.advanceTimersByTime(10_000)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(saves).toBe(1)

    await act(async () => {
      vi.advanceTimersByTime(10_000)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(saves).toBe(2)
    vi.useRealTimers()
  })

  it('shows an explicit retry after automatic inline retries are exhausted', async () => {
    let saves = 0
    const saveBodies: Array<{ content_markdown: string }> = []
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/lesson-plans/2025-01-06') && init?.method === 'PUT') {
        saves += 1
        saveBodies.push(JSON.parse(String(init.body)))
        if (saves <= 4) {
          return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'Failed' }) })
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ lesson_plan: lessonPlan({ content_markdown: 'Updated lesson' }) }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => {
          if (url.includes('lesson-plans')) return { lesson_plans: [lessonPlan()] }
          if (url.includes('assignments')) return { assignments: [] }
          if (url.includes('announcements')) return { announcements: [] }
          return {}
        },
      })
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<TeacherLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })
    await screen.findByTestId('lesson-calendar')

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Edit lesson' }))
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(saves).toBe(4)
    expect(screen.getByRole('alert')).toHaveTextContent('Some lesson plan changes could not be saved.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry lesson plan changes' }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(saves).toBe(5)
    expect(saveBodies.at(-1)).toMatchObject({ content_markdown: 'Updated lesson' })
    expect(screen.queryByRole('button', { name: 'Retry lesson plan changes' })).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('uses an explicit keepalive PUT for pending changes during unload', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/lesson-plans/2025-01-06') && init?.method === 'PUT') {
        return {
          ok: true,
          json: async () => ({ lesson_plan: lessonPlan({ content_markdown: 'Updated lesson' }) }),
        }
      }
      return {
        ok: true,
        json: async () => {
          if (url.includes('lesson-plans')) return { lesson_plans: [lessonPlan()] }
          if (url.includes('assignments')) return { assignments: [] }
          if (url.includes('announcements')) return { announcements: [] }
          return {}
        },
      }
    })

    render(<TeacherLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })
    await screen.findByTestId('lesson-calendar')
    fireEvent.click(screen.getByRole('button', { name: 'Edit lesson' }))

    await act(async () => {
      window.dispatchEvent(new Event('beforeunload'))
      await Promise.resolve()
      await Promise.resolve()
    })

    const unloadCall = fetchMock.mock.calls.find(([url, init]) => (
      String(url).endsWith('/lesson-plans/2025-01-06') && init?.keepalive === true
    ))
    expect(unloadCall?.[1]).toEqual(expect.objectContaining({
      keepalive: true,
      method: 'PUT',
    }))
    expect(JSON.parse(String(unloadCall?.[1]?.body))).toMatchObject({
      content_markdown: 'Updated lesson',
      mutation: { sequence: 1 },
    })
  })

  it('invalidates cached teacher lesson plans after an autosaved edit', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/lesson-plans/2025-01-06') && init?.method === 'PUT') {
        return {
          ok: true,
          json: async () => ({
            lesson_plan: lessonPlan({
              content_markdown: 'Updated lesson',
              updated_at: '2025-01-02T00:00:00Z',
            }),
          }),
        }
      }

      return {
        ok: true,
        json: async () => {
          if (url.includes('lesson-plans')) return { lesson_plans: [lessonPlan()] }
          if (url.includes('assignments')) return { assignments: [] }
          if (url.includes('announcements')) return { announcements: [] }
          return {}
        },
      }
    })

    const first = render(<TeacherLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-count', '1')
    })

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Edit lesson' }))

    await act(async () => {
      vi.advanceTimersByTime(10_000)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/lesson-plans/2025-01-06') && init?.method === 'PUT')).toBe(true)
    vi.useRealTimers()

    first.unmount()
    render(<TeacherLessonCalendarTab classroom={classroom} />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(screen.getByTestId('lesson-calendar')).toHaveAttribute('data-lesson-count', '1')
    })

    const urls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(urls.filter((url) => url.includes('/lesson-plans?'))).toHaveLength(2)
  })

  it('refreshes markdown content after an inline autosave invalidates the lesson cache', async () => {
    let lessonPlanReads = 0
    let latestSidebarState: CalendarSidebarState | null = null
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/lesson-plans/2025-01-06') && init?.method === 'PUT') {
        return {
          ok: true,
          json: async () => ({
            lesson_plan: lessonPlan({
              content_markdown: 'Updated lesson',
              updated_at: '2025-01-02T00:00:00Z',
            }),
          }),
        }
      }

      return {
        ok: true,
        json: async () => {
          if (url.includes('lesson-plans')) {
            lessonPlanReads += 1
            return {
              lesson_plans: [
                lessonPlan({
                  content_markdown: lessonPlanReads === 1 ? 'Original lesson' : 'Updated lesson',
                }),
              ],
            }
          }
          if (url.includes('assignments')) return { assignments: [] }
          if (url.includes('announcements')) return { announcements: [] }
          return {}
        },
      }
    })

    sidebarState.isOpen = true
    const view = render(
      <TeacherLessonCalendarTab
        classroom={classroom}
        onSidebarStateChange={(state) => {
          latestSidebarState = state
        }}
      />,
      { wrapper: Wrapper },
    )

    await waitFor(() => {
      expect(latestSidebarState?.markdownContent).toContain('Original lesson')
    })

    sidebarState.isOpen = false
    view.rerender(
      <TeacherLessonCalendarTab
        classroom={classroom}
        onSidebarStateChange={(state) => {
          latestSidebarState = state
        }}
      />,
    )

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Edit lesson' }))

    await act(async () => {
      vi.advanceTimersByTime(10_000)
      await Promise.resolve()
      await Promise.resolve()
    })
    vi.useRealTimers()

    sidebarState.isOpen = true
    view.rerender(
      <TeacherLessonCalendarTab
        classroom={classroom}
        onSidebarStateChange={(state) => {
          latestSidebarState = state
        }}
      />,
    )

    await waitFor(() => {
      expect(latestSidebarState?.markdownContent).toContain('Updated lesson')
    })

    const urls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(urls.filter((url) => url.includes('/lesson-plans?'))).toHaveLength(2)
  })

  it('surfaces malformed lesson-plan JSON as a markdown load error', async () => {
    let latestSidebarState: CalendarSidebarState | null = null
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => {
        if (url.includes('lesson-plans')) {
          throw new Error('bad json')
        }
        if (url.includes('assignments')) return { assignments: [] }
        if (url.includes('announcements')) return { announcements: [] }
        return {}
      },
    }))

    sidebarState.isOpen = true
    render(
      <TeacherLessonCalendarTab
        classroom={classroom}
        onSidebarStateChange={(state) => {
          latestSidebarState = state
        }}
      />,
      { wrapper: Wrapper },
    )

    await waitFor(() => {
      expect(latestSidebarState?.markdownError).toBe('Failed to parse lesson plans response')
    })
    expect(latestSidebarState?.markdownContent).toBe('')
  })
})
