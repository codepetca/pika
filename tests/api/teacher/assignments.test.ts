/**
 * API tests for GET/POST /api/teacher/assignments
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, POST } from '@/app/api/teacher/assignments/route'
import { NextRequest } from 'next/server'

const mockGetClassroomStudentIds = vi.hoisted(() => vi.fn())

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
  getClassroomStudentIds: mockGetClassroomStudentIds,
}))

const mockSupabaseClient = { from: vi.fn() }

function buildEmptySubmissionRequirementsTable() {
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    then: vi.fn((resolve: any) => resolve({ data: [], error: null })),
  }
  return chain
}

function buildAssignmentDocsStatsTable(options: {
  docs: Array<Record<string, any>>
  firstError?: unknown
  fallbackError?: unknown
  inCalls?: Array<{ columns: string; column: string; values: string[] }>
}) {
  return {
    select: vi.fn((columns: string) => {
      let selectedAssignmentIds: string[] = []
      const query: any = {
        in: vi.fn((column: string, values: string[]) => {
          options.inCalls?.push({ columns, column, values })
          if (column === 'assignment_id') {
            selectedAssignmentIds = values
            return query
          }
          if (column === 'student_id') {
            if (columns.includes('teacher_cleared_at') && options.firstError) {
              return Promise.resolve({ data: null, error: options.firstError })
            }

            const rows = options.docs.filter(
              (doc) => selectedAssignmentIds.includes(doc.assignment_id) && values.includes(doc.student_id)
            )
            return Promise.resolve({
              data: rows,
              error: columns.includes('teacher_cleared_at') ? null : options.fallbackError ?? null,
            })
          }
          return query
        }),
      }
      return query
    }),
  }
}

describe('GET /api/teacher/assignments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetClassroomStudentIds.mockResolvedValue({
      studentIds: ['student-1', 'student-2'],
      studentIdSet: new Set(['student-1', 'student-2']),
      totalStudents: 2,
      error: null,
    })
  })

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
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments?classroom_id=c1')
    const response = await GET(request)
    expect(response.status).toBe(200)
  })

  it('counts only submissions that still need to be returned', async () => {
    mockGetClassroomStudentIds.mockResolvedValueOnce({
      studentIds: ['student-1', 'student-2', 'student-3', 'student-4'],
      studentIdSet: new Set(['student-1', 'student-2', 'student-3', 'student-4']),
      totalStudents: 4,
      error: null,
    })

    const docs = [
      {
        assignment_id: 'assignment-1',
        student_id: 'student-1',
        is_submitted: true,
        submitted_at: '2026-03-13T10:00:00.000Z',
        returned_at: null,
        teacher_cleared_at: null,
      },
      {
        assignment_id: 'assignment-1',
        student_id: 'student-2',
        is_submitted: true,
        submitted_at: '2026-03-13T11:00:00.000Z',
        returned_at: null,
        teacher_cleared_at: '2026-03-13T12:00:00.000Z',
      },
      {
        assignment_id: 'assignment-1',
        student_id: 'student-3',
        is_submitted: true,
        submitted_at: '2026-03-15T10:00:00.000Z',
        returned_at: null,
        teacher_cleared_at: '2026-03-14T08:00:00.000Z',
      },
      {
        assignment_id: 'assignment-1',
        student_id: 'student-4',
        is_submitted: false,
        submitted_at: '2026-03-16T10:00:00.000Z',
        returned_at: '2026-03-17T08:00:00.000Z',
        teacher_cleared_at: '2026-03-17T08:00:00.000Z',
      },
      {
        assignment_id: 'assignment-1',
        student_id: 'withdrawn-student',
        is_submitted: true,
        submitted_at: '2026-03-16T12:00:00.000Z',
        returned_at: null,
        teacher_cleared_at: null,
      },
    ]
    const assignmentDocInCalls: Array<{ columns: string; column: string; values: string[] }> = []

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

      if (table === 'assignment_docs') {
        return buildAssignmentDocsStatsTable({ docs, inCalls: assignmentDocInCalls })
      }

      if (table === 'assignment_submission_requirements') {
        return buildEmptySubmissionRequirementsTable()
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
      total_students: 4,
      submitted: 2,
      late: 2,
    })
    expect(assignmentDocInCalls).toContainEqual({
      columns: 'assignment_id, student_id, is_submitted, submitted_at, returned_at, teacher_cleared_at',
      column: 'assignment_id',
      values: ['assignment-1'],
    })
    expect(assignmentDocInCalls).toContainEqual({
      columns: 'assignment_id, student_id, is_submitted, submitted_at, returned_at, teacher_cleared_at',
      column: 'student_id',
      values: ['student-1', 'student-2', 'student-3', 'student-4'],
    })
  })

  it('chunks assignment doc stats filters for large rosters and assignment lists', async () => {
    const studentIds = Array.from({ length: 51 }, (_, index) => `student-${index + 1}`)
    const assignmentRows = Array.from({ length: 51 }, (_, index) => ({
      id: `assignment-${index + 1}`,
      classroom_id: 'c1',
      title: `Essay Draft ${index + 1}`,
      description: '',
      instructions_markdown: null,
      rich_instructions: null,
      due_at: '2026-03-14T23:59:59.000Z',
    }))
    mockGetClassroomStudentIds.mockResolvedValueOnce({
      studentIds,
      studentIdSet: new Set(studentIds),
      totalStudents: studentIds.length,
      error: null,
    })

    const docs = [
      {
        assignment_id: 'assignment-1',
        student_id: 'student-1',
        is_submitted: true,
        submitted_at: '2026-03-13T10:00:00.000Z',
        returned_at: null,
        teacher_cleared_at: null,
      },
      {
        assignment_id: 'assignment-51',
        student_id: 'student-51',
        is_submitted: true,
        submitted_at: '2026-03-13T11:00:00.000Z',
        returned_at: null,
        teacher_cleared_at: null,
      },
    ]
    const assignmentDocInCalls: Array<{ columns: string; column: string; values: string[] }> = []

    const mockFrom = vi.fn((table: string) => {
      if (table === 'assignments') {
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

      if (table === 'assignment_docs') {
        return buildAssignmentDocsStatsTable({ docs, inCalls: assignmentDocInCalls })
      }

      if (table === 'assignment_submission_requirements') {
        return buildEmptySubmissionRequirementsTable()
      }

      throw new Error(`Unexpected table: ${table}`)
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments?classroom_id=c1')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    const statsByAssignmentId = new Map(
      data.assignments.map((assignment: { id: string; stats: unknown }) => [assignment.id, assignment.stats])
    )
    expect(statsByAssignmentId.get('assignment-1')).toEqual({
      total_students: 51,
      submitted: 1,
      late: 0,
    })
    expect(statsByAssignmentId.get('assignment-2')).toEqual({
      total_students: 51,
      submitted: 0,
      late: 0,
    })
    expect(statsByAssignmentId.get('assignment-51')).toEqual({
      total_students: 51,
      submitted: 1,
      late: 0,
    })

    const assignmentFilterCalls = assignmentDocInCalls.filter((call) => call.column === 'assignment_id')
    const studentFilterCalls = assignmentDocInCalls.filter((call) => call.column === 'student_id')
    expect(assignmentFilterCalls.map((call) => call.values.length)).toEqual([50, 50, 1, 1])
    expect(studentFilterCalls.map((call) => call.values.length)).toEqual([50, 1, 50, 1])
    expect(new Set(assignmentFilterCalls.flatMap((call) => call.values))).toEqual(
      new Set(assignmentRows.map((assignment) => assignment.id))
    )
    expect(new Set(studentFilterCalls.flatMap((call) => call.values))).toEqual(new Set(studentIds))
  })

  it('falls back only to returned_at when teacher_cleared_at is missing', async () => {
    const docs = [
      {
        assignment_id: 'assignment-1',
        student_id: 'student-1',
        is_submitted: true,
        submitted_at: '2026-03-23T16:27:46.54+00:00',
        returned_at: '2026-03-25T16:27:46.54+00:00',
      },
      {
        assignment_id: 'assignment-1',
        student_id: 'student-2',
        is_submitted: true,
        submitted_at: '2026-03-25T16:27:46.54+00:00',
        returned_at: null,
        feedback_returned_at: '2026-03-26T16:27:46.54+00:00',
      },
      {
        assignment_id: 'assignment-1',
        student_id: 'withdrawn-student',
        is_submitted: true,
        submitted_at: '2026-03-26T16:27:46.54+00:00',
        returned_at: null,
      },
    ]
    const assignmentDocInCalls: Array<{ columns: string; column: string; values: string[] }> = []

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

      if (table === 'assignment_docs') {
        return buildAssignmentDocsStatsTable({
          docs,
          firstError: { code: '42703', message: "column assignment_docs.teacher_cleared_at does not exist" },
          inCalls: assignmentDocInCalls,
        })
      }

      if (table === 'assignment_submission_requirements') {
        return buildEmptySubmissionRequirementsTable()
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
    expect(assignmentDocInCalls.filter((call) => call.column === 'student_id')).toHaveLength(2)
    expect(assignmentDocInCalls).toContainEqual({
      columns: 'assignment_id, student_id, is_submitted, submitted_at, returned_at',
      column: 'student_id',
      values: ['student-1', 'student-2'],
    })
  })

  it('returns zero stats without reading assignment docs when no students are enrolled', async () => {
    mockGetClassroomStudentIds.mockResolvedValueOnce({
      studentIds: [],
      studentIdSet: new Set(),
      totalStudents: 0,
      error: null,
    })

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

      if (table === 'assignment_submission_requirements') {
        return buildEmptySubmissionRequirementsTable()
      }

      throw new Error(`Unexpected table: ${table}`)
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments?classroom_id=c1')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.assignments[0].stats).toEqual({
      total_students: 0,
      submitted: 0,
      late: 0,
    })
    expect(mockFrom).not.toHaveBeenCalledWith('assignment_docs')
  })

  it('returns 500 when classroom enrollment stats fail', async () => {
    mockGetClassroomStudentIds.mockResolvedValueOnce({
      studentIds: [],
      studentIdSet: new Set(),
      totalStudents: 0,
      error: { message: 'database unavailable' },
    })

    const mockFrom = vi.fn((table: string) => {
      if (table === 'assignments') {
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
      }

      throw new Error(`Unexpected table: ${table}`)
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments?classroom_id=c1')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to fetch classroom enrollments')
    expect(mockFrom).not.toHaveBeenCalledWith('assignment_docs')
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

      if (table === 'surveys') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
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

      if (table === 'surveys') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
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
