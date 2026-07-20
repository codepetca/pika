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

    const invalidExactDate = await GET(
      new NextRequest('http://localhost:3000/api/teacher/student-history?classroom_id=c1&student_id=s1&date=03-16-2026')
    )
    expect(invalidExactDate.status).toBe(400)

    const ambiguousDate = await GET(new NextRequest(
      'http://localhost:3000/api/teacher/student-history?classroom_id=c1&student_id=s1&date=2026-03-15&before_date=2026-03-16',
    ))
    expect(ambiguousDate.status).toBe(400)
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
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
    let entryLimit: ReturnType<typeof vi.fn> | undefined
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
        entryLimit = entryQuery.limit
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
    expect(entryLimit).toHaveBeenCalledWith(5)
  })

  it('caps oversized history limits at 50 for compatibility', async () => {
    let entryLimit: ReturnType<typeof vi.fn> | undefined
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
          single: vi.fn().mockResolvedValue({ data: { student_id: 's1' }, error: null }),
        }
        return { select: vi.fn(() => enrollmentQuery) }
      }
      if (table === 'entries') {
        const entryQuery: any = {
          select: vi.fn(() => entryQuery),
          eq: vi.fn(() => entryQuery),
          order: vi.fn(() => entryQuery),
          limit: vi.fn(() => entryQuery),
          then: vi.fn((resolve: any) => Promise.resolve(resolve({ data: [], error: null }))),
        }
        entryLimit = entryQuery.limit
        return entryQuery
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(new NextRequest(
      'http://localhost:3000/api/teacher/student-history?classroom_id=c1&student_id=s1&limit=500',
    ))

    expect(response.status).toBe(200)
    expect(entryLimit).toHaveBeenCalledWith(50)
  })

  it('returns only the requested student entry for an exact date', async () => {
    const entryQuery: any = {
      select: vi.fn(() => entryQuery),
      eq: vi.fn(() => entryQuery),
      order: vi.fn(() => entryQuery),
      limit: vi.fn(() => entryQuery),
      then: vi.fn((resolve: any) => Promise.resolve(resolve({
        data: [{ id: 'e1', student_id: 's1', date: '2026-03-15', text: 'Worked hard' }],
        error: null,
      }))),
    }

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
          single: vi.fn().mockResolvedValue({ data: { student_id: 's1' }, error: null }),
        }
        return { select: vi.fn(() => enrollmentQuery) }
      }
      if (table === 'entries') return entryQuery
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(new NextRequest(
      'http://localhost:3000/api/teacher/student-history?classroom_id=c1&student_id=s1&date=2026-03-15&limit=1',
    ))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.entries).toEqual([
      { id: 'e1', student_id: 's1', date: '2026-03-15', text: 'Worked hard' },
    ])
    expect(entryQuery.eq).toHaveBeenCalledWith('student_id', 's1')
    expect(entryQuery.eq).toHaveBeenCalledWith('classroom_id', 'c1')
    expect(entryQuery.eq).toHaveBeenCalledWith('date', '2026-03-15')
    expect(entryQuery.limit).toHaveBeenCalledWith(1)
  })

  it('returns 404 before querying entries when the student is not enrolled', async () => {
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
          single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        }
        return { select: vi.fn(() => enrollmentQuery) }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(new NextRequest(
      'http://localhost:3000/api/teacher/student-history?classroom_id=c1&student_id=other-student&date=2026-03-15&limit=1',
    ))

    expect(response.status).toBe(404)
    expect(mockSupabaseClient.from).not.toHaveBeenCalledWith('entries')
  })
})
