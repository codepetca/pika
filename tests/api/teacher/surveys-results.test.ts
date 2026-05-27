import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/teacher/surveys/[id]/results/route'

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

vi.mock('@/lib/server/surveys', () => ({
  assertTeacherOwnsSurvey: vi.fn(async () => ({
    ok: true,
    survey: {
      id: 'survey-1',
      classroom_id: 'classroom-1',
      title: 'Survey One',
      status: 'active',
      show_results: true,
      dynamic_responses: false,
      position: 0,
      created_by: 'teacher-1',
      created_at: '2026-05-01T00:00:00.000Z',
      updated_at: '2026-05-01T00:00:00.000Z',
      classrooms: { id: 'classroom-1', teacher_id: 'teacher-1', archived_at: null },
    },
  })),
}))

describe('GET /api/teacher/surveys/[id]/results', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 500 when enrollment loading fails', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'survey_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [{ id: 'q-mc', question_type: 'multiple_choice', question_text: 'Choose one', options: ['A'], position: 0 }],
              error: null,
            }),
          })),
        }
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: null, count: null, error: { message: 'boom' } }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/surveys/survey-1/results'),
      { params: Promise.resolve({ id: 'survey-1' }) },
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to fetch classroom enrollments' })
  })

  it('skips response and responder loading when no students are enrolled', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'survey_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [{ id: 'q-mc', question_type: 'multiple_choice', question_text: 'Choose one', options: ['A', 'B'], position: 0 }],
              error: null,
            }),
          })),
        }
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/surveys/survey-1/results'),
      { params: Promise.resolve({ id: 'survey-1' }) },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.results[0].counts).toEqual([0, 0])
    expect(data.responders).toEqual([])
    expect(data.stats).toEqual({ total_students: 0, responded: 0 })
  })

  it('aggregates and hydrates only current enrolled student responses', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'survey_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'q-mc',
                  survey_id: 'survey-1',
                  question_type: 'multiple_choice',
                  question_text: 'Choose one',
                  options: ['A', 'B'],
                  response_max_chars: 500,
                  position: 0,
                },
                {
                  id: 'q-text',
                  survey_id: 'survey-1',
                  question_type: 'short_text',
                  question_text: 'Explain',
                  options: [],
                  response_max_chars: 500,
                  position: 1,
                },
              ],
              error: null,
            }),
          })),
        }
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

      if (table === 'survey_responses') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn((column: string, studentIds: string[]) => {
              expect(column).toBe('student_id')
              expect(studentIds).toEqual(['student-1', 'student-2'])
              return Promise.resolve({
                data: [
                  {
                    id: 'response-1',
                    survey_id: 'survey-1',
                    question_id: 'q-mc',
                    student_id: 'student-1',
                    selected_option: 0,
                    response_text: null,
                    submitted_at: '2026-05-01T00:00:00.000Z',
                    updated_at: '2026-05-01T00:00:00.000Z',
                  },
                  {
                    id: 'response-2',
                    survey_id: 'survey-1',
                    question_id: 'q-mc',
                    student_id: 'student-2',
                    selected_option: 1,
                    response_text: null,
                    submitted_at: '2026-05-01T00:00:00.000Z',
                    updated_at: '2026-05-01T00:00:00.000Z',
                  },
                  {
                    id: 'response-stale-mc',
                    survey_id: 'survey-1',
                    question_id: 'q-mc',
                    student_id: 'student-stale',
                    selected_option: 1,
                    response_text: null,
                    submitted_at: '2026-05-02T00:00:00.000Z',
                    updated_at: '2026-05-02T00:00:00.000Z',
                  },
                  {
                    id: 'response-3',
                    survey_id: 'survey-1',
                    question_id: 'q-text',
                    student_id: 'student-1',
                    selected_option: null,
                    response_text: 'Enrolled answer',
                    submitted_at: '2026-05-03T00:00:00.000Z',
                    updated_at: '2026-05-03T00:00:00.000Z',
                  },
                  {
                    id: 'response-stale-text',
                    survey_id: 'survey-1',
                    question_id: 'q-text',
                    student_id: 'student-stale',
                    selected_option: null,
                    response_text: 'Stale answer',
                    submitted_at: '2026-05-04T00:00:00.000Z',
                    updated_at: '2026-05-04T00:00:00.000Z',
                  },
                ],
                error: null,
              })
            }),
          })),
        }
      }

      if (table === 'users') {
        return {
          select: vi.fn(() => ({
            in: vi.fn((column: string, studentIds: string[]) => {
              expect(column).toBe('id')
              expect(studentIds).toEqual(['student-1', 'student-2'])
              return Promise.resolve({
                data: [
                  { id: 'student-1', email: 'alice@example.com' },
                  { id: 'student-2', email: 'zed@example.com' },
                ],
                error: null,
              })
            }),
          })),
        }
      }

      if (table === 'student_profiles') {
        return {
          select: vi.fn(() => ({
            in: vi.fn((column: string, studentIds: string[]) => {
              expect(column).toBe('user_id')
              expect(studentIds).toEqual(['student-1', 'student-2'])
              return Promise.resolve({
                data: [
                  { user_id: 'student-1', first_name: 'Alice', last_name: 'Brown' },
                  { user_id: 'student-2', first_name: 'Zed', last_name: 'Young' },
                ],
                error: null,
              })
            }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/surveys/survey-1/results'),
      { params: Promise.resolve({ id: 'survey-1' }) },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.results[0].counts).toEqual([1, 1])
    expect(data.results[1].responses).toEqual([
      {
        response_id: 'response-3',
        student_id: 'student-1',
        name: 'Alice Brown',
        email: 'alice@example.com',
        response_text: 'Enrolled answer',
        submitted_at: '2026-05-03T00:00:00.000Z',
        updated_at: '2026-05-03T00:00:00.000Z',
      },
    ])
    expect(data.responders.map((responder: { student_id: string }) => responder.student_id)).toEqual([
      'student-1',
      'student-2',
    ])
    expect(data.stats).toEqual({ total_students: 2, responded: 2 })
  })
})
