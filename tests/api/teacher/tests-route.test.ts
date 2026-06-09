import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/teacher/tests/route'

const mockGetClassroomStudentIds = vi.hoisted(() => vi.fn())

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

vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherOwnsClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'classroom-1', teacher_id: 'teacher-1' },
  })),
  assertTeacherCanMutateClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'classroom-1', teacher_id: 'teacher-1' },
  })),
  getClassroomStudentIds: mockGetClassroomStudentIds,
}))

const mockSupabaseClient = { from: vi.fn() }

function buildStudentScopedStatsTable(options: {
  rows: Array<Record<string, any>>
  error?: unknown
  inCalls?: Array<{ table: string; column: string; values: string[] }>
  table: string
}) {
  return {
    select: vi.fn(() => {
      let selectedTestIds: string[] = []
      const query: any = {
        in: vi.fn((column: string, values: string[]) => {
          options.inCalls?.push({ table: options.table, column, values })
          if (column === 'test_id') {
            selectedTestIds = values
            return query
          }
          if (column === 'student_id') {
            if (options.error) {
              return Promise.resolve({ data: null, error: options.error })
            }
            return Promise.resolve({
              data: options.rows.filter(
                (row) => selectedTestIds.includes(row.test_id) && values.includes(row.student_id)
              ),
              error: null,
            })
          }
          return query
        }),
      }
      return query
    }),
  }
}

function buildTestIdStatsTable(options: {
  rows: Array<Record<string, any>>
  error?: unknown
  filterColumn?: string
  inCalls?: Array<{ table: string; column: string; values: string[] }>
  table: string
}) {
  return {
    select: vi.fn(() => ({
      in: vi.fn((column: string, values: string[]) => {
        options.inCalls?.push({ table: options.table, column, values })
        if (options.error) {
          return Promise.resolve({ data: null, error: options.error })
        }
        const filterColumn = options.filterColumn ?? column
        return Promise.resolve({
          data: options.rows.filter((row) => values.includes(row[filterColumn])),
          error: null,
        })
      }),
    })),
  }
}

function buildAssessmentDraftRows(rows: Array<{ assessment_id: string; content: Record<string, unknown> }>) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        in: vi.fn((_column: string, values: string[]) =>
          Promise.resolve({
            data: rows.filter((row) => values.includes(row.assessment_id)),
            error: null,
          })
        ),
      })),
    })),
  }
}

describe('GET /api/teacher/tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetClassroomStudentIds.mockResolvedValue({
      studentIds: [],
      studentIdSet: new Set(),
      totalStudents: 0,
      error: null,
    })
  })

  it('requests tests in descending position order with a descending created_at tie-breaker', async () => {
    const orderCalls: Array<{ column: string; ascending: boolean | undefined }> = []

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        const builder: any = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          order: vi.fn((column: string, options?: { ascending?: boolean }) => {
            orderCalls.push({ column, ascending: options?.ascending })
            return builder
          }),
          then: vi.fn((resolve: any) =>
            resolve({
              data: [
                { id: 'test-2', classroom_id: 'classroom-1', title: 'Newest', position: 2, created_at: '2026-03-02T00:00:00.000Z' },
                { id: 'test-1', classroom_id: 'classroom-1', title: 'Older', position: 1, created_at: '2026-03-01T00:00:00.000Z' },
              ],
              error: null,
            })
          ),
        }
        return builder
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
          })),
        }
      }

      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }

      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }

      if (table === 'test_responses') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(orderCalls).toEqual([
      { column: 'position', ascending: false },
      { column: 'created_at', ascending: false },
    ])
    expect(data.tests).toEqual(data.quizzes)
    expect((data.tests as Array<{ id: string }>).map((test) => test.id)).toEqual(['test-2', 'test-1'])
  })

  it('returns 500 when reading test responses fails', async () => {
    mockGetClassroomStudentIds.mockResolvedValueOnce({
      studentIds: ['student-1'],
      studentIdSet: new Set(['student-1']),
      totalStudents: 10,
      error: null,
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            then: vi.fn((resolve: any) =>
              resolve({
                data: [{ id: 'test-1', classroom_id: 'classroom-1', title: 'T1', position: 0 }],
                error: null,
              })
            ),
          })),
        }
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ count: 10, error: null }),
          })),
        }
      }

      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [{ test_id: 'test-1' }], error: null }),
          })),
        }
      }

      if (table === 'test_attempts') {
        return buildStudentScopedStatsTable({
          table,
          rows: [{ test_id: 'test-1', student_id: 'student-1', is_submitted: true }],
        })
      }

      if (table === 'test_responses') {
        return buildStudentScopedStatsTable({
          table,
          rows: [],
          error: { message: 'Database error' },
        })
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to fetch tests')
  })

  it('returns 500 when reading classroom enrollments fails', async () => {
    mockGetClassroomStudentIds.mockResolvedValueOnce({
      studentIds: [],
      studentIdSet: new Set(),
      totalStudents: 0,
      error: { message: 'enrollment read failed' },
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            then: vi.fn((resolve: any) =>
              resolve({
                data: [{ id: 'test-1', classroom_id: 'classroom-1', title: 'T1', position: 0 }],
                error: null,
              })
            ),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to fetch classroom enrollments')
  })

  it('does not count placeholder graded rows as respondents', async () => {
    mockGetClassroomStudentIds.mockResolvedValueOnce({
      studentIds: ['student-1'],
      studentIdSet: new Set(['student-1']),
      totalStudents: 10,
      error: null,
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            then: vi.fn((resolve: any) =>
              resolve({
                data: [{ id: 'test-1', classroom_id: 'classroom-1', title: 'T1', position: 0 }],
                error: null,
              })
            ),
          })),
        }
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ count: 10, error: null }),
          })),
        }
      }

      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [{ test_id: 'test-1' }], error: null }),
          })),
        }
      }

      if (table === 'test_attempts') {
        return buildStudentScopedStatsTable({ table, rows: [] })
      }

      if (table === 'test_responses') {
        return buildStudentScopedStatsTable({
          table,
          rows: [
            {
              test_id: 'test-1',
              student_id: 'student-1',
              selected_option: null,
              response_text: '   ',
            },
          ],
        })
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.tests).toHaveLength(1)
    expect(data.tests[0].stats.responded).toBe(0)
  })

  it('counts only currently enrolled students as respondents', async () => {
    const scopedInCalls: Array<{ table: string; column: string; values: string[] }> = []
    mockGetClassroomStudentIds.mockResolvedValueOnce({
      studentIds: ['student-1', 'student-2'],
      studentIdSet: new Set(['student-1', 'student-2']),
      totalStudents: 2,
      error: null,
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            then: vi.fn((resolve: any) =>
              resolve({
                data: [{ id: 'test-1', classroom_id: 'classroom-1', title: 'T1', status: 'active', position: 0 }],
                error: null,
              })
            ),
          })),
        }
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [{ student_id: 'student-1' }, { student_id: 'student-2' }],
              count: 2,
              error: null,
            }),
          })),
        }
      }

      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [{ test_id: 'test-1' }], error: null }),
          })),
        }
      }

      if (table === 'test_attempts') {
        return buildStudentScopedStatsTable({
          table,
          inCalls: scopedInCalls,
          rows: [
            { test_id: 'test-1', student_id: 'student-1', is_submitted: true },
            { test_id: 'test-1', student_id: 'student-3', is_submitted: true },
          ],
        })
      }

      if (table === 'test_responses') {
        return buildStudentScopedStatsTable({
          table,
          inCalls: scopedInCalls,
          rows: [
            {
              test_id: 'test-1',
              student_id: 'student-2',
              selected_option: 0,
              response_text: null,
            },
            {
              test_id: 'test-1',
              student_id: 'student-4',
              selected_option: 1,
              response_text: null,
            },
          ],
        })
      }

      if (table === 'test_student_availability') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => ({
              in: vi.fn().mockResolvedValue({
                data: [{ test_id: 'test-1', student_id: 'student-1', state: 'closed' }],
                error: null,
              }),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.tests).toHaveLength(1)
    expect(data.tests[0].stats.total_students).toBe(2)
    expect(data.tests[0].stats.responded).toBe(2)
    expect(data.tests[0].stats.submitted).toBe(1)
    expect(data.tests[0].stats.open_access).toBe(1)
    expect(data.tests[0].stats.closed_access).toBe(1)
    expect(scopedInCalls).toContainEqual({
      table: 'test_attempts',
      column: 'student_id',
      values: ['student-1', 'student-2'],
    })
    expect(scopedInCalls).toContainEqual({
      table: 'test_responses',
      column: 'student_id',
      values: ['student-1', 'student-2'],
    })
  })

  it('chunks test stats filters for large rosters and test lists', async () => {
    const studentIds = Array.from({ length: 51 }, (_, index) => `student-${index + 1}`)
    const testRows = Array.from({ length: 51 }, (_, index) => ({
      id: `test-${index + 1}`,
      classroom_id: 'classroom-1',
      title: `Test ${index + 1}`,
      status: 'active',
      position: index,
    }))
    const questionRows = testRows.map((test) => ({ test_id: test.id }))
    const statsInCalls: Array<{ table: string; column: string; values: string[] }> = []

    mockGetClassroomStudentIds.mockResolvedValueOnce({
      studentIds,
      studentIdSet: new Set(studentIds),
      totalStudents: studentIds.length,
      error: null,
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            then: vi.fn((resolve: any) =>
              resolve({
                data: testRows,
                error: null,
              })
            ),
          })),
        }
      }

      if (table === 'test_questions') {
        return buildTestIdStatsTable({
          table,
          rows: questionRows,
          filterColumn: 'test_id',
          inCalls: statsInCalls,
        })
      }

      if (table === 'test_attempts') {
        return buildStudentScopedStatsTable({
          table,
          inCalls: statsInCalls,
          rows: [{ test_id: 'test-1', student_id: 'student-1', is_submitted: true }],
        })
      }

      if (table === 'test_responses') {
        return buildStudentScopedStatsTable({
          table,
          inCalls: statsInCalls,
          rows: [
            {
              test_id: 'test-1',
              student_id: 'student-2',
              selected_option: 0,
              response_text: null,
            },
          ],
        })
      }

      if (table === 'test_student_availability') {
        return buildStudentScopedStatsTable({
          table,
          inCalls: statsInCalls,
          rows: [{ test_id: 'test-1', student_id: 'student-1', state: 'closed' }],
        })
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.tests).toHaveLength(51)
    expect(data.tests[0].stats).toEqual({
      total_students: 51,
      responded: 2,
      submitted: 1,
      open_access: 50,
      closed_access: 1,
      questions_count: 1,
    })
    expect(statsInCalls.every((call) => call.values.length <= 50)).toBe(true)
    expect(statsInCalls).toContainEqual({
      table: 'test_questions',
      column: 'test_id',
      values: testRows.slice(0, 50).map((test) => test.id),
    })
    expect(statsInCalls).toContainEqual({
      table: 'test_questions',
      column: 'test_id',
      values: ['test-51'],
    })
    expect(statsInCalls).toContainEqual({
      table: 'test_attempts',
      column: 'student_id',
      values: studentIds.slice(0, 50),
    })
    expect(statsInCalls).toContainEqual({
      table: 'test_attempts',
      column: 'student_id',
      values: ['student-51'],
    })
  })

  it('applies draft overlays only to draft tests in the list', async () => {
    const testRows = [
      {
        id: 'test-draft',
        classroom_id: 'classroom-1',
        title: 'Canonical Draft Title',
        status: 'draft',
        show_results: false,
        position: 1,
      },
      {
        id: 'test-closed',
        classroom_id: 'classroom-1',
        title: 'Closed Test',
        status: 'closed',
        show_results: false,
        position: 0,
      },
    ]

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            then: vi.fn((resolve: any) =>
              resolve({
                data: testRows,
                error: null,
              })
            ),
          })),
        }
      }

      if (table === 'test_questions') {
        return buildTestIdStatsTable({
          table,
          rows: [
            { test_id: 'test-draft' },
            { test_id: 'test-closed' },
            { test_id: 'test-closed' },
          ],
          filterColumn: 'test_id',
        })
      }

      if (table === 'assessment_drafts') {
        return buildAssessmentDraftRows([
          {
            assessment_id: 'test-draft',
            content: {
              title: 'Draft Overlay Title',
              show_results: true,
              questions: [],
            },
          },
          {
            assessment_id: 'test-closed',
            content: {
              title: 'Stale Draft Title',
              show_results: true,
              questions: [],
            },
          },
        ])
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.tests[0].title).toBe('Draft Overlay Title')
    expect(data.tests[0].show_results).toBe(true)
    expect(data.tests[0].stats.questions_count).toBe(0)
    expect(data.tests[1].title).toBe('Closed Test')
    expect(data.tests[1].show_results).toBe(false)
    expect(data.tests[1].stats.questions_count).toBe(2)
  })
})

describe('POST /api/teacher/tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a new test at the next position and seeds an initial draft row', async () => {
    const deleteEqSpy = vi.fn().mockResolvedValue({ error: null })
    const deleteSpy = vi.fn(() => ({
      eq: deleteEqSpy,
    }))
    const assessmentDraftInsertSpy = vi.fn((payload: Record<string, unknown>) => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: 'draft-1', ...payload },
          error: null,
        }),
      })),
    }))

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { position: 2 },
                    error: null,
                  }),
                })),
              })),
            })),
          })),
          insert: vi.fn((payload: Record<string, unknown>) => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'test-1',
                  show_results: false,
                  documents: null,
                  ...payload,
                },
                error: null,
              }),
            })),
          })),
          delete: deleteSpy,
        }
      }

      if (table === 'assessment_drafts') {
        return {
          insert: assessmentDraftInsertSpy,
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/tests', {
        method: 'POST',
        body: JSON.stringify({ classroom_id: 'classroom-1', title: ' New Test ' }),
      })
    )
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.test).toEqual(data.quiz)
    expect(data.test.position).toBe(3)
    expect(data.test.title).toBe('New Test')
    expect(assessmentDraftInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        assessment_type: 'test',
        assessment_id: 'test-1',
        classroom_id: 'classroom-1',
        version: 1,
        created_by: 'teacher-1',
        updated_by: 'teacher-1',
        content: {
          title: 'New Test',
          show_results: false,
          questions: [],
          source_format: 'markdown',
        },
      })
    )
    expect(deleteSpy).not.toHaveBeenCalled()
  })

  it('creates an untitled draft when title is omitted', async () => {
    const assessmentDraftInsertSpy = vi.fn((payload: Record<string, unknown>) => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: 'draft-1', ...payload },
          error: null,
        }),
      })),
    }))

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: null,
                  }),
                })),
              })),
            })),
          })),
          insert: vi.fn((payload: Record<string, unknown>) => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'test-1',
                  show_results: false,
                  documents: null,
                  ...payload,
                },
                error: null,
              }),
            })),
          })),
          delete: vi.fn(),
        }
      }

      if (table === 'assessment_drafts') {
        return {
          insert: assessmentDraftInsertSpy,
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/tests', {
        method: 'POST',
        body: JSON.stringify({ classroom_id: 'classroom-1' }),
      })
    )
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.test.title).toMatch(/^Untitled \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(assessmentDraftInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          title: data.test.title,
        }),
      })
    )
  })

  it('rolls back the new test when the assessment drafts table is unavailable', async () => {
    const deleteEqSpy = vi.fn().mockResolvedValue({ error: null })
    const deleteSpy = vi.fn(() => ({
      eq: deleteEqSpy,
    }))

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { position: 0 },
                    error: null,
                  }),
                })),
              })),
            })),
          })),
          insert: vi.fn((payload: Record<string, unknown>) => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'test-1',
                  show_results: false,
                  documents: null,
                  ...payload,
                },
                error: null,
              }),
            })),
          })),
          delete: deleteSpy,
        }
      }

      if (table === 'assessment_drafts') {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: {
                  code: 'PGRST205',
                  message: 'relation "assessment_drafts" does not exist',
                },
              }),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/tests', {
        method: 'POST',
        body: JSON.stringify({ classroom_id: 'classroom-1', title: 'Draftless Test' }),
      })
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Assessment drafts require migration 045 to be applied')
    expect(deleteSpy).toHaveBeenCalledTimes(1)
    expect(deleteEqSpy).toHaveBeenCalledWith('id', 'test-1')
  })
})
