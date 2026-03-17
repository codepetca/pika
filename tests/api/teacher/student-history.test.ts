import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/teacher/student-history/route'
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

describe('GET /api/teacher/student-history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    ;(requireRole as any).mockRejectedValueOnce(mockAuthenticationError())

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/student-history?classroom_id=c1&student_id=s1')
    )

    expect(response.status).toBe(401)
  })

  it('validates required ids and date format', async () => {
    const missing = await GET(new NextRequest('http://localhost:3000/api/teacher/student-history'))
    expect(missing.status).toBe(400)

    const invalidDate = await GET(
      new NextRequest('http://localhost:3000/api/teacher/student-history?classroom_id=c1&student_id=s1&before_date=03-16-2026')
    )
    expect(invalidDate.status).toBe(400)
  })

  it('returns 403 when the classroom belongs to another teacher', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { teacher_id: 'teacher-2' },
                error: null,
              }),
            })),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/student-history?classroom_id=c1&student_id=s1')
    )

    expect(response.status).toBe(403)
  })

  it('returns paged entries for an enrolled student', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { teacher_id: 'teacher-1' },
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'classroom_enrollments') {
        const enrollmentQuery: any = {
          eq: vi.fn(() => enrollmentQuery),
          single: vi.fn().mockResolvedValue({
            data: { student_id: 's1' },
            error: null,
          }),
        }
        return {
          select: vi.fn(() => enrollmentQuery),
        }
      }
      if (table === 'entries') {
        const entryQuery: any = {
          select: vi.fn(() => entryQuery),
          eq: vi.fn(() => entryQuery),
          order: vi.fn(() => entryQuery),
          limit: vi.fn(() => entryQuery),
          lt: vi.fn(() => entryQuery),
          then: vi.fn((resolve: any) =>
            Promise.resolve(
              resolve({
                data: [{ id: 'e1', date: '2026-03-15', text: 'Worked hard' }],
                error: null,
              })
            )
          ),
        }
        return entryQuery
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/student-history?classroom_id=c1&student_id=s1&before_date=2026-03-16&limit=5')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.entries).toHaveLength(1)
    expect(data.entries[0].id).toBe('e1')
  })
})
