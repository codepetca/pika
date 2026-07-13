import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildCreateBlueprintWritePlan,
  buildInstantiateBlueprintWritePlan,
  createBlueprintWritePlanSchema,
  createCourseBlueprintAtomic,
  hashBlueprintOperationRequest,
  resolveBlueprintOperationId,
} from '@/lib/server/course-blueprint-operations'
import {
  DEFAULT_ACTUAL_COURSE_SITE_CONFIG,
  DEFAULT_PLANNED_COURSE_SITE_CONFIG,
} from '@/lib/course-site-publishing'

const operationId = '10000000-0000-4000-8000-000000000020'

function createPlan() {
  return buildCreateBlueprintWritePlan({
    blueprint: {
      title: 'Atomic blueprint',
      subject: 'Computer Science',
      grade_level: '11',
      course_code: 'ICS3U',
      term_template: 'Semester 1',
      overview_markdown: 'Overview',
      outline_markdown: 'Outline',
      resources_markdown: 'Resources',
      planned_site_slug: null,
      planned_site_published: false,
      planned_site_config: DEFAULT_PLANNED_COURSE_SITE_CONFIG,
    },
    assignments: [],
    assessments: [],
    lessonTemplates: [],
    manifestVersion: '3',
  })
}

function blueprintDetail() {
  return {
    id: '20000000-0000-4000-8000-000000000020',
    teacher_id: '30000000-0000-4000-8000-000000000020',
    content_revision: 7,
    title: 'Reusable course',
    subject: '',
    grade_level: '',
    course_code: '',
    term_template: '',
    overview_markdown: 'Overview',
    outline_markdown: 'Outline',
    resources_markdown: '',
    planned_site_slug: null,
    planned_site_published: false,
    planned_site_config: DEFAULT_PLANNED_COURSE_SITE_CONFIG,
    position: 0,
    created_at: '2026-07-13T00:00:00.000Z',
    updated_at: '2026-07-13T00:00:00.000Z',
    assignments: [],
    assessments: [],
    lesson_templates: [
      { id: 'l-1', course_blueprint_id: 'b-1', title: 'Lesson 1', content_markdown: 'One', position: 0 },
      { id: 'l-2', course_blueprint_id: 'b-1', title: 'Lesson 2', content_markdown: 'Two', position: 1 },
      { id: 'l-3', course_blueprint_id: 'b-1', title: 'Lesson 3', content_markdown: 'Three', position: 2 },
    ],
    linked_classrooms: [],
  } as any
}

describe('atomic blueprint operation contracts', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('hashes semantically identical requests independent of object key order', () => {
    expect(hashBlueprintOperationRequest({ a: 1, nested: { b: 2, c: 3 } })).toBe(
      hashBlueprintOperationRequest({ nested: { c: 3, b: 2 }, a: 1 }),
    )
  })

  it('accepts UUID idempotency keys and rejects malformed keys', () => {
    expect(resolveBlueprintOperationId(operationId)).toBe(operationId)
    expect(() => resolveBlueprintOperationId('not-an-operation-id')).toThrow()
    expect(resolveBlueprintOperationId(null)).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('rejects write-plan values that destination constraints cannot store', () => {
    const plan = createPlan()
    const assignment = {
      title: 'Invalid assignment',
      instructions_markdown: '',
      submission_requirements_json: [],
      default_due_days: 1,
      default_due_time: '23:59',
      points_possible: 10,
      gradebook_weight: 10,
      include_in_final: true,
      is_draft: true,
      position: 0,
    }

    expect(createBlueprintWritePlanSchema.safeParse({
      ...plan,
      assignments: [{ ...assignment, default_due_time: '25:90' }],
    }).success).toBe(false)
    expect(createBlueprintWritePlanSchema.safeParse({
      ...plan,
      assignments: [{ ...assignment, points_possible: 0 }],
    }).success).toBe(false)
  })

  it('fails closed when migration 081 is unavailable', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: '42883', message: 'function create_course_blueprint_atomic does not exist' },
      }),
    }

    await expect(createCourseBlueprintAtomic({
      supabase,
      operationId,
      teacherId: '30000000-0000-4000-8000-000000000020',
      operationType: 'import',
      plan: createPlan(),
    })).resolves.toEqual(expect.objectContaining({
      ok: false,
      status: 503,
      error_code: 'atomic_blueprint_migration_required',
      retryable: true,
    }))
  })

  it('fails closed when the database returns an invalid operation contract', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: { ok: true }, error: null }),
    }

    await expect(createCourseBlueprintAtomic({
      supabase,
      operationId,
      teacherId: '30000000-0000-4000-8000-000000000020',
      operationType: 'import',
      plan: createPlan(),
    })).resolves.toEqual(expect.objectContaining({
      ok: false,
      status: 500,
      error_code: 'blueprint_rpc_contract_invalid',
      retryable: false,
    }))
  })

  it('passes the source revision into capture without making it part of the write plan', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          ok: true,
          status: 201,
          operation_id: operationId,
          operation_type: 'capture',
          replayed: false,
          blueprint_id: '20000000-0000-4000-8000-000000000020',
          source_revision: 12,
          result_content_revision: 1,
          counts: { assignments: 0, assessments: 0, lesson_templates: 0 },
        },
        error: null,
      }),
    }

    await createCourseBlueprintAtomic({
      supabase,
      operationId,
      teacherId: '30000000-0000-4000-8000-000000000020',
      operationType: 'capture',
      sourceClassroomId: '40000000-0000-4000-8000-000000000020',
      expectedSourceRevision: 12,
      plan: createPlan(),
    })

    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_course_blueprint_atomic',
      expect.objectContaining({
        p_source_classroom_id: '40000000-0000-4000-8000-000000000020',
        p_expected_source_revision: 12,
      }),
    )
  })

  it('rejects capture calls without a complete source revision guard', async () => {
    await expect(createCourseBlueprintAtomic({
      supabase: { rpc: vi.fn() },
      operationId,
      teacherId: '30000000-0000-4000-8000-000000000020',
      operationType: 'capture',
      sourceClassroomId: '40000000-0000-4000-8000-000000000020',
      plan: createPlan(),
    })).rejects.toThrow('Capture operations require a source classroom and revision')
  })

  it('builds a revision-guarded teacher-ready classroom plan with overflow reporting', () => {
    const result = buildInstantiateBlueprintWritePlan({
      detail: blueprintDetail(),
      input: {
        blueprintId: '20000000-0000-4000-8000-000000000020',
        title: 'New semester',
        classCode: 'ATOM01',
        start_date: '2026-09-08',
        end_date: '2026-09-09',
      },
      themeColor: 'cyan',
      manifestVersion: '3',
    })

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    if (!result.ok) throw new Error('Expected a valid write plan')
    expect(result.plan).toEqual(expect.objectContaining({
      expected_content_revision: 7,
      classroom: expect.objectContaining({
        class_code: 'ATOM01',
        theme_color: 'cyan',
        actual_site_config: DEFAULT_ACTUAL_COURSE_SITE_CONFIG,
      }),
      lesson_plans: [
        expect.objectContaining({ date: '2026-09-08' }),
        expect.objectContaining({ date: '2026-09-09' }),
      ],
      overflow_lesson_templates: ['Lesson 3'],
    }))
  })

  it('rejects missing or ambiguous classroom calendar modes before any RPC call', () => {
    const detail = blueprintDetail()
    expect(buildInstantiateBlueprintWritePlan({
      detail,
      input: { blueprintId: detail.id, title: 'Missing dates' },
      themeColor: 'blue',
      manifestVersion: '3',
    })).toEqual(expect.objectContaining({ ok: false, status: 400 }))

    expect(buildInstantiateBlueprintWritePlan({
      detail,
      input: {
        blueprintId: detail.id,
        title: 'Ambiguous dates',
        semester: 'semester1',
        year: 2026,
        start_date: '2026-09-08',
        end_date: '2027-01-29',
      },
      themeColor: 'blue',
      manifestVersion: '3',
    })).toEqual(expect.objectContaining({ ok: false, status: 400 }))
  })
})
