import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/student/tests/[id]/history/route'

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => ({
    id: 'student-1',
    email: 'student1@example.com',
    role: 'student',
  })),
}))

vi.mock('@/lib/server/tests', () => ({
  assertStudentCanAccessTest: vi.fn(async () => ({
    ok: true,
    test: { id: 'test-1', classroom_id: 'classroom-1' },
  })),
  assertTeacherOwnsTest: vi.fn(async () => ({
    ok: true,
    test: { id: 'test-1', classroom_id: 'classroom-1' },
  })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/student/tests/[id]/history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty history when no attempt exists', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/tests/test-1/history'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.history).toEqual([])
    expect(data.attemptId).toBeNull()
  })

  it('requires student_id for teacher requests', async () => {
    const { requireAuth } = await import('@/lib/auth')
    ;(requireAuth as any).mockResolvedValueOnce({
      id: 'teacher-1',
      email: 'teacher@example.com',
      role: 'teacher',
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/tests/test-1/history'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('student_id is required')
  })
})
