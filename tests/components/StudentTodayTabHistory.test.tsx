import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { StudentTodayTab as StudentTodayTabComponent } from '@/app/classrooms/[classroomId]/StudentTodayTab'
import type { ComponentProps } from 'react'

function StudentTodayTab(props: Omit<ComponentProps<typeof StudentTodayTabComponent>, 'studentId'>) {
  return <StudentTodayTabComponent {...props} studentId="s1" />
}
import { getStudentEntryHistoryCacheKey } from '@/lib/student-entry-history'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'
import type { Classroom, Entry } from '@/types'

const getTodayInTorontoMock = vi.hoisted(() => vi.fn(() => '2025-12-16'))
const invalidateStudentEntriesForClassroomMock = vi.hoisted(() => vi.fn())
const redirectToLoginForReauthMock = vi.hoisted(() => vi.fn())
const notifyImmediatePalDeliveryMock = vi.hoisted(() => vi.fn())
const classDaysContextMock = vi.hoisted(() => ({
  classDays: [
    { id: 'd1', classroom_id: 'c1', date: '2025-12-16', prompt_text: null, is_class_day: true },
    { id: 'd4', classroom_id: 'c1', date: '2025-12-15', prompt_text: null, is_class_day: true },
    { id: 'd2', classroom_id: 'c1', date: '2025-05-06', prompt_text: null, is_class_day: true },
    { id: 'd3', classroom_id: 'c1', date: '2025-05-11', prompt_text: null, is_class_day: true },
  ],
  error: null as string | null,
  hasLoadedSnapshot: true,
  isLoading: false,
  refresh: vi.fn(),
}))
const defaultClassDays = [...classDaysContextMock.classDays]

vi.mock('@/lib/timezone', () => ({
  getTodayInToronto: getTodayInTorontoMock,
}))

vi.mock('@/lib/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client-auth')>()
  return {
    ...actual,
    redirectToLoginForReauth: redirectToLoginForReauthMock,
  }
})

vi.mock('@/lib/pal-browser-events', () => ({
  notifyImmediatePalDelivery: notifyImmediatePalDeliveryMock,
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
    RichTextEditor: ({
      'aria-labelledby': ariaLabelledBy,
      className,
      content,
      onBlur,
      onChange,
      placeholder,
      toolbarPreset,
    }: any) =>
      React.createElement('textarea', {
        'aria-labelledby': ariaLabelledBy,
        className,
        'data-toolbar-preset': toolbarPreset,
        onBlur,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
          onChange(toContent(event.currentTarget.value)),
        placeholder,
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
  useClassDaysContext: () => classDaysContextMock,
}))

const classroom: Classroom = {
  id: 'c1',
  teacher_id: 't1',
  title: 'Test Class',
  class_code: 'ABC123',
  theme_color: 'blue',
  term_label: null,
  allow_enrollment: true,
  start_date: null,
  end_date: null,
  lesson_plan_visibility: 'hidden',
  archived_at: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
}

const secondClassroom: Classroom = {
  ...classroom,
  id: 'c2',
  title: 'Second Class',
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

function getDailyLogDraftKey(classroomId: string, date: string): string {
  return `daily-log-draft:${classroomId}:${date}`
}

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
    redirectToLoginForReauthMock.mockClear()
    notifyImmediatePalDeliveryMock.mockClear()
    invalidateCachedJSONMatching('student-entries:')
    invalidateCachedJSONMatching('student-lesson-plans:')
    getTodayInTorontoMock.mockReturnValue('2025-12-16')
    classDaysContextMock.classDays = defaultClassDays
    classDaysContextMock.error = null
    classDaysContextMock.hasLoadedSnapshot = true
    classDaysContextMock.isLoading = false
    classDaysContextMock.refresh.mockReset()
    window.sessionStorage.clear()
    window.localStorage.clear()
    document.cookie = 'pika_student_today_history=; Max-Age=0; Path=/'
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('shows past logs by default and expands each entry without refetching', async () => {
    const fetchMock = vi.fn((input: RequestInfo, _init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) {
        return mockJson({ entries })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lessonPlans: [] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <StudentTodayTab
        classroom={classroom}
        mobilePlan={<div data-testid="mobile-today-plan">Today and last class</div>}
      />
    )

    await screen.findByText('Past logs')

    const dailyPlanPrompt = screen.getByRole('heading', { name: 'Daily Log' })
    const mobilePlan = screen.getByTestId('mobile-today-plan')
    const pastLogsHeading = screen.getByText('Past logs')
    const editor = await screen.findByRole('textbox', { name: 'Daily Log' })

    expect(dailyPlanPrompt).toHaveClass('font-medium')
    expect(editor).toHaveAttribute('placeholder', 'What is your plan today?')
    expect(dailyPlanPrompt.compareDocumentPosition(mobilePlan)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(pastLogsHeading.compareDocumentPosition(mobilePlan)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(mobilePlan.parentElement).toHaveClass('lg:hidden')
    expect(editor.className).toContain('[&_.tiptap.ProseMirror]:!min-h-[100px]')
    expect(editor.className).toContain('lg:[&_.tiptap.ProseMirror]:!min-h-[200px]')
    expect(screen.queryByText('What do you want to get better at?')).not.toBeInTheDocument()
    expect(screen.queryByText('Tue Dec 16')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /hide history/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /show history/i })).not.toBeInTheDocument()

    const logButton = screen.getByRole('button', { name: 'Expand log from Mon Dec 15' })
    const logText = screen.getByText(entries[1].text)

    expect(logButton).toHaveAttribute('aria-expanded', 'false')
    expect(logText).toHaveClass('truncate')

    fireEvent.click(logButton)
    expect(screen.getByRole('button', { name: 'Collapse log from Mon Dec 15' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(logText).not.toHaveClass('truncate')

    fireEvent.click(screen.getByRole('button', { name: 'Collapse log from Mon Dec 15' }))
    expect(screen.getByRole('button', { name: 'Expand log from Mon Dec 15' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(logText).toHaveClass('truncate')

    const entryFetchCalls = fetchMock.mock.calls.filter(([arg]) =>
      String(arg).includes('/api/student/entries?')
    )
    expect(entryFetchCalls).toHaveLength(1)
  })

  it('shows today plus only the ten most recent past logs', async () => {
    const olderEntries = Array.from({ length: 11 }, (_, index) => ({
      ...entries[1],
      id: `past-${index + 1}`,
      date: `2025-12-${String(15 - index).padStart(2, '0')}`,
      text: `Past log ${index + 1}`,
    }))
    classDaysContextMock.classDays = [
      ...defaultClassDays,
      ...olderEntries.slice(1).map((entry, index) => ({
        id: `history-day-${index}`,
        classroom_id: 'c1',
        date: entry.date,
        prompt_text: null,
        is_class_day: true,
      })),
    ]
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) {
        return mockJson({ entries: [entries[0], ...olderEntries] })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lessonPlans: [] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)

    await screen.findByText('Past logs')

    expect(screen.getByText('Past log 1')).toBeInTheDocument()
    expect(screen.getByText('Past log 10')).toBeInTheDocument()
    expect(screen.queryByText('Past log 11')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Expand log from/ })).toHaveLength(10)
  })

  it('does not let interleaved non-class entries displace the ten recent class-day logs', async () => {
    const classDateEntries = Array.from({ length: 10 }, (_, index) => ({
      ...entries[1],
      id: `class-entry-${index + 1}`,
      date: `2025-12-${String(15 - index).padStart(2, '0')}`,
      text: `Class-day log ${index + 1}`,
    }))
    const nonClassEntries = Array.from({ length: 11 }, (_, index) => ({
      ...entries[1],
      id: `non-class-entry-${index + 1}`,
      date: `2025-11-${String(30 - index).padStart(2, '0')}`,
      text: `Non-class log ${index + 1}`,
    }))
    classDaysContextMock.classDays = [
      defaultClassDays[0],
      ...classDateEntries.map((entry, index) => ({
        id: `class-day-${index + 1}`,
        classroom_id: 'c1',
        date: entry.date,
        prompt_text: null,
        is_class_day: true,
      })),
      ...nonClassEntries.map((entry, index) => ({
        id: `non-class-day-${index + 1}`,
        classroom_id: 'c1',
        date: entry.date,
        prompt_text: null,
        is_class_day: false,
      })),
    ]
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) {
        const allEntries = [entries[0], ...nonClassEntries, ...classDateEntries]
        return mockJson({ entries: url.includes('limit=') ? allEntries.slice(0, 11) : allEntries })
      }
      if (url.includes('/lesson-plans')) return mockJson({ lessonPlans: [] })
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)

    expect(await screen.findByText('Class-day log 10')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Expand log from/ })).toHaveLength(10)
    expect(screen.queryByText('Non-class log 1')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('limit='))).toBe(false)
  })

  it('does not show entries from non-class days in past logs', async () => {
    classDaysContextMock.classDays = [
      ...defaultClassDays,
      { id: 'weekend', classroom_id: 'c1', date: '2025-12-14', prompt_text: null, is_class_day: false },
    ]
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) {
        return mockJson({
          entries: [
            entries[0],
            entries[1],
            { ...entries[1], id: 'weekend-entry', date: '2025-12-14', text: 'Weekend log' },
          ],
        })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lessonPlans: [] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)

    await screen.findByText('Past logs')

    expect(screen.getByText(entries[1].text)).toBeInTheDocument()
    expect(screen.queryByText('Weekend log')).not.toBeInTheDocument()
  })

  it('shows missed class days as empty past-log entries when only today has an entry', async () => {
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) {
        return mockJson({ entries: [entries[0]] })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lessonPlans: [] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)

    expect(await screen.findAllByText('No log submitted')).toHaveLength(3)
    expect(screen.getByText('Mon Dec 15')).toBeInTheDocument()
    expect(screen.queryByText('Tue Dec 16')).not.toBeInTheDocument()
  })

  it('shows a retryable entry error instead of an empty saved editor after the initial read fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let entriesRequests = 0
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) {
        entriesRequests += 1
        return entriesRequests === 1
          ? mockJson({ error: 'Entries unavailable' }, false)
          : mockJson({ entries })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lessonPlans: [] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <StudentTodayTab
        classroom={classroom}
        mobilePlan={<div data-testid="mobile-plan-during-entry-error">Today and last class</div>}
      />
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Daily log unavailable')
    expect(screen.getByTestId('mobile-plan-during-entry-error')).toBeInTheDocument()
    expect(screen.queryByLabelText('Daily Log')).not.toBeInTheDocument()
    expect(screen.queryByText('No past logs yet')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByDisplayValue(entries[0].text)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(entriesRequests).toBe(2)
    consoleError.mockRestore()
  })

  it('reports a today lesson-plan failure and recovers on a retry request', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const onLessonPlanError = vi.fn()
    const onLessonPlanLoad = vi.fn()
    let lessonPlanRequests = 0
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) {
        return mockJson({ entries })
      }
      if (url.includes('/lesson-plans')) {
        lessonPlanRequests += 1
        return lessonPlanRequests === 1
          ? mockJson({ error: 'Lesson plan unavailable' }, false)
          : mockJson({ lesson_plans: [] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const view = render(
      <StudentTodayTab
        classroom={classroom}
        onLessonPlanError={onLessonPlanError}
        onLessonPlanLoad={onLessonPlanLoad}
      />,
    )

    await waitFor(() => expect(onLessonPlanError).toHaveBeenCalledWith(classroom.id))
    expect(onLessonPlanLoad).not.toHaveBeenCalled()

    view.rerender(
      <StudentTodayTab
        classroom={classroom}
        lessonPlanRequestVersion={1}
        onLessonPlanError={onLessonPlanError}
        onLessonPlanLoad={onLessonPlanLoad}
      />,
    )

    await waitFor(() => expect(onLessonPlanLoad).toHaveBeenCalledWith(null, classroom.id))
    consoleError.mockRestore()
  })

  it('shows a retryable schedule error instead of reporting no class after class-days failure', async () => {
    classDaysContextMock.classDays = []
    classDaysContextMock.error = 'The class schedule could not be loaded.'
    classDaysContextMock.hasLoadedSnapshot = false
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) {
        return mockJson({ entries })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lessonPlans: [] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <StudentTodayTab
        classroom={classroom}
        mobilePlan={<div data-testid="mobile-plan-during-schedule-error">Today and last class</div>}
      />
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Class schedule unavailable')
    expect(screen.getByTestId('mobile-plan-during-schedule-error')).toBeInTheDocument()
    expect(screen.queryByText('No class today')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(classDaysContextMock.refresh).toHaveBeenCalledOnce()
  })

  it('keeps the daily workspace visible when a schedule refresh fails', async () => {
    classDaysContextMock.error = 'The class schedule could not be loaded.'
    classDaysContextMock.hasLoadedSnapshot = true
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) {
        return mockJson({ entries })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lessonPlans: [] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The latest class schedule could not be loaded.'
    )
    expect(screen.getByDisplayValue(entries[0].text)).toBeInTheDocument()
    expect(screen.getByText(entries[1].text)).toBeInTheDocument()
    expect(screen.queryByText('Class schedule unavailable')).not.toBeInTheDocument()
  })

  it('does not paint the previous classroom log while the next classroom loads', async () => {
    const secondEntriesRequest = deferred<any>()
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) {
        return mockJson({ entries })
      }
      if (url.startsWith(`/api/student/entries?classroom_id=${secondClassroom.id}`)) {
        return secondEntriesRequest.promise
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lessonPlans: [] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const view = render(<StudentTodayTab classroom={classroom} />)
    expect(await screen.findByDisplayValue(entries[0].text)).toBeInTheDocument()

    view.rerender(<StudentTodayTab classroom={secondClassroom} />)

    expect(screen.queryByDisplayValue(entries[0].text)).not.toBeInTheDocument()

    secondEntriesRequest.resolve(await mockJson({ entries: [] }))
    expect(await screen.findAllByText('No log submitted')).toHaveLength(3)
  })

  it('ignores stale entry and lesson-plan responses after classroom changes', async () => {
    const firstEntriesRequest = deferred<any>()
    const firstLessonPlanRequest = deferred<any>()
    const secondEntriesRequest = deferred<any>()
    const secondLessonPlanRequest = deferred<any>()
    const lessonPlanLoads: Array<{ classroomId: string; title: string | null }> = []
    const firstEntries: Entry[] = [
      {
        ...entries[0],
        id: 'first-today-entry',
        classroom_id: classroom.id,
        text: 'Classroom A today log.',
      },
    ]
    const secondEntries: Entry[] = [
      {
        ...entries[0],
        id: 'second-today-entry',
        classroom_id: secondClassroom.id,
        text: 'Classroom B today log.',
      },
    ]
    const firstLessonPlan = {
      id: 'first-plan',
      classroom_id: classroom.id,
      date: '2025-12-16',
      title: 'Classroom A plan',
      content: null,
      created_at: '2025-12-16T01:00:00Z',
      updated_at: '2025-12-16T01:00:00Z',
    }
    const secondLessonPlan = {
      ...firstLessonPlan,
      id: 'second-plan',
      classroom_id: secondClassroom.id,
      title: 'Classroom B plan',
    }
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) {
        return firstEntriesRequest.promise
      }
      if (url.startsWith(`/api/student/entries?classroom_id=${secondClassroom.id}`)) {
        return secondEntriesRequest.promise
      }
      if (url.includes(`/api/student/classrooms/${classroom.id}/lesson-plans`)) {
        return firstLessonPlanRequest.promise
      }
      if (url.includes(`/api/student/classrooms/${secondClassroom.id}/lesson-plans`)) {
        return secondLessonPlanRequest.promise
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const view = render(
      <StudentTodayTab
        classroom={classroom}
        onLessonPlanLoad={(plan, classroomId) => {
          lessonPlanLoads.push({ classroomId, title: plan?.title ?? null })
        }}
      />,
    )

    view.rerender(
      <StudentTodayTab
        classroom={secondClassroom}
        onLessonPlanLoad={(plan, classroomId) => {
          lessonPlanLoads.push({ classroomId, title: plan?.title ?? null })
        }}
      />,
    )

    secondLessonPlanRequest.resolve(await mockJson({ lesson_plans: [secondLessonPlan] }))
    secondEntriesRequest.resolve(await mockJson({ entries: secondEntries }))

    expect(await screen.findByDisplayValue('Classroom B today log.')).toBeInTheDocument()
    expect(lessonPlanLoads).toEqual([
      { classroomId: secondClassroom.id, title: 'Classroom B plan' },
    ])

    firstLessonPlanRequest.resolve(await mockJson({ lesson_plans: [firstLessonPlan] }))
    firstEntriesRequest.resolve(await mockJson({ entries: firstEntries }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('Classroom B today log.')).toBeInTheDocument()
    })
    expect(screen.queryByDisplayValue('Classroom A today log.')).not.toBeInTheDocument()
    expect(lessonPlanLoads).toEqual([
      { classroomId: secondClassroom.id, title: 'Classroom B plan' },
    ])
  })

  it('keeps an empty new entry marked saved', async () => {
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) {
        return mockJson({ entries: [] })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lesson_plans: [] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)

    const editor = await screen.findByLabelText('Daily Log')
    const saveStatus = screen.getByText('Saved')
    expect(saveStatus).toHaveAttribute('role', 'status')
    expect(saveStatus).toHaveAttribute('aria-live', 'polite')
    expect(saveStatus).toHaveAttribute('aria-atomic', 'true')
    expect(editor).toHaveAttribute('data-toolbar-preset', 'brief')

    fireEvent.change(editor, { target: { value: '' } })

    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/student/entries',
      expect.objectContaining({ method: 'PATCH' })
    )
  })

  it('renders cached entries immediately and refreshes them in the background', async () => {
    const cacheKey = getStudentEntryHistoryCacheKey({ classroomId: classroom.id, limit: 11 })
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

  it('keeps cached entries available when a background refresh fails and retries', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const cacheKey = getStudentEntryHistoryCacheKey({ classroomId: classroom.id, limit: 11 })
    window.sessionStorage.setItem(cacheKey, JSON.stringify(entries))
    let entriesRequests = 0
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?`)) {
        entriesRequests += 1
        return entriesRequests === 1
          ? mockJson({ error: 'Entries unavailable' }, false)
          : mockJson({ entries })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lesson_plans: [] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The latest daily log could not be loaded.'
    )
    expect(screen.getByDisplayValue(entries[0].text)).toBeInTheDocument()
    expect(screen.getByText(entries[1].text)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
    expect(entriesRequests).toBe(2)
    expect(screen.getByDisplayValue(entries[0].text)).toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('retains the session snapshot when a background retry also fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const cacheKey = getStudentEntryHistoryCacheKey({ classroomId: classroom.id, limit: 11 })
    window.sessionStorage.setItem(cacheKey, JSON.stringify(entries))
    let entriesRequests = 0
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?`)) {
        entriesRequests += 1
        return mockJson({ error: 'Entries unavailable' }, false)
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lesson_plans: [] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const view = render(<StudentTodayTab classroom={classroom} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The latest daily log could not be loaded.'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(entriesRequests).toBe(2))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The latest daily log could not be loaded.'
    )
    expect(window.sessionStorage.getItem(cacheKey)).toContain(entries[0].text)

    view.unmount()
    render(<StudentTodayTab classroom={classroom} />)

    expect(await screen.findByDisplayValue(entries[0].text)).toBeInTheDocument()
    expect(window.sessionStorage.getItem(cacheKey)).toContain(entries[0].text)
    consoleError.mockRestore()
  })

  it.each(([
    ['entries', false, true], ['entries', true, true],
    ['lesson-plan', false, true], ['lesson-plan', true, true],
    ['entries', false, false], ['entries', true, false],
    ['lesson-plan', false, false], ['lesson-plan', true, false],
  ] as const).flatMap(([retryOwner, blockedStorage, readSucceeds]) => [
    [retryOwner, blockedStorage, readSucceeds, true] as const,
    [retryOwner, blockedStorage, readSucceeds, false] as const,
  ]))('preserves the live editor through %s retry (blocked storage=%s, read succeeds=%s, save succeeds=%s)', async (retryOwner, blockedStorage, readSucceeds, saveSucceeds) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const storageSet = Storage.prototype.setItem
    if (blockedStorage) {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
        if (this === window.localStorage && key.startsWith('daily-log-draft:v2:')) throw new Error('Storage blocked')
        return storageSet.call(this, key, value)
      })
    }
    const cacheKey = getStudentEntryHistoryCacheKey({ classroomId: classroom.id, limit: 11 })
    window.sessionStorage.setItem(cacheKey, JSON.stringify(entries))
    const retryRead = deferred<any>()
    const save = deferred<any>()
    let readCount = 0
    let saveCount = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/student/entries?')) {
        readCount += 1
        return readCount === 1 ? mockJson({ error: 'Offline' }, false) : retryRead.promise
      }
      if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
      if (url === '/api/student/entries' && init?.method === 'PATCH') {
        saveCount += 1
        return save.promise
      }
      throw new Error(`Unhandled fetch: ${url}`)
    }))
    const view = render(<StudentTodayTab classroom={classroom} />)
    await screen.findByText('The latest daily log could not be loaded.')
    const editor = screen.getByRole('textbox', { name: 'Daily Log' })
    const history = screen.getByText(entries[1].text)
    fireEvent.click(screen.getByRole('button', { name: 'Expand log from Mon Dec 15' }))
    fireEvent.change(editor, { target: { value: 'Live draft before retry.' } })
    fireEvent.blur(editor)
    await waitFor(() => expect(saveCount).toBe(1))
    expect(screen.getByText('Saving…')).toBeInTheDocument()

    if (retryOwner === 'entries') fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    else view.rerender(<StudentTodayTab classroom={classroom} lessonPlanRequestVersion={1} />)
    await waitFor(() => expect(readCount).toBe(2))
    expect(screen.getByRole('textbox', { name: 'Daily Log' })).toBe(editor)
    expect(editor).toHaveValue('Live draft before retry.')
    expect(screen.getByText('Saving…')).toBeInTheDocument()
    expect(screen.getByText(entries[1].text)).toBe(history)
    expect(screen.getByRole('button', { name: 'Collapse log from Mon Dec 15' })).toBeInTheDocument()

    fireEvent.change(editor, { target: { value: 'Live draft edited during retry.' } })
    await act(async () => retryRead.resolve(await mockJson(
      readSucceeds ? { entries } : { error: 'Still offline' }, readSucceeds,
    )))
    expect(screen.getByRole('textbox', { name: 'Daily Log' })).toBe(editor)
    expect(editor).toHaveValue('Live draft edited during retry.')
    expect(screen.getByText('Unsaved')).toBeInTheDocument()
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
    expect(saveCount).toBe(1)
    if (!readSucceeds) expect(screen.getByText('The latest daily log could not be loaded.')).toBeInTheDocument()
    else expect(screen.queryByText('The latest daily log could not be loaded.')).not.toBeInTheDocument()

    await act(async () => save.resolve(await mockJson(saveSucceeds ? {
      entry: {
        ...entries[0], text: 'Live draft before retry.', version: 2,
        rich_content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Live draft before retry.' }] }] },
      },
    } : { error: 'Save is offline' }, saveSucceeds)))
    expect(editor).toHaveValue('Live draft edited during retry.')
    expect(screen.getByText('Unsaved')).toBeInTheDocument()
    if (!saveSucceeds) expect(screen.getByText('Save is offline')).toBeInTheDocument()
    else {
      fireEvent.change(editor, { target: { value: 'Live draft before retry.' } })
      expect(screen.getByText('Saved')).toBeInTheDocument()
    }
  })

  it('detects a newer server log during retry even when durable draft storage is blocked', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const storageSet = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (this === window.localStorage && key.startsWith('daily-log-draft:v2:')) throw new Error('Storage blocked')
      return storageSet.call(this, key, value)
    })
    window.sessionStorage.setItem(getStudentEntryHistoryCacheKey({ classroomId: classroom.id, limit: 11 }), JSON.stringify(entries))
    const retryRead = deferred<any>()
    let readCount = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith('/api/student/entries?')) return ++readCount === 1 ? mockJson({ error: 'Offline' }, false) : retryRead.promise
      if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
      throw new Error(`Unhandled fetch: ${url}`)
    }))
    render(<StudentTodayTab classroom={classroom} />)
    await screen.findByText('The latest daily log could not be loaded.')
    const editor = screen.getByRole('textbox', { name: 'Daily Log' })
    fireEvent.change(editor, { target: { value: 'Keep my live revision.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(readCount).toBe(2))
    await act(async () => retryRead.resolve(await mockJson({ entries: [{ ...entries[0], version: 2, text: 'Changed elsewhere.' }, entries[1]] })))
    expect(screen.getByRole('textbox', { name: 'Daily Log' })).toBe(editor)
    expect(editor).toHaveValue('Keep my live revision.')
    expect(screen.getByText('This log changed elsewhere. Review before replacing the newer version.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload latest' })).toBeInTheDocument()
  })

  it.each(['entries', 'lesson-plan'] as const)('keeps the autosave deadline across a %s read retry', async (retryOwner) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    window.sessionStorage.setItem(getStudentEntryHistoryCacheKey({ classroomId: classroom.id, limit: 11 }), JSON.stringify(entries))
    const retryRead = deferred<any>()
    const save = deferred<any>()
    let readCount = 0
    let saveCount = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/student/entries?')) return ++readCount === 1 ? mockJson({ error: 'Offline' }, false) : retryRead.promise
      if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
      if (url === '/api/student/entries' && init?.method === 'PATCH') {
        saveCount += 1
        return save.promise
      }
      throw new Error(`Unhandled fetch: ${url}`)
    }))
    const view = render(<StudentTodayTab classroom={classroom} />)
    await screen.findByText('The latest daily log could not be loaded.')
    const editor = screen.getByRole('textbox', { name: 'Daily Log' })
    vi.useFakeTimers()
    fireEvent.change(editor, { target: { value: 'Save this on the original deadline.' } })
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    if (retryOwner === 'entries') fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    else view.rerender(<StudentTodayTab classroom={classroom} lessonPlanRequestVersion={1} />)
    await act(async () => vi.advanceTimersByTimeAsync(2999))
    expect(saveCount).toBe(0)
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(saveCount).toBe(1)
    expect(screen.getByRole('textbox', { name: 'Daily Log' })).toBe(editor)
    expect(editor).toHaveValue('Save this on the original deadline.')
    expect(screen.getByText('Saving…')).toBeInTheDocument()
    await act(async () => retryRead.resolve(await mockJson({ entries })))
    expect(screen.getByText('Saving…')).toBeInTheDocument()
  })

  it('keeps a throttled autosave queued across a lesson-plan retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    window.sessionStorage.setItem(getStudentEntryHistoryCacheKey({ classroomId: classroom.id, limit: 11 }), JSON.stringify(entries))
    const retryRead = deferred<any>()
    const secondSave = deferred<any>()
    let readCount = 0
    let saveCount = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/student/entries?')) return ++readCount === 1 ? mockJson({ error: 'Offline' }, false) : retryRead.promise
      if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
      if (url === '/api/student/entries' && init?.method === 'PATCH') {
        saveCount += 1
        return saveCount === 1 ? mockJson({ entry: {
          ...entries[0], text: 'First saved revision.', version: 2,
          rich_content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First saved revision.' }] }] },
        } }) : secondSave.promise
      }
      throw new Error(`Unhandled fetch: ${url}`)
    }))
    const view = render(<StudentTodayTab classroom={classroom} />)
    await screen.findByText('The latest daily log could not be loaded.')
    const editor = screen.getByRole('textbox', { name: 'Daily Log' })
    vi.useFakeTimers()
    fireEvent.change(editor, { target: { value: 'First saved revision.' } })
    await act(async () => fireEvent.blur(editor))
    expect(saveCount).toBe(1)
    expect(screen.getByText('Saved')).toBeInTheDocument()
    fireEvent.change(editor, { target: { value: 'Second throttled revision.' } })
    await act(async () => vi.advanceTimersByTimeAsync(6000))
    expect(saveCount).toBe(1)
    view.rerender(<StudentTodayTab classroom={classroom} lessonPlanRequestVersion={1} />)
    await act(async () => vi.advanceTimersByTimeAsync(8999))
    expect(saveCount).toBe(1)
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(saveCount).toBe(2)
    expect(screen.getByRole('textbox', { name: 'Daily Log' })).toBe(editor)
    expect(editor).toHaveValue('Second throttled revision.')
    expect(screen.getByText('Saving…')).toBeInTheDocument()
  })

  it('keeps a confirmed save when the retry read later returns its older snapshot', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    window.sessionStorage.setItem(getStudentEntryHistoryCacheKey({ classroomId: classroom.id, limit: 11 }), JSON.stringify(entries))
    const retryRead = deferred<any>()
    const save = deferred<any>()
    let readCount = 0
    let saveCount = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/student/entries?')) return ++readCount === 1 ? mockJson({ error: 'Offline' }, false) : retryRead.promise
      if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
      if (url === '/api/student/entries' && init?.method === 'PATCH') {
        saveCount += 1
        return save.promise
      }
      throw new Error(`Unhandled fetch: ${url}`)
    }))
    render(<StudentTodayTab classroom={classroom} />)
    await screen.findByText('The latest daily log could not be loaded.')
    const editor = screen.getByRole('textbox', { name: 'Daily Log' })
    fireEvent.change(editor, { target: { value: 'Confirmed newer revision.' } })
    fireEvent.blur(editor)
    await waitFor(() => expect(saveCount).toBe(1))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(readCount).toBe(2))
    await act(async () => save.resolve(await mockJson({ entry: {
      ...entries[0], text: 'Confirmed newer revision.', version: 2,
      rich_content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Confirmed newer revision.' }] }] },
    } })))
    expect(screen.getByText('Saved')).toBeInTheDocument()
    await act(async () => retryRead.resolve(await mockJson({ entries })))
    expect(screen.getByRole('textbox', { name: 'Daily Log' })).toBe(editor)
    expect(editor).toHaveValue('Confirmed newer revision.')
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reload latest' })).not.toBeInTheDocument()
    fireEvent.change(editor, { target: { value: 'Edit after confirmed retry.' } })
    fireEvent.blur(editor)
    await waitFor(() => expect(saveCount).toBe(2))
    const fetchMock = vi.mocked(fetch)
    const lastSave = fetchMock.mock.calls.filter(([url, init]) => url === '/api/student/entries' && init?.method === 'PATCH').at(-1)
    expect(JSON.parse(String(lastSave?.[1]?.body)).version).toBe(2)
  })

  it('reconciles cached past logs after the authoritative schedule arrives despite failed reads', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const pastEntries = Array.from({ length: 10 }, (_, index) => ({
      ...entries[1], id: `past-${index}`, date: `2025-12-${String(15 - index).padStart(2, '0')}`,
      text: `Cached past log ${index}.`,
    }))
    const cacheKey = getStudentEntryHistoryCacheKey({ classroomId: classroom.id, limit: 11 })
    window.sessionStorage.setItem(cacheKey, JSON.stringify([entries[0], ...pastEntries]))
    classDaysContextMock.classDays = []
    let readCount = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith('/api/student/entries?')) {
        readCount += 1
        return mockJson({ error: 'Offline' }, false)
      }
      if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
      throw new Error(`Unhandled fetch: ${url}`)
    }))
    const view = render(<StudentTodayTab classroom={classroom} />)
    await screen.findByText('The latest daily log could not be loaded.')
    classDaysContextMock.classDays = [defaultClassDays[0], ...pastEntries.map((entry, index) => ({
      ...defaultClassDays[0], id: `day-${index}`, date: entry.date,
    }))]
    view.rerender(<StudentTodayTab classroom={classroom} />)
    await waitFor(() => expect(readCount).toBe(2))
    const editor = screen.getByRole('textbox', { name: 'Daily Log' })
    expect(editor).toHaveValue(entries[0].text)
    for (const entry of pastEntries) expect(screen.getByText(entry.text)).toBeInTheDocument()
    expect(screen.queryByText('No log submitted')).not.toBeInTheDocument()
    fireEvent.change(editor, { target: { value: 'Live draft with newly loaded history.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(readCount).toBe(3))
    expect(screen.getByRole('textbox', { name: 'Daily Log' })).toBe(editor)
    expect(editor).toHaveValue('Live draft with newly loaded history.')
    for (const entry of pastEntries) expect(screen.getByText(entry.text)).toBeInTheDocument()
  })

  it('fills newly relevant cached history without replacing a newer in-memory past log', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const extraPast = { ...entries[1], id: 'extra-past', date: '2025-05-06', text: 'Additional cached past log.' }
    const newerPast = { ...entries[1], text: 'Newer past log already loaded.', version: 2 }
    const cacheKey = getStudentEntryHistoryCacheKey({ classroomId: classroom.id, limit: 11 })
    window.sessionStorage.setItem(cacheKey, JSON.stringify([...entries, extraPast]))
    classDaysContextMock.classDays = defaultClassDays.slice(0, 2)
    let readCount = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith('/api/student/entries?')) return ++readCount === 1
        ? mockJson({ entries: [entries[0], newerPast] }) : mockJson({ error: 'Offline' }, false)
      if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
      throw new Error(`Unhandled fetch: ${url}`)
    }))
    const view = render(<StudentTodayTab classroom={classroom} />)
    await screen.findByText(newerPast.text)
    window.sessionStorage.setItem(cacheKey, JSON.stringify([...entries, extraPast]))
    invalidateCachedJSONMatching('student-entries:')
    classDaysContextMock.classDays = defaultClassDays
    view.rerender(<StudentTodayTab classroom={classroom} />)
    await screen.findByText('The latest daily log could not be loaded.')
    expect(screen.getByText(newerPast.text)).toBeInTheDocument()
    expect(screen.getByText(extraPast.text)).toBeInTheDocument()
    expect(screen.queryByText(entries[1].text)).not.toBeInTheDocument()
  })

  it.each([true, false])('orders an empty retry read against the first acknowledged save (read started before save=%s)', async (readStartedBeforeSave) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    window.sessionStorage.setItem(getStudentEntryHistoryCacheKey({ classroomId: classroom.id, limit: 11 }), JSON.stringify([]))
    const retryRead = deferred<any>()
    const firstSave = deferred<any>()
    const laterSave = deferred<any>()
    const saveBodies: any[] = []
    let readCount = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/student/entries?')) return ++readCount === 1 ? mockJson({ error: 'Offline' }, false) : retryRead.promise
      if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
      if (url === '/api/student/entries' && init?.method === 'PATCH') {
        saveBodies.push(JSON.parse(String(init.body)))
        return saveBodies.length === 1 ? firstSave.promise : laterSave.promise
      }
      throw new Error(`Unhandled fetch: ${url}`)
    }))
    render(<StudentTodayTab classroom={classroom} />)
    await screen.findByText('The latest daily log could not be loaded.')
    const editor = screen.getByRole('textbox', { name: 'Daily Log' })
    fireEvent.change(editor, { target: { value: 'My first confirmed log.' } })
    await waitFor(() => expect(saveBodies).toHaveLength(1))
    if (readStartedBeforeSave) {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      await waitFor(() => expect(readCount).toBe(2))
    }
    await act(async () => firstSave.resolve(await mockJson({ entry: {
      ...entries[0], id: 'first-created-entry', text: 'My first confirmed log.', version: 1,
      rich_content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My first confirmed log.' }] }] },
    } })))
    expect(screen.getByText('Saved')).toBeInTheDocument()
    if (!readStartedBeforeSave) {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      await waitFor(() => expect(readCount).toBe(2))
    }
    await act(async () => retryRead.resolve(await mockJson({ entries: [] })))
    expect(screen.getByRole('textbox', { name: 'Daily Log' })).toBe(editor)
    expect(editor).toHaveValue(readStartedBeforeSave ? 'My first confirmed log.' : '')
    expect(screen.getByText('Saved')).toBeInTheDocument()
    fireEvent.change(editor, { target: { value: 'Edit after empty retry.' } })
    fireEvent.blur(editor)
    await waitFor(() => expect(saveBodies).toHaveLength(2))
    expect(saveBodies[1].entry_id).toBe(readStartedBeforeSave ? 'first-created-entry' : undefined)
    expect(saveBodies[1].version).toBe(1)
  })

  describe('authoritative retry reconciliation', () => {
    function prepareRetry(blockedStorage: boolean) {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      if (blockedStorage) {
        const storageSet = Storage.prototype.setItem
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
          if (this === window.localStorage && key.startsWith('daily-log-draft:v2:')) throw new Error('Storage blocked')
          return storageSet.call(this, key, value)
        })
      }
      window.sessionStorage.setItem(getStudentEntryHistoryCacheKey({ classroomId: classroom.id, limit: 11 }), JSON.stringify(entries))
    }

    function committedEntry(text: string): Entry {
      return {
        ...entries[0], text, version: 2,
        rich_content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
      }
    }

    it.each([false, true])('acknowledges identical retry content after a lost save response (blocked storage=%s)', async (blockedStorage) => {
      prepareRetry(blockedStorage)
      const retryRead = deferred<any>()
      const lostSave = deferred<any>()
      const nextSave = deferred<any>()
      const saveBodies: any[] = []
      let readCount = 0
      vi.stubGlobal('fetch', vi.fn((input: RequestInfo, init?: RequestInit) => {
        const url = String(input)
        if (url.startsWith('/api/student/entries?')) return ++readCount === 1 ? mockJson({ error: 'Read offline' }, false) : retryRead.promise
        if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
        if (url === '/api/student/entries' && init?.method === 'PATCH') {
          saveBodies.push(JSON.parse(String(init.body)))
          return saveBodies.length === 1 ? lostSave.promise : nextSave.promise
        }
        throw new Error(`Unhandled fetch: ${url}`)
      }))
      render(<StudentTodayTab classroom={classroom} />)
      await screen.findByText('The latest daily log could not be loaded.')
      const editor = screen.getByRole('textbox', { name: 'Daily Log' })
      fireEvent.change(editor, { target: { value: 'Committed draft with lost response.' } })
      fireEvent.blur(editor)
      await waitFor(() => expect(saveBodies).toHaveLength(1))
      await act(async () => lostSave.reject(new Error('Save response lost')))
      expect(screen.getByText('Unsaved')).toBeInTheDocument()
      expect(screen.getByText('Save response lost')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      await waitFor(() => expect(readCount).toBe(2))
      await act(async () => retryRead.resolve(await mockJson({ entries: [committedEntry('Committed draft with lost response.'), entries[1]] })))
      expect(screen.getByRole('textbox', { name: 'Daily Log' })).toBe(editor)
      expect(editor).toHaveValue('Committed draft with lost response.')
      expect(screen.getByText('Saved')).toBeInTheDocument()
      expect(screen.queryByText('Save response lost')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Reload latest' })).not.toBeInTheDocument()
      expect(screen.queryByText(/This draft could not be kept/)).not.toBeInTheDocument()
      expect(window.localStorage.getItem('daily-log-draft:v2:s1:c1:2025-12-16')).toBeNull()
      expect(window.sessionStorage.getItem(getDailyLogDraftKey(classroom.id, '2025-12-16'))).toBeNull()
      fireEvent.change(editor, { target: { value: 'Next revision after confirmed read.' } })
      fireEvent.blur(editor)
      await waitFor(() => expect(saveBodies).toHaveLength(2))
      expect(saveBodies[1]).toMatchObject({ entry_id: entries[0].id, version: 2 })
    })

    it.each([false, true])('retains explicit conflict recovery after reverting the old base and continuing typing (blocked storage=%s)', async (blockedStorage) => {
      prepareRetry(blockedStorage)
      const retryRead = deferred<any>()
      const explicitSave = deferred<any>()
      const saveBodies: any[] = []
      let readCount = 0
      vi.stubGlobal('fetch', vi.fn((input: RequestInfo, init?: RequestInit) => {
        const url = String(input)
        if (url.startsWith('/api/student/entries?')) return ++readCount === 1 ? mockJson({ error: 'Read offline' }, false) : retryRead.promise
        if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
        if (url === '/api/student/entries' && init?.method === 'PATCH') {
          saveBodies.push(JSON.parse(String(init.body)))
          return explicitSave.promise
        }
        throw new Error(`Unhandled fetch: ${url}`)
      }))
      render(<StudentTodayTab classroom={classroom} />)
      await screen.findByText('The latest daily log could not be loaded.')
      const editor = screen.getByRole('textbox', { name: 'Daily Log' })
      fireEvent.change(editor, { target: { value: 'Local revision before conflict.' } })
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      await waitFor(() => expect(readCount).toBe(2))
      await act(async () => retryRead.resolve(await mockJson({ entries: [committedEntry('Different content changed elsewhere.'), entries[1]] })))
      expect(editor).toHaveValue('Local revision before conflict.')
      expect(screen.getByRole('button', { name: 'Reload latest' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Retry save' })).toBeInTheDocument()
      fireEvent.change(editor, { target: { value: entries[0].text } })
      expect(screen.getByText('Unsaved')).toBeInTheDocument()
      expect(screen.queryByText('Saved')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Reload latest' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Retry save' })).toBeInTheDocument()
      expect(screen.getByText('This log changed elsewhere. Review before replacing the newer version.')).toBeInTheDocument()
      fireEvent.change(editor, { target: { value: 'Continued local revision after reverting.' } })
      fireEvent.blur(editor)
      expect(screen.getByRole('textbox', { name: 'Daily Log' })).toBe(editor)
      expect(editor).toHaveValue('Continued local revision after reverting.')
      expect(screen.getByText('Unsaved')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Reload latest' })).toBeInTheDocument()
      expect(saveBodies).toHaveLength(0)
      fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
      await waitFor(() => expect(saveBodies).toHaveLength(1))
      expect(saveBodies[0]).toMatchObject({ entry_id: entries[0].id, version: 2 })
      expect(JSON.stringify(saveBodies[0].rich_content)).toContain('Continued local revision after reverting.')
    })

    it.each([
      [false, false, false], [true, false, false],
      [false, true, false], [true, true, false],
      [false, true, true], [true, true, true],
    ] as const)('reconciles an outstanding own save after a retry (blocked storage=%s, newer draft=%s, throttled=%s)', async (blockedStorage, newerDraft, throttled) => {
      prepareRetry(blockedStorage)
      const retryRead = deferred<any>()
      const outstandingSave = deferred<any>()
      const laterSave = deferred<any>()
      const saveBodies: any[] = []
      let readCount = 0
      vi.stubGlobal('fetch', vi.fn((input: RequestInfo, init?: RequestInit) => {
        const url = String(input)
        if (url.startsWith('/api/student/entries?')) return ++readCount === 1 ? mockJson({ error: 'Read offline' }, false) : retryRead.promise
        if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
        if (url === '/api/student/entries' && init?.method === 'PATCH') {
          saveBodies.push(JSON.parse(String(init.body)))
          return saveBodies.length === 1 ? outstandingSave.promise : laterSave.promise
        }
        throw new Error(`Unhandled fetch: ${url}`)
      }))
      render(<StudentTodayTab classroom={classroom} />)
      await screen.findByText('The latest daily log could not be loaded.')
      const editor = screen.getByRole('textbox', { name: 'Daily Log' })
      fireEvent.change(editor, { target: { value: 'Content in the outstanding save.' } })
      fireEvent.blur(editor)
      await waitFor(() => expect(saveBodies).toHaveLength(1))
      vi.useFakeTimers()
      if (newerDraft) fireEvent.change(editor, { target: { value: 'Newer local draft still unsent.' } })
      if (throttled) await act(async () => vi.advanceTimersByTimeAsync(6000))
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })))
      expect(readCount).toBe(2)
      await act(async () => retryRead.resolve(await mockJson({ entries: [committedEntry('Content in the outstanding save.'), entries[1]] })))
      expect(screen.getByRole('textbox', { name: 'Daily Log' })).toBe(editor)
      expect(editor).toHaveValue(newerDraft ? 'Newer local draft still unsent.' : 'Content in the outstanding save.')
      expect(screen.queryByText('Saved')).not.toBeInTheDocument()
      expect(saveBodies).toHaveLength(1)
      expect(screen.getByRole('button', { name: 'Reload latest' })).toBeInTheDocument()
      await act(async () => outstandingSave.resolve(await mockJson({ entry: committedEntry('Content in the outstanding save.') })))
      expect(screen.getByText(newerDraft ? 'Unsaved' : 'Saved')).toBeInTheDocument()
      expect(editor).toHaveValue(newerDraft ? 'Newer local draft still unsent.' : 'Content in the outstanding save.')
      expect(screen.queryByRole('button', { name: 'Reload latest' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Retry save' })).not.toBeInTheDocument()
      expect(screen.queryByText(/This log changed elsewhere/)).not.toBeInTheDocument()
      if (newerDraft) {
        expect(Boolean(screen.queryByText(/This draft could not be kept/))).toBe(blockedStorage)
        if (!blockedStorage) {
          const draft = JSON.parse(window.localStorage.getItem('daily-log-draft:v2:s1:c1:2025-12-16')!)
          expect(draft).toMatchObject({ entryId: entries[0].id, version: 2 })
          expect(JSON.stringify(draft.content)).toContain('Newer local draft still unsent.')
        }
        await act(async () => vi.advanceTimersByTimeAsync(15000))
        expect(saveBodies).toHaveLength(2)
        expect(saveBodies[1]).toMatchObject({ entry_id: entries[0].id, version: 2 })
        expect(JSON.stringify(saveBodies[1])).toContain('Newer local draft still unsent.')
        expect(screen.getByText('Saving…')).toBeInTheDocument()
        await act(async () => laterSave.resolve(await mockJson({ entry: { ...committedEntry('Newer local draft still unsent.'), version: 3 } })))
        expect(screen.getByText('Saved')).toBeInTheDocument()
        expect(screen.queryByText(/This draft could not be kept/)).not.toBeInTheDocument()
        expect(window.localStorage.getItem('daily-log-draft:v2:s1:c1:2025-12-16')).toBeNull()
      } else {
        await act(async () => vi.advanceTimersByTimeAsync(30000))
        expect(saveBodies).toHaveLength(1)
      }
    })

    it.each([false, true].flatMap(blockedStorage => [false, true].flatMap(newerDraft =>
      ['version', 'identity', 'content'].map(difference => ({ blockedStorage, newerDraft, difference }))
    )))('retains a different retry conflict after own acknowledgement ($difference, blocked=$blockedStorage, newer draft=$newerDraft)', async ({ blockedStorage, newerDraft, difference }) => {
      prepareRetry(blockedStorage)
      const retryRead = deferred<any>()
      const outstandingSave = deferred<any>()
      const replacementSave = deferred<any>()
      const ownEntry = committedEntry('Content in the outstanding save.')
      const serverEntry = {
        ...committedEntry(difference === 'content' ? 'Different external content.' : ownEntry.text),
        id: difference === 'identity' ? 'other-server-entry' : ownEntry.id,
        version: difference === 'version' ? 3 : 2,
      }
      const saveBodies: any[] = []
      let readCount = 0
      vi.stubGlobal('fetch', vi.fn((input: RequestInfo, init?: RequestInit) => {
        const url = String(input)
        if (url.startsWith('/api/student/entries?')) return ++readCount === 1 ? mockJson({ error: 'Read offline' }, false) : retryRead.promise
        if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
        if (url === '/api/student/entries' && init?.method === 'PATCH') {
          saveBodies.push(JSON.parse(String(init.body)))
          return saveBodies.length === 1 ? outstandingSave.promise : replacementSave.promise
        }
        throw new Error(`Unhandled fetch: ${url}`)
      }))
      render(<StudentTodayTab classroom={classroom} />)
      await screen.findByText('The latest daily log could not be loaded.')
      const editor = screen.getByRole('textbox', { name: 'Daily Log' })
      fireEvent.change(editor, { target: { value: ownEntry.text } })
      fireEvent.blur(editor)
      await waitFor(() => expect(saveBodies).toHaveLength(1))
      vi.useFakeTimers()
      if (newerDraft) fireEvent.change(editor, { target: { value: 'Newer local draft still unsent.' } })
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })))
      await act(async () => retryRead.resolve(await mockJson({ entries: [serverEntry, entries[1]] })))
      await act(async () => outstandingSave.resolve(await mockJson({ entry: ownEntry })))
      expect(screen.getByText('Unsaved')).toBeInTheDocument()
      expect(screen.getByText('This log changed elsewhere. Review before replacing the newer version.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Reload latest' })).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'Daily Log' })).toBe(editor)
      expect(editor).toHaveValue(newerDraft ? 'Newer local draft still unsent.' : ownEntry.text)
      expect(Boolean(screen.queryByText(/This draft could not be kept/))).toBe(blockedStorage)
      await act(async () => vi.advanceTimersByTimeAsync(30000))
      fireEvent.blur(editor)
      expect(saveBodies).toHaveLength(1)
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry save' })))
      expect(saveBodies).toHaveLength(2)
      expect(saveBodies[1]).toMatchObject({ entry_id: serverEntry.id, version: serverEntry.version })
      expect(JSON.stringify(saveBodies[1].rich_content)).toContain(newerDraft ? 'Newer local draft still unsent.' : ownEntry.text)
    })

  })

  it('does not overwrite local edits when the background refresh completes', async () => {
    const cacheKey = getStudentEntryHistoryCacheKey({ classroomId: classroom.id, limit: 11 })
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

    const editor = await screen.findByLabelText('Daily Log')
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
    const cacheKey = getStudentEntryHistoryCacheKey({ classroomId: classroom.id, limit: 11 })
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

    const editor = await screen.findByLabelText('Daily Log')
    expect(editor).toHaveValue('Cached today entry.')

    fireEvent.change(editor, { target: { value: 'Temporary local draft.' } })
    fireEvent.change(editor, { target: { value: 'Cached today entry.' } })
    entriesRequest.resolve(await mockJson({ entries: refreshedEntries }))

    await waitFor(() => {
      expect(editor).toHaveValue('Server refreshed today entry.')
    })
    expect(window.sessionStorage.getItem(cacheKey)).toContain('Server refreshed today entry.')
  })

  it('saves first new-day typing under the new Toronto date after a stale tab resumes', async () => {
    getTodayInTorontoMock.mockReturnValue('2025-05-06')
    const patchBodies: any[] = []

    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) {
        return mockJson({ entries: [] })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lesson_plans: [] })
      }
      if (url === '/api/student/entries' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        patchBodies.push(body)
        return mockJson({ entry: { id: 'new-day-entry', student_id: 's1', classroom_id: classroom.id, date: body.date, text: 'Worked today', rich_content: body.rich_content, version: 1 } })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)

    const editor = await screen.findByLabelText('Daily Log')
    getTodayInTorontoMock.mockReturnValue('2025-05-11')

    fireEvent.change(editor, { target: { value: 'Worked today' } })
    fireEvent.blur(editor)

    await waitFor(() => expect(patchBodies).toHaveLength(1))
    expect(patchBodies[0]).toMatchObject({ date: '2025-05-11' })
    expect(JSON.stringify(patchBodies[0].rich_content)).toContain('Worked today')
    await waitFor(() => expect(screen.getByLabelText('Daily Log')).toHaveValue('Worked today'))
  })

  it('sends rollover typing even if browser draft storage is unavailable', async () => {
    getTodayInTorontoMock.mockReturnValue('2025-05-06')
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (this === window.localStorage && key.startsWith('daily-log-draft:v2:')) throw new Error('Storage blocked')
      return originalSetItem.call(this, key, value)
    })
    const saveRequest = deferred<any>()
    const patchBodies: any[] = []
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/student/entries?')) return mockJson({ entries: [] })
      if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
      if (url === '/api/student/entries' && init?.method === 'PATCH') {
        patchBodies.push(JSON.parse(String(init.body)))
        return saveRequest.promise
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)
    const editor = await screen.findByLabelText('Daily Log')
    getTodayInTorontoMock.mockReturnValue('2025-05-11')
    fireEvent.change(editor, { target: { value: 'New day text.' } })
    await waitFor(() => expect(patchBodies).toHaveLength(1))
    expect(patchBodies[0].date).toBe('2025-05-11')
    expect(JSON.stringify(patchBodies[0].rich_content)).toContain('New day text.')
    expect(screen.getByText(/could not be kept on this device/)).toBeInTheDocument()
  })

  it('keeps a newer rollover edit after the first save completes and the tab reloads', async () => {
    getTodayInTorontoMock.mockReturnValue('2025-05-06')
    const firstSave = deferred<any>()
    const patchBodies: any[] = []
    let savedEntries: Entry[] = []
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/student/entries?')) return mockJson({ entries: savedEntries })
      if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
      if (url === '/api/student/entries' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        patchBodies.push(body)
        return patchBodies.length === 1
          ? firstSave.promise
          : mockJson({ entry: { ...savedEntries[0], text: 'AB', rich_content: body.rich_content, version: 2 } })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const view = render(<StudentTodayTab classroom={classroom} />)
    const editor = await screen.findByLabelText('Daily Log')
    getTodayInTorontoMock.mockReturnValue('2025-05-11')
    fireEvent.change(editor, { target: { value: 'A' } })
    await waitFor(() => expect(patchBodies).toHaveLength(1))
    fireEvent.change(screen.getByLabelText('Daily Log'), { target: { value: 'AB' } })
    expect(window.localStorage.getItem('daily-log-draft:v2:s1:c1:2025-05-11')).toContain('AB')

    savedEntries = [{ ...entries[0], id: 'new-day-entry', date: '2025-05-11', text: 'A', rich_content: patchBodies[0].rich_content }]
    firstSave.resolve(await mockJson({ entry: savedEntries[0] }))
    await waitFor(() => expect(screen.getByText('Unsaved')).toBeInTheDocument())
    view.rerender(<StudentTodayTab classroom={classroom} onLessonPlanLoad={() => undefined} />)

    await waitFor(() => expect(screen.getByLabelText('Daily Log')).toHaveValue('AB'))
    await waitFor(() => expect(
      window.localStorage.getItem('daily-log-draft:v2:s1:c1:2025-05-11')?.includes('AB') ||
      patchBodies.slice(1).some(body => JSON.stringify(body).includes('AB')),
    ).toBe(true))
  })

  it('does not overwrite another device’s new-day log when rollover storage fails', async () => {
    getTodayInTorontoMock.mockReturnValue('2025-05-06')
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (this === window.localStorage && key.startsWith('daily-log-draft:v2:')) throw new Error('Storage blocked')
      return originalSetItem.call(this, key, value)
    })
    const newDayEntry = { ...entries[0], id: 'other-device-entry', date: '2025-05-11', text: 'Already saved elsewhere.', version: 3 }
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith('/api/student/entries?')) return mockJson({ entries: [newDayEntry] })
      if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
      throw new Error(`Unexpected save: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)
    const editor = await screen.findByLabelText('Daily Log')
    getTodayInTorontoMock.mockReturnValue('2025-05-11')
    fireEvent.change(editor, { target: { value: 'My new-day draft.' } })

    expect(await screen.findByRole('button', { name: 'Reload latest' })).toBeInTheDocument()
    expect(screen.getByLabelText('Daily Log')).toHaveValue('My new-day draft.')
    expect(screen.getByText(/changed elsewhere/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([input]) => String(input) === '/api/student/entries')).toBe(false)
  })

  it('moves the previous log into history at Toronto midnight and opens a clean new day', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-12-17T04:59:59.900Z'))
    getTodayInTorontoMock.mockImplementation(() => (
      Date.now() < new Date('2025-12-17T05:00:00.000Z').getTime()
        ? '2025-12-16'
        : '2025-12-17'
    ))
    classDaysContextMock.classDays = [
      { id: 'new-today', classroom_id: 'c1', date: '2025-12-17', prompt_text: null, is_class_day: true },
      ...defaultClassDays,
    ]
    const fetchMock = vi.fn((input: RequestInfo, _init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) {
        return mockJson({ entries })
      }
      if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByLabelText('Daily Log')).toHaveValue(entries[0].text)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    expect(screen.getByLabelText('Daily Log')).toHaveValue('')
    expect(screen.getByText(entries[0].text)).toBeInTheDocument()
    expect(screen.getByText('Tue Dec 16')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([input, init]) => (
      String(input) === '/api/student/entries' && init?.method === 'PATCH'
    ))).toBe(false)
  })

  it('invalidates entry caches and clears session history on partial save conflict', async () => {
    const cacheKey = getStudentEntryHistoryCacheKey({ classroomId: classroom.id, limit: 11 })
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
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) {
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

    const editor = await screen.findByLabelText('Daily Log')
    fireEvent.change(editor, { target: { value: 'Local draft.' } })
    fireEvent.blur(editor)

    await waitFor(() => {
      expect(screen.getByText('Entry updated elsewhere')).toBeInTheDocument()
    })

    expect(invalidateStudentEntriesForClassroomMock).toHaveBeenCalledWith(classroom.id)
    expect(window.sessionStorage.getItem(cacheKey)).toBeNull()
  })

  it('does not report saved when an older save finishes after a newer edit', async () => {
    const saveRequest = deferred<any>()
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) {
        return mockJson({ entries: [] })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lesson_plans: [] })
      }
      if (url === '/api/student/entries' && init?.method === 'PATCH') {
        return saveRequest.promise
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)

    const editor = await screen.findByLabelText('Daily Log')
    fireEvent.change(editor, { target: { value: 'Older save content.' } })
    fireEvent.blur(editor)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/student/entries',
        expect.objectContaining({ method: 'PATCH' })
      )
    })

    fireEvent.change(editor, { target: { value: 'Newer unsaved content.' } })

    saveRequest.resolve(await mockJson({
      entry: {
        id: 'entry-stale',
        student_id: 's1',
        classroom_id: classroom.id,
        date: '2025-12-16',
        text: 'Older save content.',
        rich_content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Older save content.' }] }],
        },
        version: 1,
        minutes_reported: null,
        mood: null,
        created_at: '2025-12-16T14:00:00Z',
        updated_at: '2025-12-16T14:00:00Z',
        on_time: true,
      },
    }))

    await waitFor(() => {
      expect(screen.getByText('Unsaved')).toBeInTheDocument()
    })
    expect(editor).toHaveValue('Newer unsaved content.')
  })

  it('uses a stale completed save as the base version for the next daily log save', async () => {
    const firstSaveRequest = deferred<any>()
    const patchBodies: any[] = []
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) {
        return mockJson({ entries: [entries[0]] })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lesson_plans: [] })
      }
      if (url === '/api/student/entries' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        patchBodies.push(body)
        if (patchBodies.length === 1) {
          return firstSaveRequest.promise
        }
        return mockJson({
          entry: {
            ...entries[0],
            text: 'Second visible draft.',
            rich_content: {
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second visible draft.' }] }],
            },
            version: 3,
          },
        })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)

    const editor = await screen.findByLabelText('Daily Log')
    fireEvent.change(editor, { target: { value: 'First in-flight draft.' } })
    fireEvent.blur(editor)

    await waitFor(() => {
      expect(patchBodies).toHaveLength(1)
    })

    fireEvent.change(editor, { target: { value: 'Second visible draft.' } })
    firstSaveRequest.resolve(await mockJson({
      entry: {
        ...entries[0],
        text: 'First in-flight draft.',
        rich_content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First in-flight draft.' }] }],
        },
        version: 2,
      },
    }))

    await waitFor(() => {
      expect(screen.getByText('Unsaved')).toBeInTheDocument()
    })

    fireEvent.blur(editor)

    await waitFor(() => {
      expect(patchBodies).toHaveLength(2)
    })
    expect(patchBodies[1].version).toBe(2)
  })

  it('clears the saved draft and refreshes only its classroom after confirmed Pal delivery', async () => {
    const draftKey = 'daily-log-draft:v2:s1:c1:2025-12-16'
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) {
        return mockJson({ entries: [] })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lesson_plans: [] })
      }
      if (url === '/api/student/entries' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        return mockJson({
          entry: {
            id: 'entry-saved',
            student_id: 's1',
            classroom_id: classroom.id,
            date: '2025-12-16',
            text: 'Draft that should clear.',
            rich_content: body.rich_content,
            version: 1,
            minutes_reported: null,
            mood: null,
            created_at: '2025-12-16T14:00:00Z',
            updated_at: '2025-12-16T14:00:00Z',
            on_time: true,
          },
          pal_delivery: 'delivered',
        })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)

    const editor = await screen.findByLabelText('Daily Log')
    fireEvent.change(editor, { target: { value: 'Draft that should clear.' } })

    expect(window.localStorage.getItem(draftKey)).toContain('Draft that should clear.')

    fireEvent.blur(editor)

    await waitFor(() => {
      expect(screen.getByText('Saved')).toBeInTheDocument()
    })
    expect(window.localStorage.getItem(draftKey)).toBeNull()
    expect(notifyImmediatePalDeliveryMock).toHaveBeenCalledWith('delivered', classroom.id)
  })

  it('redirects to login when saving fails because the session expired', async () => {
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) {
        return mockJson({ entries: [] })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lesson_plans: [] })
      }
      if (url === '/api/student/entries' && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: 'Unauthorized' }),
        }) as any
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)

    const editor = await screen.findByLabelText('Daily Log')
    fireEvent.change(editor, { target: { value: 'Needs a valid session.' } })
    fireEvent.blur(editor)

    expect(await screen.findByText('Your session expired. Please log in again before continuing.')).toBeInTheDocument()
    expect(redirectToLoginForReauthMock).toHaveBeenCalled()
  })

  it('keeps an authorization save failure in place without claiming the session expired', async () => {
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) {
        return mockJson({ entries: [] })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lesson_plans: [] })
      }
      if (url === '/api/student/entries' && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: false,
          status: 403,
          json: () => Promise.resolve({ error: 'You no longer have access to this classroom' }),
        }) as any
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)

    const editor = await screen.findByLabelText('Daily Log')
    fireEvent.change(editor, { target: { value: 'Keep this local draft.' } })
    fireEvent.blur(editor)

    expect(await screen.findByText('You no longer have access to this classroom')).toBeInTheDocument()
    expect(redirectToLoginForReauthMock).not.toHaveBeenCalled()
  })

  it('restores an unsaved daily log draft after an expired-session redirect remount', async () => {
    const draftKey = getDailyLogDraftKey(classroom.id, '2025-12-16')
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) {
        return mockJson({ entries: [] })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lesson_plans: [] })
      }
      if (url === '/api/student/entries' && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: 'Unauthorized' }),
        }) as any
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const firstRender = render(<StudentTodayTab classroom={classroom} />)

    const firstEditor = await screen.findByLabelText('Daily Log')
    fireEvent.change(firstEditor, { target: { value: 'Recovered after login.' } })
    fireEvent.blur(firstEditor)

    await waitFor(() => {
      expect(redirectToLoginForReauthMock).toHaveBeenCalled()
    })
    expect(window.sessionStorage.getItem(draftKey)).toContain('Recovered after login.')

    firstRender.unmount()
    render(<StudentTodayTab classroom={classroom} />)

    const restoredEditor = await screen.findByLabelText('Daily Log')
    expect(restoredEditor).toHaveValue('Recovered after login.')
    expect(screen.getByText('Unsaved')).toBeInTheDocument()
  })

  it('autosaves a restored daily log draft after the page reloads with an active session', async () => {
    const draftKey = 'daily-log-draft:v2:s1:c1:2025-12-16'
    window.localStorage.setItem(
      draftKey,
      JSON.stringify({
        studentId: 's1', classroomId: 'c1', date: '2025-12-16', entryId: null, version: 1, updatedAt: '2025-12-16T14:00:00Z',
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Autosave after login.' }] }] },
      })
    )
    const saveRequest = deferred<any>()
    const patchBodies: any[] = []
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) {
        return mockJson({ entries: [] })
      }
      if (url.includes('/lesson-plans')) {
        return mockJson({ lesson_plans: [] })
      }
      if (url === '/api/student/entries' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        patchBodies.push(body)
        return saveRequest.promise
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)

    const editor = await screen.findByLabelText('Daily Log')
    expect(editor).toHaveValue('Autosave after login.')

    await waitFor(() => {
      expect(patchBodies).toHaveLength(1)
    })

    saveRequest.resolve(await mockJson({
      entry: {
        id: 'entry-restored-save',
        student_id: 's1',
        classroom_id: classroom.id,
        date: '2025-12-16',
        text: 'Autosave after login.',
        rich_content: patchBodies[0].rich_content,
        version: 1,
        minutes_reported: null,
        mood: null,
        created_at: '2025-12-16T14:00:00Z',
        updated_at: '2025-12-16T14:00:00Z',
        on_time: true,
      },
    }))

    await waitFor(() => {
      expect(screen.getByText('Saved')).toBeInTheDocument()
    })
    expect(window.localStorage.getItem(draftKey)).toBeNull()
  })

  it('starts the first nonblank save without waiting for blur or the debounce timer', async () => {
    const saveRequest = deferred<any>()
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) return mockJson({ entries: [] })
      if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
      if (url === '/api/student/entries' && init?.method === 'PATCH') return saveRequest.promise
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)
    const editor = await screen.findByLabelText('Daily Log')
    fireEvent.change(editor, { target: { value: 'Here for class.' } })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/student/entries', expect.objectContaining({ method: 'PATCH' }),
    ))
    const request = fetchMock.mock.calls.find(([input]) => String(input) === '/api/student/entries')
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({ date: '2025-12-16' })
    expect(window.localStorage.getItem('daily-log-draft:v2:s1:c1:2025-12-16')).toContain('Here for class.')
    expect(screen.getByText('Saving…')).toBeInTheDocument()
  })

  it('recovers and sends an unsent prior-day log under its original date', async () => {
    window.localStorage.setItem('daily-log-draft:v2:s1:c1:2025-12-15', JSON.stringify({
      studentId: 's1', classroomId: 'c1', date: '2025-12-15',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Yesterday in class.' }] }] },
      entryId: null, version: 1, updatedAt: '2025-12-15T15:00:00Z',
    }))
    const savedBodies: any[] = []
    const recoverySave = deferred<any>()
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) return mockJson({ entries: [] })
      if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
      if (url === '/api/student/entries' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        savedBodies.push(body)
        return recoverySave.promise
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)
    expect(await screen.findByText('Unsent Daily Log from Mon Dec 15')).toBeInTheDocument()
    await waitFor(() => expect(savedBodies).toHaveLength(1))
    expect(savedBodies[0].date).toBe('2025-12-15')
    recoverySave.resolve(await mockJson({ entry: {
      ...entries[0], id: 'recovered-older-log', date: '2025-12-15',
      text: 'Yesterday in class.', rich_content: savedBodies[0].rich_content, version: 1,
    } }))
    await waitFor(() => expect(window.localStorage.getItem('daily-log-draft:v2:s1:c1:2025-12-15')).toBeNull())
    expect(screen.getByLabelText('Daily Log')).toHaveValue('')
  })

  it('waits for the first save before sending a newer edit', async () => {
    const firstSave = deferred<any>()
    const requests: any[] = []
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) return mockJson({ entries: [] })
      if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
      if (url === '/api/student/entries' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        requests.push(body)
        if (requests.length === 1) return firstSave.promise
        return mockJson({ entry: { ...entries[0], id: 'serialized-log', text: 'Second edit.', rich_content: body.rich_content, version: 2 } })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)
    const editor = await screen.findByLabelText('Daily Log')
    fireEvent.change(editor, { target: { value: 'First edit.' } })
    await waitFor(() => expect(requests).toHaveLength(1))
    fireEvent.change(editor, { target: { value: 'Second edit.' } })
    fireEvent.blur(editor)
    expect(requests).toHaveLength(1)

    firstSave.resolve(await mockJson({ entry: {
      ...entries[0], id: 'serialized-log', text: 'First edit.',
      rich_content: requests[0].rich_content, version: 1,
    } }))
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]).toMatchObject({ entry_id: 'serialized-log', version: 1 })
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument())
  })

  it('sends a clearing edit after an in-flight first save instead of leaving attendance content behind', async () => {
    const firstSave = deferred<any>()
    const requests: any[] = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) return mockJson({ entries: [] })
      if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
      if (url === '/api/student/entries' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        requests.push(body)
        if (requests.length === 1) return firstSave.promise
        return mockJson({ entry: { ...entries[0], id: 'cleared-log', text: '', rich_content: body.rich_content, version: 2 } })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    }))

    render(<StudentTodayTab classroom={classroom} />)
    const editor = await screen.findByLabelText('Daily Log')
    fireEvent.change(editor, { target: { value: 'A' } })
    await waitFor(() => expect(requests).toHaveLength(1))
    fireEvent.change(editor, { target: { value: '' } })
    fireEvent.blur(editor)
    expect(screen.getByText('Unsaved')).toBeInTheDocument()
    expect(requests).toHaveLength(1)

    firstSave.resolve(await mockJson({ entry: {
      ...entries[0], id: 'cleared-log', text: 'A', rich_content: requests[0].rich_content, version: 1,
    } }))
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]).toMatchObject({ entry_id: 'cleared-log', version: 1, rich_content: { type: 'doc', content: [] } })
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument())
  })

  it('attempts a keepalive save on page exit while retaining the recovery draft', async () => {
    const saveRequest = deferred<any>()
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith(`/api/student/entries?classroom_id=${classroom.id}`)) return mockJson({ entries: [] })
      if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
      if (url === '/api/student/entries' && init?.method === 'PATCH') return saveRequest.promise
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)
    const editor = await screen.findByLabelText('Daily Log')
    fireEvent.change(editor, { target: { value: 'Before leaving.' } })
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/api/student/entries')).toHaveLength(1))
    fireEvent(window, new Event('pagehide'))

    expect(fetchMock).toHaveBeenCalledWith('/api/student/entries', expect.objectContaining({ keepalive: true }))
    expect(window.localStorage.getItem('daily-log-draft:v2:s1:c1:2025-12-16')).toContain('Before leaving.')
  })

  it('does not restore another student’s unscoped legacy draft in a shared tab', async () => {
    window.sessionStorage.setItem(getDailyLogDraftKey('c1', '2025-12-16'), JSON.stringify({
      type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Student A private draft.' }] }],
    }))
    window.localStorage.setItem('daily-log-draft:v2:s1:c1:2025-12-16', JSON.stringify({
      studentId: 's1', classroomId: 'c1', date: '2025-12-16', entryId: null, version: 1,
      updatedAt: '2025-12-16T14:00:00Z',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Student A durable draft.' }] }] },
    }))
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith('/api/student/entries?')) return mockJson({ entries: [] })
      if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
      throw new Error(`Unexpected save: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTabComponent classroom={classroom} studentId="s2" />)
    expect(await screen.findByLabelText('Daily Log')).toHaveValue('')
    expect(screen.queryByText(/Student A private draft/)).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([input]) => String(input) === '/api/student/entries')).toBe(false)
  })

  it('does not resend a rejected draft after Reload latest and page exit', async () => {
    window.localStorage.setItem('daily-log-draft:v2:s1:c1:2025-12-16', JSON.stringify({
      studentId: 's1', classroomId: 'c1', date: '2025-12-16', entryId: 'e1', version: 1,
      updatedAt: '2025-12-16T14:00:00Z',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rejected draft.' }] }] },
    }))
    const newerEntry = { ...entries[0], version: 2, text: 'Newer saved log.' }
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith('/api/student/entries?')) return mockJson({ entries: [newerEntry] })
      if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
      throw new Error(`Unexpected save: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reload latest' }))
    expect(screen.getByLabelText('Daily Log')).toHaveValue('Newer saved log.')
    fireEvent(window, new Event('pagehide'))
    expect(fetchMock.mock.calls.some(([input]) => String(input) === '/api/student/entries')).toBe(false)
    expect(window.localStorage.getItem('daily-log-draft:v2:s1:c1:2025-12-16')).toBeNull()
  })

  it('never submits an empty unsent prior-day draft as a new entry', async () => {
    window.localStorage.setItem('daily-log-draft:v2:s1:c1:2025-12-15', JSON.stringify({
      studentId: 's1', classroomId: 'c1', date: '2025-12-15', entryId: null, version: 1,
      updatedAt: '2025-12-15T14:00:00Z', content: { type: 'doc', content: [] },
    }))
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith('/api/student/entries?')) return mockJson({ entries: [] })
      if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
      throw new Error(`Unexpected save: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)
    await screen.findByLabelText('Daily Log')
    await waitFor(() => expect(window.localStorage.getItem('daily-log-draft:v2:s1:c1:2025-12-15')).toBeNull())
    expect(fetchMock.mock.calls.some(([input]) => String(input) === '/api/student/entries')).toBe(false)
  })

  it('restores a blank edit when it differs from an existing saved log', async () => {
    window.localStorage.setItem('daily-log-draft:v2:s1:c1:2025-12-16', JSON.stringify({
      studentId: 's1', classroomId: 'c1', date: '2025-12-16', entryId: 'e1', version: 1,
      updatedAt: '2025-12-16T14:00:00Z', content: { type: 'doc', content: [] },
    }))
    const saveRequest = deferred<any>()
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/student/entries?')) return mockJson({ entries: [entries[0]] })
      if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
      if (url === '/api/student/entries' && init?.method === 'PATCH') return saveRequest.promise
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)
    expect(await screen.findByLabelText('Daily Log')).toHaveValue('')
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input) === '/api/student/entries')).toBe(true))
    expect(window.localStorage.getItem('daily-log-draft:v2:s1:c1:2025-12-16')).toContain('"content":[]')
  })

  it('does not let a stalled older recovery delay today’s first save', async () => {
    window.localStorage.setItem('daily-log-draft:v2:s1:c1:2025-12-15', JSON.stringify({
      studentId: 's1', classroomId: 'c1', date: '2025-12-15', entryId: null, version: 1,
      updatedAt: '2025-12-15T14:00:00Z',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Yesterday.' }] }] },
    }))
    const olderSave = deferred<any>()
    const requests: any[] = []
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/student/entries?')) return mockJson({ entries: [] })
      if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
      if (url === '/api/student/entries' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        requests.push(body)
        return body.date === '2025-12-15' ? olderSave.promise : mockJson({ entry: { ...entries[0], text: 'Today.', rich_content: body.rich_content } })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)
    const editor = await screen.findByLabelText('Daily Log')
    await waitFor(() => expect(requests.some(body => body.date === '2025-12-15')).toBe(true))
    fireEvent.change(editor, { target: { value: 'Today.' } })
    await waitFor(() => expect(requests.some(body => body.date === '2025-12-16')).toBe(true))
  })

  it('keeps queued saves bound to their classroom when switching on the same date', async () => {
    const firstSave = deferred<any>()
    const requests: any[] = []
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/student/entries?')) return mockJson({ entries: [] })
      if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
      if (url === '/api/student/entries' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        requests.push(body)
        if (body.classroom_id === 'c1' && requests.length === 1) return firstSave.promise
        return mockJson({ entry: { ...entries[0], id: `${body.classroom_id}-entry`, classroom_id: body.classroom_id, text: body.classroom_id === 'c1' ? 'A second edit.' : 'B text.', rich_content: body.rich_content, version: 2 } })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const view = render(<StudentTodayTab classroom={classroom} />)
    const editor = await screen.findByLabelText('Daily Log')
    fireEvent.change(editor, { target: { value: 'A first edit.' } })
    await waitFor(() => expect(requests).toHaveLength(1))
    fireEvent.change(editor, { target: { value: 'A second edit.' } })
    fireEvent.blur(editor)

    view.rerender(<StudentTodayTab classroom={secondClassroom} />)
    await waitFor(() => expect(screen.getByLabelText('Daily Log')).toHaveValue(''))
    fireEvent.change(screen.getByLabelText('Daily Log'), { target: { value: 'B text.' } })
    await waitFor(() => expect(requests.some(body => body.classroom_id === 'c2')).toBe(true))

    firstSave.resolve(await mockJson({ entry: { ...entries[0], text: 'A first edit.', rich_content: requests[0].rich_content, version: 1 } }))
    await waitFor(() => expect(requests.filter(body => body.classroom_id === 'c1')).toHaveLength(2))
    const secondA = requests.filter(body => body.classroom_id === 'c1')[1]
    expect(JSON.stringify(secondA.rich_content)).toContain('A second edit.')
    expect(JSON.stringify(secondA.rich_content)).not.toContain('B text.')
  })

  it('reconciles a blank old draft with a first save whose response was lost', async () => {
    window.localStorage.setItem('daily-log-draft:v2:s1:c1:2025-12-15', JSON.stringify({
      studentId: 's1', classroomId: 'c1', date: '2025-12-15', entryId: null, version: 1,
      updatedAt: '2025-12-15T14:00:00Z', content: { type: 'doc', content: [] },
    }))
    let getCount = 0
    const patchBodies: any[] = []
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/student/entries?')) {
        getCount += 1
        return mockJson({ entries: getCount === 1 ? [] : [entries[1]] })
      }
      if (url.includes('/lesson-plans')) return mockJson({ lesson_plans: [] })
      if (url === '/api/student/entries' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        patchBodies.push(body)
        return mockJson({ entry: { ...entries[1], text: '', rich_content: body.rich_content, version: 2 } })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentTodayTab classroom={classroom} />)
    await screen.findByLabelText('Daily Log')
    await waitFor(() => expect(patchBodies).toHaveLength(1))
    expect(patchBodies[0]).toMatchObject({ classroom_id: 'c1', date: '2025-12-15', entry_id: 'e2' })
    expect(patchBodies[0].rich_content).toEqual({ type: 'doc', content: [] })
  })
})
