import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/student/quizzes/[id]/focus-events/route'
import { mockAuthenticationError, mockAuthorizationError } from '../setup'

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({
    id: 'student-1',
    email: 'student1@example.com',
    role: 'student',
  })),
}))

describe('POST /api/student/quizzes/[id]/focus-events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    ;(requireRole as any).mockRejectedValueOnce(mockAuthenticationError())

    const response = await POST(
      new NextRequest('http://localhost:3000/api/student/quizzes/quiz-1/focus-events', { method: 'POST' }),
      { params: Promise.resolve({ id: 'quiz-1' }) }
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 when the current user is not a student', async () => {
    const { requireRole } = await import('@/lib/auth')
    ;(requireRole as any).mockRejectedValueOnce(mockAuthorizationError())

    const response = await POST(
      new NextRequest('http://localhost:3000/api/student/quizzes/quiz-1/focus-events', { method: 'POST' }),
      { params: Promise.resolve({ id: 'quiz-1' }) }
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('returns the tests-only error for authenticated students', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/student/quizzes/quiz-1/focus-events', { method: 'POST' }),
      { params: Promise.resolve({ id: 'quiz-1' }) }
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Focus telemetry is only available for tests',
    })
  })

  it('returns 500 on unexpected errors', async () => {
    const { requireRole } = await import('@/lib/auth')
    ;(requireRole as any).mockRejectedValueOnce(new Error('boom'))

    const response = await POST(
      new NextRequest('http://localhost:3000/api/student/quizzes/quiz-1/focus-events', { method: 'POST' }),
      { params: Promise.resolve({ id: 'quiz-1' }) }
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' })
  })
})
