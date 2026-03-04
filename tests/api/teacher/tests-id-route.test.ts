import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/teacher/tests/[id]/route'

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

vi.mock('@/lib/server/tests', () => ({
  assertTeacherOwnsTest: vi.fn(async () => ({
    ok: true,
    test: {
      id: 'test-1',
      title: 'Unit Test',
      classroom_id: 'classroom-1',
      status: 'draft',
      show_results: false,
      position: 0,
      points_possible: null,
      include_in_final: false,
      created_by: 'teacher-1',
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
      classrooms: { archived_at: null },
    },
  })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('PATCH /api/teacher/tests/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when activating with an incomplete question', async () => {
    const updateSpy = vi.fn()

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'q-1',
                  position: 0,
                  question_type: 'multiple_choice',
                  question_text: '   ',
                  options: ['Option 1', 'Option 2'],
                  correct_option: 0,
                  points: 1,
                  response_max_chars: 5000,
                  response_monospace: false,
                },
              ],
              error: null,
            }),
          })),
        }
      }

      if (table === 'tests') {
        return { update: updateSpy }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'active' }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Q1: Question text is required')
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('activates a draft test when all questions are complete', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'q-1',
                  position: 0,
                  question_type: 'multiple_choice',
                  question_text: 'What is 2 + 2?',
                  options: ['3', '4'],
                  correct_option: 1,
                  points: 1,
                  response_max_chars: 5000,
                  response_monospace: false,
                },
              ],
              error: null,
            }),
          })),
        }
      }

      if (table === 'tests') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'test-1',
                    classroom_id: 'classroom-1',
                    title: 'Unit Test',
                    status: 'active',
                    show_results: false,
                  },
                  error: null,
                }),
              })),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'active' }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.quiz.status).toBe('active')
  })
})
