import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyBlueprintMergeSuggestions,
  buildMarkdownSectionContent,
  getBlueprintMergeSuggestionSet,
  getClassroomActualCourseSite,
  getPublishedActualCourseSite,
  getPublishedPlannedCourseSite,
} from '@/lib/server/course-sites'
import {
  makeQueryBuilder,
  makeSupabaseFromQueues as makeStrictSupabaseFromQueues,
} from '../../support/supabase'

function makeSupabaseFromQueues(queues: Record<string, any[]>) {
  const emptyRows = () => Array.from(
    { length: 12 },
    () => makeQueryBuilder({ data: [], error: null }),
  )
  const emptyMaybeSingle = () => Array.from(
    { length: 12 },
    () => makeQueryBuilder({ data: null, error: null }),
  )
  return makeStrictSupabaseFromQueues({
    course_blueprint_materials: emptyRows(),
    course_blueprint_surveys: emptyRows(),
    classwork_materials: emptyRows(),
    surveys: emptyRows(),
    gradebook_settings: emptyMaybeSingle(),
    ...queues,
  })
}

let mockSupabase: any

const mockGetCourseBlueprintDetail = vi.fn()
const mockBuildBlueprintSnapshot = vi.fn((detail: any) => ({
  blueprint_id: detail.id,
  draft_revision: detail.content_revision,
}))
const mockSubmitProposal = vi.fn()
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
  getCourseBlueprintDetail: (...args: any[]) => mockGetCourseBlueprintDetail(...args),
}))

vi.mock('@/lib/server/course-blueprint-versions', () => ({
  buildCourseBlueprintSnapshot: (...args: any[]) => mockBuildBlueprintSnapshot(...args),
}))

vi.mock('@/lib/server/course-blueprint-proposals', () => ({
  submitCourseBlueprintProposal: (...args: any[]) => mockSubmitProposal(...args),
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

function seedActualSiteSupabase(
  sourceBlueprintId = 'b-1',
  actualSiteConfig: Record<string, unknown> = { lesson_plan_scope: 'current_week' },
) {
  mockSupabase = makeSupabaseFromQueues({
    classrooms: [
      makeQueryBuilder({
        data: {
          id: 'c-1',
          teacher_id: 'teacher-1',
          title: 'CS 11',
          class_code: 'ICS4U',
          term_label: 'Semester 1',
          start_date: '2026-02-01',
          end_date: '2026-06-30',
          actual_site_slug: 'cs11',
          actual_site_published: true,
          actual_site_config: actualSiteConfig,
          blueprint_source_revision: 1,
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
          actual_site_config: actualSiteConfig,
          blueprint_source_revision: 1,
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
          {
            id: 'a-1',
            title: 'Essay',
            instructions_markdown: 'New instructions',
            due_at: '2026-05-01T03:59:00.000Z',
            points_possible: 30,
            gradebook_weight: 10,
            include_in_final: true,
            is_draft: false,
            released_at: null,
            position: 0,
          },
          { id: 'a-2', title: 'Draft Assignment', instructions_markdown: 'Ignore', is_draft: true, released_at: null, position: 1 },
          {
            id: 'a-3',
            title: 'Scheduled Assignment',
            instructions_markdown: 'Not yet',
            is_draft: false,
            released_at: '2099-01-01T00:00:00.000Z',
            position: 2,
          },
          {
            id: 'a-4',
            title: 'Released Assignment',
            instructions_markdown: 'Available now',
            is_draft: false,
            released_at: '2020-01-01T00:00:00.000Z',
            include_in_final: false,
            position: 3,
          },
        ],
        error: null,
      }),
    ],
    assignment_submission_requirements: [
      makeQueryBuilder({ data: [], error: null }),
    ],
    tests: [
      makeQueryBuilder({
        data: [
          {
            id: 't-1',
            title: 'Unit Test',
            status: 'published',
            documents: [],
            show_results: false,
            points_possible: 60,
            gradebook_weight: 70,
            include_in_final: true,
            position: 0,
          },
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
    test_questions: [
      makeQueryBuilder({
        data: [{
          id: 'tq-1',
          artifact_id: '20000000-0000-4000-8000-000000000001',
          test_id: 't-1',
          prompt: 'T1',
        }],
        error: null,
      }),
    ],
    assessment_drafts: [
      makeQueryBuilder({ data: [{ assessment_id: 't-1', content: { title: 'Unit Test', questions: [{ id: 'tq-1' }] } }], error: null }),
      makeQueryBuilder({ data: [], error: null }),
      makeQueryBuilder({ data: [{ assessment_id: 't-1', content: { title: 'Unit Test', questions: [{ id: 'tq-1' }] } }], error: null }),
      makeQueryBuilder({ data: [], error: null }),
    ],
    gradebook_settings: [
      makeQueryBuilder({
        data: {
          use_weights: true,
          assignments_weight: 50,
          tests_weight: 30,
        },
        error: null,
      }),
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
    mockSubmitProposal.mockResolvedValue({
      ok: true,
      proposal: { id: 'proposal-1', status: 'needs_review' },
    })
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
          assignments: [
            expect.objectContaining({ title: 'Essay' }),
            expect.objectContaining({ title: 'Released Assignment' }),
          ],
          tests: [expect.objectContaining({ title: 'Unit Test' })],
          grading: expect.objectContaining({
            mode: 'weighted',
            mode_label: 'Weighted by assessment',
            categories: expect.arrayContaining([
              expect.objectContaining({ id: 'assignments', weight_percent: 12.5 }),
              expect.objectContaining({ id: 'tests', weight_percent: 87.5 }),
            ]),
            items: expect.arrayContaining([
              expect.objectContaining({ title: 'Essay', course_weight_percent: 12.5 }),
              expect.objectContaining({ title: 'Unit Test', course_weight_percent: 87.5 }),
            ]),
          }),
          lesson_plans: [expect.objectContaining({ title: 'Lesson 1 (2026-04-16)' })],
          announcements: [expect.objectContaining({ title: 'Visible' })],
        }),
      })
    )

    if (result.ok) {
      expect(result.site.classroom).not.toHaveProperty('teacher_id')
      expect(result.site.classroom).toEqual(expect.objectContaining({
        class_code: 'ICS4U',
      }))
      expect(result.site.classroom).not.toHaveProperty('term_label')
      expect(result.site.classroom).not.toHaveProperty('start_date')
      expect(result.site.classroom).not.toHaveProperty('end_date')
      expect(result.site.classroom).not.toHaveProperty('course_outline_markdown')
      expect(result.site.assignments).toHaveLength(2)
      expect(result.site.assignments.map((assignment) => assignment.title)).not.toContain('Scheduled Assignment')
      expect(result.site.assignments[0]).toEqual(expect.objectContaining({
        due_at: '2026-05-01T03:59:00.000Z',
      }))
      expect(result.site.lesson_plans).toHaveLength(1)
      expect(result.site.announcements).toHaveLength(1)
      expect(mockSupabase.from).not.toHaveBeenCalledWith('gradebook_settings')
      expect(mockSupabase.from).not.toHaveBeenCalledWith('assessment_drafts')
    }
  })

  it('loads the current classroom site without requiring a public slug or publication state', async () => {
    seedActualSiteSupabase()

    const result = await getClassroomActualCourseSite('c-1')

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      site: expect.objectContaining({
        classroom: expect.objectContaining({ id: 'c-1', title: 'CS 11' }),
        assignments: expect.arrayContaining([expect.objectContaining({ title: 'Essay' })]),
      }),
    }))
  })

  it('builds merge suggestions and rejects classrooms from another blueprint', async () => {
    mockGetCourseBlueprintDetail.mockResolvedValue({
      detail: {
        id: 'b-1',
        content_revision: 7,
        authority_mode: 'pika',
        overview_markdown: 'Blueprint overview',
        outline_markdown: 'Blueprint outline',
        resources_markdown: 'Blueprint resources',
        assignments: [{ title: 'Essay', instructions_markdown: 'Old instructions', position: 0 }],
        assessments: [
          { assessment_type: 'test', title: 'Unit Test', content: { version: 1 } },
        ],
        lesson_templates: [{ title: 'Lesson 1 (2026-04-16)', content_markdown: 'Old lesson', position: 0 }],
      },
    })

    seedActualSiteSupabase('b-1', {
      overview: true,
      outline: true,
      resources: true,
      assignments: true,
      tests: false,
      lesson_plans: true,
      lesson_plan_scope: 'current_week',
    })
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
            expect.objectContaining({ area: 'tests' }),
            expect.objectContaining({ area: 'lesson-plans' }),
            expect.objectContaining({ area: 'site-visibility' }),
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

  it('turns selected classroom merge areas into a revision-bound proposal', async () => {
    seedActualSiteSupabase('b-1', {
      overview: true,
      outline: true,
      resources: true,
      assignments: true,
      tests: false,
      lesson_plans: true,
      lesson_plan_scope: 'current_week',
    })
    mockGetCourseBlueprintDetail.mockResolvedValue({
      detail: {
        id: 'b-1',
        content_revision: 7,
        authority_mode: 'pika',
        overview_markdown: 'Old',
        outline_markdown: 'Old',
        resources_markdown: 'Old',
        assignments: [],
        assessments: [],
        lesson_templates: [],
      },
    })

    await expect(applyBlueprintMergeSuggestions('teacher-1', 'b-1', 'c-1', [
      'overview',
      'outline',
      'resources',
      'assignments',
      'tests',
      'lesson-plans',
      'site-visibility',
    ], {
      expectedBlueprintRevision: 7,
      expectedClassroomRevision: 1,
    })).resolves.toEqual({
      ok: true,
      proposal: { id: 'proposal-1', status: 'needs_review' },
    })

    expect(mockSubmitProposal).toHaveBeenCalledWith(expect.objectContaining({
      teacherId: 'teacher-1',
      source: 'classroom',
      expectedBlueprintRevision: 7,
      sourceClassroomId: 'c-1',
      baseClassroomRevision: 1,
    }))
    expect(mockBuildBlueprintSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        planned_site_config: expect.objectContaining({ tests: false }),
      }),
    )

    expect(buildMarkdownSectionContent('Hello')).toEqual(
      expect.objectContaining({ type: 'doc' })
    )
    expect(mockMarkdownToTiptapContent).toHaveBeenCalledWith('Hello')
  })
})
