import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as GET_SURVEY } from '@/app/api/student/surveys/[id]/route'
import { GET as GET_SURVEY_RESULTS } from '@/app/api/student/surveys/[id]/results/route'

const mockSupabaseClient = { from: vi.fn() }

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({
    id: 'student-1',
    email: 'student1@example.com',
    role: 'student',
  })),
}))

vi.mock('@/lib/server/surveys', () => ({
  assertStudentCanAccessSurvey: vi.fn(async () => ({
    ok: true,
    survey: {
      id: 'survey-1',
      classroom_id: 'classroom-1',
      title: 'Game Jam Links',
      status: 'active',
      opens_at: null,
      show_results: true,
      dynamic_responses: true,
      position: 0,
      created_by: 'teacher-1',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      classrooms: {
        id: 'classroom-1',
        teacher_id: 'teacher-1',
        archived_at: null,
      },
    },
  })),
}))

describe('GET /api/student/surveys/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves link response discriminants in the student response map', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'survey_responses') {
        const responseFilter: any = {
          eq: vi.fn(() => responseFilter),
        }
        responseFilter.eq
          .mockReturnValueOnce(responseFilter)
          .mockResolvedValueOnce({
            data: [
              { question_id: 'link-question', selected_option: null, response_text: 'https://example.com/game' },
              { question_id: 'text-question', selected_option: null, response_text: 'Built in Godot' },
            ],
            error: null,
          })
        return {
          select: vi.fn(() => responseFilter),
        }
      }

      if (table === 'survey_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'link-question',
                  survey_id: 'survey-1',
                  question_type: 'link',
                  question_text: 'Share your game',
                  options: [],
                  response_max_chars: 2048,
                  position: 0,
                  created_at: '2026-01-01T00:00:00.000Z',
                  updated_at: '2026-01-01T00:00:00.000Z',
                },
                {
                  id: 'text-question',
                  survey_id: 'survey-1',
                  question_type: 'short_text',
                  question_text: 'What did you build?',
                  options: [],
                  response_max_chars: 500,
                  position: 1,
                  created_at: '2026-01-01T00:00:00.000Z',
                  updated_at: '2026-01-01T00:00:00.000Z',
                },
              ],
              error: null,
            }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET_SURVEY(
      new NextRequest('http://localhost:3000/api/student/surveys/survey-1'),
      { params: Promise.resolve({ id: 'survey-1' }) },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.student_responses['link-question']).toEqual({
      question_type: 'link',
      response_text: 'https://example.com/game',
    })
    expect(data.student_responses['text-question']).toEqual({
      question_type: 'short_text',
      response_text: 'Built in Godot',
    })
  })
})

describe('GET /api/student/surveys/[id]/results', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('omits classmate student ids from text and link result payloads', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'survey_responses') {
        return {
          select: vi.fn((columns: string) => {
            if (columns === 'id') {
              return {
                eq: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue({ data: [{ id: 'own-response' }], error: null }),
              }
            }

            if (columns === '*') {
              return {
                eq: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'response-1',
                      survey_id: 'survey-1',
                      question_id: 'link-question',
                      student_id: 'student-1',
                      selected_option: null,
                      response_text: 'https://example.com/game',
                      submitted_at: '2026-01-01T00:00:00.000Z',
                      updated_at: '2026-01-01T00:00:00.000Z',
                    },
                    {
                      id: 'response-2',
                      survey_id: 'survey-1',
                      question_id: 'link-question',
                      student_id: 'student-2',
                      selected_option: null,
                      response_text: 'https://example.com/other-game',
                      submitted_at: '2026-01-02T00:00:00.000Z',
                      updated_at: '2026-01-02T00:00:00.000Z',
                    },
                    {
                      id: 'response-3',
                      survey_id: 'survey-1',
                      question_id: 'text-question',
                      student_id: 'student-1',
                      selected_option: null,
                      response_text: 'Built in Godot',
                      submitted_at: '2026-01-03T00:00:00.000Z',
                      updated_at: '2026-01-03T00:00:00.000Z',
                    },
                    {
                      id: 'response-4',
                      survey_id: 'survey-1',
                      question_id: 'text-question',
                      student_id: 'student-2',
                      selected_option: null,
                      response_text: 'Built in Phaser',
                      submitted_at: '2026-01-04T00:00:00.000Z',
                      updated_at: '2026-01-04T00:00:00.000Z',
                    },
                  ],
                  error: null,
                }),
              }
            }

            throw new Error(`Unexpected survey_responses columns: ${columns}`)
          }),
        }
      }

      if (table === 'survey_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'link-question',
                  survey_id: 'survey-1',
                  question_type: 'link',
                  question_text: 'Share your game',
                  options: [],
                  response_max_chars: 2048,
                  position: 0,
                  created_at: '2026-01-01T00:00:00.000Z',
                  updated_at: '2026-01-01T00:00:00.000Z',
                },
                {
                  id: 'text-question',
                  survey_id: 'survey-1',
                  question_type: 'short_text',
                  question_text: 'What did you build?',
                  options: [],
                  response_max_chars: 500,
                  position: 1,
                  created_at: '2026-01-01T00:00:00.000Z',
                  updated_at: '2026-01-01T00:00:00.000Z',
                },
              ],
              error: null,
            }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET_SURVEY_RESULTS(
      new NextRequest('http://localhost:3000/api/student/surveys/survey-1/results'),
      { params: Promise.resolve({ id: 'survey-1' }) },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.results[0].responses).toEqual([
      {
        response_id: 'response-1',
        response_text: 'https://example.com/game',
        submitted_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      {
        response_id: 'response-2',
        response_text: 'https://example.com/other-game',
        submitted_at: '2026-01-02T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
      },
    ])
    expect(data.results[1].responses).toEqual([
      {
        response_id: 'response-3',
        response_text: 'Built in Godot',
        submitted_at: '2026-01-03T00:00:00.000Z',
        updated_at: '2026-01-03T00:00:00.000Z',
      },
      {
        response_id: 'response-4',
        response_text: 'Built in Phaser',
        submitted_at: '2026-01-04T00:00:00.000Z',
        updated_at: '2026-01-04T00:00:00.000Z',
      },
    ])
  })
})
