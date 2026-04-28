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
  syncCourseBlueprintAssessments,
  updateCourseBlueprint,
} from '@/lib/server/course-blueprints'
import {
  DEFAULT_PLANNED_COURSE_SITE_CONFIG,
} from '@/lib/course-site-publishing'
import { makeQueryBuilder, makeSupabaseFromQueues } from '../../support/supabase'

let mockSupabase: any
const mockGenerateClassDaysForClassroom = vi.fn()
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

vi.mock('@/lib/server/class-days', () => ({
  generateClassDaysForClassroom: (...args: any[]) => mockGenerateClassDaysForClassroom(...args),
}))

describe('course-blueprints server helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateClassDaysForClassroom.mockReset()
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

  it('rolls back a blueprint import when a later sync step fails', async () => {
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

    const result = await importCourseBlueprintBundle('teacher-1', {
      manifest: {
        version: '1',
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
        'quizzes.md': '',
        'tests.md': '',
        'lesson-plans.md': '',
      },
    } as any)

    expect(result).toEqual(expect.objectContaining({ ok: false, status: 500 }))
    expect(deleteBuilder.delete).toHaveBeenCalled()
  })

  it('rolls back classroom creation when blueprint cloning fails', async () => {
    mockGenerateClassDaysForClassroom.mockResolvedValue({ ok: true })
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

    await expect(createClassroomFromBlueprint('teacher-1', {
      blueprintId: 'b-1',
      title: 'Semester 1',
    } as any)).rejects.toThrow('Failed to clone blueprint resources')

    expect(deleteBuilder.delete).toHaveBeenCalled()
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
            is_draft: false,
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

    const result = await createCourseBlueprintFromClassroom('teacher-1', 'c-1', { title: 'Reusable Draft' })
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        blueprint: expect.objectContaining({ id: 'b-1', title: 'Reusable Draft' }),
      })
    )
    expect(assignmentInsertBuilder.insert).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ title: 'Essay' })])
    )
    expect(assessmentInsertBuilder.insert).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ title: 'Quiz 1' }), expect.objectContaining({ title: 'Unit Test' })])
    )
    expect(lessonInsertBuilder.insert).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ title: 'Lesson 1' })])
    )
    expect(classroomUpdateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        source_blueprint_id: 'b-1',
        source_blueprint_origin: expect.objectContaining({
          blueprint_id: 'b-1',
          blueprint_title: 'Reusable Draft',
        }),
      })
    )
  })

  it('rolls back blueprint promotion when classroom linking fails', async () => {
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

    const result = await createCourseBlueprintFromClassroom('teacher-1', 'c-1', { title: 'Reusable Draft' })
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 500 }))
    expect(deleteBuilder.delete).toHaveBeenCalled()
  })
})
