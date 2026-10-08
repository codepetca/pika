import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CalendarPage from '@/app/teacher/calendar/page'
import { AppMessageProvider, TooltipProvider } from '@/ui'
import { createMockClassroom } from '../helpers/mocks'
import { fetchJSONWithCache, invalidateCachedJSON, invalidateCachedJSONMatching } from '@/lib/request-cache'
import type { ClassDay, Classroom } from '@/types'

const push = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

vi.mock('@/components/CreateClassroomModal', () => ({
  CreateClassroomModal: ({ isOpen, onSuccess, onBlueprintCreated }: any) => {
    return isOpen ? (
      <div role="dialog">
        <button
          type="button"
          onClick={() => onSuccess(createMockClassroom({ id: 'created', title: 'Created Class' }))}
        >
          Create mocked classroom
        </button>
        <button
          type="button"
          onClick={() => {
            onBlueprintCreated(createMockClassroom({ id: 'blueprint-created', title: 'Blueprint Class' }))
          }}
        >
          Complete mocked blueprint classroom
        </button>
      </div>
    ) : null
  },
}))

vi.mock('@/components/Spinner', () => ({
  Spinner: () => <div>Loading...</div>,
}))

vi.mock('@/components/PageLayout', () => ({
  PageLayout: ({ children }: any) => <div>{children}</div>,
  PageContent: ({ children }: any) => <div>{children}</div>,
  PageActionBar: ({ primary, actions = [] }: any) => (
    <div>
      <div data-testid="calendar-action-primary">{primary}</div>
      {actions.map((action: any) => (
        <button key={action.id} type="button" onClick={action.onSelect}>
          {action.label}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('@/lib/request-cache', () => ({
  fetchJSONWithCache: vi.fn((_key: string, load: () => Promise<unknown>) => load()),
  invalidateCachedJSON: vi.fn(),
  invalidateCachedJSONMatching: vi.fn(),
  prefetchJSON: vi.fn(),
}))

vi.mock('@/lib/timezone', () => ({
  getTodayInToronto: () => '2026-06-01',
}))

function renderCalendarPage() {
  return render(
    <TooltipProvider>
      <AppMessageProvider>
        <CalendarPage />
      </AppMessageProvider>
    </TooltipProvider>,
  )
}

function waitForCalendarWizard() {
  return waitFor(
    () => {
      expect(fetchJSONWithCache).toHaveBeenCalledWith(
        'class-days:c1',
        expect.any(Function),
        20_000,
      )
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Semester 2/ })).toBeInTheDocument()
    },
    { timeout: 5_000 },
  )
}

async function generateSemester2Calendar() {
  await waitForCalendarWizard()

  await waitFor(() => {
    fireEvent.click(screen.getByRole('button', { name: /Semester 2/ }))
  }, { timeout: 5_000 })

  await waitFor(() => {
    const generateButton = screen.getByRole('button', { name: 'Generate Calendar' })
    expect(generateButton).toBeEnabled()
    fireEvent.click(generateButton)
  }, { timeout: 5_000 })
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response
}

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

function installFetchMock(options?: {
  classrooms?: Classroom[]
  classDays?: ClassDay[]
  classDaysByClassroom?: Record<string, ClassDay[] | Promise<{ class_days: ClassDay[] }>>
}) {
  const classrooms = options?.classrooms ?? [
    createMockClassroom({
      id: 'c1',
      title: 'Calendar Class',
      class_code: 'CAL01',
      start_date: '2026-06-01',
      end_date: '2026-06-30',
    }),
  ]
  const classDays = options?.classDays ?? []

  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    if (url === '/api/auth/me' && method === 'GET') {
      return Promise.resolve(jsonResponse({
        user: { id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' },
      }))
    }

    if (url === '/api/teacher/classrooms' && method === 'GET') {
      return Promise.resolve(jsonResponse({ classrooms }))
    }

    if (url === '/api/classrooms/c1/class-days' && method === 'GET') {
      const payload = options?.classDaysByClassroom?.c1 ?? classDays
      return Promise.resolve({
        ok: true,
        json: async () => Array.isArray(payload) ? { class_days: payload } : payload,
      } as Response)
    }

    if (url === '/api/classrooms/c2/class-days' && method === 'GET') {
      const payload = options?.classDaysByClassroom?.c2 ?? []
      return Promise.resolve({
        ok: true,
        json: async () => Array.isArray(payload) ? { class_days: payload } : payload,
      } as Response)
    }

    if (/^\/api\/classrooms\/[^/]+\/class-days$/.test(url) && method === 'GET') {
      return Promise.resolve(jsonResponse({ class_days: [] }))
    }

    if (url === '/api/classrooms/c1/class-days' && method === 'POST') {
      return Promise.resolve(jsonResponse({ ok: true }))
    }

    if (url === '/api/classrooms/c1/class-days' && method === 'PATCH') {
      return Promise.resolve(jsonResponse({ ok: true }))
    }

    return Promise.reject(new Error(`Unexpected fetch: ${method} ${url}`))
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('Teacher calendar page', () => {
  beforeEach(() => {
    push.mockReset()
    vi.mocked(fetchJSONWithCache).mockImplementation((_key, load) => load())
    vi.mocked(invalidateCachedJSON).mockClear()
    vi.mocked(invalidateCachedJSONMatching).mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows list failure with retry instead of the successful empty state', async () => {
    const fetchMock = installFetchMock()
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('Offline')))
    renderCalendarPage()
    expect(await screen.findByRole('heading', { name: 'Could not load classrooms' })).toBeInTheDocument()
    expect(screen.queryByText('No Classrooms Yet')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitForCalendarWizard()
  })

  it('hides another classroom snapshot on failed scope switch and retries only the selected scope', async () => {
    const failure = deferred<{ class_days: ClassDay[] }>()
    const fetchMock = installFetchMock({
      classrooms: [createMockClassroom({ id: 'c1', title: 'First Class', start_date: '2026-06-01', end_date: '2026-06-30' }),
        createMockClassroom({ id: 'c2', title: 'Second Class', start_date: '2026-06-01', end_date: '2026-06-30' })],
      classDaysByClassroom: { c1: [classDay('2026-06-08')], c2: failure.promise },
    })
    const originalFetch = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((input, init) => String(input) === '/api/classrooms/c2/class-days'
      ? failure.promise.then((body) => jsonResponse(body)) : originalFetch(input, init))
    renderCalendarPage()
    await screen.findByRole('button', { name: '8' })
    fireEvent.click(screen.getByRole('button', { name: /Second Class/ }))
    expect(screen.queryByRole('button', { name: '8' })).not.toBeInTheDocument()
    expect(screen.getByTestId('calendar-action-primary')).not.toHaveTextContent('1 class days')
    await act(async () => { failure.reject(new Error('Offline')) })
    expect(await screen.findByRole('heading', { name: 'Could not load calendar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Semester 2/ })).not.toBeInTheDocument()
    fetchMock.mockImplementation((input) => Promise.resolve(jsonResponse({ class_days: [classDay('2026-06-09')] })))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('button', { name: '9' })
    expect(fetchMock).toHaveBeenLastCalledWith('/api/classrooms/c2/class-days')
  })

  it('loads classrooms and class days through the shared request cache', async () => {
    installFetchMock()

    renderCalendarPage()

    await waitForCalendarWizard()
    expect(fetchJSONWithCache).toHaveBeenCalledWith(
      'teacher-classrooms:teacher-1:active-list',
      expect.any(Function),
      20_000,
    )
    expect(fetchJSONWithCache).toHaveBeenCalledWith(
      'class-days:c1',
      expect.any(Function),
      20_000,
    )
  })

  it.each([true, false])('opens class-day review after blank creation (empty=%s)', async (empty) => {
    installFetchMock({ classrooms: empty ? [] : undefined })
    renderCalendarPage()

    fireEvent.click(await screen.findByRole('button', { name: empty ? 'Create classroom' : '+ New' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create mocked classroom' }))

    expect(push).toHaveBeenCalledWith('/classrooms/created?tab=daily&reviewClassDays=1')
  })

  it('preserves the completed blueprint classroom when the first classroom is added', async () => {
    installFetchMock({ classrooms: [] })

    renderCalendarPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Create classroom' }))
    fireEvent.click(screen.getByRole('button', { name: 'Complete mocked blueprint classroom' }))

    expect(await screen.findAllByText('Blueprint Class')).toHaveLength(2)
    expect(push).not.toHaveBeenCalled()
  })

  it('does not expose permanent classroom deletion', async () => {
    const fetchMock = installFetchMock()

    renderCalendarPage()

    await waitForCalendarWizard()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Delete classroom')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
  })

  it('invalidates classroom and class-day reads after generating a calendar', async () => {
    const fetchMock = installFetchMock()

    renderCalendarPage()

    await generateSemester2Calendar()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/classrooms/c1/class-days',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    expect(invalidateCachedJSONMatching).toHaveBeenCalledWith('teacher-classrooms:')
    expect(invalidateCachedJSON).toHaveBeenCalledWith('class-days:c1')
  })

  it('ignores stale class-day responses after switching classrooms', async () => {
    const firstClassroom = createMockClassroom({
      id: 'c1',
      title: 'First Class',
      class_code: 'FIRST',
      start_date: '2026-06-01',
      end_date: '2026-06-30',
    })
    const secondClassroom = createMockClassroom({
      id: 'c2',
      title: 'Second Class',
      class_code: 'SECOND',
      start_date: '2026-06-01',
      end_date: '2026-06-30',
    })
    const firstLoad = deferred<{ class_days: ClassDay[] }>()
    const secondLoad = deferred<{ class_days: ClassDay[] }>()
    installFetchMock({
      classrooms: [firstClassroom, secondClassroom],
      classDaysByClassroom: {
        c1: firstLoad.promise,
        c2: secondLoad.promise,
      },
    })

    renderCalendarPage()

    fireEvent.click(await screen.findByRole('button', { name: /Second Class/ }))

    await act(async () => {
      secondLoad.resolve({ class_days: [classDay('2026-06-09')] })
    })

    await screen.findByRole('button', { name: '9' })

    await act(async () => {
      firstLoad.resolve({ class_days: [classDay('2026-06-08'), classDay('2026-06-10')] })
    })

    expect(screen.getAllByText('Second Class')).toHaveLength(2)
    const actionPrimary = screen.getByTestId('calendar-action-primary')
    expect(within(actionPrimary).getByText('Second Class')).toBeInTheDocument()
    expect(actionPrimary).toHaveTextContent('1 class days')
    expect(
      screen.queryByText((_, element) => element?.textContent?.includes('2 class days') ?? false)
    ).not.toBeInTheDocument()
  })

  it('keeps the selected classroom when an earlier calendar generation completes', async () => {
    const generated = deferred<Response>()
    const fetchMock = installFetchMock({
      classrooms: [createMockClassroom({ id: 'c1', title: 'First Class' }), createMockClassroom({ id: 'c2', title: 'Second Class' })],
      classDaysByClassroom: { c1: [], c2: [classDay('2026-06-09')] },
    })
    const originalFetch = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((input, init) => init?.method === 'POST'
      ? generated.promise : originalFetch(input, init))
    renderCalendarPage()
    await generateSemester2Calendar()
    expect(fetchMock).toHaveBeenCalledWith('/api/classrooms/c1/class-days', expect.objectContaining({
      method: 'POST', body: expect.stringContaining('"classroom_id":"c1"'),
    }))
    fireEvent.click(screen.getByRole('button', { name: /Second Class/ }))
    await screen.findByRole('button', { name: '9' })
    const listReads = fetchMock.mock.calls.filter(([input]) => input === '/api/teacher/classrooms').length
    await act(async () => { generated.resolve(jsonResponse({ ok: true })) })
    expect(screen.getByTestId('calendar-action-primary')).toHaveTextContent('Second Class')
    expect(screen.getByRole('button', { name: '9' })).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([input]) => input === '/api/teacher/classrooms')).toHaveLength(listReads)
    expect(invalidateCachedJSON).toHaveBeenCalledWith('class-days:c1')
    expect(invalidateCachedJSON).not.toHaveBeenCalledWith('class-days:c2')
  })

  it('keeps past and outside-range dates disabled while current dates retain classroom ownership', async () => {
    const fetchMock = installFetchMock({
      classrooms: [createMockClassroom({ id: 'c1', start_date: '2026-05-30', end_date: '2026-06-02' })],
      classDays: [classDay('2026-05-30'), classDay('2026-06-01'), classDay('2026-06-02', false)],
    })
    renderCalendarPage()
    const firstDays = await screen.findAllByRole('button', { name: '1' })
    expect(firstDays[0]).toBeDisabled()
    expect(firstDays[1]).toBeEnabled()
    expect(screen.getAllByRole('button', { name: '30' })[0]).toBeDisabled()
    expect(screen.getAllByRole('button', { name: '3' })[1]).toBeDisabled()
    fireEvent.click(firstDays[0])
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
    fireEvent.click(firstDays[1])
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/classrooms/c1/class-days',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ date: '2026-06-01', is_class_day: false }) })))
  })

  it('invalidates class-day reads after toggling a class day', async () => {
    const fetchMock = installFetchMock({
      classDays: [classDay('2026-06-08')],
    })

    renderCalendarPage()

    fireEvent.click(await screen.findByRole('button', { name: '8' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/classrooms/c1/class-days',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            date: '2026-06-08',
            is_class_day: false,
          }),
        }),
      )
    })
    expect(invalidateCachedJSON).toHaveBeenCalledWith('class-days:c1')
  })

  it.each(['error', 'success', 'pending'] as const)(
    'preserves B %s and recovery when an earlier A day toggle completes',
    async (state) => {
      const patched = deferred<Response>()
      const secondRead = deferred<Response>()
      let retrySecond = false
      const fetchMock = installFetchMock({
        classrooms: [
          createMockClassroom({ id: 'c1', title: 'First Class', start_date: '2026-06-01', end_date: '2026-06-30' }),
          createMockClassroom({ id: 'c2', title: 'Second Class', start_date: '2026-06-01', end_date: '2026-06-30' }),
        ],
        classDaysByClassroom: { c1: [classDay('2026-06-08')] },
      })
      const originalFetch = fetchMock.getMockImplementation()!
      fetchMock.mockImplementation((input, init) => {
        if (String(input) === '/api/classrooms/c1/class-days' && init?.method === 'PATCH') return patched.promise
        if (String(input) === '/api/classrooms/c2/class-days') {
          return retrySecond ? Promise.resolve(jsonResponse({ class_days: [classDay('2026-06-09')] })) : secondRead.promise
        }
        return originalFetch(input, init)
      })

      renderCalendarPage()
      fireEvent.click(await screen.findByRole('button', { name: '8' }))
      expect(fetchMock).toHaveBeenCalledWith('/api/classrooms/c1/class-days', expect.objectContaining({
        method: 'PATCH', body: JSON.stringify({ date: '2026-06-08', is_class_day: false }),
      }))
      fireEvent.click(screen.getByRole('button', { name: /Second Class/ }))
      expect(screen.queryByRole('button', { name: '8' })).not.toBeInTheDocument()

      if (state === 'error') {
        await act(async () => { secondRead.reject(new Error('B offline')) })
        await screen.findByRole('heading', { name: 'Could not load calendar' })
      } else if (state === 'success') {
        await act(async () => { secondRead.resolve(jsonResponse({ class_days: [classDay('2026-06-09')] })) })
        await screen.findByRole('button', { name: '9' })
      }

      await act(async () => { patched.resolve(jsonResponse({ ok: true })) })
      expect(invalidateCachedJSON).toHaveBeenCalledWith('class-days:c1')
      expect(invalidateCachedJSON).not.toHaveBeenCalledWith('class-days:c2')
      if (state === 'error') {
        expect(screen.getByRole('heading', { name: 'Could not load calendar' })).toBeInTheDocument()
        retrySecond = true
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      } else if (state === 'pending') {
        expect(screen.getByText('Loading...')).toBeInTheDocument()
        await act(async () => { secondRead.resolve(jsonResponse({ class_days: [classDay('2026-06-09')] })) })
      }
      expect(await screen.findByRole('button', { name: '9' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '9' })).toHaveClass('bg-success-bg')
      expect(screen.getByRole('button', { name: '8' })).not.toHaveClass('bg-success-bg')
      expect(screen.getByTestId('calendar-action-primary')).toHaveTextContent('Second Class')
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
      const aReads = fetchMock.mock.calls.filter(([input, init]) => String(input) === '/api/classrooms/c1/class-days' && !init?.method)
      expect(aReads).toHaveLength(1)
      expect(fetchMock).toHaveBeenLastCalledWith('/api/classrooms/c2/class-days')
    },
  )
})
