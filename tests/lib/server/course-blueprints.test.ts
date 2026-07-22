import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertTeacherOwnsCourseBlueprint,
  createClassroomFromBlueprint,
  createCourseBlueprintFromClassroom,
  createCourseBlueprint,
  deleteCourseBlueprint,
  getCourseBlueprintDetail,
  getNextTeacherCourseBlueprintPosition,
  hydrateCourseBlueprint,
  importCourseBlueprintBundle,
  syncCourseBlueprintAssignments,
  syncCourseBlueprintAssessments,
  syncCourseBlueprintLessonTemplates,
  updateCourseBlueprint,
} from '@/lib/server/course-blueprints'
import {
  DEFAULT_PLANNED_COURSE_SITE_CONFIG,
} from '@/lib/course-site-publishing'
import { getDefaultClassroomThemeColor } from '@/lib/classroom-theme'
import { makeQueryBuilder, makeSupabaseFromQueues } from '../../support/supabase'

let mockSupabase: any
const mockAssertTeacherCanMutateClassroom = vi.fn()
const mockLoadClassroomBlueprintSource = vi.fn()

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabase),
}))

vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherCanMutateClassroom: (...args: any[]) => mockAssertTeacherCanMutateClassroom(...args),
}))

vi.mock('@/lib/server/classroom-blueprint-source', () => ({
  loadClassroomBlueprintSource: (...args: any[]) => mockLoadClassroomBlueprintSource(...args),
}))

describe('course-blueprints server helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAssertTeacherCanMutateClassroom.mockReset()
    mockLoadClassroomBlueprintSource.mockReset()
  })

  it('hydrates missing planned-site fields with defaults', () => {
    expect(hydrateCourseBlueprint({ id: 'b-1', title: 'Blueprint' } as any)).toEqual(
      expect.objectContaining({
        id: 'b-1',
        title: 'Blueprint',
        planned_site_slug: null,
        planned_site_published: false,
        planned_site_config: DEFAULT_PLANNED_COURSE_SITE_CONFIG,
      })
    )
  })

  it('checks blueprint ownership and reports not found / forbidden states', async () => {
    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [
        makeQueryBuilder({ data: { id: 'b-1', teacher_id: 'teacher-1' }, error: null }),
      ],
    })
    await expect(assertTeacherOwnsCourseBlueprint('teacher-1', 'b-1')).resolves.toEqual(
      expect.objectContaining({ ok: true })
    )

    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [
        makeQueryBuilder({ data: null, error: { code: 'PGRST116' } }),
      ],
    })
    await expect(assertTeacherOwnsCourseBlueprint('teacher-1', 'missing')).resolves.toEqual(
      expect.objectContaining({ ok: false, status: 404 })
    )

    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [
        makeQueryBuilder({ data: { id: 'b-1', teacher_id: 'other' }, error: null }),
      ],
    })
    await expect(assertTeacherOwnsCourseBlueprint('teacher-1', 'b-1')).resolves.toEqual(
      expect.objectContaining({ ok: false, status: 403 })
    )
  })

  it('computes the next teacher blueprint position', async () => {
    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [makeQueryBuilder({ data: { position: -4 }, error: null })],
    })
    await expect(getNextTeacherCourseBlueprintPosition(mockSupabase, 'teacher-1')).resolves.toBe(-5)

    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [makeQueryBuilder({ data: null, error: null })],
    })
    await expect(getNextTeacherCourseBlueprintPosition(mockSupabase, 'teacher-1')).resolves.toBe(0)
  })

  it('creates and updates blueprints with slug validation', async () => {
    const insertBuilder = makeQueryBuilder({
      data: { id: 'b-1', teacher_id: 'teacher-1', title: 'Blueprint 1' },
      error: null,
    })
    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [
        makeQueryBuilder({ data: { position: -1 }, error: null }),
        insertBuilder,
      ],
    })

    const created = await createCourseBlueprint('teacher-1', { title: 'Blueprint 1' })
    expect(created).toEqual(
      expect.objectContaining({
        id: 'b-1',
        title: 'Blueprint 1',
        planned_site_config: DEFAULT_PLANNED_COURSE_SITE_CONFIG,
      })
    )
    expect(insertBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      teacher_id: 'teacher-1',
      position: -2,
      planned_site_config: DEFAULT_PLANNED_COURSE_SITE_CONFIG,
    }))

    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [
        makeQueryBuilder({ data: { id: 'b-1', teacher_id: 'teacher-1' }, error: null }),
        makeQueryBuilder({ data: [{ id: 'b-2' }], error: null }),
      ],
    })
    await expect(updateCourseBlueprint('teacher-1', 'b-1', { planned_site_slug: 'blueprint-1' })).resolves.toEqual(
      expect.objectContaining({ ok: false, status: 409 })
    )

    const updateBuilder = makeQueryBuilder({
      data: {
        id: 'b-1',
        teacher_id: 'teacher-1',
        title: 'Updated',
        planned_site_slug: 'updated',
        planned_site_published: true,
        planned_site_config: { overview: false },
      },
      error: null,
    })
    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [
        makeQueryBuilder({ data: { id: 'b-1', teacher_id: 'teacher-1' }, error: null }),
        makeQueryBuilder({ data: [], error: null }),
        updateBuilder,
      ],
    })
    await expect(updateCourseBlueprint('teacher-1', 'b-1', {
      title: 'Updated',
      planned_site_slug: 'updated',
      planned_site_published: true,
      planned_site_config: { overview: false } as any,
    })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        blueprint: expect.objectContaining({
          planned_site_config: expect.objectContaining({ overview: false, outline: true }),
        }),
      })
    )

    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [
        makeQueryBuilder({
          data: { id: 'b-1', teacher_id: 'teacher-1', planned_site_slug: null, planned_site_published: false },
          error: null,
        }),
      ],
    })
    await expect(updateCourseBlueprint('teacher-1', 'b-1', {
      planned_site_published: true,
    })).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        error: 'A planned site slug is required before publishing the planned site',
      })
    )
  })

  it('can replace only one assessment type without deleting the other type', async () => {
    const deleteBuilder = makeQueryBuilder({ data: null, error: null })
    const updateBuilder = makeQueryBuilder({ data: null, error: null })
    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [
        makeQueryBuilder({ data: { id: 'b-1', teacher_id: 'teacher-1' }, error: null }),
      ],
      course_blueprint_assessments: [
        makeQueryBuilder({
          data: [
            { id: 'q-1', assessment_type: 'quiz' },
            { id: 'q-2', assessment_type: 'quiz' },
            { id: 't-1', assessment_type: 'test' },
          ],
          error: null,
        }),
        deleteBuilder,
        updateBuilder,
      ],
    })

    await expect(syncCourseBlueprintAssessments(
      'teacher-1',
      'b-1',
      [{
        id: 'q-1',
        assessment_type: 'quiz',
        title: 'Quiz 1',
        content: { title: 'Quiz 1', show_results: true, questions: [] } as any,
        documents: [],
        position: 0,
      }],
      { replaceTypes: ['quiz'] }
    )).resolves.toEqual({ ok: true })

    expect(deleteBuilder.in).toHaveBeenCalledWith('id', ['q-2'])
    expect(updateBuilder.eq).toHaveBeenCalledWith('id', 'q-1')
  })

  it('rejects unknown assignment update IDs before deleting existing blueprint assignments', async () => {
    const deleteBuilder = makeQueryBuilder({ data: null, error: null })
    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [
        makeQueryBuilder({ data: { id: 'b-1', teacher_id: 'teacher-1' }, error: null }),
      ],
      course_blueprint_assignments: [
        makeQueryBuilder({
          data: [{ id: 'a-1' }, { id: 'a-2' }],
          error: null,
        }),
        deleteBuilder,
      ],
    })

    await expect(syncCourseBlueprintAssignments('teacher-1', 'b-1', [{
      id: 'stale-assignment-id',
      title: 'Updated Essay',
      instructions_markdown: 'Updated instructions',
      default_due_days: 1,
      default_due_time: '23:59',
      points_possible: 10,
      include_in_final: true,
      is_draft: false,
      position: 0,
    }])).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'Cannot update unknown blueprint assignment',
    })

    expect(deleteBuilder.delete).not.toHaveBeenCalled()
  })

  it('rejects unknown assessment update IDs before deleting existing blueprint assessments', async () => {
    const deleteBuilder = makeQueryBuilder({ data: null, error: null })
    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [
        makeQueryBuilder({ data: { id: 'b-1', teacher_id: 'teacher-1' }, error: null }),
      ],
      course_blueprint_assessments: [
        makeQueryBuilder({
          data: [
            { id: 'q-1', assessment_type: 'quiz' },
            { id: 'q-2', assessment_type: 'quiz' },
          ],
          error: null,
        }),
        deleteBuilder,
      ],
    })

    await expect(syncCourseBlueprintAssessments(
      'teacher-1',
      'b-1',
      [{
        id: 'stale-assessment-id',
        assessment_type: 'quiz',
        title: 'Updated Quiz',
        content: { title: 'Updated Quiz', show_results: true, questions: [] } as any,
        documents: [],
        position: 0,
      }],
      { replaceTypes: ['quiz'] },
    )).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'Cannot update unknown blueprint assessment',
    })

    expect(deleteBuilder.delete).not.toHaveBeenCalled()
  })

  it('rejects assessment type drift before deleting existing blueprint assessments', async () => {
    const deleteBuilder = makeQueryBuilder({ data: null, error: null })
    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [
        makeQueryBuilder({ data: { id: 'b-1', teacher_id: 'teacher-1' }, error: null }),
      ],
      course_blueprint_assessments: [
        makeQueryBuilder({
          data: [
            { id: 'q-1', assessment_type: 'quiz' },
            { id: 'q-2', assessment_type: 'quiz' },
          ],
          error: null,
        }),
        deleteBuilder,
      ],
    })

    await expect(syncCourseBlueprintAssessments(
      'teacher-1',
      'b-1',
      [{
        id: 'q-1',
        assessment_type: 'test',
        title: 'Updated Test',
        content: { title: 'Updated Test', questions: [] } as any,
        documents: [],
        position: 0,
      }],
    )).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'Cannot change blueprint assessment type during bulk sync',
    })

    expect(deleteBuilder.delete).not.toHaveBeenCalled()
  })

  it('rejects assessment updates outside the selected replacement type before deleting rows', async () => {
    const deleteBuilder = makeQueryBuilder({ data: null, error: null })
    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [
        makeQueryBuilder({ data: { id: 'b-1', teacher_id: 'teacher-1' }, error: null }),
      ],
      course_blueprint_assessments: [
        makeQueryBuilder({
          data: [
            { id: 'q-1', assessment_type: 'quiz' },
            { id: 't-1', assessment_type: 'test' },
          ],
          error: null,
        }),
        deleteBuilder,
      ],
    })

    await expect(syncCourseBlueprintAssessments(
      'teacher-1',
      'b-1',
      [{
        id: 't-1',
        assessment_type: 'test',
        title: 'Updated Test',
        content: { title: 'Updated Test', questions: [] } as any,
        documents: [],
        position: 0,
      }],
      { replaceTypes: ['quiz'] },
    )).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'Cannot update a blueprint assessment outside the selected assessment type',
    })

    expect(deleteBuilder.delete).not.toHaveBeenCalled()
  })

  it('rejects unknown lesson template update IDs before deleting existing lesson templates', async () => {
    const deleteBuilder = makeQueryBuilder({ data: null, error: null })
    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [
        makeQueryBuilder({ data: { id: 'b-1', teacher_id: 'teacher-1' }, error: null }),
      ],
      course_blueprint_lesson_templates: [
        makeQueryBuilder({
          data: [{ id: 'l-1' }, { id: 'l-2' }],
          error: null,
        }),
        deleteBuilder,
      ],
    })

    await expect(syncCourseBlueprintLessonTemplates('teacher-1', 'b-1', [{
      id: 'stale-lesson-id',
      title: 'Updated Lesson',
      content_markdown: 'Updated markdown',
      position: 0,
    }])).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'Cannot update unknown lesson template',
    })

    expect(deleteBuilder.delete).not.toHaveBeenCalled()
  })

  it('loads detail hydration and deletes owned blueprints', async () => {
    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [
        makeQueryBuilder({
          data: {
            id: 'b-1',
            teacher_id: 'teacher-1',
            title: 'Blueprint 1',
            overview_markdown: '',
            outline_markdown: '',
            resources_markdown: '',
          },
          error: null,
        }),
        makeQueryBuilder({ data: { content_revision: 1 }, error: null }),
      ],
      course_blueprint_assignments: [
        makeQueryBuilder({ data: [{ id: 'a-1', title: 'Essay', position: 0 }], error: null }),
      ],
      course_blueprint_assessments: [
        makeQueryBuilder({
          data: [{ id: 'q-1', assessment_type: 'quiz', title: 'Quiz 1', content: {}, documents: null, position: 0 }],
          error: null,
        }),
      ],
      course_blueprint_lesson_templates: [
        makeQueryBuilder({ data: [{ id: 'l-1', title: 'Lesson 1', content_markdown: '', position: 0 }], error: null }),
      ],
      classrooms: [
        makeQueryBuilder({
          data: [{
            id: 'c-1',
            title: 'Semester 1',
            class_code: 'ABC123',
            theme_color: 'blue',
            term_label: 'Sem 1',
            actual_site_published: true,
            archived_at: null,
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-02T00:00:00Z',
          }],
          error: null,
        }),
      ],
    })

    const detail = await getCourseBlueprintDetail('teacher-1', 'b-1')
    expect(detail.detail).toEqual(
      expect.objectContaining({
        assignments: [expect.objectContaining({ title: 'Essay' })],
        assessments: [expect.objectContaining({ documents: [] })],
        linked_classrooms: [expect.objectContaining({ title: 'Semester 1', actual_site_published: true })],
      })
    )

    const deleteBuilder = makeQueryBuilder({ data: null, error: null })
    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [
        makeQueryBuilder({ data: { id: 'b-1', teacher_id: 'teacher-1' }, error: null }),
        deleteBuilder,
      ],
    })
    await expect(deleteCourseBlueprint('teacher-1', 'b-1')).resolves.toEqual({ ok: true })
    expect(deleteBuilder.delete).toHaveBeenCalled()
  })

  it('rejects a mixed-revision blueprint detail snapshot', async () => {
    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [
        makeQueryBuilder({
          data: {
            id: 'b-1',
            teacher_id: 'teacher-1',
            content_revision: 3,
            title: 'Blueprint 1',
          },
          error: null,
        }),
        makeQueryBuilder({ data: { content_revision: 4 }, error: null }),
      ],
      course_blueprint_assignments: [makeQueryBuilder({ data: [], error: null })],
      course_blueprint_assessments: [makeQueryBuilder({ data: [], error: null })],
      course_blueprint_lesson_templates: [makeQueryBuilder({ data: [], error: null })],
      classrooms: [makeQueryBuilder({ data: [], error: null })],
    })

    await expect(getCourseBlueprintDetail('teacher-1', 'b-1')).resolves.toEqual({
      detail: null,
      error: 'Course blueprint changed while loading; review and retry',
      status: 409,
    })
  })

  it('fails a blueprint import without issuing compensating deletes', async () => {
    const operationId = '10000000-0000-4000-8000-000000000010'
    const deleteBuilder = makeQueryBuilder({ data: null, error: null })
    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [
        makeQueryBuilder({ data: { position: -1 }, error: null }),
        makeQueryBuilder({
          data: { id: 'b-1', teacher_id: 'teacher-1', title: 'Imported blueprint' },
          error: null,
        }),
        makeQueryBuilder({ data: { id: 'b-1', teacher_id: 'teacher-1' }, error: null }),
        makeQueryBuilder({
          data: {
            id: 'b-1',
            teacher_id: 'teacher-1',
            title: 'Imported blueprint',
            planned_site_config: DEFAULT_PLANNED_COURSE_SITE_CONFIG,
          },
          error: null,
        }),
        makeQueryBuilder({ data: { id: 'b-1', teacher_id: 'teacher-1' }, error: null }),
        deleteBuilder,
      ],
      course_blueprint_assignments: [
        makeQueryBuilder({ data: null, error: { message: 'assignment sync failed' } }),
      ],
    })
    mockSupabase.rpc = vi.fn().mockResolvedValue({
      data: {
        ok: false,
        status: 500,
        operation_id: operationId,
        operation_type: 'import',
        error_code: 'create_blueprint_assignments_failed',
        error: 'Atomic blueprint creation failed',
        retryable: true,
      },
      error: null,
    })

    const result = await importCourseBlueprintBundle('teacher-1', {
      manifest: {
        version: '2',
        exported_at: '2026-04-20T00:00:00Z',
        title: 'Imported blueprint',
        subject: '',
        grade_level: '',
        course_code: '',
        term_template: '',
      },
      files: {
        'course-overview.md': '',
        'course-outline.md': '',
        'resources.md': '',
        'assignments.md': '# Assignment 1\n\n## Instructions\n\nBody\n',
        'tests.md': '',
        'lesson-plans.md': '',
      },
    } as any, { operationId })

    expect(result).toEqual(expect.objectContaining({ ok: false, status: 500 }))
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'create_course_blueprint_atomic',
      expect.objectContaining({
        p_operation_id: operationId,
        p_operation_type: 'import',
        p_plan: expect.objectContaining({
          manifest_version: '2',
          source_package_exported_at: '2026-04-20T00:00:00Z',
        }),
      }),
    )
    expect(deleteBuilder.delete).not.toHaveBeenCalled()
  })

  it('fails classroom instantiation without issuing compensating deletes', async () => {
    const operationId = '10000000-0000-4000-8000-000000000011'
    const deleteBuilder = makeQueryBuilder({ data: null, error: null })
    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [
        makeQueryBuilder({
          data: {
            id: 'b-1',
            teacher_id: 'teacher-1',
            title: 'Blueprint 1',
            overview_markdown: 'Overview',
            outline_markdown: 'Outline',
            resources_markdown: 'Resources',
          },
          error: null,
        }),
        makeQueryBuilder({ data: { content_revision: 1 }, error: null }),
      ],
      course_blueprint_assignments: [
        makeQueryBuilder({ data: [], error: null }),
      ],
      course_blueprint_assessments: [
        makeQueryBuilder({ data: [], error: null }),
      ],
      course_blueprint_lesson_templates: [
        makeQueryBuilder({ data: [], error: null }),
      ],
      classrooms: [
        makeQueryBuilder({ data: [], error: null }),
        makeQueryBuilder({ data: [], error: null }),
        makeQueryBuilder({ data: [], error: null }),
        makeQueryBuilder({ data: null, error: null }),
        makeQueryBuilder({
          data: {
            id: 'c-1',
            teacher_id: 'teacher-1',
            title: 'Semester 1',
            class_code: 'ABC123',
            course_overview_markdown: 'Overview',
            course_outline_markdown: 'Outline',
            start_date: '2026-09-01',
          },
          error: null,
        }),
        makeQueryBuilder({
          data: {
            id: 'c-1',
            teacher_id: 'teacher-1',
            title: 'Semester 1',
            class_code: 'ABC123',
            course_overview_markdown: 'Overview',
            course_outline_markdown: 'Outline',
            start_date: '2026-09-01',
          },
          error: null,
        }),
        deleteBuilder,
      ],
      classroom_resources: [
        makeQueryBuilder({ data: null, error: { message: 'resource clone failed' } }),
      ],
    })
    mockSupabase.rpc = vi.fn().mockResolvedValue({
      data: {
        ok: false,
        status: 500,
        operation_id: operationId,
        operation_type: 'instantiate',
        error_code: 'create_classroom_resources_failed',
        error: 'Atomic blueprint instantiation failed',
        retryable: true,
      },
      error: null,
    })

    await expect(createClassroomFromBlueprint('teacher-1', {
      blueprintId: 'b-1',
      title: 'Semester 1',
      start_date: '2026-09-01',
      end_date: '2027-01-29',
    } as any, { operationId })).resolves.toEqual(expect.objectContaining({
      ok: false,
      error_code: 'create_classroom_resources_failed',
    }))

    expect(deleteBuilder.delete).not.toHaveBeenCalled()
  })

  it('creates a new blueprint from classroom content and links the classroom to it', async () => {
    mockAssertTeacherCanMutateClassroom.mockResolvedValue({
      ok: true,
      classroom: { id: 'c-1', teacher_id: 'teacher-1', archived_at: null },
    })
    mockLoadClassroomBlueprintSource.mockResolvedValue({
      ok: true,
      source: {
        classroom: {
          id: 'c-1',
          title: 'Semester Classroom',
          blueprint_source_revision: 7,
          course_overview_markdown: 'Overview',
          course_outline_markdown: 'Outline',
        },
        resources_markdown: 'Resources',
        assignments: [
          {
            title: 'Essay',
            instructions_markdown: 'Write an essay',
            default_due_days: 0,
            default_due_time: '23:59',
            points_possible: 20,
            include_in_final: true,
            is_draft: true,
            position: 0,
          },
        ],
        quizzes: [
          {
            assessment_type: 'quiz',
            title: 'Quiz 1',
            content: { title: 'Quiz 1', questions: [] },
            documents: [],
            position: 0,
          },
        ],
        tests: [
          {
            assessment_type: 'test',
            title: 'Unit Test',
            content: { title: 'Unit Test', questions: [] },
            documents: [],
            position: 1,
          },
        ],
        lesson_templates: [
          { title: 'Lesson 1', content_markdown: 'Intro lesson', position: 0 },
        ],
      },
    })

    const assignmentInsertBuilder = makeQueryBuilder({ data: null, error: null })
    const assessmentInsertBuilder = makeQueryBuilder({ data: null, error: null })
    const lessonInsertBuilder = makeQueryBuilder({ data: null, error: null })
    const classroomUpdateBuilder = makeQueryBuilder({ data: null, error: null })

    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [
        makeQueryBuilder({ data: { position: -1 }, error: null }),
        makeQueryBuilder({
          data: { id: 'b-1', teacher_id: 'teacher-1', title: 'Reusable Draft' },
          error: null,
        }),
        makeQueryBuilder({ data: { id: 'b-1', teacher_id: 'teacher-1' }, error: null }),
        makeQueryBuilder({
          data: {
            id: 'b-1',
            teacher_id: 'teacher-1',
            title: 'Reusable Draft',
            planned_site_config: DEFAULT_PLANNED_COURSE_SITE_CONFIG,
            overview_markdown: 'Overview',
            outline_markdown: 'Outline',
            resources_markdown: 'Resources',
          },
          error: null,
        }),
        makeQueryBuilder({ data: { id: 'b-1', teacher_id: 'teacher-1' }, error: null }),
        makeQueryBuilder({ data: { id: 'b-1', teacher_id: 'teacher-1' }, error: null }),
        makeQueryBuilder({ data: { id: 'b-1', teacher_id: 'teacher-1' }, error: null }),
        makeQueryBuilder({
          data: {
            id: 'b-1',
            teacher_id: 'teacher-1',
            title: 'Reusable Draft',
            overview_markdown: 'Overview',
            outline_markdown: 'Outline',
            resources_markdown: 'Resources',
            planned_site_slug: null,
            planned_site_published: false,
            planned_site_config: DEFAULT_PLANNED_COURSE_SITE_CONFIG,
          },
          error: null,
        }),
      ],
      course_blueprint_assignments: [
        makeQueryBuilder({ data: [], error: null }),
        assignmentInsertBuilder,
        makeQueryBuilder({
          data: [{
            id: 'a-1',
            title: 'Essay',
            instructions_markdown: 'Write an essay',
            default_due_days: 0,
            default_due_time: '23:59',
            points_possible: 20,
            include_in_final: true,
            is_draft: false,
            position: 0,
          }],
          error: null,
        }),
      ],
      course_blueprint_assessments: [
        makeQueryBuilder({ data: [], error: null }),
        assessmentInsertBuilder,
        makeQueryBuilder({
          data: [
            {
              id: 'q-1',
              assessment_type: 'quiz',
              title: 'Quiz 1',
              content: { title: 'Quiz 1', questions: [] },
              documents: [],
              position: 0,
            },
            {
              id: 't-1',
              assessment_type: 'test',
              title: 'Unit Test',
              content: { title: 'Unit Test', questions: [] },
              documents: [],
              position: 1,
            },
          ],
          error: null,
        }),
      ],
      course_blueprint_lesson_templates: [
        makeQueryBuilder({ data: [], error: null }),
        lessonInsertBuilder,
        makeQueryBuilder({ data: [{ id: 'l-1', title: 'Lesson 1', content_markdown: 'Intro lesson', position: 0 }], error: null }),
      ],
      classrooms: [
        makeQueryBuilder({ data: [{ id: 'c-1', title: 'Semester Classroom' }], error: null }),
        classroomUpdateBuilder,
      ],
    })

    const operationId = '10000000-0000-4000-8000-000000000012'
    const blueprintId = '20000000-0000-4000-8000-000000000012'
    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [
        makeQueryBuilder({
          data: {
            id: blueprintId,
            teacher_id: 'teacher-1',
            content_revision: 4,
            title: 'Reusable Draft',
            overview_markdown: 'Overview',
            outline_markdown: 'Outline',
            resources_markdown: 'Resources',
            planned_site_config: DEFAULT_PLANNED_COURSE_SITE_CONFIG,
          },
          error: null,
        }),
        makeQueryBuilder({ data: { content_revision: 4 }, error: null }),
      ],
      course_blueprint_assignments: [makeQueryBuilder({ data: [], error: null })],
      course_blueprint_assessments: [makeQueryBuilder({ data: [], error: null })],
      course_blueprint_lesson_templates: [makeQueryBuilder({ data: [], error: null })],
      classrooms: [makeQueryBuilder({ data: [{ id: 'c-1', title: 'Semester Classroom' }], error: null })],
    })
    mockSupabase.rpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        status: 201,
        operation_id: operationId,
        operation_type: 'capture',
        replayed: false,
        blueprint_id: blueprintId,
        source_revision: 7,
        result_content_revision: 4,
        counts: { assignments: 1, assessments: 1, lesson_templates: 1 },
      },
      error: null,
    })

    const result = await createCourseBlueprintFromClassroom(
      'teacher-1',
      'c-1',
      { title: 'Reusable Draft' },
      { operationId },
    )
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        blueprint: expect.objectContaining({ id: blueprintId, title: 'Reusable Draft' }),
        operation_id: operationId,
      })
    )
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'create_course_blueprint_atomic',
      expect.objectContaining({
        p_operation_id: operationId,
        p_operation_type: 'capture',
        p_source_classroom_id: 'c-1',
        p_expected_source_revision: 7,
        p_plan: expect.objectContaining({
          assignments: [expect.objectContaining({ title: 'Essay', is_draft: true })],
          assessments: [expect.objectContaining({ title: 'Unit Test' })],
          lesson_templates: [expect.objectContaining({ title: 'Lesson 1' })],
        }),
      }),
    )
  })

  it('creates a teacher-ready classroom through one atomic write plan', async () => {
    const operationId = '10000000-0000-4000-8000-000000000013'
    const classroomId = '30000000-0000-4000-8000-000000000013'
    const assignmentInsert = makeQueryBuilder({
      data: [{ id: 'new-a-1', title: 'Essay', position: 0 }],
      error: null,
    })
    const requirementInsert = makeQueryBuilder({ data: null, error: null })
    const testInsert = makeQueryBuilder({ data: { id: 'new-t-1' }, error: null })
    const questionInsert = makeQueryBuilder({ data: null, error: null })
    const draftUpsert = makeQueryBuilder({ data: null, error: null })
    const resourceUpsert = makeQueryBuilder({ data: null, error: null })
    const lessonUpsert = makeQueryBuilder({ data: null, error: null })

    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [
        makeQueryBuilder({
          data: {
            id: 'b-1',
            teacher_id: 'teacher-1',
            title: 'Reusable CS',
            overview_markdown: 'Course overview',
            outline_markdown: 'Course outline',
            resources_markdown: 'Course resources',
          },
          error: null,
        }),
        makeQueryBuilder({ data: { content_revision: 1 }, error: null }),
      ],
      course_blueprint_assignments: [makeQueryBuilder({
        data: [{
          id: 'ba-1',
          title: 'Essay',
          instructions_markdown: 'Write an essay',
          submission_requirements_json: [{
            type: 'link',
            label: 'Published essay',
            instructions: '',
            required: true,
            position: 0,
            validation_policy_json: {},
          }],
          default_due_days: 14,
          default_due_time: '23:30',
          points_possible: 20,
          gradebook_weight: 25,
          include_in_final: true,
          is_draft: false,
          position: 0,
        }],
        error: null,
      })],
      course_blueprint_assessments: [makeQueryBuilder({
        data: [{
          id: 'bt-1',
          assessment_type: 'test',
          title: 'Unit Test',
          content: {
            title: 'Unit Test',
            show_results: false,
            questions: [{
              question_type: 'open_response',
              question_text: 'Explain recursion.',
              options: [],
              correct_option: null,
              answer_key: 'A function calls itself.',
              sample_solution: '',
              points: 5,
              response_max_chars: 1000,
              response_monospace: false,
            }],
          },
          documents: [],
          points_possible: 40,
          gradebook_weight: 35,
          include_in_final: false,
          position: 1,
        }],
        error: null,
      })],
      course_blueprint_lesson_templates: [makeQueryBuilder({
        data: [{ id: 'bl-1', title: 'Lesson 1', content_markdown: 'Introduction', position: 0 }],
        error: null,
      })],
      classrooms: [
        makeQueryBuilder({ data: [], error: null }),
        makeQueryBuilder({
          data: { id: classroomId, teacher_id: 'teacher-1', title: 'CS Fall', start_date: '2026-09-08' },
          error: null,
        }),
      ],
      classroom_resources: [resourceUpsert],
      assignments: [assignmentInsert],
      assignment_submission_requirements: [requirementInsert],
      tests: [testInsert],
      test_questions: [questionInsert],
      assessment_drafts: [draftUpsert],
      class_days: [makeQueryBuilder({ data: [{ date: '2026-09-08' }], error: null })],
      lesson_plans: [lessonUpsert],
    })
    mockSupabase.rpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        status: 201,
        operation_id: operationId,
        operation_type: 'instantiate',
        replayed: false,
        classroom_id: classroomId,
        source_revision: 1,
        counts: {
          assignments: 1,
          assessments: 1,
          lesson_templates: 1,
          class_days: 99,
          submission_requirements: 1,
          questions: 1,
        },
        lesson_mapping: {
          applied_lesson_templates: 1,
          overflow_lesson_templates: [],
        },
      },
      error: null,
    })

    const result = await createClassroomFromBlueprint('teacher-1', {
      blueprintId: 'b-1',
      title: 'CS Fall',
      start_date: '2026-09-08',
      end_date: '2027-01-29',
    } as any, { operationId })

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      classroom: expect.objectContaining({ id: classroomId, title: 'CS Fall' }),
      lesson_mapping: { applied_lesson_templates: 1, overflow_lesson_templates: [] },
      operation_id: operationId,
    }))
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'instantiate_course_blueprint_atomic',
      expect.objectContaining({
        p_operation_id: operationId,
        p_plan: expect.objectContaining({
          classroom: expect.objectContaining({
            title: 'CS Fall',
            theme_color: getDefaultClassroomThemeColor(`teacher-1:${operationId}`),
            start_date: '2026-09-08',
            end_date: '2027-01-29',
          }),
          assignments: [expect.objectContaining({
            title: 'Essay',
            due_at: '2026-09-23T03:30:00.000Z',
            gradebook_weight: 25,
            submission_requirements: [expect.objectContaining({ label: 'Published essay' })],
          })],
          tests: [expect.objectContaining({
            title: 'Unit Test',
            points_possible: 40,
            gradebook_weight: 35,
            include_in_final: false,
            questions: [expect.objectContaining({ question_text: 'Explain recursion.', points: 5 })],
          })],
          lesson_plans: [expect.objectContaining({ date: '2026-09-08' })],
        }),
      }),
    )
    expect(mockSupabase.from).not.toHaveBeenCalledWith('classroom_enrollments')
    expect(mockSupabase.from).not.toHaveBeenCalledWith('assignment_docs')
    expect(mockSupabase.from).not.toHaveBeenCalledWith('test_responses')
    expect(mockSupabase.from).not.toHaveBeenCalledWith('attendance')
    expect(mockSupabase.from).not.toHaveBeenCalledWith('announcements')
  })

  it('records classroom-link failure without a best-effort blueprint delete', async () => {
    const operationId = '10000000-0000-4000-8000-000000000014'
    mockAssertTeacherCanMutateClassroom.mockResolvedValue({
      ok: true,
      classroom: { id: 'c-1', teacher_id: 'teacher-1', archived_at: null },
    })
    mockLoadClassroomBlueprintSource.mockResolvedValue({
      ok: true,
      source: {
        classroom: {
          id: 'c-1',
          title: 'Semester Classroom',
          blueprint_source_revision: 9,
          course_overview_markdown: '',
          course_outline_markdown: '',
        },
        resources_markdown: '',
        assignments: [],
        quizzes: [],
        tests: [],
        lesson_templates: [],
      },
    })

    const deleteBuilder = makeQueryBuilder({ data: null, error: null })
    mockSupabase = makeSupabaseFromQueues({
      course_blueprints: [
        makeQueryBuilder({ data: { position: -1 }, error: null }),
        makeQueryBuilder({
          data: { id: 'b-1', teacher_id: 'teacher-1', title: 'Reusable Draft' },
          error: null,
        }),
        makeQueryBuilder({ data: { id: 'b-1', teacher_id: 'teacher-1' }, error: null }),
        makeQueryBuilder({
          data: {
            id: 'b-1',
            teacher_id: 'teacher-1',
            title: 'Reusable Draft',
            planned_site_config: DEFAULT_PLANNED_COURSE_SITE_CONFIG,
          },
          error: null,
        }),
        makeQueryBuilder({ data: { id: 'b-1', teacher_id: 'teacher-1' }, error: null }),
        makeQueryBuilder({ data: { id: 'b-1', teacher_id: 'teacher-1' }, error: null }),
        makeQueryBuilder({ data: { id: 'b-1', teacher_id: 'teacher-1' }, error: null }),
        makeQueryBuilder({
          data: {
            id: 'b-1',
            teacher_id: 'teacher-1',
            title: 'Reusable Draft',
            planned_site_config: DEFAULT_PLANNED_COURSE_SITE_CONFIG,
          },
          error: null,
        }),
        deleteBuilder,
      ],
      course_blueprint_assignments: [
        makeQueryBuilder({ data: [], error: null }),
        makeQueryBuilder({ data: null, error: null }),
        makeQueryBuilder({ data: [], error: null }),
      ],
      course_blueprint_assessments: [
        makeQueryBuilder({ data: [], error: null }),
        makeQueryBuilder({ data: null, error: null }),
        makeQueryBuilder({ data: [], error: null }),
      ],
      course_blueprint_lesson_templates: [
        makeQueryBuilder({ data: [], error: null }),
        makeQueryBuilder({ data: null, error: null }),
        makeQueryBuilder({ data: [], error: null }),
      ],
      classrooms: [
        makeQueryBuilder({ data: [], error: null }),
        makeQueryBuilder({ data: null, error: { message: 'link failed' } }),
      ],
    })
    mockSupabase.rpc = vi.fn().mockResolvedValue({
      data: {
        ok: false,
        status: 409,
        operation_id: operationId,
        operation_type: 'capture',
        error_code: 'source_classroom_changed',
        error: 'Source classroom changed before the blueprint could be saved',
        retryable: true,
      },
      error: null,
    })

    const result = await createCourseBlueprintFromClassroom(
      'teacher-1',
      'c-1',
      { title: 'Reusable Draft' },
      { operationId },
    )
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      status: 409,
      error_code: 'source_classroom_changed',
    }))
    expect(deleteBuilder.delete).not.toHaveBeenCalled()
  })
})
