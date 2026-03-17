import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/teacher/gradebook/quiz-overrides/route'
import { mockAuthenticationError } from '../setup'

const mockSupabaseClient = { from: vi.fn() }

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({
    id: 'teacher-1',
    email: 'teacher@example.com',
    role: 'teacher',
  })),
}))

describe('PATCH /api/teacher/gradebook/quiz-overrides', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    ;(requireRole as any).mockRejectedValueOnce(mockAuthenticationError())

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/gradebook/quiz-overrides', {
        method: 'PATCH',
        body: JSON.stringify({}),
      })
    )

    expect(response.status).toBe(401)
  })

  it('validates required ids and override bounds', async () => {
    const missing = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/gradebook/quiz-overrides', {
        method: 'PATCH',
        body: JSON.stringify({ quiz_id: 'quiz-1' }),
      })
    )
    expect(missing.status).toBe(400)

    const invalidScore = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/gradebook/quiz-overrides', {
        method: 'PATCH',
        body: JSON.stringify({
          classroom_id: 'classroom-1',
          quiz_id: 'quiz-1',
          student_id: 'student-1',
          manual_override_score: -1,
        }),
      })
    )
    expect(invalidScore.status).toBe(400)
  })

  it('saves a quiz override for an enrolled student in the teacher classroom', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'quizzes') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'quiz-1',
                  classroom_id: 'classroom-1',
                  points_possible: 10,
                  classrooms: { teacher_id: 'teacher-1' },
                },
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'classroom_enrollments') {
        const enrollmentQuery: any = {
          eq: vi.fn(() => enrollmentQuery),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'enrollment-1' }, error: null }),
        }
        return {
          select: vi.fn(() => enrollmentQuery),
        }
      }
      if (table === 'quiz_student_scores') {
        return {
          upsert: vi.fn().mockResolvedValue({ error: null }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/gradebook/quiz-overrides', {
        method: 'PATCH',
        body: JSON.stringify({
          classroom_id: 'classroom-1',
          quiz_id: 'quiz-1',
          student_id: 'student-1',
          manual_override_score: 8,
        }),
      })
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ success: true })
  })
})
