import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import JoinClassroomPage from '@/app/join/[code]/page'
import { invalidateStudentClassrooms } from '@/lib/student-classrooms-client'

const push = vi.hoisted(() => vi.fn())
const navigation = vi.hoisted(() => ({ code: 'ABC123' }))

vi.mock('next/navigation', () => ({
  useParams: () => ({ code: navigation.code }),
  useRouter: () => ({ push }),
}))

vi.mock('@/components/Spinner', () => ({
  Spinner: () => <div>Loading...</div>,
}))

vi.mock('@/lib/student-classrooms-client', () => ({
  invalidateStudentClassrooms: vi.fn(),
}))

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

describe('JoinClassroomPage', () => {
  beforeEach(() => {
    navigation.code = 'ABC123'
    push.mockClear()
    vi.mocked(invalidateStudentClassrooms).mockClear()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
      jsonResponse({ classroom: { id: 'classroom-1', title: 'Biology' } })
    )) as any)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    cleanup()
  })

  it('invalidates student classroom caches after joining by link', async () => {
    render(<JoinClassroomPage />)

    await waitFor(() => {
      expect(invalidateStudentClassrooms).toHaveBeenCalledOnce()
    })
    expect(screen.getByRole('heading', { name: 'You joined this classroom' })).toBeVisible()
    expect(screen.getByText('Biology')).toBeVisible()
    expect(push).not.toHaveBeenCalled()
  })

  it('shows the idempotent already-joined state', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
      jsonResponse({
        classroom: { id: 'classroom-1', title: 'Biology' },
        alreadyEnrolled: true,
      }),
    )) as any)
    render(<JoinClassroomPage />)
    expect(await screen.findByRole('heading', { name: 'You’re already in this classroom' })).toBeVisible()
  })

  it.each([
    ['not_on_roster', 'You’re not on this class roster'],
    ['roster_ambiguous', 'We couldn’t match your school account'],
    ['roster_binding_conflict', 'We couldn’t match your school account'],
  ])('shows the %s state without an attendance action', async (code, title) => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
      jsonResponse({ code }, false, code === 'not_on_roster' ? 403 : 409),
    )) as any)
    render(<JoinClassroomPage />)
    expect(await screen.findByRole('heading', { name: title })).toBeVisible()
    expect(screen.queryByText(/attendance/i)).not.toBeInTheDocument()
  })

  it('collects a student profile when an open classroom requires one', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        code: 'profile_required',
        requiredFields: ['firstName', 'lastName'],
      }, false, 400))
      .mockResolvedValueOnce(jsonResponse({
        classroom: { id: 'classroom-1', title: 'Biology' },
      }))
    vi.stubGlobal('fetch', fetcher)
    render(<JoinClassroomPage />)

    expect(await screen.findByRole('heading', { name: 'Tell your teacher who you are' })).toBeVisible()
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ada' } })
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } })
    fireEvent.change(screen.getByLabelText('Student number or lab ID (optional)'), { target: { value: 'S-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Join classroom' }))

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetcher.mock.calls[1][1]?.body as string)).toEqual({
      classCode: 'ABC123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      studentNumber: 'S-123',
    })
    expect(await screen.findByRole('heading', { name: 'You joined this classroom' })).toBeVisible()
  })

  it('returns a signed-out student to the exact classroom join route', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
      jsonResponse({ error: 'Unauthorized' }, false, 401),
    )) as any)
    render(<JoinClassroomPage />)
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/login?next=%2Fjoin%2FABC123')
    })
  })

  it('preserves compatibility for an already-issued classroom UUID link', async () => {
    const classroomId = '33333333-3333-4333-8333-333333333333'
    navigation.code = classroomId
    const fetcher = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(jsonResponse({
      classroom: { id: classroomId, title: 'Biology' },
      alreadyEnrolled: true,
    })))
    vi.stubGlobal('fetch', fetcher as any)

    render(<JoinClassroomPage />)

    expect(await screen.findByRole('heading', { name: 'You’re already in this classroom' })).toBeVisible()
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({ classroomId })
  })

  it('submits an open-join profile through an already-issued classroom UUID link', async () => {
    const classroomId = '33333333-3333-4333-8333-333333333333'
    navigation.code = classroomId
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        code: 'profile_required',
        requiredFields: ['firstName', 'lastName'],
      }, false, 400))
      .mockResolvedValueOnce(jsonResponse({
        classroom: { id: classroomId, title: 'Biology' },
      }))
    vi.stubGlobal('fetch', fetcher)

    render(<JoinClassroomPage />)

    expect(await screen.findByRole('heading', { name: 'Tell your teacher who you are' })).toBeVisible()
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ada' } })
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } })
    fireEvent.change(screen.getByLabelText('Student number or lab ID (optional)'), { target: { value: 'S-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Join classroom' }))

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetcher.mock.calls[1][1]?.body as string)).toEqual({
      classroomId,
      firstName: 'Ada',
      lastName: 'Lovelace',
      studentNumber: 'S-123',
    })
    expect(await screen.findByRole('heading', { name: 'You joined this classroom' })).toBeVisible()
  })

  it('retains a legacy stored code exactly for the bounded server fallback', async () => {
    navigation.code = ' bio101 '
    const fetcher = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(jsonResponse({
      classroom: { id: 'classroom-1', title: 'Biology' },
    })))
    vi.stubGlobal('fetch', fetcher as any)

    render(<JoinClassroomPage />)

    expect(await screen.findByRole('heading', { name: 'You joined this classroom' })).toBeVisible()
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({ classCode: ' bio101 ' })
  })
})
