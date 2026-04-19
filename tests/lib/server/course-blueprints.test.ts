import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertTeacherOwnsCourseBlueprint,
  createCourseBlueprint,
  deleteCourseBlueprint,
  getCourseBlueprintDetail,
  getNextTeacherCourseBlueprintPosition,
  hydrateCourseBlueprint,
  updateCourseBlueprint,
} from '@/lib/server/course-blueprints'
import {
  DEFAULT_PLANNED_COURSE_SITE_CONFIG,
} from '@/lib/course-site-publishing'
import { makeQueryBuilder, makeSupabaseFromQueues } from '../../support/supabase'

let mockSupabase: any

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabase),
}))

describe('course-blueprints server helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
