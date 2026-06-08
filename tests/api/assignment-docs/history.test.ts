import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/assignment-docs/[id]/history/route'
import { NextRequest } from 'next/server'
import * as auth from '@/lib/auth'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(async () => ({ id: 'student-1', role: 'student' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'class-1', archived_at: null },
  })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/assignment-docs/[id]/history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(auth.requireAuth).mockResolvedValue({ id: 'student-1', role: 'student' } as any)
  })

  it('returns empty history when no doc exists', async () => {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'assign-1', classroom_id: 'class-1', classrooms: { id: 'class-1', teacher_id: 'teacher-1' } },
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: 'enroll-1' }, error: null }),
          })),
        }
      }
      if (table === 'assignment_docs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
          })),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/history')
    const response = await GET(request, { params: { id: 'assign-1' } })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.history).toEqual([])
    expect(data.docId).toBe(null)
  })

  it('requires student_id for teacher history reads', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValueOnce({ id: 'teacher-1', role: 'teacher' } as any)
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'assign-1',
                  classroom_id: 'class-1',
                  is_draft: true,
                  released_at: null,
                  classrooms: { id: 'class-1', teacher_id: 'teacher-1' },
                },
                error: null,
              }),
            })),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/history'),
      { params: { id: 'assign-1' } }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('student_id is required')
  })

  it('blocks teacher history reads for assignments they do not own', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValueOnce({ id: 'teacher-2', role: 'teacher' } as any)
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'assign-1',
                  classroom_id: 'class-1',
                  is_draft: true,
                  released_at: null,
                  classrooms: { id: 'class-1', teacher_id: 'teacher-1' },
                },
                error: null,
              }),
            })),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/history?student_id=student-1'),
      { params: { id: 'assign-1' } }
    )
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Unauthorized')
  })

  it('blocks teacher history reads for students outside the assignment classroom', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValueOnce({ id: 'teacher-1', role: 'teacher' } as any)
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'assign-1',
                  classroom_id: 'class-1',
                  is_draft: true,
                  released_at: null,
                  classrooms: { id: 'class-1', teacher_id: 'teacher-1' },
                },
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/history?student_id=student-2'),
      { params: { id: 'assign-1' } }
    )
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Not enrolled in this classroom')
  })

  it('lets the classroom teacher read enrolled student history for draft assignments', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValueOnce({ id: 'teacher-1', role: 'teacher' } as any)
    const enrollmentFilters: Array<[string, unknown]> = []
    const docFilters: Array<[string, unknown]> = []
    const historyFilters: Array<[string, unknown]> = []
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'assign-1',
                  classroom_id: 'class-1',
                  is_draft: true,
                  released_at: null,
                  classrooms: { id: 'class-1', teacher_id: 'teacher-1' },
                },
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'classroom_enrollments') {
        const enrollmentChain = {
          eq: vi.fn((column: string, value: unknown) => {
            enrollmentFilters.push([column, value])
            return enrollmentChain
          }),
          single: vi.fn().mockResolvedValue({ data: { id: 'enroll-1' }, error: null }),
        }
        return {
          select: vi.fn(() => enrollmentChain),
        }
      }
      if (table === 'assignment_docs') {
        const docChain = {
          eq: vi.fn((column: string, value: unknown) => {
            docFilters.push([column, value])
            return docChain
          }),
          single: vi.fn().mockResolvedValue({
            data: { id: 'doc-1' },
            error: null,
          }),
        }
        return {
          select: vi.fn(() => docChain),
        }
      }
      if (table === 'assignment_doc_history') {
        const historyChain = {
          eq: vi.fn((column: string, value: unknown) => {
            historyFilters.push([column, value])
            return historyChain
          }),
          order: vi.fn().mockResolvedValue({
            data: [{ id: 'history-1', assignment_doc_id: 'doc-1', snapshot: { type: 'doc', content: [] } }],
            error: null,
          }),
        }
        return {
          select: vi.fn(() => historyChain),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/history?student_id=student-1'),
      { params: { id: 'assign-1' } }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.docId).toBe('doc-1')
    expect(data.history).toHaveLength(1)
    expect(enrollmentFilters).toEqual([
      ['classroom_id', 'class-1'],
      ['student_id', 'student-1'],
    ])
    expect(docFilters).toEqual([
      ['assignment_id', 'assign-1'],
      ['student_id', 'student-1'],
    ])
    expect(historyFilters).toEqual([
      ['assignment_doc_id', 'doc-1'],
    ])
  })
})
