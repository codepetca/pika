import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
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

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response
}

describe('JoinClassroomPage', () => {
  beforeEach(() => {
    push.mockClear()
    vi.mocked(invalidateStudentClassrooms).mockClear()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
      jsonResponse({ classroom: { id: 'classroom-1' } })
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
    expect(push).toHaveBeenCalledWith('/classrooms/classroom-1?tab=today')
  })
})
