/**
 * API tests for GET/POST /api/teacher/assignments
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, POST } from '@/app/api/teacher/assignments/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherOwnsClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'c1', teacher_id: 'teacher-1', archived_at: null },
  })),
  assertTeacherCanMutateClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'c1', teacher_id: 'teacher-1', archived_at: null },
  })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/teacher/assignments', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('should return 400 when classroom_id is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/assignments')
    const response = await GET(request)
    expect(response.status).toBe(400)
  })

  it('should return assignments for owned classroom', async () => {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: 'c1', teacher_id: 'teacher-1' }, error: null }),
          })),
        }
      } else if (table === 'assignments') {
        const builder: any = {}
        builder.order = vi
          .fn()
          .mockImplementationOnce(() => builder)
          .mockResolvedValue({ data: [], error: null })

        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: builder.order,
            })),
          })),
        }
      } else if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
          })),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments?classroom_id=c1')
    const response = await GET(request)
    expect(response.status).toBe(200)
  })

  it('counts only submissions that still need to be returned', async () => {
    const docs = [
      {
        is_submitted: true,
        submitted_at: '2026-03-13T10:00:00.000Z',
        returned_at: null,
        teacher_cleared_at: null,
      },
      {
        is_submitted: true,
        submitted_at: '2026-03-13T11:00:00.000Z',
        returned_at: null,
        teacher_cleared_at: '2026-03-13T12:00:00.000Z',
      },
      {
        is_submitted: true,
        submitted_at: '2026-03-15T10:00:00.000Z',
        returned_at: null,
        teacher_cleared_at: '2026-03-14T08:00:00.000Z',
      },
      {
        is_submitted: false,
        submitted_at: '2026-03-16T10:00:00.000Z',
        returned_at: '2026-03-17T08:00:00.000Z',
        teacher_cleared_at: '2026-03-17T08:00:00.000Z',
      },
    ]

    const mockFrom = vi.fn((table: string) => {
      if (table === 'assignments') {
        const assignmentRows = [
          {
            id: 'assignment-1',
            classroom_id: 'c1',
            title: 'Essay Draft',
            description: '',
            instructions_markdown: null,
            rich_instructions: null,
            due_at: '2026-03-14T23:59:59.000Z',
          },
        ]
        const builder: any = {}
        builder.order = vi
          .fn()
          .mockImplementationOnce(() => builder)
          .mockResolvedValue({ data: assignmentRows, error: null })

        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: builder.order,
            })),
          })),
        }
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ count: 31, error: null }),
          })),
        }
      }

      if (table === 'assignment_docs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: docs, error: null }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments?classroom_id=c1')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.assignments).toHaveLength(1)
    expect(data.assignments[0].stats).toEqual({
      total_students: 31,
      submitted: 2,
      late: 2,
    })
  })

  it('falls back only to returned_at when teacher_cleared_at is missing', async () => {
    const docs = [
      {
        is_submitted: true,
        submitted_at: '2026-03-23T16:27:46.54+00:00',
        returned_at: '2026-03-25T16:27:46.54+00:00',
      },
      {
        is_submitted: true,
        submitted_at: '2026-03-25T16:27:46.54+00:00',
        returned_at: null,
        feedback_returned_at: '2026-03-26T16:27:46.54+00:00',
      },
    ]

    const mockFrom = vi.fn((table: string) => {
      if (table === 'assignments') {
        const assignmentRows = [
          {
            id: 'assignment-1',
            classroom_id: 'c1',
            title: 'Essay Draft',
            description: '',
            instructions_markdown: null,
            rich_instructions: null,
            due_at: '2026-03-24T23:59:59.000Z',
          },
        ]
        const builder: any = {}
        builder.order = vi
          .fn()
          .mockImplementationOnce(() => builder)
          .mockResolvedValue({ data: assignmentRows, error: null })

        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: builder.order,
            })),
          })),
        }
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ count: 2, error: null }),
          })),
        }
      }

      if (table === 'assignment_docs') {
        return {
          select: vi.fn((columns: string) => ({
            eq: vi.fn().mockResolvedValue(
              columns.includes('teacher_cleared_at')
                ? { data: null, error: { code: '42703', message: "column assignment_docs.teacher_cleared_at does not exist" } }
                : { data: docs, error: null }
            ),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments?classroom_id=c1')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.assignments[0].stats).toEqual({
      total_students: 2,
      submitted: 1,
      late: 1,
    })
  })
})

describe('POST /api/teacher/assignments', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('should return 400 when required fields are missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/assignments', {
      method: 'POST',
      body: JSON.stringify({}),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('creates a basic assignment without repo review config', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        const orderBuilder = {
          limit: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => orderBuilder),
            })),
          })),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'a-1', title: 'Essay Draft' },
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'classwork_materials') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { position: 2 }, error: null }),
                })),
              })),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments', {
      method: 'POST',
      body: JSON.stringify({
        classroom_id: 'c1',
        title: 'Essay Draft',
        due_at: '2026-03-20T23:59:59.000Z',
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(201)
  })

  it('fails assignment creation when mixed order lookup has an unexpected error', async () => {
    const insert = vi.fn()
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { position: 1 }, error: null }),
                })),
              })),
            })),
          })),
          insert,
        }
      }

      if (table === 'classwork_materials') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'database unavailable' } }),
                })),
              })),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments', {
      method: 'POST',
      body: JSON.stringify({
        classroom_id: 'c1',
        title: 'Essay Draft',
        due_at: '2026-03-20T23:59:59.000Z',
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(500)
    expect(insert).not.toHaveBeenCalled()
  })
})
