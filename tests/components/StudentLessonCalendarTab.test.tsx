import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { StudentLessonCalendarTab } from '@/app/classrooms/[classroomId]/StudentLessonCalendarTab'
import { createMockClassroom } from '../helpers/mocks'

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

vi.mock('@/components/LessonCalendar', () => ({
  LessonCalendar: () => <div data-testid="lesson-calendar" />,
  CalendarViewMode: {},
}))

describe('StudentLessonCalendarTab', () => {
  const classroom = createMockClassroom({
    start_date: '2025-01-01',
    end_date: '2025-06-30',
  })
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
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

    render(<StudentLessonCalendarTab classroom={classroom} />)

    // All 3 fetches should be initiated before any resolve
    await waitFor(() => {
      expect(callOrder).toHaveLength(3)
    })

    expect(callOrder.some((u) => u.includes('lesson-plans'))).toBe(true)
    expect(callOrder.some((u) => u.includes('assignments'))).toBe(true)
    expect(callOrder.some((u) => u.includes('announcements'))).toBe(true)

    // Resolve all
    resolveAll.forEach((r) => r())
  })

  it('fires exactly 3 fetch calls total (not 3 separate useEffects)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ lesson_plans: [], assignments: [], announcements: [] }),
    })

    render(<StudentLessonCalendarTab classroom={classroom} />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    // Wait a tick — no additional calls should fire
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
