import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ClassDaysProvider,
  useClassDays,
  useClassDaysContext,
} from '@/contexts/ClassDaysContext'
import { CLASS_DAYS_UPDATED_EVENT } from '@/lib/events'
import { invalidateCachedJSON } from '@/lib/request-cache'
import type { ClassDay } from '@/types'

function classDay(date: string, isClassDay = true): ClassDay {
  return {
    date,
    is_class_day: isClassDay,
    prompt_text: null,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function ContextProbe({ label = 'probe' }: { label?: string }) {
  const { classDays, isLoading, refresh } = useClassDaysContext()
  return (
    <div>
      <div data-testid={`${label}-loading`}>{String(isLoading)}</div>
      <div data-testid={`${label}-dates`}>{classDays.map((day) => day.date).join(',')}</div>
      <button type="button" onClick={() => void refresh()}>
        Refresh {label}
      </button>
    </div>
  )
}

function ClassDaysProbe({ classroomId }: { classroomId: string }) {
  const classDays = useClassDays(classroomId)
  return <div data-testid="class-days-hook">{classDays.map((day) => day.date).join(',')}</div>
}

describe('ClassDaysProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    invalidateCachedJSON('class-days:classroom-1')
    invalidateCachedJSON('class-days:classroom-2')
  })

  afterEach(() => {
    invalidateCachedJSON('class-days:classroom-1')
    invalidateCachedJSON('class-days:classroom-2')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('deduplicates concurrent provider loads through the shared request cache', async () => {
    const load = deferred<{ class_days: ClassDay[] }>()
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockReturnValueOnce(
      Promise.resolve({
        ok: true,
        json: () => load.promise,
      } as Response),
    )

    render(
      <>
        <ClassDaysProvider classroomId="classroom-1">
          <ContextProbe label="first" />
        </ClassDaysProvider>
        <ClassDaysProvider classroomId="classroom-1">
          <ContextProbe label="second" />
        </ClassDaysProvider>
      </>,
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/classrooms/classroom-1/class-days')

    await act(async () => {
      load.resolve({ class_days: [classDay('2026-05-01')] })
    })

    await waitFor(() => {
      expect(screen.getByTestId('first-loading')).toHaveTextContent('false')
      expect(screen.getByTestId('second-loading')).toHaveTextContent('false')
    })
    expect(screen.getByTestId('first-dates')).toHaveTextContent('2026-05-01')
    expect(screen.getByTestId('second-dates')).toHaveTextContent('2026-05-01')
  })

  it('forces a fresh load when refresh is called', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ class_days: [classDay('2026-05-01')] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ class_days: [classDay('2026-05-02')] }),
      } as Response)

    render(
      <ClassDaysProvider classroomId="classroom-1">
        <ContextProbe />
      </ClassDaysProvider>,
    )

    await screen.findByText('2026-05-01')

    await act(async () => {
      screen.getByRole('button', { name: 'Refresh probe' }).click()
    })

    await screen.findByText('2026-05-02')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('ignores stale class-days responses that resolve after a forced refresh', async () => {
    const initialLoad = deferred<{ class_days: ClassDay[] }>()
    const refreshLoad = deferred<{ class_days: ClassDay[] }>()
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockReturnValueOnce(
        Promise.resolve({
          ok: true,
          json: () => initialLoad.promise,
        } as Response),
      )
      .mockReturnValueOnce(
        Promise.resolve({
          ok: true,
          json: () => refreshLoad.promise,
        } as Response),
      )

    render(
      <ClassDaysProvider classroomId="classroom-1">
        <ContextProbe />
      </ClassDaysProvider>,
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      screen.getByRole('button', { name: 'Refresh probe' }).click()
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      refreshLoad.resolve({ class_days: [classDay('2026-05-02')] })
    })

    await screen.findByText('2026-05-02')

    await act(async () => {
      initialLoad.resolve({ class_days: [classDay('2026-05-01')] })
    })

    expect(screen.getByTestId('probe-dates')).toHaveTextContent('2026-05-02')
  })

  it('invalidates cached class days before handling a matching update event', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ class_days: [classDay('2026-05-01')] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ class_days: [classDay('2026-05-03')] }),
      } as Response)

    render(
      <ClassDaysProvider classroomId="classroom-1">
        <ContextProbe />
      </ClassDaysProvider>,
    )

    await screen.findByText('2026-05-01')

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(CLASS_DAYS_UPDATED_EVENT, { detail: { classroomId: 'classroom-2' } }),
      )
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(CLASS_DAYS_UPDATED_EVENT, { detail: { classroomId: 'classroom-1' } }),
      )
    })

    await screen.findByText('2026-05-03')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('lets useClassDays read provider state without a second request', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ class_days: [classDay('2026-05-01')] }),
    } as Response)

    render(
      <ClassDaysProvider classroomId="classroom-1">
        <ClassDaysProbe classroomId="classroom-1" />
      </ClassDaysProvider>,
    )

    await screen.findByText('2026-05-01')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not cache failed class-days responses', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Class days unavailable' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ class_days: [classDay('2026-05-04')] }),
      } as Response)

    render(
      <ClassDaysProvider classroomId="classroom-1">
        <ContextProbe />
      </ClassDaysProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('probe-loading')).toHaveTextContent('false')
    })
    expect(screen.getByTestId('probe-dates')).toHaveTextContent('')

    await act(async () => {
      screen.getByRole('button', { name: 'Refresh probe' }).click()
    })

    await screen.findByText('2026-05-04')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(consoleError).toHaveBeenCalledWith('Error loading class days:', expect.any(Error))
  })
})
