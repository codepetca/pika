import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { StudentTodayTab } from '@/app/classrooms/[classroomId]/StudentTodayTab'
import { getStudentEntryHistoryCacheKey } from '@/lib/student-entry-history'
import type { Classroom, Entry } from '@/types'

const getTodayInTorontoMock = vi.hoisted(() => vi.fn(() => '2025-12-16'))

vi.mock('@/lib/timezone', () => ({
  getTodayInToronto: getTodayInTorontoMock,
}))

vi.mock('@/components/editor', async () => {
  const React = await import('react')

  function toContent(text: string) {
    if (!text) return { type: 'doc', content: [] }
    return {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text }],
        },
      ],
    }
  }

  function toText(content: any): string {
    return content?.content?.[0]?.content?.[0]?.text ?? ''
  }

  return {
    RichTextEditor: ({ content, onBlur, onChange, placeholder }: any) =>
      React.createElement('textarea', {
        'aria-label': placeholder,
        onBlur,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
          onChange(toContent(event.currentTarget.value)),
        value: toText(content),
      }),
  }
})

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
      { id: 'd2', classroom_id: 'c1', date: '2025-05-06', prompt_text: null, is_class_day: true },
      { id: 'd3', classroom_id: 'c1', date: '2025-05-11', prompt_text: null, is_class_day: true },
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
    vi.restoreAllMocks()
    getTodayInTorontoMock.mockReturnValue('2025-12-16')
    window.sessionStorage.clear()
    document.cookie = 'pika_student_today_history=; Max-Age=0; Path=/'
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

  it('saves against the current Toronto date when the mounted date is stale', async () => {
    getTodayInTorontoMock.mockReturnValue('2025-05-06')

    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}&limit=5`)) {
        return mockJson({ entries: [] })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lesson_plans: [] })
      }
      if (url === '/api/student/entries' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        return mockJson({
          entry: {
            id: 'entry-today',
            student_id: 's1',
            classroom_id: classroom.id,
            date: body.date,
            text: 'Worked today',
            rich_content: body.rich_content,
            version: 1,
            minutes_reported: null,
            mood: null,
            created_at: '2025-05-11T14:00:00Z',
            updated_at: '2025-05-11T14:00:00Z',
            on_time: true,
          },
        })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)

    const editor = await screen.findByLabelText('Write something...')
    getTodayInTorontoMock.mockReturnValue('2025-05-11')

    fireEvent.change(editor, { target: { value: 'Worked today' } })
    fireEvent.blur(editor)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/student/entries',
        expect.objectContaining({ method: 'PATCH' })
      )
    })

    const saveCall = fetchMock.mock.calls.find(([input, init]) =>
      String(input) === '/api/student/entries' && init?.method === 'PATCH'
    )
    expect(saveCall).toBeDefined()
    expect(JSON.parse(String(saveCall?.[1]?.body)).date).toBe('2025-05-11')
  })
})
