import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PATCH } from '@/app/api/teacher/quizzes/[id]/draft/route'
import { assertTeacherOwnsQuiz } from '@/lib/server/quizzes'
import {
  buildNextDraftContent,
  getAssessmentDraftByType,
  updateAssessmentDraft,
} from '@/lib/server/assessment-drafts'

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

vi.mock('@/lib/server/quizzes', () => ({
  assertTeacherOwnsQuiz: vi.fn(async () => ({
    ok: true,
    quiz: {
      id: 'quiz-1',
      classroom_id: 'classroom-1',
      title: 'Seed Quiz',
      show_results: false,
      classrooms: { archived_at: null },
    },
  })),
}))

vi.mock('@/lib/server/assessment-drafts', () => ({
  buildNextDraftContent: vi.fn(),
  buildQuizDraftContentFromRows: vi.fn(() => ({
    title: 'Seed Quiz',
    show_results: false,
    questions: [],
  })),
  createAssessmentDraft: vi.fn(),
  getAssessmentDraftByType: vi.fn(),
  isMissingAssessmentDraftsError: vi.fn(() => false),
  updateAssessmentDraft: vi.fn(),
  validateQuizDraftContent: vi.fn((content: any) => ({ valid: true, value: content })),
}))

describe('teacher quiz draft route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAssessmentDraftByType).mockResolvedValue({
      draft: {
        id: 'draft-1',
        assessment_type: 'quiz',
        assessment_id: 'quiz-1',
        classroom_id: 'classroom-1',
        content: { title: 'Seed Quiz', show_results: false, questions: [] },
        version: 2,
        created_by: 'teacher-1',
        updated_by: 'teacher-1',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      },
      error: null,
    } as any)
    vi.mocked(buildNextDraftContent).mockReturnValue({
      ok: true,
      content: { title: 'Updated Quiz', show_results: true, questions: [] },
    } as any)
    vi.mocked(updateAssessmentDraft).mockResolvedValue({
      draft: {
        id: 'draft-1',
        assessment_type: 'quiz',
        assessment_id: 'quiz-1',
        classroom_id: 'classroom-1',
        content: { title: 'Updated Quiz', show_results: true, questions: [] },
        version: 3,
      },
      error: null,
    } as any)
  })

  it('returns the ensured quiz draft', async () => {
    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/quizzes/quiz-1/draft'),
      { params: Promise.resolve({ id: 'quiz-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.draft.id).toBe('draft-1')
  })

  it('returns 409 when the provided version is stale', async () => {
    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/quizzes/quiz-1/draft', {
        method: 'PATCH',
        body: JSON.stringify({ version: 1, content: { title: 'Updated Quiz', show_results: true, questions: [] } }),
      }),
      { params: Promise.resolve({ id: 'quiz-1' }) }
    )

    expect(response.status).toBe(409)
  })

  it('updates draft content and syncs quiz metadata', async () => {
    const quizUpdateSpy = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }))
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'quizzes') return { update: quizUpdateSpy }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/quizzes/quiz-1/draft', {
        method: 'PATCH',
        body: JSON.stringify({ version: 2, content: { title: 'Updated Quiz', show_results: true, questions: [] } }),
      }),
      { params: Promise.resolve({ id: 'quiz-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(quizUpdateSpy).toHaveBeenCalledWith({ title: 'Updated Quiz', show_results: true })
    expect(data.draft.content.title).toBe('Updated Quiz')
    expect(assertTeacherOwnsQuiz).toHaveBeenCalledWith('teacher-1', 'quiz-1', { checkArchived: true })
  })
})
