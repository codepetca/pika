import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/teacher/surveys/route'

const mockSupabaseClient = { from: vi.fn() }
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
  assertTeacherCanMutateClassroom: vi.fn(async () => ({ ok: true })),
  assertTeacherOwnsClassroom: vi.fn(async () => ({ ok: true })),
  getClassroomStudentIds: mockGetClassroomStudentIds,
}))

describe('GET /api/teacher/surveys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetClassroomStudentIds.mockResolvedValue({
      studentIds: ['student-1', 'student-2'],
      studentIdSet: new Set(['student-1', 'student-2']),
      totalStudents: 2,
      error: null,
    })
  })

  it('counts only currently enrolled responders in survey stats', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'surveys') {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          then: vi.fn((resolve: any) =>
            resolve({
              data: [
                {
                  id: 'survey-1',
                  classroom_id: 'classroom-1',
                  title: 'Survey One',
                  status: 'active',
                  show_results: true,
                  dynamic_responses: false,
                  position: 0,
                  created_at: '2026-05-01T00:00:00.000Z',
                },
              ],
              error: null,
            })
          ),
        }
        return chain
      }
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [
                { student_id: 'student-1' },
                { student_id: 'student-2' },
              ],
              count: 2,
              error: null,
            }),
          })),
        }
      }
      if (table === 'survey_questions') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [{ survey_id: 'survey-1' }], error: null }),
          })),
        }
      }
      if (table === 'survey_responses') {
        const responseFilter: any = {
          in: vi.fn((column: string, values: string[]) => {
            if (column === 'survey_id') {
              expect(values).toEqual(['survey-1'])
              return responseFilter
            }
            if (column === 'student_id') {
              expect(values).toEqual(['student-1', 'student-2'])
              return Promise.resolve({
                data: [
                  { survey_id: 'survey-1', student_id: 'student-1' },
                  { survey_id: 'survey-1', student_id: 'student-stale' },
                ],
                error: null,
              })
            }
            throw new Error(`Unexpected survey_responses in column: ${column}`)
          }),
        }
        return {
          select: vi.fn(() => ({
            in: responseFilter.in,
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/surveys?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.surveys[0].stats).toEqual({
      total_students: 2,
      responded: 1,
      questions_count: 1,
    })
  })

  it('returns 500 when enrollment loading fails', async () => {
    mockGetClassroomStudentIds.mockResolvedValueOnce({
      studentIds: [],
      studentIdSet: new Set(),
      totalStudents: 0,
      error: { message: 'boom' },
    })
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'surveys') {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          then: vi.fn((resolve: any) => resolve({ data: [], error: null })),
        }
        return chain
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/surveys?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to fetch classroom enrollments' })
  })

  it('returns 500 when scoped survey response stat loading fails', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'surveys') {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          then: vi.fn((resolve: any) =>
            resolve({
              data: [
                {
                  id: 'survey-1',
                  classroom_id: 'classroom-1',
                  title: 'Survey One',
                  status: 'active',
                  show_results: true,
                  dynamic_responses: false,
                  position: 0,
                  created_at: '2026-05-01T00:00:00.000Z',
                },
              ],
              error: null,
            })
          ),
        }
        return chain
      }
      if (table === 'survey_questions') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [{ survey_id: 'survey-1' }], error: null }),
          })),
        }
      }
      if (table === 'survey_responses') {
        const responseFilter: any = {
          in: vi.fn((column: string) => {
            if (column === 'survey_id') return responseFilter
            if (column === 'student_id') return Promise.resolve({ data: null, error: { message: 'boom' } })
            throw new Error(`Unexpected survey_responses in column: ${column}`)
          }),
        }
        return {
          select: vi.fn(() => ({
            in: responseFilter.in,
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/surveys?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to fetch survey response stats' })
  })
})

describe('POST /api/teacher/surveys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates an untitled draft survey when no title is provided', async () => {
    const insertedSurvey = {
      id: 'survey-1',
      classroom_id: 'classroom-1',
      title: 'Untitled 2026-05-14 10:15:30',
      status: 'draft',
      opens_at: null,
      show_results: true,
      dynamic_responses: false,
      position: 3,
      created_by: 'teacher-1',
    }
    const insert = vi.fn((payload: Record<string, unknown>) => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { ...insertedSurvey, ...payload },
          error: null,
        }),
      })),
    }))
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
          insert,
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/surveys', {
        method: 'POST',
        body: JSON.stringify({ classroom_id: 'classroom-1', title: '   ' }),
      }),
    )

    expect(response.status).toBe(201)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      classroom_id: 'classroom-1',
      title: expect.stringMatching(/^Untitled \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
      show_results: true,
      dynamic_responses: false,
      created_by: 'teacher-1',
      position: 3,
    }))
    await expect(response.json()).resolves.toEqual({
      survey: expect.objectContaining({
        title: expect.stringMatching(/^Untitled \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
      }),
    })
  })
})
