import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  changedReusableAreas,
  classifyArchivedClassroomReuseSnapshots,
  decideArchivedClassroomReuse,
  prepareArchivedClassroomReuse,
} from '@/lib/server/archived-classroom-reuse'

const mockAssertTeacherOwnsClassroom = vi.fn()
const mockLoadClassroomBlueprintSource = vi.fn()
const mockCreateCourseBlueprintFromClassroom = vi.fn()
const mockGetCourseBlueprintDetail = vi.fn()
const mockGetBlueprintMergeSuggestionSet = vi.fn()
const mockApplyBlueprintMergeSuggestions = vi.fn()
const mockApplyArchivedClassroomCourseBlueprintProposal = vi.fn()

vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherOwnsClassroom: (...args: any[]) =>
    mockAssertTeacherOwnsClassroom(...args),
}))

vi.mock('@/lib/server/classroom-blueprint-source', () => ({
  loadClassroomBlueprintSource: (...args: any[]) =>
    mockLoadClassroomBlueprintSource(...args),
}))

vi.mock('@/lib/server/course-blueprints', () => ({
  createCourseBlueprintFromClassroom: (...args: any[]) =>
    mockCreateCourseBlueprintFromClassroom(...args),
  getCourseBlueprintDetail: (...args: any[]) =>
    mockGetCourseBlueprintDetail(...args),
}))

vi.mock('@/lib/server/course-sites', () => ({
  getBlueprintMergeSuggestionSet: (...args: any[]) =>
    mockGetBlueprintMergeSuggestionSet(...args),
  applyBlueprintMergeSuggestions: (...args: any[]) =>
    mockApplyBlueprintMergeSuggestions(...args),
}))

vi.mock('@/lib/server/course-blueprint-proposals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/course-blueprint-proposals')>()
  return {
    ...actual,
    applyArchivedClassroomCourseBlueprintProposal: (...args: any[]) =>
      mockApplyArchivedClassroomCourseBlueprintProposal(...args),
  }
})

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => {
    const builder: Record<string, any> = {}
    builder.eq = vi.fn(() => builder)
    builder.not = vi.fn(() => builder)
    builder.select = vi.fn(() => builder)
    return {
      rpc: vi.fn(),
      from: vi.fn(() => builder),
    }
  }),
}))

function snapshot(overrides: Record<string, any> = {}) {
  return {
    schema_version: 2,
    blueprint_id: '20000000-0000-4000-8000-000000000001',
    draft_revision: 1,
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
    ...overrides,
  } as any
}

function legacySource(overrides: Record<string, any> = {}) {
  return {
    classroom: {
      id: '30000000-0000-4000-8000-000000000001',
      title: 'Archived course',
      source_blueprint_id: '20000000-0000-4000-8000-000000000001',
      source_blueprint_version_id: null,
      source_blueprint_origin: { blueprint_content_revision: 4 },
      blueprint_source_revision: 2,
      ...overrides,
    },
  }
}

describe('archived classroom reuse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAssertTeacherOwnsClassroom.mockResolvedValue({
      ok: true,
      classroom: {
        id: '30000000-0000-4000-8000-000000000001',
        archived_at: '2026-07-01T00:00:00.000Z',
      },
    })
  })

  it('ignores expected classroom-instantiation transformations', () => {
    const base = snapshot({
      assignments: [{
        artifact_id: '40000000-0000-4000-8000-000000000001',
        title: 'Assignment',
        instructions_markdown: '',
        submission_requirements: [],
        default_due_days: 7,
        default_due_time: '23:59',
        points_possible: null,
        gradebook_weight: 10,
        include_in_final: true,
        is_draft: false,
        track_authenticity: false,
        position: 0,
      }],
      assessments: [{
        artifact_id: '50000000-0000-4000-8000-000000000001',
        assessment_type: 'test',
        title: 'Test',
        content: { title: 'Test', show_results: false, questions: [] },
        documents: [],
        points_possible: null,
        gradebook_weight: 10,
        include_in_final: true,
        position: 0,
      }],
      lesson_templates: [
        {
          artifact_id: '60000000-0000-4000-8000-000000000001',
          title: 'Lesson 1',
          content_markdown: '',
          position: 0,
        },
        {
          artifact_id: '60000000-0000-4000-8000-000000000002',
          title: 'Overflow lesson',
          content_markdown: '',
          position: 1,
        },
      ],
    })
    const currentClassroom = snapshot({
      assignments: [{
        ...base.assignments[0],
        points_possible: 30,
        is_draft: true,
      }],
      assessments: [{
        ...base.assessments[0],
        points_possible: 100,
      }],
      lesson_templates: [base.lesson_templates[0]],
    })

    expect(classifyArchivedClassroomReuseSnapshots({
      baseVersion: base,
      currentBlueprint: base,
      currentClassroom,
      appliedLessonArtifactIds: new Set([
        '60000000-0000-4000-8000-000000000001',
      ]),
    })).toEqual(expect.objectContaining({
      blueprintChanged: false,
      classroomChanged: false,
    }))
  })

  it('ignores the portable identity marker when comparing a pre-marker Version', () => {
    const legacyVersion = snapshot({
      assessments: [{
        artifact_id: '50000000-0000-4000-8000-000000000001',
        assessment_type: 'test',
        title: 'Test',
        content: {
          title: 'Test',
          show_results: false,
          questions: [{
            id: '51000000-0000-4000-8000-000000000001',
            question_type: 'open_response',
            question_text: 'Question',
            options: [],
            correct_option: null,
            answer_key: null,
            sample_solution: null,
            points: 1,
            response_max_chars: 5000,
            response_monospace: false,
          }],
        },
        documents: [],
        points_possible: 100,
        gradebook_weight: 10,
        include_in_final: true,
        position: 0,
      }],
    })
    const markedSnapshot = snapshot({
      assessments: [{
        ...legacyVersion.assessments[0],
        content: {
          ...legacyVersion.assessments[0].content,
          question_identity_version: 1,
        },
      }],
    })

    const result = classifyArchivedClassroomReuseSnapshots({
      baseVersion: legacyVersion,
      currentBlueprint: markedSnapshot,
      currentClassroom: markedSnapshot,
      appliedLessonArtifactIds: new Set(),
    })

    expect(result).toEqual(expect.objectContaining({
      blueprintChanged: false,
      classroomChanged: false,
    }))
    expect(result.classroomBaseline.assessments[0].content).toEqual(
      expect.objectContaining({ question_identity_version: 1 }),
    )

    const unmarkedClassroomChange = snapshot({
      sections: {
        ...legacyVersion.sections,
        overview_markdown: 'Changed only in the Classroom',
      },
      assessments: legacyVersion.assessments,
    })
    expect(changedReusableAreas(
      result.classroomBaseline,
      unmarkedClassroomChange,
    )).toEqual(['overview'])
  })

  it('distinguishes Blueprint-only and classroom-only changes', () => {
    const base = snapshot()
    const blueprintChanged = snapshot({
      draft_revision: 2,
      metadata: { ...base.metadata, title: 'New title' },
    })
    const classroomChanged = snapshot({
      sections: { ...base.sections, overview_markdown: 'Changed in class' },
    })

    expect(classifyArchivedClassroomReuseSnapshots({
      baseVersion: base,
      currentBlueprint: blueprintChanged,
      currentClassroom: base,
      appliedLessonArtifactIds: new Set(),
    })).toEqual(expect.objectContaining({
      blueprintChanged: true,
      classroomChanged: false,
    }))
    expect(classifyArchivedClassroomReuseSnapshots({
      baseVersion: base,
      currentBlueprint: base,
      currentClassroom: classroomChanged,
      appliedLessonArtifactIds: new Set(),
    })).toEqual(expect.objectContaining({
      blueprintChanged: false,
      classroomChanged: true,
    }))

    const matchingChanges = snapshot({
      draft_revision: 2,
      sections: { ...base.sections, overview_markdown: 'Same new content' },
    })
    expect(classifyArchivedClassroomReuseSnapshots({
      baseVersion: base,
      currentBlueprint: matchingChanges,
      currentClassroom: matchingChanges,
      appliedLessonArtifactIds: new Set(),
    })).toEqual(expect.objectContaining({
      blueprintChanged: true,
      classroomChanged: true,
    }))
    expect(decideArchivedClassroomReuse({
      blueprintChanged: true,
      classroomChanged: true,
      authorityMode: 'pika',
    })).toBe('review')
  })

  it('uses persisted lesson lineage instead of the current calendar size', () => {
    const appliedLessonId = '60000000-0000-4000-8000-000000000001'
    const overflowLessonId = '60000000-0000-4000-8000-000000000002'
    const base = snapshot({
      lesson_templates: [
        {
          artifact_id: appliedLessonId,
          title: 'Lesson 1',
          content_markdown: 'Applied',
          position: 0,
        },
        {
          artifact_id: overflowLessonId,
          title: 'Lesson 2',
          content_markdown: 'Overflow',
          position: 1,
        },
      ],
    })
    const classroom = snapshot({
      lesson_templates: [base.lesson_templates[0]],
    })

    expect(classifyArchivedClassroomReuseSnapshots({
      baseVersion: base,
      currentBlueprint: base,
      currentClassroom: classroom,
      appliedLessonArtifactIds: new Set([appliedLessonId]),
    })).toEqual(expect.objectContaining({
      classroomChanged: false,
      classroomBaseline: expect.objectContaining({
        lesson_templates: [base.lesson_templates[0]],
      }),
    }))
  })

  it('tracks reusable site visibility without comparing publication state', () => {
    const base = snapshot()
    const operationalBlueprintChange = snapshot({
      planned_site: {
        ...base.planned_site,
        slug: 'new-runtime-slug',
        published: true,
      },
    })
    const classroom = snapshot({
      planned_site: {
        slug: 'runtime-slug',
        published: true,
        config: {
          ...base.planned_site.config,
          tests: false,
        },
      },
    })

    expect(classifyArchivedClassroomReuseSnapshots({
      baseVersion: base,
      currentBlueprint: operationalBlueprintChange,
      currentClassroom: classroom,
      appliedLessonArtifactIds: new Set(),
    })).toEqual(expect.objectContaining({
      blueprintChanged: false,
      classroomChanged: true,
    }))
  })

  it('creates a copy-only Blueprint for an unlinked archived classroom', async () => {
    mockLoadClassroomBlueprintSource.mockResolvedValue({
      ok: true,
      source: legacySource({ source_blueprint_id: null }),
    })
    mockCreateCourseBlueprintFromClassroom.mockResolvedValue({
      ok: true,
      blueprint: {
        id: '20000000-0000-4000-8000-000000000002',
        title: 'Archived course',
        content_revision: 1,
      },
      operation_id: '70000000-0000-4000-8000-000000000001',
    })

    const result = await prepareArchivedClassroomReuse({
      teacherId: '10000000-0000-4000-8000-000000000001',
      classroomId: '30000000-0000-4000-8000-000000000001',
      operationId: '70000000-0000-4000-8000-000000000001',
    })

    expect(mockCreateCourseBlueprintFromClassroom).toHaveBeenCalledWith(
      '10000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      { title: 'Archived course' },
      {
        operationId: '70000000-0000-4000-8000-000000000001',
        copyOnly: true,
      },
    )
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      status: 'ready',
      blueprint_id: '20000000-0000-4000-8000-000000000002',
    }))
  })

  it('atomically promotes legacy classroom-only changes before reuse', async () => {
    mockLoadClassroomBlueprintSource.mockResolvedValue({
      ok: true,
      source: legacySource(),
    })
    mockGetCourseBlueprintDetail.mockResolvedValue({
      detail: {
        id: '20000000-0000-4000-8000-000000000001',
        title: 'Course',
        content_revision: 4,
        authority_mode: 'pika',
      },
    })
    mockGetBlueprintMergeSuggestionSet.mockResolvedValue({
      ok: true,
      suggestionSet: {
        suggestions: [{ area: 'overview' }],
      },
    })
    mockApplyBlueprintMergeSuggestions.mockResolvedValue({
      ok: true,
      proposal: {
        id: '80000000-0000-4000-8000-000000000001',
        status: 'needs_review',
        diff_json: { candidate_snapshot: snapshot() },
      },
    })
    mockApplyArchivedClassroomCourseBlueprintProposal.mockResolvedValue({
      ok: true,
      proposal: { status: 'applied' },
    })

    const result = await prepareArchivedClassroomReuse({
      teacherId: '10000000-0000-4000-8000-000000000001',
      classroomId: '30000000-0000-4000-8000-000000000001',
      operationId: '70000000-0000-4000-8000-000000000001',
    })

    expect(mockApplyBlueprintMergeSuggestions).toHaveBeenCalledWith(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      ['overview'],
      {
        expectedBlueprintRevision: 4,
        expectedClassroomRevision: 2,
      },
    )
    expect(mockApplyArchivedClassroomCourseBlueprintProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        classroomId: '30000000-0000-4000-8000-000000000001',
        expectedClassroomRevision: 2,
      }),
    )
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      status: 'ready',
    }))
  })

  it('requires review when both legacy sources changed', async () => {
    mockLoadClassroomBlueprintSource.mockResolvedValue({
      ok: true,
      source: legacySource(),
    })
    mockGetCourseBlueprintDetail.mockResolvedValue({
      detail: {
        id: '20000000-0000-4000-8000-000000000001',
        title: 'Course',
        content_revision: 5,
        authority_mode: 'pika',
      },
    })
    mockGetBlueprintMergeSuggestionSet.mockResolvedValue({
      ok: true,
      suggestionSet: {
        suggestions: [{ area: 'overview' }],
      },
    })

    const result = await prepareArchivedClassroomReuse({
      teacherId: '10000000-0000-4000-8000-000000000001',
      classroomId: '30000000-0000-4000-8000-000000000001',
      operationId: '70000000-0000-4000-8000-000000000001',
    })

    expect(result).toEqual({
      ok: true,
      status: 'review_required',
      blueprint_id: '20000000-0000-4000-8000-000000000001',
      blueprint_title: 'Course',
      review_url:
        '/teacher/blueprints?blueprint=20000000-0000-4000-8000-000000000001'
        + '&reviewClassroom=30000000-0000-4000-8000-000000000001',
    })
    expect(mockApplyBlueprintMergeSuggestions).not.toHaveBeenCalled()
  })

  it('requires review when both legacy sources reach matching content', async () => {
    mockLoadClassroomBlueprintSource.mockResolvedValue({
      ok: true,
      source: legacySource(),
    })
    mockGetCourseBlueprintDetail.mockResolvedValue({
      detail: {
        id: '20000000-0000-4000-8000-000000000001',
        title: 'Course',
        content_revision: 5,
        authority_mode: 'pika',
      },
    })
    mockGetBlueprintMergeSuggestionSet.mockResolvedValue({
      ok: true,
      suggestionSet: { suggestions: [] },
    })

    const result = await prepareArchivedClassroomReuse({
      teacherId: '10000000-0000-4000-8000-000000000001',
      classroomId: '30000000-0000-4000-8000-000000000001',
      operationId: '70000000-0000-4000-8000-000000000001',
    })

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      status: 'review_required',
    }))
  })
})
