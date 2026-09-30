import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
const todayInToronto = vi.hoisted(() => ({ date: '2026-09-04' }))

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
  getTodayInToronto: () => todayInToronto.date,
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
    todayInToronto.date = '2026-09-04'
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

  it.each([false, undefined])('allows adding today when its saved state is %s', async (savedState) => {
    if (savedState !== undefined) {
      classDaysState.classDays.push({ ...classDay, id: 'today', date: '2026-09-04', is_class_day: savedState })
    }
    const today = { ...classDay, id: 'today', date: '2026-09-04', is_class_day: true }
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ class_day: today }) })
    render(<TeacherCalendarTab classroom={classroom} />, { wrapper: Wrapper })

    const button = await screen.findByRole('button', { name: '4', exact: true })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ date: today.date, is_class_day: true })
    await waitFor(() => {
      expect(button).toHaveAttribute('aria-pressed', 'true')
      expect(button).not.toHaveAttribute('aria-busy')
    })
  })

  it('keeps today unchanged when its exclusion warning is cancelled or escaped', async () => {
    const user = userEvent.setup()
    classDaysState.classDays.push({ ...classDay, id: 'today', date: '2026-09-04' })
    render(<TeacherCalendarTab classroom={classroom} />, { wrapper: Wrapper })
    const button = await screen.findByRole('button', { name: '4', exact: true })

    await user.click(button)
    expect(screen.getByRole('dialog', { name: 'Make today a non-class day?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(fetchMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(button).toHaveFocus())

    await user.click(button)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('saves today only after confirmation and allows restoring it after the save', async () => {
    const today = { ...classDay, id: 'today', date: '2026-09-04' }
    classDaysState.classDays.push(today)
    const request = deferred<{ ok: boolean; json: () => Promise<unknown> }>()
    fetchMock.mockReturnValue(request.promise)
    render(<TeacherCalendarTab classroom={classroom} />, { wrapper: Wrapper })
    const button = await screen.findByRole('button', { name: '4', exact: true })

    fireEvent.click(button)
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Make non-class day' }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ date: today.date, is_class_day: false })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(button)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      request.resolve({ ok: true, json: async () => ({ class_day: { ...today, is_class_day: false } }) })
      await request.promise
    })
    await waitFor(() => expect(button).toBeEnabled())
    expect(invalidateClassDays).toHaveBeenCalledWith(classroom.id)
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ class_day: today }) })
    fireEvent.click(button)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'))
  })

  it('rolls today back if its confirmed exclusion fails', async () => {
    classDaysState.classDays.push({ ...classDay, id: 'today', date: '2026-09-04' })
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Could not save class day' }) })
    render(<TeacherCalendarTab classroom={classroom} />, { wrapper: Wrapper })
    const button = await screen.findByRole('button', { name: '4', exact: true })
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('button', { name: 'Make non-class day' }))
    await screen.findByText('Could not save class day')
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toBeEnabled()
    expect(invalidateClassDays).not.toHaveBeenCalled()
  })

  it('disables past dates whether they are class days or non-class days', async () => {
    classDaysState.classDays.push({ ...classDay, id: 'past', date: '2026-09-03' })
    render(<TeacherCalendarTab classroom={classroom} />, { wrapper: Wrapper })
    for (const day of ['2', '3']) {
      const button = await screen.findByRole('button', { name: day, exact: true })
      expect(button).toBeDisabled()
      fireEvent.click(button)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not submit an exclusion left open across Toronto midnight', async () => {
    classDaysState.classDays.push({ ...classDay, id: 'today', date: '2026-09-04' })
    render(<TeacherCalendarTab classroom={classroom} />, { wrapper: Wrapper })
    fireEvent.click(await screen.findByRole('button', { name: '4', exact: true }))
    todayInToronto.date = '2026-09-05'
    fireEvent.click(screen.getByRole('button', { name: 'Make non-class day' }))
    expect(screen.getByText('Cannot modify past class days')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps archived classrooms read-only, including today', async () => {
    render(<TeacherCalendarTab classroom={{ ...classroom, archived_at: '2026-09-01T12:00:00Z' }} />, { wrapper: Wrapper })
    const button = await screen.findByRole('button', { name: '4', exact: true })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
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
