import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyBlueprintMergeSuggestions,
  buildMarkdownSectionContent,
  getBlueprintMergeSuggestionSet,
  getPublishedActualCourseSite,
  getPublishedPlannedCourseSite,
} from '@/lib/server/course-sites'
import { makeQueryBuilder, makeSupabaseFromQueues } from '../../support/supabase'

let mockSupabase: any

const mockGetCourseBlueprintDetail = vi.fn()
const mockAssertTeacherOwnsCourseBlueprint = vi.fn()
const mockSyncAssignments = vi.fn()
const mockSyncAssessments = vi.fn()
const mockSyncLessons = vi.fn()
const mockUpdateBlueprint = vi.fn()
const mockAssertTeacherOwnsClassroom = vi.fn()
const mockHydrateClassroomRecord = vi.fn((row) => ({
  ...row,
  actual_site_config: row.actual_site_config ?? { lesson_plan_scope: 'current_week' },
  course_overview_markdown: row.course_overview_markdown ?? '',
  course_outline_markdown: row.course_outline_markdown ?? '',
}))
const mockMarkdownToTiptapContent = vi.fn((markdown: string) => ({
  type: 'doc',
  content: markdown ? [{ type: 'paragraph', content: [{ type: 'text', text: markdown }] }] : [],
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabase),
}))

vi.mock('@/lib/server/course-blueprints', () => ({
  assertTeacherOwnsCourseBlueprint: (...args: any[]) => mockAssertTeacherOwnsCourseBlueprint(...args),
  getCourseBlueprintDetail: (...args: any[]) => mockGetCourseBlueprintDetail(...args),
  syncCourseBlueprintAssignments: (...args: any[]) => mockSyncAssignments(...args),
  syncCourseBlueprintAssessments: (...args: any[]) => mockSyncAssessments(...args),
  syncCourseBlueprintLessonTemplates: (...args: any[]) => mockSyncLessons(...args),
  updateCourseBlueprint: (...args: any[]) => mockUpdateBlueprint(...args),
}))

vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherOwnsClassroom: (...args: any[]) => mockAssertTeacherOwnsClassroom(...args),
  hydrateClassroomRecord: (...args: any[]) => mockHydrateClassroomRecord(...args),
}))

vi.mock('@/lib/assignment-instructions', () => ({
  getAssignmentInstructionsMarkdown: vi.fn((assignment: any) => ({
    markdown: assignment.instructions_markdown ?? assignment.instructions ?? '',
  })),
}))

vi.mock('@/lib/lesson-plan-content', () => ({
  getLessonPlanMarkdown: vi.fn((plan: any) => ({
    markdown: plan.content_markdown ?? plan.lesson_markdown ?? '',
  })),
}))

vi.mock('@/lib/limited-markdown', () => ({
  markdownToTiptapContent: (...args: any[]) => mockMarkdownToTiptapContent(...args),
  tiptapToMarkdown: vi.fn((content: any) => ({ markdown: content?.markdown ?? '' })),
}))

vi.mock('@/lib/course-blueprint-assignments', () => ({
  courseBlueprintAssignmentsToMarkdown: vi.fn(() => '# assignments'),
}))

vi.mock('@/lib/course-blueprint-assessments-markdown', () => ({
  courseBlueprintAssessmentsToMarkdown: vi.fn((_items: any, type: string) => `# ${type}`),
}))

vi.mock('@/lib/course-blueprint-lesson-templates', () => ({
  courseBlueprintLessonTemplatesToMarkdown: vi.fn(() => '# lessons'),
}))

vi.mock('@/lib/timezone', () => ({
  nowInToronto: vi.fn(() => new Date('2026-04-15T12:00:00Z')),
}))

function seedActualSiteSupabase(sourceBlueprintId = 'b-1') {
  mockSupabase = makeSupabaseFromQueues({
    classrooms: [
      makeQueryBuilder({
        data: {
          id: 'c-1',
          teacher_id: 'teacher-1',
          title: 'CS 11',
          actual_site_slug: 'cs11',
          actual_site_published: true,
          actual_site_config: { lesson_plan_scope: 'current_week' },
          source_blueprint_id: sourceBlueprintId,
          course_overview_markdown: 'Actual overview',
          course_outline_markdown: 'Actual outline',
        },
        error: null,
      }),
      makeQueryBuilder({
        data: {
          id: 'c-1',
          teacher_id: 'teacher-1',
          title: 'CS 11',
          actual_site_config: { lesson_plan_scope: 'current_week' },
          source_blueprint_id: sourceBlueprintId,
          course_overview_markdown: 'Actual overview',
          course_outline_markdown: 'Actual outline',
        },
        error: null,
      }),
    ],
    classroom_resources: [
      makeQueryBuilder({ data: { id: 'r-1', content: { markdown: 'Actual resources' } }, error: null }),
    ],
    assignments: [
      makeQueryBuilder({
        data: [
          { id: 'a-1', title: 'Essay', instructions_markdown: 'New instructions', is_draft: false, position: 0 },
          { id: 'a-2', title: 'Draft Assignment', instructions_markdown: 'Ignore', is_draft: true, position: 1 },
        ],
        error: null,
      }),
    ],
    quizzes: [
      makeQueryBuilder({
        data: [
          { id: 'q-1', title: 'Quiz 1', status: 'published', show_results: true, position: 0 },
          { id: 'q-2', title: 'Quiz Draft', status: 'draft', show_results: false, position: 1 },
        ],
        error: null,
      }),
    ],
    tests: [
      makeQueryBuilder({
        data: [
          { id: 't-1', title: 'Unit Test', status: 'published', documents: [], show_results: false, position: 0 },
        ],
        error: null,
      }),
    ],
    lesson_plans: [
      makeQueryBuilder({
        data: [
          { id: 'lp-1', date: '2026-04-16', content_markdown: 'Lesson now' },
          { id: 'lp-2', date: '2026-04-30', content_markdown: 'Lesson later' },
        ],
        error: null,
      }),
    ],
    announcements: [
      makeQueryBuilder({
        data: [
          { id: 'ann-1', title: 'Visible', scheduled_for: '2026-04-14T12:00:00Z' },
          { id: 'ann-2', title: 'Future', scheduled_for: '2099-01-01T00:00:00Z' },
        ],
        error: null,
      }),
    ],
    quiz_questions: [
      makeQueryBuilder({ data: [{ id: 'qq-1', prompt: 'Q1' }], error: null }),
      makeQueryBuilder({ data: [{ id: 'qq-2', prompt: 'Q2' }], error: null }),
    ],
    test_questions: [
      makeQueryBuilder({ data: [{ id: 'tq-1', prompt: 'T1' }], error: null }),
    ],
    assessment_drafts: [
      makeQueryBuilder({ data: { content: { title: 'Quiz 1', questions: [{ id: 'qq-1' }] } }, error: null }),
      makeQueryBuilder({ data: null, error: null }),
      makeQueryBuilder({ data: { content: { title: 'Quiz 1', questions: [{ id: 'qq-1' }] } }, error: null }),
      makeQueryBuilder({ data: null, error: null }),
    ],
  })
}

describe('course-sites server helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAssertTeacherOwnsClassroom.mockResolvedValue({
      ok: true,
      classroom: { id: 'c-1', teacher_id: 'teacher-1', archived_at: null },
    })
    mockAssertTeacherOwnsCourseBlueprint.mockResolvedValue({
      ok: true,
      blueprint: { id: 'b-1', teacher_id: 'teacher-1' },
    })
    mockSyncAssignments.mockResolvedValue({ ok: true })
    mockSyncAssessments.mockResolvedValue({ ok: true })
    mockSyncLessons.mockResolvedValue({ ok: true })
    mockUpdateBlueprint.mockResolvedValue({ ok: true })
  })

  it('loads a published planned site and handles missing slugs', async () => {
    mockGetCourseBlueprintDetail.mockResolvedValue({
      detail: { id: 'b-1', title: 'Blueprint', assignments: [], assessments: [], lesson_templates: [] },
    })

    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [
        makeQueryBuilder({
          data: { id: 'b-1', teacher_id: 'teacher-1', planned_site_slug: 'blueprint', planned_site_published: true },
          error: null,
        }),
      ],
    })
    await expect(getPublishedPlannedCourseSite('blueprint')).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        site: { blueprint: expect.objectContaining({ id: 'b-1' }) },
      })
    )

    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [makeQueryBuilder({ data: null, error: { code: 'PGRST116' } })],
    })
    await expect(getPublishedPlannedCourseSite('missing')).resolves.toEqual({
      ok: false,
      status: 404,
      error: 'Planned course site not found',
    })
  })

  it('loads a published actual site and filters draft/future content', async () => {
    seedActualSiteSupabase()

    const result = await getPublishedActualCourseSite('cs11')
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        site: expect.objectContaining({
          assignments: [expect.objectContaining({ title: 'Essay' })],
          quizzes: [expect.objectContaining({ title: 'Quiz 1' })],
          tests: [expect.objectContaining({ title: 'Unit Test' })],
          lesson_plans: [expect.objectContaining({ title: 'Lesson 1 (2026-04-16)' })],
          announcements: [expect.objectContaining({ title: 'Visible' })],
        }),
      })
    )

    if (result.ok) {
      expect(result.site.assignments).toHaveLength(1)
      expect(result.site.lesson_plans).toHaveLength(1)
      expect(result.site.announcements).toHaveLength(1)
    }
  })

  it('builds merge suggestions and rejects classrooms from another blueprint', async () => {
    mockGetCourseBlueprintDetail.mockResolvedValue({
      detail: {
        id: 'b-1',
        overview_markdown: 'Blueprint overview',
        outline_markdown: 'Blueprint outline',
        resources_markdown: 'Blueprint resources',
        assignments: [{ title: 'Essay', instructions_markdown: 'Old instructions', position: 0 }],
        assessments: [
          { assessment_type: 'quiz', title: 'Quiz 1', content: { version: 1 } },
          { assessment_type: 'test', title: 'Unit Test', content: { version: 1 } },
        ],
        lesson_templates: [{ title: 'Lesson 1 (2026-04-16)', content_markdown: 'Old lesson', position: 0 }],
      },
    })

    seedActualSiteSupabase()
    const result = await getBlueprintMergeSuggestionSet('teacher-1', 'b-1', 'c-1')
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        suggestionSet: expect.objectContaining({
          suggestions: expect.arrayContaining([
            expect.objectContaining({ area: 'overview' }),
            expect.objectContaining({ area: 'outline' }),
            expect.objectContaining({ area: 'resources' }),
            expect.objectContaining({ area: 'assignments' }),
            expect.objectContaining({ area: 'quizzes' }),
            expect.objectContaining({ area: 'tests' }),
            expect.objectContaining({ area: 'lesson-plans' }),
          ]),
        }),
      })
    )

    seedActualSiteSupabase('other-blueprint')
    await expect(getBlueprintMergeSuggestionSet('teacher-1', 'b-1', 'c-1')).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'This classroom was not created from the selected blueprint',
    })
  })

  it('applies selected merge areas back into the blueprint and builds section content', async () => {
    seedActualSiteSupabase()

    await expect(applyBlueprintMergeSuggestions('teacher-1', 'b-1', 'c-1', [
      'overview',
      'outline',
      'resources',
      'assignments',
      'quizzes',
      'tests',
      'lesson-plans',
    ])).resolves.toEqual({ ok: true })

    expect(mockUpdateBlueprint).toHaveBeenCalledWith('teacher-1', 'b-1', { overview_markdown: 'Actual overview' })
    expect(mockUpdateBlueprint).toHaveBeenCalledWith('teacher-1', 'b-1', { outline_markdown: 'Actual outline' })
    expect(mockUpdateBlueprint).toHaveBeenCalledWith('teacher-1', 'b-1', { resources_markdown: 'Actual resources' })
    expect(mockSyncAssignments).toHaveBeenCalledWith(
      'teacher-1',
      'b-1',
      expect.arrayContaining([expect.objectContaining({ title: 'Essay' })])
    )
    expect(mockSyncAssessments).toHaveBeenCalledTimes(2)
    expect(mockSyncAssessments).toHaveBeenNthCalledWith(
      1,
      'teacher-1',
      'b-1',
      expect.arrayContaining([expect.objectContaining({ title: 'Quiz 1' })]),
      { replaceTypes: ['quiz'] }
    )
    expect(mockSyncAssessments).toHaveBeenNthCalledWith(
      2,
      'teacher-1',
      'b-1',
      expect.arrayContaining([expect.objectContaining({ title: 'Unit Test' })]),
      { replaceTypes: ['test'] }
    )
    expect(mockSyncLessons).toHaveBeenCalledWith(
      'teacher-1',
      'b-1',
      expect.arrayContaining([expect.objectContaining({ title: 'Lesson 1 (2026-04-16)' })])
    )

    expect(buildMarkdownSectionContent('Hello')).toEqual(
      expect.objectContaining({ type: 'doc' })
    )
    expect(mockMarkdownToTiptapContent).toHaveBeenCalledWith('Hello')
  })
})
