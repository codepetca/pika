import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadClassroomBlueprintSource } from '@/lib/server/classroom-blueprint-source'
import { makeQueryBuilder, makeSupabaseFromQueues } from '../../support/supabase'

let mockSupabase: any
const mockAssertTeacherOwnsClassroom = vi.fn()
const mockHydrateClassroomRecord = vi.fn((row) => row)

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabase),
}))

vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherOwnsClassroom: (...args: any[]) => mockAssertTeacherOwnsClassroom(...args),
  hydrateClassroomRecord: (...args: any[]) => mockHydrateClassroomRecord(...args),
}))

vi.mock('@/lib/assignment-instructions', () => ({
  getAssignmentInstructionsMarkdown: vi.fn((assignment: any) => ({
    markdown: assignment.instructions_markdown ?? '',
  })),
}))

vi.mock('@/lib/lesson-plan-content', () => ({
  getLessonPlanMarkdown: vi.fn((plan: any) => ({
    markdown: plan.content_markdown ?? '',
  })),
}))

vi.mock('@/lib/limited-markdown', () => ({
  tiptapToMarkdown: vi.fn((content: any) => ({ markdown: content?.markdown ?? '' })),
}))

function seedSourceSupabase(overrides?: {
  quizQuestionsError?: any
  assessmentDraftError?: any
}) {
  mockSupabase = makeSupabaseFromQueues({
    classrooms: [
      makeQueryBuilder({
        data: { id: 'c-1', teacher_id: 'teacher-1', title: 'CS 11', course_overview_markdown: '', course_outline_markdown: '' },
        error: null,
      }),
    ],
    classroom_resources: [
      makeQueryBuilder({ data: { content: { markdown: 'Resources' } }, error: null }),
    ],
    assignments: [
      makeQueryBuilder({ data: [], error: null }),
    ],
    quizzes: [
      makeQueryBuilder({ data: [{ id: 'q-1', title: 'Quiz 1', status: 'published', show_results: true, position: 0 }], error: null }),
    ],
    tests: [
      makeQueryBuilder({ data: [], error: null }),
    ],
    lesson_plans: [
      makeQueryBuilder({ data: [], error: null }),
    ],
    announcements: [
      makeQueryBuilder({ data: [], error: null }),
    ],
    quiz_questions: [
      makeQueryBuilder({
        data: overrides?.quizQuestionsError ? null : [{ id: 'qq-1', prompt: 'Q1' }],
        error: overrides?.quizQuestionsError ?? null,
      }),
    ],
    assessment_drafts: [
      makeQueryBuilder({
        data: overrides?.assessmentDraftError ? null : { content: { title: 'Quiz 1', questions: [] } },
        error: overrides?.assessmentDraftError ?? null,
      }),
    ],
  })
}

describe('classroom blueprint source loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAssertTeacherOwnsClassroom.mockResolvedValue({
      ok: true,
      classroom: { id: 'c-1', teacher_id: 'teacher-1', archived_at: null },
    })
  })

  it('returns a 500 when nested quiz question loading fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    seedSourceSupabase({ quizQuestionsError: { message: 'quiz questions failed' } })

    await expect(loadClassroomBlueprintSource('teacher-1', 'c-1')).resolves.toEqual({
      ok: false,
      status: 500,
      error: 'Failed to load classroom content',
    })

    errorSpy.mockRestore()
  })

  it('returns a 500 when nested assessment draft loading fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    seedSourceSupabase({ assessmentDraftError: { message: 'draft failed' } })

    await expect(loadClassroomBlueprintSource('teacher-1', 'c-1')).resolves.toEqual({
      ok: false,
      status: 500,
      error: 'Failed to load classroom content',
    })

    errorSpy.mockRestore()
  })
})
