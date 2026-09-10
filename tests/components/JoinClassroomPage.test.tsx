import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import JoinClassroomPage from '@/app/join/[code]/page'
import { invalidateStudentClassrooms } from '@/lib/student-classrooms-client'

const push = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useParams: () => ({ code: 'ABC123' }),
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

  it('returns a signed-out student to the exact classroom join route', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
      jsonResponse({ error: 'Unauthorized' }, false, 401),
    )) as any)
    render(<JoinClassroomPage />)
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/login?next=%2Fjoin%2FABC123')
    })
  })
})
