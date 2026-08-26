import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildCreateBlueprintWritePlan,
  buildClassroomBlueprintUpdateWritePlan,
  buildInstantiateBlueprintWritePlan,
  createArchivedClassroomBlueprintAtomic,
  createBlueprintWritePlanSchema,
  createCourseBlueprintAtomic,
  hashBlueprintOperationRequest,
  resolveBlueprintOperationId,
} from '@/lib/server/course-blueprint-operations'
import {
  DEFAULT_ACTUAL_COURSE_SITE_CONFIG,
  DEFAULT_PLANNED_COURSE_SITE_CONFIG,
} from '@/lib/course-site-publishing'
import { parseCourseBlueprintImportBundle } from '@/lib/course-blueprint-package'

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
    gradebook_use_weights: true,
    gradebook_assignments_weight: 65,
    gradebook_tests_weight: 35,
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
    materials: [{
      id: 'm-1',
      artifact_id: '71000000-0000-4000-8000-000000000020',
      course_blueprint_id: 'b-1',
      title: 'Course guide',
      content_markdown: 'Read first.',
      position: 0,
    }],
    surveys: [{
      id: 's-1',
      artifact_id: '72000000-0000-4000-8000-000000000020',
      course_blueprint_id: 'b-1',
      title: 'Check-in',
      show_results: false,
      dynamic_responses: true,
      questions_json: [{
        id: '73000000-0000-4000-8000-000000000020',
        question_type: 'short_text',
        question_text: 'What do you need?',
        options: [],
        response_max_chars: 300,
        position: 0,
      }],
      position: 1,
    }],
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
    expect(resolveBlueprintOperationId('ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF'))
      .toBe('abcdefab-cdef-4abc-8def-abcdefabcdef')
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

  it('logs the safe database error code when an atomic RPC fails', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: '23514',
          message: 'sensitive database detail',
          details: 'sensitive row detail',
        },
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

    expect(errorSpy).toHaveBeenCalledWith(
      '[blueprint-operation-rpc-error]',
      JSON.stringify({
        operation_id: operationId,
        operation_type: 'capture',
        rpc_name: 'create_course_blueprint_atomic_v2',
        database_error_code: '23514',
      }),
    )
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('sensitive database detail')
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('sensitive row detail')
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
      'create_course_blueprint_atomic_v2',
      expect.objectContaining({
        p_source_classroom_id: '40000000-0000-4000-8000-000000000020',
        p_expected_source_revision: 12,
      }),
    )
  })

  it('keeps archived reuse idempotency stable across a revision-only repair', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          ok: false,
          status: 409,
          operation_id: operationId,
          operation_type: 'import',
          error_code: 'test_question_identity_ambiguous',
          error: 'Test question identity mapping is ambiguous',
          retryable: true,
        },
        error: null,
      }),
    }
    const args = {
      supabase,
      operationId,
      teacherId: '30000000-0000-4000-8000-000000000020',
      sourceClassroomId: '40000000-0000-4000-8000-000000000020',
      plan: createPlan(),
    }

    await createArchivedClassroomBlueprintAtomic({
      ...args,
      expectedSourceRevision: 12,
    })
    await createArchivedClassroomBlueprintAtomic({
      ...args,
      expectedSourceRevision: 14,
    })

    const firstRequest = supabase.rpc.mock.calls[0][1]
    const retryRequest = supabase.rpc.mock.calls[1][1]
    expect(firstRequest.p_expected_source_revision).toBe(12)
    expect(retryRequest.p_expected_source_revision).toBe(14)
    expect(retryRequest.p_request_sha256).toBe(firstRequest.p_request_sha256)
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
      operationId,
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
      grading: {
        use_weights: true,
        assignments_weight: 65,
        tests_weight: 35,
      },
      materials: [expect.objectContaining({
        artifact_id: '71000000-0000-4000-8000-000000000020',
        title: 'Course guide',
        position: 0,
      })],
      surveys: [expect.objectContaining({
        artifact_id: '72000000-0000-4000-8000-000000000020',
        questions: [expect.objectContaining({
          artifact_id: '73000000-0000-4000-8000-000000000020',
        })],
        position: 1,
      })],
    }))
  })

  it('derives the same generated class code for repeated operation IDs', () => {
    const args = {
      detail: blueprintDetail(),
      input: {
        blueprintId: '20000000-0000-4000-8000-000000000020',
        title: 'New semester',
        start_date: '2026-09-08',
        end_date: '2026-09-09',
      },
      themeColor: 'cyan' as const,
      manifestVersion: '3',
      operationId,
    }
    const first = buildInstantiateBlueprintWritePlan(args)
    const second = buildInstantiateBlueprintWritePlan(args)

    expect(first.ok && first.plan.classroom.class_code).toBe(
      second.ok && second.plan.classroom.class_code,
    )
  })

  it('materializes Blueprint pacing against a classroom calendar without runtime controls', () => {
    const snapshot = {
      schema_version: 2,
      blueprint_id: '20000000-0000-4000-8000-000000000020',
      draft_revision: 7,
      metadata: {
        title: 'Course',
        subject: '',
        grade_level: '',
        course_code: '',
        term_template: '',
      },
      sections: {
        overview_markdown: 'Overview',
        outline_markdown: 'Outline',
        resources_markdown: 'Resources',
      },
      grading: { use_weights: true, assignments_weight: 65, tests_weight: 35 },
      planned_site: {
        slug: null,
        published: false,
        config: DEFAULT_PLANNED_COURSE_SITE_CONFIG,
      },
      assignments: [{
        artifact_id: '71000000-0000-4000-8000-000000000020',
        title: 'Draft assignment',
        instructions_markdown: 'Do the work.',
        submission_requirements: [],
        default_due_days: 7,
        default_due_time: '15:30',
        points_possible: 30,
        gradebook_weight: 10,
        include_in_final: true,
        is_draft: true,
        track_authenticity: false,
        position: 0,
      }],
      assessments: [],
      lesson_templates: [],
      materials: [],
      surveys: [],
    } as const

    const plan = buildClassroomBlueprintUpdateWritePlan({
      snapshot: snapshot as any,
      classroomStartDate: '2026-09-08',
      classDayDates: ['2026-09-08'],
    })
    expect(plan.assignments[0]).toEqual(expect.objectContaining({
      artifact_id: '71000000-0000-4000-8000-000000000020',
      due_at: '2026-09-15T19:30:00.000Z',
    }))
    expect(plan.calendar_guard).toEqual({
      start_date: '2026-09-08',
      class_day_dates: ['2026-09-08'],
    })
    expect(plan.site_visibility_defaults).toEqual(
      DEFAULT_PLANNED_COURSE_SITE_CONFIG,
    )
    expect(plan.assignments[0]).not.toHaveProperty('is_draft')
    expect(plan.assignments[0]).not.toHaveProperty('released_at')
    expect(plan.tests).toEqual([])
    expect(plan).not.toHaveProperty('students')
    expect(plan).not.toHaveProperty('submissions')
  })

  it('rejects missing or ambiguous classroom calendar modes before any RPC call', () => {
    const detail = blueprintDetail()
    expect(buildInstantiateBlueprintWritePlan({
      detail,
      input: { blueprintId: detail.id, title: 'Missing dates' },
      themeColor: 'blue',
      manifestVersion: '3',
      operationId,
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
      operationId,
    })).toEqual(expect.objectContaining({ ok: false, status: 400 }))
  })
})

describe('importing a course package that contains tests and lesson plans', () => {
  // The markdown parsers attach `id: existingMatch?.id` for matching against
  // existing rows. On a fresh import there is no match, so the key is present
  // with value `undefined` — which zod 4 rejects as an unrecognized key on the
  // strict write schemas. Assignments were already normalized; assessments and
  // lesson templates were passed through raw and blew up.
  function bundleWithAssessmentsAndLessons() {
    return {
      manifest: {
        version: '4' as const,
        exported_at: '2026-01-01T00:00:00.000Z',
        title: 'Package With Tests',
        subject: 'Computer Science',
        grade_level: '10',
        course_code: 'ICS2O',
        term_template: 'Semester',
      },
      files: {
        'course-overview.md': '',
        'course-outline.md': '',
        'resources.md': '',
        'assignments.md': [
          '## Warm-Up',
          'Due Days: 7',
          'Due Time: 23:59',
          'Gradebook Weight: 10',
          'Include In Final: true',
          '',
          'Do the warm-up.',
        ].join('\n'),
        'tests.md': [
          '# Test',
          'Title: Unit 1 Quiz',
          'Points Possible: 5',
          'Gradebook Weight: 10',
          'Include In Final: true',
          'Show Results: false',
          '',
          '## Questions',
          '### Question 1',
          'Type: multiple_choice',
          'Points: 5',
          'Prompt:',
          'Which keyword cannot be reassigned?',
          'Options:',
          '- let',
          '- const',
          'Correct Option: 2',
        ].join('\n'),
        'lesson-plans.md': ['## Lesson 1', '', 'Introduce variables.', '', '---'].join('\n'),
      },
    }
  }

  // Mirrors the mapping in importCourseBlueprintBundle.
  function planFromBundle() {
    const parsed = parseCourseBlueprintImportBundle(bundleWithAssessmentsAndLessons())
    expect(parsed.errors).toEqual([])
    return buildCreateBlueprintWritePlan({
      blueprint: parsed.blueprint,
      assignments: parsed.assignments.map((assignment) => ({
        ...assignment,
        submission_requirements_json: assignment.submission_requirements || [],
      })),
      assessments: parsed.assessments.map((assessment) => ({
        ...assessment,
        points_possible: assessment.points_possible ?? null,
        gradebook_weight: assessment.gradebook_weight ?? 10,
        include_in_final: assessment.include_in_final !== false,
      })),
      lessonTemplates: parsed.lesson_templates,
      manifestVersion: parsed.manifest!.version,
      sourcePackageExportedAt: parsed.manifest!.exported_at,
    })
  }

  it('builds a write plan instead of rejecting the unmatched id key', () => {
    expect(() => planFromBundle()).not.toThrow()
  })

  it('keeps the parsed tests and lesson plans in the write plan', () => {
    const plan = planFromBundle()
    expect(plan.assessments).toHaveLength(1)
    expect(plan.assessments[0]).toEqual(
      expect.objectContaining({ assessment_type: 'test', title: 'Unit 1 Quiz', position: 0 })
    )
    expect(plan.lesson_templates).toHaveLength(1)
    expect(plan.assignments).toHaveLength(1)
  })

  it('does not carry an id into the create plan', () => {
    const plan = planFromBundle()
    expect(plan.assessments[0]).not.toHaveProperty('id')
    expect(plan.lesson_templates[0]).not.toHaveProperty('id')
    expect(plan.assignments[0]).not.toHaveProperty('id')
  })

  it('strips classroom snapshot ownership from capture and instantiation plans', () => {
    const snapshotDocument = {
      id: 'doc-1',
      title: 'Reference',
      source: 'link',
      url: 'https://docs.example.com/reference',
      snapshot_path: 'link-docs/teacher/test/doc-1/snapshots/current',
      snapshot_content_type: 'text/html',
      synced_at: '2026-07-23T12:00:00.000Z',
    }
    const basePlan = createPlan()
    const capturePlan = buildCreateBlueprintWritePlan({
      blueprint: basePlan.blueprint,
      assignments: basePlan.assignments,
      lessonTemplates: [],
      manifestVersion: '4',
      assessments: [{
        assessment_type: 'test',
        title: 'Test',
        content: { title: 'Test', show_results: false, questions: [] },
        documents: [snapshotDocument],
        points_possible: null,
        gradebook_weight: 10,
        include_in_final: true,
        position: 0,
      }],
    })
    expect(capturePlan.assessments[0].documents).toEqual([
      expect.not.objectContaining({ snapshot_path: expect.anything() }),
    ])

    const detail = blueprintDetail()
    detail.assessments = [{
      id: 'assessment-1',
      course_blueprint_id: detail.id,
      assessment_type: 'test',
      title: 'Test',
      content: { title: 'Test', show_results: false, questions: [] },
      documents: [snapshotDocument],
      points_possible: null,
      gradebook_weight: 10,
      include_in_final: true,
      position: 0,
    }]
    const instantiated = buildInstantiateBlueprintWritePlan({
      detail,
      input: {
        title: 'New class',
        classCode: 'NEW123',
        start_date: '2026-09-01',
        end_date: '2026-09-30',
      },
      themeColor: 'blue',
      manifestVersion: '4',
      operationId,
    })
    expect(instantiated).toEqual(expect.objectContaining({ ok: true }))
    if (!instantiated.ok) throw new Error('Expected blueprint instantiation plan')
    expect(instantiated.plan.tests[0].documents).toEqual([
      expect.not.objectContaining({ snapshot_path: expect.anything() }),
    ])
  })
})
