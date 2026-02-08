import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { StudentTodayTab } from '@/app/classrooms/[classroomId]/StudentTodayTab'
import { getStudentEntryHistoryCacheKey } from '@/lib/student-entry-history'
import type { Classroom, Entry } from '@/types'

vi.mock('@/lib/timezone', () => ({
  getTodayInToronto: () => '2025-12-16',
}))

vi.mock('@/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui')>()
  return {
    ...actual,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }
})

vi.mock('@/hooks/useClassDays', () => ({
  useClassDaysContext: () => ({
    classDays: [
      { id: 'd1', classroom_id: 'c1', date: '2025-12-16', prompt_text: null, is_class_day: true },
    ],
    isLoading: false,
    refresh: vi.fn(),
  }),
}))

const classroom: Classroom = {
  id: 'c1',
  teacher_id: 't1',
  title: 'Test Class',
  class_code: 'ABC123',
  term_label: null,
  allow_enrollment: true,
  start_date: null,
  end_date: null,
  lesson_plan_visibility: 'hidden',
  archived_at: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
}

const entries: Entry[] = [
  {
    id: 'e1',
    student_id: 's1',
    classroom_id: 'c1',
    date: '2025-12-16',
    text: 'Worked on my assignment and reviewed notes.',
    rich_content: null,
    version: 1,
    minutes_reported: null,
    mood: null,
    created_at: '2025-12-16T01:00:00Z',
    updated_at: '2025-12-16T01:00:00Z',
    on_time: true,
  },
  {
    id: 'e2',
    student_id: 's1',
    classroom_id: 'c1',
    date: '2025-12-15',
    text: 'Had trouble focusing but completed the reading.',
    rich_content: null,
    version: 1,
    minutes_reported: null,
    mood: null,
    created_at: '2025-12-15T01:00:00Z',
    updated_at: '2025-12-15T01:00:00Z',
    on_time: false,
  },
]

function mockJson(data: any, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(data) }) as any
}

describe('StudentTodayTab history section', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    document.cookie = 'pika_student_today_history=; Max-Age=0; Path=/'
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('toggles history without refetching', async () => {
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}&limit=5`)) {
        return mockJson({ entries })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lessonPlans: [] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)

    await screen.findAllByText('Tue Dec 16')
    await screen.findByRole('button', { name: /history/i })

    expect(screen.getByText('Mon Dec 15')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /hide/i }))
    expect(screen.queryByText('Mon Dec 15')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /show/i }))
    expect(screen.getByText('Mon Dec 15')).toBeInTheDocument()

    const entryFetchCalls = fetchMock.mock.calls.filter(([arg]) =>
      String(arg).includes('/api/student/entries?')
    )
    expect(entryFetchCalls).toHaveLength(1)
  })

  it('persists toggle state via cookie', async () => {
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}&limit=5`)) {
        return mockJson({ entries })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lessonPlans: [] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { unmount } = render(<StudentTodayTab classroom={classroom} />)
    await screen.findByRole('button', { name: /history/i })

    fireEvent.click(screen.getByRole('button', { name: /hide/i }))
    expect(document.cookie).toMatch(/pika_student_today_history=0/)

    unmount()

    render(<StudentTodayTab classroom={classroom} />)
    await screen.findByRole('button', { name: /history/i })

    expect(screen.getByRole('button', { name: /show/i })).toBeInTheDocument()
    expect(screen.queryByText('Mon Dec 15')).not.toBeInTheDocument()
  })

  it('uses sessionStorage cache for entries', async () => {
    const cacheKey = getStudentEntryHistoryCacheKey({ classroomId: classroom.id, limit: 5 })
    window.sessionStorage.setItem(cacheKey, JSON.stringify(entries))

    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?`)) {
        return mockJson({ entries })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lessonPlans: [] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)
    await screen.findByRole('button', { name: /history/i })
    expect(screen.getByText('Mon Dec 15')).toBeInTheDocument()

    await waitFor(() => {
      const entryFetchCalls = fetchMock.mock.calls.filter(([arg]) =>
        String(arg).includes('/api/student/entries?')
      )
      expect(entryFetchCalls).toHaveLength(0)
    })
  })
})
