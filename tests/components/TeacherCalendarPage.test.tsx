import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CalendarPage from '@/app/teacher/calendar/page'
import { AppMessageProvider, TooltipProvider } from '@/ui'
import { createMockClassroom } from '../helpers/mocks'
import { fetchJSONWithCache, invalidateCachedJSON, invalidateCachedJSONMatching } from '@/lib/request-cache'
import type { ClassDay, Classroom } from '@/types'

vi.mock('@/components/CreateClassroomModal', () => ({
  CreateClassroomModal: () => null,
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

vi.mock('@/lib/timezone', () => ({
  getTodayInToronto: () => '2026-06-01',
}))

vi.mock('@/lib/request-cache', () => ({
  fetchJSONWithCache: vi.fn((_key: string, load: () => Promise<unknown>) => load()),
  invalidateCachedJSON: vi.fn(),
  invalidateCachedJSONMatching: vi.fn(),
  prefetchJSON: vi.fn(),
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
    vi.mocked(fetchJSONWithCache).mockImplementation((_key, load) => load())
    vi.mocked(invalidateCachedJSON).mockClear()
    vi.mocked(invalidateCachedJSONMatching).mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads classrooms and class days through the shared request cache', async () => {
    installFetchMock()

    renderCalendarPage()

    expect(await screen.findByText('Create Calendar')).toBeInTheDocument()
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

  it('invalidates classroom and class-day reads after generating a calendar', async () => {
    const fetchMock = installFetchMock()

    renderCalendarPage()

    expect(await screen.findByText('Create Calendar')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Semester 2/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate Calendar' }))

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
})
