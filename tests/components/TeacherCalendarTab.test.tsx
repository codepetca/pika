import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TeacherCalendarTab } from '@/app/classrooms/[classroomId]/TeacherCalendarTab'
import { AppMessageProvider } from '@/ui'
import type { ClassDay } from '@/types'
import { createMockClassroom } from '../helpers/mocks'

const classDaysState = vi.hoisted(() => ({
  classDays: [] as ClassDay[],
  error: null as string | null,
  hasLoadedSnapshot: true,
  isLoading: false,
  refresh: vi.fn(async () => {}),
}))

const invalidateClassDays = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useClassDays', () => ({
  useClassDaysContext: () => classDaysState,
}))

vi.mock('@/contexts/MarkdownPreferenceContext', () => ({
  useMarkdownPreference: () => ({ showMarkdown: false, mounted: true }),
}))

vi.mock('@/lib/class-days-client', () => ({
  invalidateClassDaysForClassroom: invalidateClassDays,
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

function Wrapper({ children }: { children: ReactNode }) {
  return <AppMessageProvider>{children}</AppMessageProvider>
}

describe('TeacherCalendarTab class-day toggles', () => {
  const classroom = createMockClassroom({
    id: 'classroom-1',
    start_date: '2026-09-01',
    end_date: '2026-09-30',
  })
  const classDay: ClassDay = {
    id: 'class-day-9',
    classroom_id: classroom.id,
    date: '2026-09-09',
    prompt_text: null,
    is_class_day: true,
  }
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    classDaysState.classDays = [classDay]
    classDaysState.error = null
    classDaysState.isLoading = false
    classDaysState.refresh.mockClear()
    invalidateClassDays.mockClear()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('updates immediately and prevents a duplicate toggle while the save is pending', async () => {
    const request = deferred<{ ok: boolean; json: () => Promise<unknown> }>()
    fetchMock.mockReturnValue(request.promise)
    render(<TeacherCalendarTab classroom={classroom} />, { wrapper: Wrapper })

    const dayButton = await screen.findByRole('button', { name: '9' })
    expect(dayButton).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(dayButton)

    expect(dayButton).toHaveAttribute('aria-pressed', 'false')
    expect(dayButton).toHaveAttribute('aria-busy', 'true')
    expect(dayButton).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fireEvent.click(dayButton)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const requestOptions = fetchMock.mock.calls[0][1]
    expect(JSON.parse(requestOptions.body)).toEqual({
      date: '2026-09-09',
      is_class_day: false,
    })

    await act(async () => {
      request.resolve({
        ok: true,
        json: async () => ({ class_day: { ...classDay, is_class_day: false } }),
      })
      await request.promise
    })

    await waitFor(() => {
      expect(dayButton).not.toBeDisabled()
      expect(dayButton).not.toHaveAttribute('aria-busy')
    })
    expect(dayButton).toHaveAttribute('aria-pressed', 'false')
    expect(invalidateClassDays).toHaveBeenCalledWith(classroom.id)
  })

  it('rolls the toggle back and shows the server error when the save fails', async () => {
    const request = deferred<{ ok: boolean; json: () => Promise<unknown> }>()
    fetchMock.mockReturnValue(request.promise)
    render(<TeacherCalendarTab classroom={classroom} />, { wrapper: Wrapper })

    const dayButton = await screen.findByRole('button', { name: '9' })
    fireEvent.click(dayButton)
    expect(dayButton).toHaveAttribute('aria-pressed', 'false')

    await act(async () => {
      request.resolve({
        ok: false,
        json: async () => ({ error: 'Could not save class day' }),
      })
      await request.promise
    })

    await waitFor(() => {
      expect(dayButton).toHaveAttribute('aria-pressed', 'true')
      expect(dayButton).not.toBeDisabled()
    })
    expect(screen.getByText('Could not save class day')).toBeInTheDocument()
    expect(invalidateClassDays).not.toHaveBeenCalled()
  })
})
