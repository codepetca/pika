import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/teacher/tests/[id]/questions/[qid]/route'
import { assertTeacherOwnsTest } from '@/lib/server/tests'

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
  isLockedTestQuestionMutationError: vi.fn((error: { code?: string }) => error?.code === '55000'),
  assertTeacherOwnsTest: vi.fn(async () => ({
    ok: true,
    test: {
      id: 'test-1',
      title: 'Unit Test',
      classroom_id: 'classroom-1',
      status: 'draft',
      classrooms: { archived_at: null },
    },
  })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('PATCH /api/teacher/tests/[id]/questions/[qid]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when trying to change an existing question type', async () => {
    const updateSpy = vi.fn()

    ;(mockSupabaseClient.from as any) = vi.fn(() => {
      const selectQuery = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'question-1',
            test_id: 'test-1',
            question_type: 'multiple_choice',
            question_text: 'What is 2 + 2?',
            options: ['3', '4'],
            correct_option: 1,
            points: 1,
            response_max_chars: 5000,
            response_monospace: false,
          },
          error: null,
        }),
      }

      return {
        select: vi.fn(() => selectQuery),
        update: updateSpy,
      }
    })

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/tests/test-1/questions/question-1',
      {
        method: 'PATCH',
        body: JSON.stringify({
          question_type: 'open_response',
        }),
      }
    )

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'test-1', qid: 'question-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Question type cannot be changed after creation')
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('returns 400 when clearing question text on an active test', async () => {
    vi.mocked(assertTeacherOwnsTest).mockResolvedValueOnce({
      ok: true,
      test: {
        id: 'test-1',
        title: 'Unit Test',
        classroom_id: 'classroom-1',
        status: 'active',
        classrooms: { archived_at: null },
      } as any,
    })
    const updateSpy = vi.fn()

    ;(mockSupabaseClient.from as any) = vi.fn(() => {
      const selectQuery = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'question-1',
            test_id: 'test-1',
            question_type: 'multiple_choice',
            question_text: 'What is 2 + 2?',
            options: ['3', '4'],
            correct_option: 1,
            points: 1,
            response_max_chars: 5000,
            response_monospace: false,
          },
          error: null,
        }),
      }

      return {
        select: vi.fn(() => selectQuery),
        update: updateSpy,
      }
    })

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/tests/test-1/questions/question-1',
      {
        method: 'PATCH',
        body: JSON.stringify({
          question_text: '   ',
        }),
      }
    )

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'test-1', qid: 'question-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Question text cannot be empty')
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('allows clearing question text on a draft test', async () => {
    vi.mocked(assertTeacherOwnsTest).mockResolvedValueOnce({
      ok: true,
      test: {
        id: 'test-1',
        title: 'Unit Test',
        classroom_id: 'classroom-1',
        status: 'draft',
        classrooms: { archived_at: null },
      } as any,
    })
    const updateSpy = vi.fn((payload: Record<string, unknown>) => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { id: 'question-1', ...payload },
            error: null,
          }),
        })),
      })),
    }))

    ;(mockSupabaseClient.from as any) = vi.fn(() => {
      const selectQuery = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'question-1',
            test_id: 'test-1',
            question_type: 'multiple_choice',
            question_text: 'What is 2 + 2?',
            options: ['3', '4'],
            correct_option: 1,
            points: 1,
            response_max_chars: 5000,
            response_monospace: false,
          },
          error: null,
        }),
      }

      return {
        select: vi.fn(() => selectQuery),
        update: updateSpy,
      }
    })

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/tests/test-1/questions/question-1',
      {
        method: 'PATCH',
        body: JSON.stringify({
          question_text: '   ',
        }),
      }
    )

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'test-1', qid: 'question-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        question_text: '',
      })
    )
    expect(data.question.question_text).toBe('')
  })

  it('returns 409 when student work locks question updates', async () => {
    const updateSpy = vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '55000', message: 'Test questions cannot be changed after student work exists' },
          }),
        })),
      })),
    }))

    ;(mockSupabaseClient.from as any) = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'question-1',
            test_id: 'test-1',
            question_type: 'multiple_choice',
            question_text: 'Original',
            options: ['A', 'B'],
            correct_option: 0,
            points: 1,
            response_max_chars: 5000,
            response_monospace: false,
          },
          error: null,
        }),
      })),
      update: updateSpy,
    }))

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/questions/question-1', {
        method: 'PATCH',
        body: JSON.stringify({ question_text: 'Changed' }),
      }),
      { params: Promise.resolve({ id: 'test-1', qid: 'question-1' }) },
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Test questions cannot be changed after student work exists',
    })
  })
})
