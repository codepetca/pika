import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TeacherLessonCalendarTab } from '@/app/classrooms/[classroomId]/TeacherLessonCalendarTab'
import { createMockClassroom } from '../helpers/mocks'
import { TooltipProvider } from '@/ui'
import { invalidateTeacherLessonPlansForClassroom } from '@/lib/teacher-lesson-plans-client'
import { invalidateCachedJSON } from '@/lib/request-cache'
import type { CalendarSidebarState } from '@/app/classrooms/[classroomId]/TeacherLessonCalendarTab'
import type { LessonPlan } from '@/types'
import type { ReactNode } from 'react'

const sidebarState = vi.hoisted(() => ({
  isOpen: false,
  toggle: vi.fn(),
  setOpen: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/hooks/useClassDays', () => ({
  useClassDays: () => [],
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
      data-assignment-classrooms={assignments.map((assignment: any) => assignment.classroom_id).join(',')}
      data-announcement-classrooms={announcements.map((announcement: any) => announcement.classroom_id).join(',')}
    >
      <button type="button" onClick={() => onContentChange?.('2025-01-06', 'Updated lesson')}>
        Edit lesson
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
  return <TooltipProvider>{children}</TooltipProvider>
}

describe('TeacherLessonCalendarTab', () => {
  const classroom = createMockClassroom({
    id: 'classroom-1',
    start_date: '2025-01-01',
    end_date: '2025-06-30',
  })
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    invalidateTeacherLessonPlansForClassroom(classroom.id)
    invalidateCachedJSON(`teacher-assignments:${classroom.id}`)
    invalidateCachedJSON(`teacher-announcements:${classroom.id}`)
    sidebarState.isOpen = false
    sidebarState.toggle.mockReset()
    sidebarState.setOpen.mockReset()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    invalidateTeacherLessonPlansForClassroom(classroom.id)
    invalidateCachedJSON(`teacher-assignments:${classroom.id}`)
    invalidateCachedJSON(`teacher-announcements:${classroom.id}`)
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
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
