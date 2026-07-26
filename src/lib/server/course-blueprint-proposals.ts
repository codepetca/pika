import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildCourseBlueprintChangeProposal,
  type CourseBlueprintProposalSource,
} from '@/lib/course-blueprint-change-proposals'
import {
  canonicalizeCourseBlueprintSnapshot,
  hashCanonicalJson,
  hashCourseBlueprintSnapshot,
  type CourseBlueprintSnapshot,
} from '@/lib/server/course-blueprint-versions'
import { parseDatabaseJson } from '@/lib/validations/database-json'
import { parseCourseBlueprintImportBundle } from '@/lib/course-blueprint-package'
import { buildCourseBlueprintSnapshot } from '@/lib/server/course-blueprint-versions'
import { markdownToCourseBlueprintAssignments } from '@/lib/course-blueprint-assignments'
import { markdownToCourseBlueprintAssessments } from '@/lib/course-blueprint-assessments-markdown'
import { markdownToCourseBlueprintLessonTemplates } from '@/lib/course-blueprint-lesson-templates'
import { markdownToCourseBlueprintMaterials } from '@/lib/course-blueprint-materials'
import { markdownToCourseBlueprintSurveys } from '@/lib/course-blueprint-surveys'
import { markdownToCourseBlueprintGrading } from '@/lib/course-blueprint-grading'
import type { CourseBlueprintDetail } from '@/types'
import type { ClassroomBlueprintSource } from '@/lib/server/classroom-blueprint-source'
import {
  buildClassroomBlueprintUpdateWritePlan,
  type ClassroomBlueprintUpdateWritePlan,
} from '@/lib/server/course-blueprint-operations'

const uuidSchema = z.string().uuid()
const proposalStatusSchema = z.enum([
  'ready',
  'needs_review',
  'conflicted',
  'stale',
  'applied',
  'rejected',
])

const proposalRecordSchema = z.object({
  id: uuidSchema,
  teacher_id: uuidSchema,
  course_blueprint_id: uuidSchema,
  source_classroom_id: uuidSchema.nullable(),
  target_classroom_id: uuidSchema.nullable(),
  target_kind: z.enum(['blueprint', 'classroom']),
  source_kind: z.enum(['classroom', 'package', 'repository', 'ai', 'blueprint']),
  status: proposalStatusSchema,
  base_blueprint_revision: z.coerce.number().int().positive(),
  base_classroom_revision: z.coerce.number().int().positive().nullable(),
  base_blueprint_version_id: uuidSchema.nullable(),
  payload_schema_version: z.coerce.number().int().positive(),
  operations_json: z.array(z.unknown()),
  diff_json: z.record(z.string(), z.unknown()),
  validation_errors: z.array(z.unknown()),
  request_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  idempotency_key: uuidSchema,
  applied_blueprint_revision: z.coerce.number().int().positive().nullable(),
  applied_classroom_revision: z.coerce.number().int().positive().nullable(),
  applied_at: z.string().nullable(),
  rejected_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type CourseBlueprintProposalRecord = z.infer<typeof proposalRecordSchema>
export type CourseBlueprintProposalTarget =
  | 'overview'
  | 'outline'
  | 'resources'
  | 'assignments'
  | 'tests'
  | 'lesson-plans'
  | 'materials'
  | 'surveys'
  | 'grading'

export function countUntrackedClassroomBlueprintArtifacts(
  source: ClassroomBlueprintSource,
): number {
  return [
    ...source.assignments,
    ...source.tests,
    ...source.lesson_templates,
    ...source.materials,
    ...source.surveys,
  ].filter((artifact) => artifact.source_artifact_id === null).length
}

function parseProposalRpcResult(data: unknown) {
  return proposalRecordSchema.safeParse(Array.isArray(data) ? data[0] : data)
}

export async function submitCourseBlueprintProposal(args: {
  supabase: Pick<SupabaseClient<any>, 'rpc'>
  teacherId: string
  base: CourseBlueprintSnapshot
  candidate: CourseBlueprintSnapshot
  source: CourseBlueprintProposalSource
  idempotencyKey: string
  baseBlueprintVersionId?: string | null
  expectedBlueprintRevision?: number
  sourceClassroomId?: string | null
  baseClassroomRevision?: number | null
}): Promise<
  | { ok: true; proposal: CourseBlueprintProposalRecord }
  | { ok: false; status: number; error: string }
> {
  const proposal = buildCourseBlueprintChangeProposal(args.base, args.candidate, args.source)
  const candidateSha256 = hashCourseBlueprintSnapshot(args.candidate)
  const diff = {
    summary: proposal.summary,
    candidate_sha256: candidateSha256,
    candidate_snapshot: args.candidate,
  }
  const requestSha256 = hashCanonicalJson({
    blueprint_id: args.base.blueprint_id,
    base_draft_revision: args.expectedBlueprintRevision ?? args.base.draft_revision,
    source: args.source,
    operations: proposal.operations,
    candidate_sha256: candidateSha256,
  })
  const { data, error } = await args.supabase.rpc(
    'create_course_blueprint_proposal_atomic',
    {
      p_teacher_id: args.teacherId,
      p_blueprint_id: args.base.blueprint_id,
      p_idempotency_key: uuidSchema.parse(args.idempotencyKey),
      p_source_kind: args.source,
      p_expected_blueprint_revision:
        args.expectedBlueprintRevision ?? args.base.draft_revision,
      p_base_blueprint_version_id: args.baseBlueprintVersionId ?? null,
      p_source_classroom_id: args.sourceClassroomId ?? null,
      p_base_classroom_revision: args.baseClassroomRevision ?? null,
      p_operations: parseDatabaseJson(proposal.operations),
      p_diff: parseDatabaseJson(diff),
      p_request_sha256: requestSha256,
    }
  )

  if (error) {
    const missing = error.code === '42883'
      || error.code === 'PGRST202'
      || (error.message || '').includes('create_course_blueprint_proposal_atomic')
    return {
      ok: false,
      status: missing ? 503 : error.code === '23505' ? 409 : 500,
      error: missing
        ? 'Blueprint proposals require migration 111 to be applied'
        : error.code === '23505'
          ? 'Proposal idempotency key was already used for different content'
          : 'Failed to submit Blueprint proposal',
    }
  }

  const parsed = parseProposalRpcResult(data)
  return parsed.success
    ? { ok: true, proposal: parsed.data }
    : { ok: false, status: 500, error: 'Blueprint proposal transaction returned an invalid response' }
}

export function buildClassroomCourseBlueprintSnapshot(args: {
  source: ClassroomBlueprintSource
  blueprintId: string
  blueprintRevision: number
  candidate?: CourseBlueprintSnapshot
  trackedOnly?: boolean
}): CourseBlueprintSnapshot {
  const includeArtifact = (artifact: { source_artifact_id: string | null }) =>
    !args.trackedOnly || artifact.source_artifact_id !== null
  const candidateLessonTitles = new Map(
    (args.candidate?.lesson_templates || []).map((lesson) => [
      lesson.artifact_id,
      lesson.title,
    ]),
  )
  const metadata = args.candidate?.metadata ?? {
    title: args.source.classroom.title,
    subject: '',
    grade_level: '',
    course_code: '',
    term_template: '',
  }
  const actualSiteConfig = args.source.classroom.actual_site_config
  const plannedSite = args.candidate ? {
    ...args.candidate.planned_site,
    config: {
      overview: actualSiteConfig?.overview ?? true,
      outline: actualSiteConfig?.outline ?? true,
      resources: actualSiteConfig?.resources ?? true,
      assignments: actualSiteConfig?.assignments ?? true,
      tests: actualSiteConfig?.tests ?? true,
      lesson_plans: actualSiteConfig?.lesson_plans ?? true,
    },
  } : {
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
  }

  return {
    schema_version: 2,
    blueprint_id: args.blueprintId,
    draft_revision: args.blueprintRevision,
    metadata,
    sections: {
      overview_markdown: args.source.classroom.course_overview_markdown ?? '',
      outline_markdown: args.source.classroom.course_outline_markdown ?? '',
      resources_markdown: args.source.resources_markdown,
    },
    grading: args.source.grading,
    planned_site: plannedSite,
    assignments: args.source.assignments.filter(includeArtifact).map((assignment) => ({
      artifact_id: assignment.artifact_id,
      title: assignment.title,
      instructions_markdown: assignment.instructions_markdown,
      submission_requirements: assignment.submission_requirements_json.map(
        (requirement) => ({
          id: requirement.id,
          type: requirement.type,
          label: requirement.label,
          instructions: requirement.instructions,
          required: requirement.required,
          position: requirement.position,
          validation_policy_json: requirement.validation_policy_json || {},
        }),
      ),
      default_due_days: assignment.default_due_days,
      default_due_time: assignment.default_due_time,
      points_possible: assignment.points_possible,
      gradebook_weight: assignment.gradebook_weight ?? 10,
      include_in_final: assignment.include_in_final,
      is_draft: true,
      track_authenticity: assignment.track_authenticity,
      position: assignment.position,
    })),
    assessments: args.source.tests.filter(includeArtifact).map((test) => ({
      artifact_id: test.artifact_id,
      assessment_type: 'test',
      title: test.title,
      content: test.content,
      documents: test.documents,
      points_possible: test.points_possible,
      gradebook_weight: test.gradebook_weight ?? 10,
      include_in_final: test.include_in_final,
      position: test.position,
    })),
    lesson_templates: args.source.lesson_templates.filter(includeArtifact).map((lesson) => ({
      artifact_id: lesson.artifact_id,
      title: candidateLessonTitles.get(lesson.artifact_id) || lesson.title,
      content_markdown: lesson.content_markdown,
      position: lesson.position,
    })),
    materials: args.source.materials.filter(includeArtifact).map((material) => ({
      artifact_id: material.artifact_id,
      title: material.title,
      content_markdown: material.content_markdown,
      position: material.position,
    })),
    surveys: args.source.surveys.filter(includeArtifact).map((survey) => ({
      artifact_id: survey.artifact_id,
      title: survey.title,
      show_results: survey.show_results,
      dynamic_responses: survey.dynamic_responses,
      questions: survey.questions_json.map((question) => ({
        artifact_id: question.id,
        question_type: question.question_type,
        question_text: question.question_text,
        options: question.options,
        response_max_chars: question.response_max_chars,
        position: question.position,
      })),
      position: survey.position,
    })),
  }
}

export async function submitClassroomBlueprintProposal(args: {
  supabase: Pick<SupabaseClient<any>, 'rpc'>
  teacherId: string
  blueprintId: string
  blueprintRevision: number
  blueprintVersionId: string
  classroomId: string
  classroomRevision: number
  base: CourseBlueprintSnapshot
  candidate: CourseBlueprintSnapshot
  plan: ClassroomBlueprintUpdateWritePlan
  idempotencyKey: string
}): Promise<
  | { ok: true; proposal: CourseBlueprintProposalRecord }
  | { ok: false; status: number; error: string }
> {
  const proposal = buildCourseBlueprintChangeProposal(
    args.base,
    args.candidate,
    'blueprint',
  )
  const candidateSha256 = hashCourseBlueprintSnapshot(args.candidate)
  const planSha256 = hashCanonicalJson(args.plan)
  const diff = {
    summary: proposal.summary,
    candidate_sha256: candidateSha256,
    candidate_snapshot: args.candidate,
    classroom_plan_sha256: planSha256,
    classroom_plan: args.plan,
  }
  const requestSha256 = hashCanonicalJson({
    blueprint_id: args.blueprintId,
    blueprint_revision: args.blueprintRevision,
    blueprint_version_id: args.blueprintVersionId,
    classroom_id: args.classroomId,
    classroom_revision: args.classroomRevision,
    operations: proposal.operations,
    candidate_sha256: candidateSha256,
    classroom_plan_sha256: planSha256,
  })
  const { data, error } = await args.supabase.rpc(
    'create_course_blueprint_classroom_proposal_atomic',
    {
      p_teacher_id: args.teacherId,
      p_blueprint_id: args.blueprintId,
      p_blueprint_version_id: args.blueprintVersionId,
      p_target_classroom_id: args.classroomId,
      p_expected_blueprint_revision: args.blueprintRevision,
      p_expected_classroom_revision: args.classroomRevision,
      p_idempotency_key: uuidSchema.parse(args.idempotencyKey),
      p_operations: parseDatabaseJson(proposal.operations),
      p_diff: parseDatabaseJson(diff),
      p_request_sha256: requestSha256,
    },
  )

  if (error) {
    const missing = error.code === '42883'
      || error.code === 'PGRST202'
      || (error.message || '').includes(
        'create_course_blueprint_classroom_proposal_atomic',
      )
    return {
      ok: false,
      status: missing ? 503 : error.code === '23505' ? 409 : 500,
      error: missing
        ? 'Classroom Blueprint proposals require migration 111 to be applied'
        : error.code === '23505'
          ? 'Proposal idempotency key was already used for different content'
          : 'Failed to prepare classroom Blueprint proposal',
    }
  }

  const parsed = parseProposalRpcResult(data)
  return parsed.success
    ? { ok: true, proposal: parsed.data }
    : { ok: false, status: 500, error: 'Classroom proposal transaction returned an invalid response' }
}

export async function applyPersistedClassroomBlueprintProposal(args: {
  supabase: Pick<SupabaseClient<any>, 'rpc'>
  teacherId: string
  proposalId: string
  plan: ClassroomBlueprintUpdateWritePlan
}): Promise<
  | { ok: true; proposal: CourseBlueprintProposalRecord }
  | { ok: false; status: number; error: string }
> {
  const { data, error } = await args.supabase.rpc(
    'apply_course_blueprint_classroom_proposal_atomic',
    {
      p_teacher_id: args.teacherId,
      p_proposal_id: uuidSchema.parse(args.proposalId),
      p_classroom_plan: parseDatabaseJson(args.plan),
      p_classroom_plan_sha256: hashCanonicalJson(args.plan),
    },
  )
  if (error) {
    const missing = error.code === '42883'
      || error.code === 'PGRST202'
      || (error.message || '').includes(
        'apply_course_blueprint_classroom_proposal_atomic',
      )
    return {
      ok: false,
      status: missing ? 503 : error.code === '40001' ? 409 : 500,
      error: missing
        ? 'Classroom Blueprint proposal application requires migration 111 to be applied'
        : error.code === '40001'
          ? 'Classroom proposal is stale; review it again against the current classroom'
          : 'Failed to apply classroom Blueprint proposal',
    }
  }
  const parsed = parseProposalRpcResult(data)
  return parsed.success
    ? { ok: true, proposal: parsed.data }
    : { ok: false, status: 500, error: 'Classroom proposal transaction returned an invalid response' }
}

export function buildCourseBlueprintAiCandidate(
  baseDetail: CourseBlueprintDetail,
  target: CourseBlueprintProposalTarget,
  content: string
):
  | {
      ok: true
      base: CourseBlueprintSnapshot
      candidate: CourseBlueprintSnapshot
      warnings: string[]
    }
  | { ok: false; status: number; error: string; errors?: string[] } {
  const candidateDetail = structuredClone(baseDetail)
  const warnings: string[] = []
  const now = new Date().toISOString()

  if (target === 'overview' || target === 'outline' || target === 'resources') {
    const key =
      target === 'overview'
        ? 'overview_markdown'
        : target === 'outline'
          ? 'outline_markdown'
          : 'resources_markdown'
    candidateDetail[key] = content
  } else if (target === 'assignments') {
    const parsed = markdownToCourseBlueprintAssignments(
      content,
      baseDetail.assignments,
      { generateMissingArtifactIds: true }
    )
    if (parsed.errors.length > 0) {
      return { ok: false, status: 400, error: 'Invalid assignment proposal', errors: parsed.errors }
    }
    warnings.push(...parsed.warnings)
    candidateDetail.assignments = parsed.assignments.map((assignment) => {
      const existing = baseDetail.assignments.find((item) => item.id === assignment.id)
      return {
        ...(existing || {
          id: assignment.artifact_id!,
          course_blueprint_id: baseDetail.id,
          created_at: now,
          updated_at: now,
        }),
        ...assignment,
        artifact_id: assignment.artifact_id!,
        submission_requirements_json:
          assignment.submission_requirements
          || assignment.submission_requirements_json
          || [],
        gradebook_weight: assignment.gradebook_weight ?? 10,
        track_authenticity:
          assignment.track_authenticity ?? existing?.track_authenticity ?? false,
      }
    })
  } else if (target === 'tests') {
    const parsed = markdownToCourseBlueprintAssessments(
      content,
      baseDetail.assessments as any,
      'test',
      { generateMissingArtifactIds: true }
    )
    if (parsed.errors.length > 0) {
      return { ok: false, status: 400, error: 'Invalid test proposal', errors: parsed.errors }
    }
    warnings.push(...parsed.warnings)
    candidateDetail.assessments = parsed.assessments.map((assessment) => {
      const existing = baseDetail.assessments.find((item) => item.id === assessment.id)
      return {
        ...(existing || {
          id: assessment.artifact_id!,
          course_blueprint_id: baseDetail.id,
          created_at: now,
          updated_at: now,
        }),
        ...assessment,
        artifact_id: assessment.artifact_id!,
        points_possible: assessment.points_possible ?? null,
        gradebook_weight: assessment.gradebook_weight ?? 10,
        include_in_final: assessment.include_in_final ?? true,
      }
    })
  } else if (target === 'lesson-plans') {
    const parsed = markdownToCourseBlueprintLessonTemplates(
      content,
      baseDetail.lesson_templates,
      { generateMissingArtifactIds: true }
    )
    if (parsed.errors.length > 0) {
      return { ok: false, status: 400, error: 'Invalid lesson proposal', errors: parsed.errors }
    }
    warnings.push(...parsed.warnings)
    candidateDetail.lesson_templates = parsed.lesson_templates.map((lesson) => {
      const existing = baseDetail.lesson_templates.find((item) => item.id === lesson.id)
      return {
        ...(existing || {
          id: lesson.artifact_id!,
          course_blueprint_id: baseDetail.id,
          created_at: now,
          updated_at: now,
        }),
        ...lesson,
        artifact_id: lesson.artifact_id!,
      }
    })
  } else if (target === 'materials') {
    const parsed = markdownToCourseBlueprintMaterials(
      content,
      baseDetail.materials,
      { generateMissingArtifactIds: true },
    )
    if (parsed.errors.length > 0) {
      return { ok: false, status: 400, error: 'Invalid material proposal', errors: parsed.errors }
    }
    warnings.push(...parsed.warnings)
    candidateDetail.materials = parsed.materials.map((material) => {
      const existing = baseDetail.materials.find((item) => item.id === material.id)
      return {
        ...(existing || {
          id: material.artifact_id!,
          course_blueprint_id: baseDetail.id,
          created_at: now,
          updated_at: now,
        }),
        ...material,
        artifact_id: material.artifact_id!,
      }
    })
  } else if (target === 'surveys') {
    const parsed = markdownToCourseBlueprintSurveys(
      content,
      baseDetail.surveys,
      { generateMissingArtifactIds: true },
    )
    if (parsed.errors.length > 0) {
      return { ok: false, status: 400, error: 'Invalid survey proposal', errors: parsed.errors }
    }
    warnings.push(...parsed.warnings)
    candidateDetail.surveys = parsed.surveys.map((survey) => {
      const existing = baseDetail.surveys.find((item) => item.id === survey.id)
      return {
        ...(existing || {
          id: survey.artifact_id!,
          course_blueprint_id: baseDetail.id,
          created_at: now,
          updated_at: now,
        }),
        ...survey,
        artifact_id: survey.artifact_id!,
        questions_json: survey.questions_json.map((question) => ({
          ...question,
          id: question.id!,
        })),
      }
    })
  } else {
    const parsed = markdownToCourseBlueprintGrading(content)
    if (!parsed.grading) {
      return {
        ok: false,
        status: 400,
        error: 'Invalid grading proposal',
        errors: parsed.errors,
      }
    }
    candidateDetail.gradebook_use_weights = parsed.grading.use_weights
    candidateDetail.gradebook_assignments_weight = parsed.grading.assignments_weight
    candidateDetail.gradebook_tests_weight = parsed.grading.tests_weight
  }

  try {
    return {
      ok: true,
      base: buildCourseBlueprintSnapshot(baseDetail),
      candidate: buildCourseBlueprintSnapshot(candidateDetail),
      warnings,
    }
  } catch (error) {
    return {
      ok: false,
      status: 400,
      error: error instanceof Error ? error.message : 'Invalid Blueprint proposal',
    }
  }
}

export async function applyPersistedCourseBlueprintProposal(args: {
  supabase: Pick<SupabaseClient<any>, 'rpc'>
  teacherId: string
  proposalId: string
  candidate: CourseBlueprintSnapshot
}): Promise<
  | { ok: true; proposal: CourseBlueprintProposalRecord }
  | { ok: false; status: number; error: string }
> {
  const candidateSha256 = hashCourseBlueprintSnapshot(args.candidate)
  const { data, error } = await args.supabase.rpc(
    'apply_course_blueprint_proposal_atomic',
    {
      p_teacher_id: args.teacherId,
      p_proposal_id: uuidSchema.parse(args.proposalId),
      p_candidate_snapshot: parseDatabaseJson(args.candidate),
      p_candidate_sha256: candidateSha256,
    }
  )

  if (error) {
    const missing = error.code === '42883'
      || error.code === 'PGRST202'
      || (error.message || '').includes('apply_course_blueprint_proposal_atomic')
    return {
      ok: false,
      status:
        missing
          ? 503
          : error.code === '40001' || error.code === '55000'
            ? 409
            : 500,
      error: missing
        ? 'Blueprint proposal application requires migration 111 to be applied'
        : error.code === '40001'
          ? 'Blueprint proposal is stale; rebuild it against the current Draft'
          : error.code === '55000'
            ? 'Proposal source does not match the selected Blueprint authority'
          : 'Failed to apply Blueprint proposal',
    }
  }

  const parsed = parseProposalRpcResult(data)
  return parsed.success
    ? { ok: true, proposal: parsed.data }
    : { ok: false, status: 500, error: 'Blueprint proposal transaction returned an invalid response' }
}

export function serializeCourseBlueprintProposalCandidate(
  candidate: CourseBlueprintSnapshot
): string {
  return canonicalizeCourseBlueprintSnapshot(candidate)
}

export function buildCourseBlueprintPackageCandidate(
  baseDetail: CourseBlueprintDetail,
  bundle: unknown
):
  | {
      ok: true
      base: CourseBlueprintSnapshot
      candidate: CourseBlueprintSnapshot
      baseBlueprintVersionId: string | null
      sourceDraftRevision: number
      editingSessionId: string | null
    }
  | { ok: false; status: number; error: string; errors?: string[] } {
  const parsed = parseCourseBlueprintImportBundle(bundle)
  if (parsed.errors.length > 0 || !parsed.manifest) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid course package',
      errors: parsed.errors,
    }
  }
  if (parsed.manifest.version !== '5') {
    return {
      ok: false,
      status: 400,
      error: 'Change proposals require a version 5 identity-aware course package',
    }
  }
  if (parsed.manifest.blueprint_id !== baseDetail.id) {
    return {
      ok: false,
      status: 409,
      error: 'Course package belongs to a different Blueprint',
    }
  }

  const candidateDetail: CourseBlueprintDetail = {
    ...baseDetail,
    ...parsed.blueprint,
    // Publication authority stays in Pika. External package content may update
    // the site draft but cannot publish or unpublish the public course site.
    planned_site_published: baseDetail.planned_site_published,
    content_revision: parsed.manifest.source_draft_revision,
    assignments: parsed.assignments.map((assignment) => ({
      id: assignment.artifact_id!,
      artifact_id: assignment.artifact_id!,
      course_blueprint_id: baseDetail.id,
      title: assignment.title,
      instructions_markdown: assignment.instructions_markdown,
      submission_requirements_json: assignment.submission_requirements || [],
      default_due_days: assignment.default_due_days,
      default_due_time: assignment.default_due_time,
      points_possible: assignment.points_possible,
      gradebook_weight: assignment.gradebook_weight,
      include_in_final: assignment.include_in_final,
      is_draft: assignment.is_draft,
      track_authenticity: assignment.track_authenticity ?? false,
      position: assignment.position,
      created_at: baseDetail.created_at,
      updated_at: baseDetail.updated_at,
    })),
    assessments: parsed.assessments.map((assessment) => ({
      id: assessment.artifact_id!,
      artifact_id: assessment.artifact_id!,
      course_blueprint_id: baseDetail.id,
      assessment_type: 'test',
      title: assessment.title,
      content: assessment.content,
      documents: assessment.documents,
      points_possible: assessment.points_possible ?? null,
      gradebook_weight: assessment.gradebook_weight ?? 10,
      include_in_final: assessment.include_in_final !== false,
      position: assessment.position,
      created_at: baseDetail.created_at,
      updated_at: baseDetail.updated_at,
    })),
    lesson_templates: parsed.lesson_templates.map((lesson) => ({
      id: lesson.artifact_id!,
      artifact_id: lesson.artifact_id!,
      course_blueprint_id: baseDetail.id,
      title: lesson.title,
      content_markdown: lesson.content_markdown,
      position: lesson.position,
      created_at: baseDetail.created_at,
      updated_at: baseDetail.updated_at,
    })),
    materials: parsed.materials.map((material) => ({
      id: material.artifact_id!,
      artifact_id: material.artifact_id!,
      course_blueprint_id: baseDetail.id,
      title: material.title,
      content_markdown: material.content_markdown,
      position: material.position,
      created_at: baseDetail.created_at,
      updated_at: baseDetail.updated_at,
    })),
    surveys: parsed.surveys.map((survey) => ({
      id: survey.artifact_id!,
      artifact_id: survey.artifact_id!,
      course_blueprint_id: baseDetail.id,
      title: survey.title,
      show_results: survey.show_results,
      dynamic_responses: survey.dynamic_responses,
      questions_json: survey.questions_json.map((question) => ({
        ...question,
        id: question.id!,
      })),
      position: survey.position,
      created_at: baseDetail.created_at,
      updated_at: baseDetail.updated_at,
    })),
  }

  return {
    ok: true,
    base: buildCourseBlueprintSnapshot(baseDetail),
    candidate: buildCourseBlueprintSnapshot(candidateDetail),
    baseBlueprintVersionId: parsed.manifest.blueprint_version_id ?? null,
    sourceDraftRevision: parsed.manifest.source_draft_revision,
    editingSessionId: parsed.manifest.editing_session_id ?? null,
  }
}
