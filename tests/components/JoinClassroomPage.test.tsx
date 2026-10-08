import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import JoinClassroomPage from '@/app/join/[code]/page'
import { invalidateStudentClassrooms } from '@/lib/student-classrooms-client'

const push = vi.hoisted(() => vi.fn())
const navigation = vi.hoisted(() => ({ code: 'ABC123', profileRequired: false }))

vi.mock('next/navigation', () => ({
  useParams: () => ({ code: navigation.code }),
  useRouter: () => ({ push }),
  useSearchParams: () => ({
    get: (name: string) => name === 'profile' && navigation.profileRequired ? 'required' : null,
  }),
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
    navigation.profileRequired = false
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


  it('does not move focus during the initial pending request or response', async () => {
    let resolve!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done })))
    const outside = document.createElement('button')
    outside.textContent = 'Another task'
    document.body.append(outside)
    outside.focus()
    render(<JoinClassroomPage />)
    expect(screen.getByRole('region', { name: 'Join this classroom' })).toHaveAttribute('aria-busy', 'true')
    expect(outside).toHaveFocus()
    await act(async () => resolve(jsonResponse({ code: 'enrollment_closed' }, false, 403)))
    expect(outside).toHaveFocus()
    expect(screen.getByRole('region', { name: 'Join this classroom' })).not.toHaveAttribute('aria-busy')
    outside.remove()
  })

  it('keeps native retry focus in the same named region through pending, error and success', async () => {
    const pending: Array<(response: Response) => void> = []
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => pending.push(done))))
    const user = userEvent.setup()
    render(<JoinClassroomPage />)
    await act(async () => pending.shift()!(jsonResponse({ code: 'enrollment_closed' }, false, 403)))
    const region = screen.getByRole('region', { name: 'Join this classroom' })
    await user.tab()
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(region).toHaveFocus()
    expect(region).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    await act(async () => pending.shift()!(jsonResponse({ code: 'enrollment_closed' }, false, 403)))
    expect(region).toHaveFocus()
    expect(region).not.toHaveAttribute('aria-busy')
    await user.tab()
    await user.keyboard('{Enter}')
    expect(region).toHaveFocus()
    await act(async () => pending.shift()!(jsonResponse({ classroom: { id: 'classroom-1', title: 'Biology' } })))
    expect(screen.getByRole('heading', { name: 'You joined this classroom' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Join this classroom' })).toBe(region)
    expect(region).toHaveFocus()
  })

  it('does not reclaim deliberate focus movement after retry or unmount', async () => {
    const pending: Array<(response: Response) => void> = []
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => pending.push(done))))
    const outside = document.createElement('button')
    outside.textContent = 'Another task'
    document.body.append(outside)
    const { unmount } = render(<JoinClassroomPage />)
    await act(async () => pending.shift()!(jsonResponse({ code: 'enrollment_closed' }, false, 403)))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByRole('region', { name: 'Join this classroom' })).toHaveFocus()
    outside.focus()
    await act(async () => pending.shift()!(jsonResponse({ code: 'enrollment_closed' }, false, 403)))
    expect(outside).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    unmount()
    outside.focus()
    await act(async () => pending.shift()!(jsonResponse({ classroom: { id: 'classroom-1', title: 'Biology' } })))
    expect(outside).toHaveFocus()
    outside.remove()
  })

  it('exposes profile busy state and preserves input nodes, draft and caret after a failed submission', async () => {
    navigation.profileRequired = true
    let resolve!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done })))
    render(<JoinClassroomPage />)
    const first = screen.getByLabelText('First name')
    const last = screen.getByLabelText('Last name')
    const number = screen.getByLabelText('Student number or lab ID (optional)') as HTMLInputElement
    fireEvent.change(first, { target: { value: 'Ada' } })
    fireEvent.change(last, { target: { value: 'Lovelace' } })
    fireEvent.change(number, { target: { value: 'S-123' } })
    number.setSelectionRange(2, 2)
    fireEvent.click(screen.getByRole('button', { name: 'Join classroom' }))
    expect(screen.getByRole('button', { name: 'Joining…' })).toHaveAttribute('aria-busy', 'true')
    expect(first).toBeDisabled()
    expect(screen.getByRole('region', { name: 'Join this classroom' })).toHaveAttribute('aria-busy', 'true')
    await act(async () => resolve(jsonResponse({ code: 'rate_limited', retryAfterSeconds: 30 }, false, 429)))
    expect(screen.getByLabelText('First name')).toBe(first)
    expect(screen.getByLabelText('Last name')).toBe(last)
    expect(screen.getByLabelText('Student number or lab ID (optional)')).toBe(number)
    expect(first).toHaveValue('Ada')
    expect(last).toHaveValue('Lovelace')
    expect(number).toHaveValue('S-123')
    expect(number.selectionStart).toBe(2)
    expect(number.selectionEnd).toBe(2)
    expect(screen.getByRole('button', { name: 'Join classroom' })).not.toHaveAttribute('aria-busy')
    expect(screen.getByRole('region', { name: 'Join this classroom' })).not.toHaveAttribute('aria-busy')
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

  it('skips the redundant probe for a profile-required handoff and shows the retry wait', async () => {
    navigation.profileRequired = true
    const fetcher = vi.fn(() => Promise.resolve(jsonResponse({
      code: 'rate_limited',
      retryAfterSeconds: 45,
    }, false, 429)))
    vi.stubGlobal('fetch', fetcher as any)

    render(<JoinClassroomPage />)

    expect(await screen.findByRole('heading', { name: 'Tell your teacher who you are' })).toBeVisible()
    expect(fetcher).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ada' } })
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Join classroom' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Wait 45 seconds before trying again.',
    )
    expect(fetcher).toHaveBeenCalledOnce()
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
