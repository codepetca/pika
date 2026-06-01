import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { StudentTodayTab } from '@/app/classrooms/[classroomId]/StudentTodayTab'
import { getStudentEntryHistoryCacheKey } from '@/lib/student-entry-history'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'
import type { Classroom, Entry } from '@/types'

const getTodayInTorontoMock = vi.hoisted(() => vi.fn(() => '2025-12-16'))
const invalidateStudentEntriesForClassroomMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/timezone', () => ({
  getTodayInToronto: getTodayInTorontoMock,
}))

vi.mock('@/lib/student-entries-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/student-entries-client')>()
  return {
    ...actual,
    invalidateStudentEntriesForClassroom: (classroomId: string) => {
      invalidateStudentEntriesForClassroomMock(classroomId)
      return actual.invalidateStudentEntriesForClassroom(classroomId)
    },
  }
})

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
    text: 'Had trouble focusing but completed the reading. I wrote a longer reflection about the confusing parts, the examples I reviewed, and the questions I want to ask next class so that the entry needs more than a single short preview line.',
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

describe('StudentTodayTab history section', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    invalidateStudentEntriesForClassroomMock.mockClear()
    invalidateCachedJSONMatching('student-entries:')
    invalidateCachedJSONMatching('student-lesson-plans:')
    getTodayInTorontoMock.mockReturnValue('2025-12-16')
    window.sessionStorage.clear()
    document.cookie = 'pika_student_today_history=; Max-Age=0; Path=/'
  })

  afterEach(() => {
    cleanup()
  })

  it('shows past logs by default and expands each entry without refetching', async () => {
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}&limit=12`)) {
        return mockJson({ entries })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lessonPlans: [] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)

    await screen.findByText('Past logs')

    expect(screen.queryByText('Tue Dec 16')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /hide history/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /show history/i })).not.toBeInTheDocument()

    const logButton = screen.getByRole('button', { name: 'Expand log from Mon Dec 15' })
    const logText = screen.getByText(entries[1].text)

    expect(logButton).toHaveAttribute('aria-expanded', 'false')
    expect(logText).toHaveClass('line-clamp-2')

    fireEvent.click(logButton)
    expect(screen.getByRole('button', { name: 'Collapse log from Mon Dec 15' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(logText).not.toHaveClass('line-clamp-2')

    fireEvent.click(screen.getByRole('button', { name: 'Collapse log from Mon Dec 15' }))
    expect(screen.getByRole('button', { name: 'Expand log from Mon Dec 15' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(logText).toHaveClass('line-clamp-2')

    const entryFetchCalls = fetchMock.mock.calls.filter(([arg]) =>
      String(arg).includes('/api/student/entries?')
    )
    expect(entryFetchCalls).toHaveLength(1)
  })

  it('shows an empty past-log state when only today has an entry', async () => {
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}&limit=12`)) {
        return mockJson({ entries: [entries[0]] })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lessonPlans: [] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)

    expect(await screen.findByText('No past logs yet')).toBeInTheDocument()
    expect(screen.queryByText('Tue Dec 16')).not.toBeInTheDocument()
  })

  it('keeps an empty new entry marked saved', async () => {
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}&limit=12`)) {
        return mockJson({ entries: [] })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lesson_plans: [] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)

    const editor = await screen.findByLabelText('Write something...')
    expect(screen.getByText('Saved')).toBeInTheDocument()

    fireEvent.change(editor, { target: { value: '' } })

    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/student/entries',
      expect.objectContaining({ method: 'PATCH' })
    )
  })

  it('renders cached entries immediately and refreshes them in the background', async () => {
    const cacheKey = getStudentEntryHistoryCacheKey({ classroomId: classroom.id, limit: 12 })
    window.sessionStorage.setItem(cacheKey, JSON.stringify(entries))
    const refreshedEntries = [
      entries[0],
      {
        ...entries[1],
        id: 'e2-refreshed',
        text: 'Refreshed log from the server.',
      },
    ] as Entry[]
    const entriesRequest = deferred<any>()

    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?`)) {
        return entriesRequest.promise
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lesson_plans: [] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)
    await screen.findByText('Past logs')
    expect(screen.getByText('Mon Dec 15')).toBeInTheDocument()
    expect(screen.getByText(entries[1].text)).toBeInTheDocument()

    const entryFetchCalls = fetchMock.mock.calls.filter(([arg]) =>
      String(arg).includes('/api/student/entries?')
    )
    expect(entryFetchCalls).toHaveLength(1)

    entriesRequest.resolve(await mockJson({ entries: refreshedEntries }))

    expect(await screen.findByText('Refreshed log from the server.')).toBeInTheDocument()
    expect(window.sessionStorage.getItem(cacheKey)).toContain('Refreshed log from the server.')
  })

  it('does not overwrite local edits when the background refresh completes', async () => {
    const cacheKey = getStudentEntryHistoryCacheKey({ classroomId: classroom.id, limit: 12 })
    const cachedEntries = [
      {
        ...entries[0],
        text: 'Cached today entry.',
      },
      entries[1],
    ] as Entry[]
    const refreshedEntries = [
      {
        ...entries[0],
        text: 'Server refreshed today entry.',
        version: 2,
      },
      {
        ...entries[1],
        text: 'Server refreshed past entry.',
      },
    ] as Entry[]
    window.sessionStorage.setItem(cacheKey, JSON.stringify(cachedEntries))
    const entriesRequest = deferred<any>()

    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?`)) {
        return entriesRequest.promise
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lesson_plans: [] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)

    const editor = await screen.findByLabelText('Write something...')
    expect(editor).toHaveValue('Cached today entry.')

    fireEvent.change(editor, { target: { value: 'Local unsaved draft.' } })
    entriesRequest.resolve(await mockJson({ entries: refreshedEntries }))

    await waitFor(() => {
      expect(window.sessionStorage.getItem(cacheKey)).toContain('Server refreshed past entry.')
    })
    expect(window.sessionStorage.getItem(cacheKey)).toContain('Cached today entry.')
    expect(window.sessionStorage.getItem(cacheKey)).not.toContain('Server refreshed today entry.')
    expect(editor).toHaveValue('Local unsaved draft.')
  })

  it('applies refreshed today content after a local edit is reverted', async () => {
    const cacheKey = getStudentEntryHistoryCacheKey({ classroomId: classroom.id, limit: 12 })
    const cachedEntries = [
      {
        ...entries[0],
        text: 'Cached today entry.',
      },
      entries[1],
    ] as Entry[]
    const refreshedEntries = [
      {
        ...entries[0],
        text: 'Server refreshed today entry.',
        version: 2,
      },
      entries[1],
    ] as Entry[]
    window.sessionStorage.setItem(cacheKey, JSON.stringify(cachedEntries))
    const entriesRequest = deferred<any>()

    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?`)) {
        return entriesRequest.promise
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lesson_plans: [] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)

    const editor = await screen.findByLabelText('Write something...')
    expect(editor).toHaveValue('Cached today entry.')

    fireEvent.change(editor, { target: { value: 'Temporary local draft.' } })
    fireEvent.change(editor, { target: { value: 'Cached today entry.' } })
    entriesRequest.resolve(await mockJson({ entries: refreshedEntries }))

    await waitFor(() => {
      expect(editor).toHaveValue('Server refreshed today entry.')
    })
    expect(window.sessionStorage.getItem(cacheKey)).toContain('Server refreshed today entry.')
  })

  it('saves against the current Toronto date when the mounted date is stale', async () => {
    getTodayInTorontoMock.mockReturnValue('2025-05-06')

    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}&limit=12`)) {
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
    expect(invalidateStudentEntriesForClassroomMock).toHaveBeenCalledWith(classroom.id)
  })

  it('invalidates entry caches and clears session history on partial save conflict', async () => {
    const cacheKey = getStudentEntryHistoryCacheKey({ classroomId: classroom.id, limit: 12 })
    getTodayInTorontoMock.mockReturnValue('2025-12-16')
    const serverEntry = {
      id: entries[0].id,
      text: 'Server conflict version.',
      rich_content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Server conflict version.' }] }],
      },
      version: 2,
    }

    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}&limit=12`)) {
        return mockJson({ entries: [] })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lesson_plans: [] })
      }
      if (url === '/api/student/entries' && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: () => Promise.resolve({ error: 'Entry updated elsewhere', entry: serverEntry }),
        }) as any
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)

    const editor = await screen.findByLabelText('Write something...')
    fireEvent.change(editor, { target: { value: 'Local draft.' } })
    fireEvent.blur(editor)

    await waitFor(() => {
      expect(screen.getByText('Entry updated elsewhere')).toBeInTheDocument()
    })

    expect(invalidateStudentEntriesForClassroomMock).toHaveBeenCalledWith(classroom.id)
    expect(window.sessionStorage.getItem(cacheKey)).toBeNull()
  })
})
