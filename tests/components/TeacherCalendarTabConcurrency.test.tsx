import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TeacherCalendarTab } from '@/app/classrooms/[classroomId]/TeacherCalendarTab'
import { ClassDaysProvider } from '@/contexts/ClassDaysContext'
import { invalidateClassDaysForClassroom } from '@/lib/class-days-client'
import { AppMessageProvider } from '@/ui'
import type { ClassDay } from '@/types'
import { createMockClassroom } from '../helpers/mocks'

vi.mock('@/contexts/MarkdownPreferenceContext', () => ({
  useMarkdownPreference: () => ({ showMarkdown: false, mounted: true }),
}))

vi.mock('@/lib/timezone', () => ({
  getTodayInToronto: () => '2026-09-04',
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function classDay(date: string, isClassDay: boolean): ClassDay {
  return {
    id: `class-day-${date}`,
    classroom_id: 'classroom-1',
    date,
    prompt_text: null,
    is_class_day: isClassDay,
  }
}

function response(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response
}

describe('TeacherCalendarTab concurrent class-day toggles', () => {
  const classroom = createMockClassroom({
    id: 'classroom-1',
    start_date: '2026-09-01',
    end_date: '2026-09-30',
  })
  const firstDate = '2026-09-09'
  const secondDate = '2026-09-10'
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    invalidateClassDaysForClassroom(classroom.id)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    invalidateClassDaysForClassroom(classroom.id)
    vi.unstubAllGlobals()
  })

  it('preserves another date optimistic value when the first save refreshes a stale snapshot', async () => {
    const firstSave = deferred<Response>()
    const secondSave = deferred<Response>()
    let getCount = 0

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as { date: string }
        return body.date === firstDate ? firstSave.promise : secondSave.promise
      }

      expect(url).toBe(`/api/classrooms/${classroom.id}/class-days`)
      getCount += 1
      const classDays = getCount === 1
        ? [classDay(firstDate, true), classDay(secondDate, true)]
        : getCount === 2
          ? [classDay(firstDate, false), classDay(secondDate, true)]
          : [classDay(firstDate, false), classDay(secondDate, false)]
      return Promise.resolve(response({ class_days: classDays }))
    })

    render(
      <AppMessageProvider>
        <ClassDaysProvider classroomId={classroom.id}>
          <TeacherCalendarTab classroom={classroom} />
        </ClassDaysProvider>
      </AppMessageProvider>,
    )

    const firstDayButton = await screen.findByRole('button', { name: '9' })
    const secondDayButton = screen.getByRole('button', { name: '10' })

    fireEvent.click(firstDayButton)
    fireEvent.click(secondDayButton)

    expect(firstDayButton).toHaveAttribute('aria-pressed', 'false')
    expect(secondDayButton).toHaveAttribute('aria-pressed', 'false')
    expect(secondDayButton).toHaveAttribute('aria-busy', 'true')

    await act(async () => {
      firstSave.resolve(response({ class_day: classDay(firstDate, false) }))
    })

    await waitFor(() => expect(getCount).toBe(2))
    expect(secondDayButton).toHaveAttribute('aria-pressed', 'false')
    expect(secondDayButton).toHaveAttribute('aria-busy', 'true')

    await act(async () => {
      secondSave.resolve(response({ class_day: classDay(secondDate, false) }))
    })

    await waitFor(() => {
      expect(getCount).toBe(3)
      expect(secondDayButton).not.toHaveAttribute('aria-busy')
    })
    expect(firstDayButton).toHaveAttribute('aria-pressed', 'false')
    expect(secondDayButton).toHaveAttribute('aria-pressed', 'false')
  })
})
