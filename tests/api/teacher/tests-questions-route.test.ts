import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/tests/[id]/questions/route'
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

describe('POST /api/teacher/tests/[id]/questions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows empty question text for draft tests', async () => {
    const insertSpy = vi.fn((payload: Record<string, unknown>) => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: 'question-1', test_id: 'test-1', ...payload },
          error: null,
        }),
      })),
    }))

    ;(mockSupabaseClient.from as any) = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { position: 1 }, error: null }),
      })),
      insert: insertSpy,
    }))

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/questions', {
        method: 'POST',
        body: JSON.stringify({
          question_type: 'multiple_choice',
          question_text: '   ',
          options: ['Option 1', 'Option 2'],
          correct_option: 0,
          points: 1,
          response_max_chars: 5000,
          response_monospace: false,
        }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        test_id: 'test-1',
        question_text: '',
      })
    )
    expect(data.question.question_text).toBe('')
  })

  it('rejects empty question text for active tests', async () => {
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

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/questions', {
        method: 'POST',
        body: JSON.stringify({
          question_type: 'multiple_choice',
          question_text: '   ',
          options: ['Option 1', 'Option 2'],
          correct_option: 0,
          points: 1,
          response_max_chars: 5000,
          response_monospace: false,
        }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Question text is required')
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })
})
