import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { StudentHistoryTab } from '@/app/classrooms/[classroomId]/StudentHistoryTab'
import { invalidateClassDaysForClassroom } from '@/lib/class-days-client'
import { invalidateStudentEntriesForClassroom } from '@/lib/student-entries-client'
import type { Classroom, Entry } from '@/types'

vi.mock('@/lib/timezone', () => ({
  getTodayInToronto: () => '2025-05-10',
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

const secondClassroom: Classroom = {
  ...classroom,
  id: 'c2',
  title: 'Second Class',
  class_code: 'DEF456',
}

const entries: Entry[] = [
  {
    id: 'entry-1',
    student_id: 'student-1',
    classroom_id: 'c1',
    date: '2025-05-09',
    text: 'Completed the lesson.',
    rich_content: null,
    version: 1,
    minutes_reported: null,
    mood: null,
    created_at: '2025-05-09T12:00:00Z',
    updated_at: '2025-05-09T12:00:00Z',
    on_time: true,
  },
]

function mockJson(data: unknown, ok = true) {
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

describe('StudentHistoryTab', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    invalidateClassDaysForClassroom(classroom.id)
    invalidateClassDaysForClassroom(secondClassroom.id)
    invalidateStudentEntriesForClassroom(classroom.id)
    invalidateStudentEntriesForClassroom(secondClassroom.id)
  })

  afterEach(() => {
    cleanup()
  })

  it('reuses cached class days and entry history across remounts', async () => {
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url === `/api/classrooms/${classroom.id}/class-days`) {
        return mockJson({
          class_days: [
            { id: 'day-1', classroom_id: 'c1', date: '2025-05-09', prompt_text: null, is_class_day: true },
            { id: 'day-2', classroom_id: 'c1', date: '2025-05-08', prompt_text: null, is_class_day: true },
            { id: 'day-3', classroom_id: 'c1', date: '2025-05-07', prompt_text: null, is_class_day: false },
          ],
        })
      }
      if (url === `/api/student/entries?classroom_id=${classroom.id}`) {
        return mockJson({ entries })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const firstRender = render(<StudentHistoryTab classroom={classroom} />)

    expect(await screen.findByText('2025-05-09')).toBeInTheDocument()
    expect(screen.getByText('2025-05-08')).toBeInTheDocument()
    expect(screen.queryByText('2025-05-07')).not.toBeInTheDocument()
    expect(screen.getByLabelText('present')).toBeInTheDocument()
    expect(screen.getByLabelText('absent')).toBeInTheDocument()

    firstRender.unmount()
    render(<StudentHistoryTab classroom={classroom} />)

    expect(await screen.findByText('2025-05-09')).toBeInTheDocument()

    const classDayFetches = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/class-days')
    )
    const entryFetches = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/api/student/entries?')
    )

    expect(classDayFetches).toHaveLength(1)
    expect(entryFetches).toHaveLength(1)
  })

  it('clears stale rows when a later classroom history load fails', async () => {
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url === `/api/classrooms/${classroom.id}/class-days`) {
        return mockJson({
          class_days: [
            { id: 'day-1', classroom_id: 'c1', date: '2025-05-09', prompt_text: null, is_class_day: true },
          ],
        })
      }
      if (url === `/api/student/entries?classroom_id=${classroom.id}`) {
        return mockJson({ entries })
      }
      if (url === `/api/classrooms/${secondClassroom.id}/class-days`) {
        return mockJson({ error: 'Forbidden' }, false)
      }
      if (url === `/api/student/entries?classroom_id=${secondClassroom.id}`) {
        return mockJson({ entries: [] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { rerender } = render(<StudentHistoryTab classroom={classroom} />)

    expect(await screen.findByText('2025-05-09')).toBeInTheDocument()

    rerender(<StudentHistoryTab classroom={secondClassroom} />)

    expect(await screen.findByText('No class days yet')).toBeInTheDocument()
    expect(screen.queryByText('2025-05-09')).not.toBeInTheDocument()
  })

  it('ignores an older classroom history request after switching classrooms', async () => {
    const firstClassDaysRequest = deferred<any>()
    const firstEntriesRequest = deferred<any>()

    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url === `/api/classrooms/${classroom.id}/class-days`) {
        return firstClassDaysRequest.promise
      }
      if (url === `/api/student/entries?classroom_id=${classroom.id}`) {
        return firstEntriesRequest.promise
      }
      if (url === `/api/classrooms/${secondClassroom.id}/class-days`) {
        return mockJson({ error: 'Forbidden' }, false)
      }
      if (url === `/api/student/entries?classroom_id=${secondClassroom.id}`) {
        return mockJson({ entries: [] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { rerender } = render(<StudentHistoryTab classroom={classroom} />)

    rerender(<StudentHistoryTab classroom={secondClassroom} />)

    expect(await screen.findByText('No class days yet')).toBeInTheDocument()

    firstClassDaysRequest.resolve(await mockJson({
      class_days: [
        { id: 'day-1', classroom_id: 'c1', date: '2025-05-09', prompt_text: null, is_class_day: true },
      ],
    }))
    firstEntriesRequest.resolve(await mockJson({ entries }))

    await waitFor(() => {
      expect(screen.queryByText('2025-05-09')).not.toBeInTheDocument()
    })
  })
})
