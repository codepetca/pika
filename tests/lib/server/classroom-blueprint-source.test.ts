import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadClassroomBlueprintSource,
  projectPortableTestQuestionIds,
} from '@/lib/server/classroom-blueprint-source'
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
  testQuestionsError?: any
  assessmentDraftError?: any
  classroom?: Record<string, any>
  finalSourceRevision?: number
  assignments?: Array<Record<string, any>>
  assignmentRequirements?: Array<Record<string, any>>
  tests?: Array<Record<string, any>>
  testQuestions?: Array<Record<string, any>>
  assessmentDrafts?: Array<Record<string, any>>
  materials?: Array<Record<string, any>>
  surveys?: Array<Record<string, any>>
  surveyQuestions?: Array<Record<string, any>>
  grading?: Record<string, any> | null
}) {
  const classroom = {
    id: 'c-1',
    teacher_id: 'teacher-1',
    title: 'CS 11',
    course_overview_markdown: '',
    course_outline_markdown: '',
    blueprint_source_revision: 1,
    ...overrides?.classroom,
  }
  mockSupabase = makeSupabaseFromQueues({
    classrooms: [
      makeQueryBuilder({ data: classroom, error: null }),
      makeQueryBuilder({
        data: {
          blueprint_source_revision:
            overrides?.finalSourceRevision ?? classroom.blueprint_source_revision,
        },
        error: null,
      }),
    ],
    classroom_resources: [
      makeQueryBuilder({ data: { content: { markdown: 'Resources' } }, error: null }),
    ],
    assignments: [
      makeQueryBuilder({ data: overrides?.assignments || [], error: null }),
    ],
    assignment_submission_requirements: overrides?.assignments?.length
      ? [makeQueryBuilder({ data: overrides.assignmentRequirements || [], error: null })]
      : [],
    tests: [
      makeQueryBuilder({
        data: overrides?.tests || [{ id: 't-1', title: 'Test 1', status: 'active', show_results: true, position: 0 }],
        error: null,
      }),
    ],
    lesson_plans: [
      makeQueryBuilder({ data: [], error: null }),
    ],
    classwork_materials: [
      makeQueryBuilder({ data: overrides?.materials || [], error: null }),
    ],
    surveys: [
      makeQueryBuilder({ data: overrides?.surveys || [], error: null }),
    ],
    gradebook_settings: [
      makeQueryBuilder({ data: overrides?.grading ?? null, error: null }),
    ],
    announcements: [
      makeQueryBuilder({ data: [], error: null }),
    ],
    test_questions: [
      makeQueryBuilder({
        data: overrides?.testQuestionsError
          ? null
          : overrides?.testQuestions || [{ id: 'tq-1', test_id: 't-1', prompt: 'Q1' }],
        error: overrides?.testQuestionsError ?? null,
      }),
    ],
    assessment_drafts: [
      makeQueryBuilder({
        data: overrides?.assessmentDraftError
          ? null
          : overrides?.assessmentDrafts || [{
            assessment_id: 't-1',
            content: { title: 'Test 1', questions: [] },
          }],
        error: overrides?.assessmentDraftError ?? null,
      }),
    ],
    survey_questions: overrides?.surveys?.length
      ? [makeQueryBuilder({ data: overrides.surveyQuestions || [], error: null })]
      : [],
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

  it('returns a 500 when nested test question loading fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    seedSourceSupabase({ testQuestionsError: { message: 'test questions failed' } })

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

  it('preserves assignment timing relative to the source classroom start in Toronto', async () => {
    seedSourceSupabase({
      classroom: {
        id: 'c-1',
        teacher_id: 'teacher-1',
        title: 'CS 11',
        start_date: '2026-02-02',
        course_overview_markdown: '',
        course_outline_markdown: '',
      },
      assignments: [{
        id: 'a-1',
        title: 'Project',
        instructions_markdown: 'Build it',
        due_at: '2026-02-16T04:30:00.000Z',
        gradebook_weight: 25,
        is_draft: false,
        position: 2,
      }],
      assignmentRequirements: [{
        id: 'r-1',
        assignment_id: 'a-1',
        type: 'link',
        label: 'Published project',
        instructions: 'Share a public URL',
        required: true,
        position: 0,
        validation_policy_json: {},
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }],
    })

    const result = await loadClassroomBlueprintSource('teacher-1', 'c-1')

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    if (!result.ok) throw new Error('Expected classroom source to load')
    expect(result.source.assignments).toEqual([
      expect.objectContaining({
        title: 'Project',
        default_due_days: 13,
        default_due_time: '23:30',
        gradebook_weight: 25,
        is_draft: true,
        submission_requirements_json: [
          expect.objectContaining({ id: 'r-1', label: 'Published project' }),
        ],
      }),
    ])
  })

  it('includes draft tests in the reusable blueprint source', async () => {
    seedSourceSupabase({
      tests: [
        { id: 't-1', title: 'Published test', status: 'active', show_results: false, position: 0 },
        { id: 't-2', title: 'Draft test', status: 'draft', show_results: false, position: 1 },
      ],
      testQuestions: [
        { id: 'tq-1', test_id: 't-1', prompt: 'Published question' },
        { id: 'tq-2', test_id: 't-2', prompt: 'Draft question' },
      ],
      assessmentDrafts: [
        { assessment_id: 't-1', content: { title: 'Published test', questions: [] } },
        { assessment_id: 't-2', content: { title: 'Draft test', questions: [] } },
      ],
    })

    const result = await loadClassroomBlueprintSource('teacher-1', 'c-1')

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    if (!result.ok) throw new Error('Expected classroom source to load')
    expect(result.source.tests).toEqual([
      expect.objectContaining({ title: 'Published test' }),
      expect.objectContaining({ title: 'Draft test' }),
    ])
    expect(mockSupabase.from.mock.calls.filter(([table]: [string]) => table === 'test_questions')).toHaveLength(1)
    expect(mockSupabase.from.mock.calls.filter(([table]: [string]) => table === 'assessment_drafts')).toHaveLength(1)
  })

  it('uses portable question identity when a Test has no assessment draft row', async () => {
    seedSourceSupabase({
      tests: [{
        id: 't-1',
        artifact_id: '10000000-0000-4000-8000-000000000001',
        title: 'Published test',
        status: 'active',
        show_results: false,
        position: 0,
      }],
      testQuestions: [{
        id: 'question-row-1',
        artifact_id: '20000000-0000-4000-8000-000000000001',
        test_id: 't-1',
        question_type: 'open_response',
        question_text: 'Explain portable identity.',
        position: 0,
      }],
      assessmentDrafts: [],
    })

    const result = await loadClassroomBlueprintSource('teacher-1', 'c-1')

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    if (!result.ok) throw new Error('Expected classroom source to load')
    expect(result.source.tests[0].content.questions).toEqual([
      expect.objectContaining({ id: '20000000-0000-4000-8000-000000000001' }),
    ])
  })

  it('uses portable question identity from a saved assessment draft', async () => {
    seedSourceSupabase({
      tests: [{
        id: 't-1',
        artifact_id: '10000000-0000-4000-8000-000000000001',
        title: 'Draft-backed test',
        status: 'draft',
        show_results: false,
        position: 0,
      }],
      testQuestions: [{
        id: 'question-row-1',
        artifact_id: '20000000-0000-4000-8000-000000000001',
        test_id: 't-1',
        question_type: 'open_response',
        question_text: 'Explain portable identity.',
        position: 0,
      }],
      assessmentDrafts: [{
        assessment_id: 't-1',
        content: {
          title: 'Draft-backed test',
          questions: [{
            id: 'question-row-1',
            question_type: 'open_response',
            question_text: 'Explain portable identity.',
            position: 0,
          }],
        },
      }],
    })

    const result = await loadClassroomBlueprintSource('teacher-1', 'c-1')

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    if (!result.ok) throw new Error('Expected classroom source to load')
    expect(result.source.tests[0].content.questions).toEqual([
      expect.objectContaining({ id: '20000000-0000-4000-8000-000000000001' }),
    ])
  })

  it('captures materialized questions for an active Test instead of a stale draft', async () => {
    seedSourceSupabase({
      tests: [{
        id: 't-1',
        artifact_id: '10000000-0000-4000-8000-000000000001',
        title: 'Activated Test',
        status: 'active',
        show_results: false,
        position: 0,
      }],
      testQuestions: [{
        id: 'question-row-1',
        artifact_id: '20000000-0000-4000-8000-000000000001',
        test_id: 't-1',
        question_type: 'open_response',
        question_text: 'Materialized question A',
        options: [],
        correct_option: null,
        answer_key: 'A',
        sample_solution: null,
        points: 5,
        response_max_chars: 5000,
        response_monospace: false,
        position: 0,
      }],
      assessmentDrafts: [{
        assessment_id: 't-1',
        content: {
          title: 'Stale draft title',
          show_results: true,
          questions: [{
            id: '30000000-0000-4000-8000-000000000001',
            question_type: 'open_response',
            question_text: 'Never activated question B',
            options: [],
            correct_option: null,
            answer_key: 'B',
            sample_solution: null,
            points: 5,
            response_max_chars: 5000,
            response_monospace: false,
          }],
        },
      }],
    })

    const result = await loadClassroomBlueprintSource('teacher-1', 'c-1')

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    if (!result.ok) throw new Error('Expected classroom source to load')
    expect(result.source.tests[0].content).toEqual(expect.objectContaining({
      title: 'Activated Test',
      show_results: false,
      questions: [expect.objectContaining({
        id: '20000000-0000-4000-8000-000000000001',
        question_text: 'Materialized question A',
      })],
    }))
  })

  it('preserves draft-only identity and fails closed on ambiguous persisted identity', () => {
    const content = {
      title: 'Identity contract',
      show_results: false,
      questions: [{
        id: '20000000-0000-4000-8000-000000000001',
        question_type: 'open_response' as const,
        question_text: 'Persisted',
        options: [],
        correct_option: null,
        answer_key: null,
        sample_solution: null,
        points: 1,
        response_max_chars: 5000,
        response_monospace: false,
      }, {
        id: '30000000-0000-4000-8000-000000000001',
        question_type: 'open_response' as const,
        question_text: 'Draft only',
        options: [],
        correct_option: null,
        answer_key: null,
        sample_solution: null,
        points: 1,
        response_max_chars: 5000,
        response_monospace: false,
      }],
    }

    expect(projectPortableTestQuestionIds(content, [{
      id: 'question-row-1',
      artifact_id: '20000000-0000-4000-8000-000000000001',
      source_artifact_id: null,
    }])).toEqual({ ok: true, content })

    expect(projectPortableTestQuestionIds(content, [{
      id: 'question-row-1',
      artifact_id: '20000000-0000-4000-8000-000000000001',
      source_artifact_id: null,
    }, {
      id: 'question-row-2',
      artifact_id: '40000000-0000-4000-8000-000000000001',
      source_artifact_id: '20000000-0000-4000-8000-000000000001',
    }])).toEqual({ ok: false })

    expect(projectPortableTestQuestionIds({
      ...content,
      questions: [{ ...content.questions[0], id: 'question-row-1' }],
    }, [{
      id: 'question-row-1',
      artifact_id: '20000000-0000-4000-8000-000000000001',
      source_artifact_id: null,
    }, {
      id: 'question-row-2',
      artifact_id: 'question-row-1',
      source_artifact_id: null,
    }])).toEqual({ ok: false })
  })

  it('does not carry classroom snapshot ownership into a reusable blueprint', async () => {
    seedSourceSupabase({
      tests: [{
        id: 't-1',
        title: 'Published test',
        status: 'active',
        show_results: false,
        position: 0,
        documents: [{
          id: 'doc-1',
          title: 'Reference',
          source: 'link',
          url: 'https://docs.example.com/reference',
          snapshot_path: 'link-docs/teacher/test/doc-1/snapshots/current',
          snapshot_content_type: 'text/html',
          synced_at: '2026-07-23T12:00:00.000Z',
        }],
      }],
    })

    const result = await loadClassroomBlueprintSource('teacher-1', 'c-1')

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    if (!result.ok) throw new Error('Expected classroom source to load')
    expect(result.source.tests[0].documents).toEqual([{
      id: 'doc-1',
      title: 'Reference',
      source: 'link',
      url: 'https://docs.example.com/reference',
    }])
  })

  it('projects materials, surveys, grading, and portable identity without runtime state', async () => {
    seedSourceSupabase({
      materials: [{
        id: 'm-row',
        artifact_id: '11111111-1111-4111-8111-111111111111',
        title: 'Course guide',
        content: { markdown: 'Read this first.' },
        position: 1,
        is_draft: false,
        released_at: '2026-09-01T12:00:00.000Z',
      }],
      surveys: [{
        id: 's-row',
        artifact_id: '22222222-2222-4222-8222-222222222222',
        title: 'Check-in',
        show_results: false,
        dynamic_responses: true,
        position: 2,
        status: 'active',
        opens_at: '2026-09-02T12:00:00.000Z',
      }],
      surveyQuestions: [{
        id: 'sq-row',
        artifact_id: '33333333-3333-4333-8333-333333333333',
        survey_id: 's-row',
        question_type: 'short_text',
        question_text: 'What do you need?',
        options: [],
        response_max_chars: 300,
        position: 0,
      }],
      grading: {
        use_weights: true,
        assignments_weight: 65,
        tests_weight: 35,
      },
    })

    const result = await loadClassroomBlueprintSource('teacher-1', 'c-1')
    expect(result).toEqual(expect.objectContaining({ ok: true }))
    if (!result.ok) throw new Error('Expected classroom source to load')
    expect(result.source.materials).toEqual([expect.objectContaining({
      artifact_id: '11111111-1111-4111-8111-111111111111',
      content_markdown: 'Read this first.',
      position: 1,
    })])
    expect(result.source.surveys).toEqual([expect.objectContaining({
      artifact_id: '22222222-2222-4222-8222-222222222222',
      questions_json: [expect.objectContaining({
        id: '33333333-3333-4333-8333-333333333333',
      })],
    })])
    expect(result.source.grading).toEqual({
      use_weights: true,
      assignments_weight: 65,
      tests_weight: 35,
    })
    expect(result.source.materials[0]).not.toHaveProperty('released_at')
    expect(result.source.surveys[0]).not.toHaveProperty('status')
    expect(result.source.surveys[0]).not.toHaveProperty('opens_at')
  })

  it('rejects a source snapshot when classroom content changes during loading', async () => {
    seedSourceSupabase({ finalSourceRevision: 2 })

    await expect(loadClassroomBlueprintSource('teacher-1', 'c-1')).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'Classroom content changed while preparing the blueprint; review and retry',
    })
  })
})
