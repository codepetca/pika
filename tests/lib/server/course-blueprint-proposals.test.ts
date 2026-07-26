import { describe, expect, it, vi } from 'vitest'
import {
  applyPersistedClassroomBlueprintProposal,
  buildClassroomCourseBlueprintSnapshot,
  countUntrackedClassroomBlueprintArtifacts,
  applyPersistedCourseBlueprintProposal,
  buildCourseBlueprintAiCandidate,
  buildCourseBlueprintPackageCandidate,
  submitClassroomBlueprintProposal,
  submitCourseBlueprintProposal,
} from '@/lib/server/course-blueprint-proposals'
import { buildCourseBlueprintExportBundle } from '@/lib/course-blueprint-package'
import type { CourseBlueprintSnapshot } from '@/lib/server/course-blueprint-versions'
import type { CourseBlueprintDetail } from '@/types'

const base: CourseBlueprintSnapshot = {
  schema_version: 2,
  blueprint_id: '10000000-0000-4000-8000-000000000000',
  draft_revision: 4,
  metadata: {
    title: 'Course',
    subject: '',
    grade_level: '',
    course_code: '',
    term_template: '',
  },
  sections: {
    overview_markdown: '',
    outline_markdown: '',
    resources_markdown: '',
  },
  grading: {
    use_weights: false,
    assignments_weight: 70,
    tests_weight: 30,
  },
  planned_site: {
    slug: null,
    published: false,
    config: {
      overview: true,
      outline: true,
      resources: true,
      assignments: true,
      tests: true,
      lesson_plans: true,
    },
  },
  assignments: [],
  assessments: [],
  lesson_templates: [],
  materials: [],
  surveys: [],
}

const proposalRow = {
  id: '30000000-0000-4000-8000-000000000000',
  teacher_id: '20000000-0000-4000-8000-000000000000',
  course_blueprint_id: base.blueprint_id,
  source_classroom_id: null,
  target_classroom_id: null,
  target_kind: 'blueprint',
  source_kind: 'repository',
  status: 'needs_review',
  base_blueprint_revision: 4,
  base_classroom_revision: null,
  base_blueprint_version_id: null,
  payload_schema_version: 1,
  operations_json: [],
  diff_json: {},
  validation_errors: [],
  request_sha256: 'a'.repeat(64),
  idempotency_key: '40000000-0000-4000-8000-000000000000',
  applied_blueprint_revision: null,
  applied_classroom_revision: null,
  applied_at: null,
  rejected_at: null,
  created_at: '2026-07-26T00:00:00.000Z',
  updated_at: '2026-07-26T00:00:00.000Z',
} as const

describe('persisted course blueprint proposals', () => {
  it('turns AI output into a candidate without changing the live Draft', () => {
    const detail = {
      id: base.blueprint_id,
      teacher_id: proposalRow.teacher_id,
      content_revision: base.draft_revision,
      authority_mode: 'pika',
      latest_version_number: 0,
      ...base.metadata,
      ...base.sections,
      gradebook_use_weights: base.grading.use_weights,
      gradebook_assignments_weight: base.grading.assignments_weight,
      gradebook_tests_weight: base.grading.tests_weight,
      planned_site_slug: null,
      planned_site_published: false,
      planned_site_config: base.planned_site.config,
      position: 0,
      created_at: proposalRow.created_at,
      updated_at: proposalRow.updated_at,
      assignments: [],
      assessments: [],
      lesson_templates: [],
      materials: [],
      surveys: [],
      linked_classrooms: [],
    } satisfies CourseBlueprintDetail

    const result = buildCourseBlueprintAiCandidate(
      detail,
      'overview',
      'AI-proposed overview'
    )

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    if (result.ok) {
      expect(result.base.sections.overview_markdown).toBe('')
      expect(result.candidate.sections.overview_markdown).toBe('AI-proposed overview')
      expect(detail.overview_markdown).toBe('')
    }

    const materialResult = buildCourseBlueprintAiCandidate(
      detail,
      'materials',
      [
        '## Course guide',
        'Classwork Position: 0',
        '',
        'Read this first.',
      ].join('\n')
    )
    expect(materialResult).toEqual(expect.objectContaining({ ok: true }))
    if (materialResult.ok) {
      expect(materialResult.base.materials).toEqual([])
      expect(materialResult.candidate.materials).toEqual([
        expect.objectContaining({
          title: 'Course guide',
          content_markdown: 'Read this first.',
          artifact_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        }),
      ])
    }

    const gradingResult = buildCourseBlueprintAiCandidate(
      detail,
      'grading',
      [
        '# Gradebook',
        'Use Weights: true',
        'Assignments Weight: 65',
        'Tests Weight: 35',
      ].join('\n')
    )
    expect(gradingResult).toEqual(expect.objectContaining({ ok: true }))
    if (gradingResult.ok) {
      expect(gradingResult.candidate.grading).toEqual({
        use_weights: true,
        assignments_weight: 65,
        tests_weight: 35,
      })
      expect(detail.gradebook_use_weights).toBe(false)
    }
  })

  it('keeps public-site publication under Pika control for package proposals', () => {
    const detail = {
      id: base.blueprint_id,
      teacher_id: proposalRow.teacher_id,
      content_revision: base.draft_revision,
      authority_mode: 'repository',
      latest_version_number: 0,
      ...base.metadata,
      ...base.sections,
      gradebook_use_weights: base.grading.use_weights,
      gradebook_assignments_weight: base.grading.assignments_weight,
      gradebook_tests_weight: base.grading.tests_weight,
      planned_site_slug: 'published-course',
      planned_site_published: true,
      planned_site_config: base.planned_site.config,
      position: 0,
      created_at: proposalRow.created_at,
      updated_at: proposalRow.updated_at,
      assignments: [],
      assessments: [],
      lesson_templates: [],
      materials: [],
      surveys: [],
      linked_classrooms: [],
    } satisfies CourseBlueprintDetail
    const bundle = buildCourseBlueprintExportBundle(detail)
    bundle.manifest.planned_site_published = false

    const result = buildCourseBlueprintPackageCandidate(detail, bundle)

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    if (result.ok) {
      expect(result.candidate.planned_site.published).toBe(true)
    }
  })

  it('submits exact-revision proposal data through the atomic RPC', async () => {
    const candidate = structuredClone(base)
    candidate.sections.overview_markdown = 'Changed'
    const rpc = vi.fn().mockResolvedValue({ data: proposalRow, error: null })

    const result = await submitCourseBlueprintProposal({
      supabase: { rpc } as any,
      teacherId: proposalRow.teacher_id,
      base,
      candidate,
      source: 'repository',
      idempotencyKey: proposalRow.idempotency_key,
    })

    expect(result.ok).toBe(true)
    expect(rpc).toHaveBeenCalledWith(
      'create_course_blueprint_proposal_atomic',
      expect.objectContaining({
        p_blueprint_id: base.blueprint_id,
        p_expected_blueprint_revision: 4,
        p_source_kind: 'repository',
        p_source_classroom_id: null,
        p_base_classroom_revision: null,
        p_diff: expect.objectContaining({
          candidate_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      })
    )
  })

  it('applies the exact reviewed candidate digest through one atomic RPC', async () => {
    const candidate = structuredClone(base)
    candidate.sections.overview_markdown = 'Changed'
    const appliedRow = {
      ...proposalRow,
      status: 'applied',
      applied_blueprint_revision: 5,
      applied_at: '2026-07-26T01:00:00.000Z',
    }
    const rpc = vi.fn().mockResolvedValue({ data: appliedRow, error: null })

    const result = await applyPersistedCourseBlueprintProposal({
      supabase: { rpc } as any,
      teacherId: proposalRow.teacher_id,
      proposalId: proposalRow.id,
      candidate,
    })

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      proposal: expect.objectContaining({
        status: 'applied',
        applied_blueprint_revision: 5,
      }),
    }))
    expect(rpc).toHaveBeenCalledWith(
      'apply_course_blueprint_proposal_atomic',
      expect.objectContaining({
        p_proposal_id: proposalRow.id,
        p_candidate_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    )
  })

  it('submits the package source revision rather than rebasing it silently', async () => {
    const candidate = structuredClone(base)
    candidate.draft_revision = 2
    const rpc = vi.fn().mockResolvedValue({
      data: { ...proposalRow, status: 'stale', base_blueprint_revision: 2 },
      error: null,
    })

    const result = await submitCourseBlueprintProposal({
      supabase: { rpc } as any,
      teacherId: proposalRow.teacher_id,
      base,
      candidate,
      source: 'repository',
      idempotencyKey: proposalRow.idempotency_key,
      expectedBlueprintRevision: 2,
    })

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      proposal: expect.objectContaining({ status: 'stale' }),
    }))
    expect(rpc).toHaveBeenCalledWith(
      'create_course_blueprint_proposal_atomic',
      expect.objectContaining({ p_expected_blueprint_revision: 2 })
    )
  })

  it('creates and applies an exact classroom-targeted proposal through dedicated RPCs', async () => {
    const candidate = structuredClone(base)
    candidate.sections.overview_markdown = 'Versioned overview'
    const classroomRow = {
      ...proposalRow,
      target_kind: 'classroom',
      target_classroom_id: '50000000-0000-4000-8000-000000000000',
      source_kind: 'blueprint',
      base_classroom_revision: 9,
      base_blueprint_version_id: '60000000-0000-4000-8000-000000000000',
    } as const
    const plan = {
      calendar_guard: {
        start_date: '2026-09-08',
        class_day_dates: [],
      },
      sections: {
        overview_markdown: 'Versioned overview',
        outline_markdown: '',
      },
      site_visibility_defaults: base.planned_site.config,
      resources_content: null,
      grading: base.grading,
      assignments: [],
      tests: [],
      materials: [],
      surveys: [],
      lesson_plans: [],
      overflow_lesson_templates: [],
    }
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: classroomRow, error: null })
      .mockResolvedValueOnce({
        data: {
          ...classroomRow,
          status: 'applied',
          applied_classroom_revision: 10,
          applied_at: '2026-07-26T01:00:00.000Z',
        },
        error: null,
      })

    const submitted = await submitClassroomBlueprintProposal({
      supabase: { rpc } as any,
      teacherId: proposalRow.teacher_id,
      blueprintId: base.blueprint_id,
      blueprintRevision: 4,
      blueprintVersionId: classroomRow.base_blueprint_version_id,
      classroomId: classroomRow.target_classroom_id,
      classroomRevision: 9,
      base,
      candidate,
      plan,
      idempotencyKey: proposalRow.idempotency_key,
    })
    expect(submitted).toEqual(expect.objectContaining({ ok: true }))
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      'create_course_blueprint_classroom_proposal_atomic',
      expect.objectContaining({
        p_target_classroom_id: classroomRow.target_classroom_id,
        p_expected_classroom_revision: 9,
        p_blueprint_version_id: classroomRow.base_blueprint_version_id,
        p_diff: expect.objectContaining({
          classroom_plan_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    )

    const applied = await applyPersistedClassroomBlueprintProposal({
      supabase: { rpc } as any,
      teacherId: proposalRow.teacher_id,
      proposalId: proposalRow.id,
      plan,
    })
    expect(applied).toEqual(expect.objectContaining({
      ok: true,
      proposal: expect.objectContaining({
        status: 'applied',
        applied_classroom_revision: 10,
      }),
    }))
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'apply_course_blueprint_classroom_proposal_atomic',
      expect.objectContaining({
        p_proposal_id: proposalRow.id,
        p_classroom_plan_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    )
  })

  it('projects classroom structure with logical source IDs and excludes runtime state', () => {
    const snapshot = buildClassroomCourseBlueprintSnapshot({
      blueprintId: base.blueprint_id,
      blueprintRevision: 4,
      candidate: base,
      trackedOnly: true,
      source: {
        classroom: {
          id: '50000000-0000-4000-8000-000000000000',
          title: 'Live classroom',
          course_overview_markdown: 'Live overview',
          course_outline_markdown: 'Live outline',
          actual_site_config: {
            overview: false,
            outline: true,
            resources: true,
            assignments: true,
            tests: true,
            lesson_plans: true,
            announcements: false,
            lesson_plan_scope: 'all',
          },
        } as any,
        resources: null,
        resources_markdown: '',
        grading: base.grading,
        assignments: [],
        tests: [],
        lesson_templates: [],
        materials: [
          {
            artifact_id: '70000000-0000-4000-8000-000000000001',
            source_artifact_id: '70000000-0000-4000-8000-000000000001',
            title: 'Tracked material',
            content_markdown: 'Tracked',
            position: 0,
          },
          {
            artifact_id: '70000000-0000-4000-8000-000000000002',
            source_artifact_id: null,
            title: 'Local-only material',
            content_markdown: 'Local',
            position: 1,
          },
        ],
        surveys: [],
        announcements: [{ id: 'runtime-only' }] as any,
      },
    })

    expect(snapshot.sections.overview_markdown).toBe('Live overview')
    expect(snapshot.planned_site).toEqual({
      ...base.planned_site,
      config: {
        ...base.planned_site.config,
        overview: false,
      },
    })
    expect(snapshot.materials).toEqual([
      expect.objectContaining({ title: 'Tracked material' }),
    ])
    expect(snapshot).not.toHaveProperty('announcements')
    expect(snapshot).not.toHaveProperty('students')
    expect(snapshot).not.toHaveProperty('submissions')
  })

  it('requires untracked top-level classroom artifacts to be reconciled first', () => {
    const source = {
      assignments: [],
      tests: [],
      lesson_templates: [],
      materials: [
        {
          artifact_id: '70000000-0000-4000-8000-000000000001',
          source_artifact_id: null,
        },
        {
          artifact_id: '70000000-0000-4000-8000-000000000002',
          source_artifact_id: '70000000-0000-4000-8000-000000000002',
        },
      ],
      surveys: [],
    } as any
    expect(countUntrackedClassroomBlueprintArtifacts(source)).toBe(1)
  })
})
