import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeAssignmentSubmissionRequirementDrafts } from '@/lib/assignment-submission-requirements'
import { isCourseBlueprintArtifactId } from '@/lib/course-blueprint-artifact-identity'
import { normalizePlannedCourseSiteConfig } from '@/lib/course-site-publishing'
import { stripTestDocumentSnapshots } from '@/lib/test-documents'
import type {
  CourseBlueprintDetail,
  CourseBlueprintVersion,
  PlannedCourseSiteConfig,
  TestDocument,
  TestDraftContent,
} from '@/types'
import { PORTABLE_TEST_QUESTION_IDENTITY_VERSION } from '@/lib/test-question-identity'
import { parseDatabaseJson } from '@/lib/validations/database-json'

export const COURSE_BLUEPRINT_SNAPSHOT_SCHEMA_VERSION = 2 as const

export type CourseBlueprintSnapshot = {
  schema_version: typeof COURSE_BLUEPRINT_SNAPSHOT_SCHEMA_VERSION
  blueprint_id: string
  draft_revision: number
  metadata: {
    title: string
    subject: string
    grade_level: string
    course_code: string
    term_template: string
  }
  sections: {
    overview_markdown: string
    outline_markdown: string
    resources_markdown: string
  }
  grading: {
    use_weights: boolean
    assignments_weight: number
    tests_weight: number
  }
  planned_site: {
    slug: string | null
    published: boolean
    config: PlannedCourseSiteConfig
  }
  assignments: Array<{
    artifact_id: string
    title: string
    instructions_markdown: string
    submission_requirements: ReturnType<typeof normalizeAssignmentSubmissionRequirementDrafts>
    default_due_days: number
    default_due_time: string
    points_possible: number | null
    gradebook_weight: number
    include_in_final: boolean
    is_draft: boolean
    track_authenticity: boolean
    position: number
  }>
  assessments: Array<{
    artifact_id: string
    assessment_type: 'test'
    title: string
    content: TestDraftContent
    documents: TestDocument[]
    points_possible: number | null
    gradebook_weight: number
    include_in_final: boolean
    position: number
  }>
  lesson_templates: Array<{
    artifact_id: string
    title: string
    content_markdown: string
    position: number
  }>
  materials: Array<{
    artifact_id: string
    title: string
    content_markdown: string
    position: number
  }>
  surveys: Array<{
    artifact_id: string
    title: string
    show_results: boolean
    dynamic_responses: boolean
    questions: Array<{
      artifact_id: string
      question_type: 'multiple_choice' | 'short_text' | 'link'
      question_text: string
      options: string[]
      response_max_chars: number
      position: number
    }>
    position: number
  }>
}

function assertArtifactId(value: unknown, label: string): asserts value is string {
  if (!isCourseBlueprintArtifactId(value)) {
    throw new Error(`${label} requires a UUIDv4 Artifact ID`)
  }
}

function byPositionAndArtifactId(
  left: { position: number; artifact_id: string },
  right: { position: number; artifact_id: string }
) {
  return left.position - right.position || left.artifact_id.localeCompare(right.artifact_id)
}

export function buildCourseBlueprintSnapshot(
  detail: CourseBlueprintDetail
): CourseBlueprintSnapshot {
  const seenArtifactIds = new Set<string>()
  const registerArtifactId = (value: unknown, label: string) => {
    assertArtifactId(value, label)
    const normalized = value.toLowerCase()
    if (seenArtifactIds.has(normalized)) {
      throw new Error(`${label} duplicates Artifact ID "${normalized}"`)
    }
    seenArtifactIds.add(normalized)
    return normalized
  }

  const assignments = detail.assignments.map((assignment, index) => ({
    artifact_id: registerArtifactId(assignment.artifact_id, `Assignment ${index + 1}`),
    title: assignment.title,
    instructions_markdown: assignment.instructions_markdown,
    submission_requirements: normalizeAssignmentSubmissionRequirementDrafts(
      assignment.submission_requirements_json
    ).map((requirement, requirementIndex) => ({
      ...requirement,
      id: registerArtifactId(
        requirement.id,
        `Assignment ${index + 1} submission requirement ${requirementIndex + 1}`
      ),
    })),
    default_due_days: assignment.default_due_days,
    default_due_time: assignment.default_due_time,
    points_possible: assignment.points_possible,
    gradebook_weight: assignment.gradebook_weight,
    include_in_final: assignment.include_in_final,
    is_draft: assignment.is_draft,
    track_authenticity: assignment.track_authenticity ?? false,
    position: assignment.position,
  })).sort(byPositionAndArtifactId)

  const assessments = detail.assessments
    .filter((assessment) => assessment.assessment_type === 'test')
    .map((assessment, index) => {
      const content = assessment.content as unknown as TestDraftContent
      return {
        artifact_id: registerArtifactId(assessment.artifact_id, `Test ${index + 1}`),
        assessment_type: 'test' as const,
        title: assessment.title,
        content: {
          title: content.title || assessment.title,
          show_results: Boolean(content.show_results),
          question_identity_version: PORTABLE_TEST_QUESTION_IDENTITY_VERSION,
          questions: (content.questions || []).map((question, questionIndex) => ({
            ...question,
            id: registerArtifactId(
              question.id,
              `Test ${index + 1} question ${questionIndex + 1}`
            ),
          })),
          ...(content.source_format ? { source_format: content.source_format } : {}),
          ...(content.source_markdown ? { source_markdown: content.source_markdown } : {}),
        },
        documents: stripTestDocumentSnapshots(assessment.documents).map(
          (document, documentIndex) => ({
            ...document,
            id: registerArtifactId(
              document.id,
              `Test ${index + 1} document ${documentIndex + 1}`
            ),
          })
        ),
        points_possible: assessment.points_possible,
        gradebook_weight: assessment.gradebook_weight,
        include_in_final: assessment.include_in_final,
        position: assessment.position,
      }
    })
    .sort(byPositionAndArtifactId)

  const lessonTemplates = detail.lesson_templates.map((lesson, index) => ({
    artifact_id: registerArtifactId(lesson.artifact_id, `Lesson ${index + 1}`),
    title: lesson.title,
    content_markdown: lesson.content_markdown,
    position: lesson.position,
  })).sort(byPositionAndArtifactId)
  const materials = (detail.materials || []).map((material, index) => ({
    artifact_id: registerArtifactId(material.artifact_id, `Material ${index + 1}`),
    title: material.title,
    content_markdown: material.content_markdown,
    position: material.position,
  })).sort(byPositionAndArtifactId)
  const surveys = (detail.surveys || []).map((survey, surveyIndex) => ({
    artifact_id: registerArtifactId(
      survey.artifact_id,
      `Survey ${surveyIndex + 1}`
    ),
    title: survey.title,
    show_results: survey.show_results,
    dynamic_responses: survey.dynamic_responses,
    questions: survey.questions_json.map((question, questionIndex) => ({
      artifact_id: registerArtifactId(
        question.id,
        `Survey ${surveyIndex + 1} question ${questionIndex + 1}`
      ),
      question_type: question.question_type,
      question_text: question.question_text,
      options: question.options,
      response_max_chars: question.response_max_chars,
      position: question.position,
    })).sort(byPositionAndArtifactId),
    position: survey.position,
  })).sort(byPositionAndArtifactId)
  const classworkPositions = [
    ...assignments.map((item) => item.position),
    ...materials.map((item) => item.position),
    ...surveys.map((item) => item.position),
  ]
  if (new Set(classworkPositions).size !== classworkPositions.length) {
    throw new Error(
      'Assignments, materials, and surveys require distinct classwork positions'
    )
  }
  const useWeights = detail.gradebook_use_weights ?? false
  const assignmentsWeight = detail.gradebook_assignments_weight ?? 70
  const testsWeight = detail.gradebook_tests_weight ?? 30
  if (useWeights && assignmentsWeight + testsWeight !== 100) {
    throw new Error('Assignment and test gradebook weights must total 100%')
  }

  return {
    schema_version: COURSE_BLUEPRINT_SNAPSHOT_SCHEMA_VERSION,
    blueprint_id: detail.id,
    draft_revision: detail.content_revision,
    metadata: {
      title: detail.title ?? '',
      subject: detail.subject ?? '',
      grade_level: detail.grade_level ?? '',
      course_code: detail.course_code ?? '',
      term_template: detail.term_template ?? '',
    },
    sections: {
      overview_markdown: detail.overview_markdown,
      outline_markdown: detail.outline_markdown,
      resources_markdown: detail.resources_markdown,
    },
    grading: {
      use_weights: useWeights,
      assignments_weight: assignmentsWeight,
      tests_weight: testsWeight,
    },
    planned_site: {
      slug: detail.planned_site_slug,
      published: detail.planned_site_published,
      config: normalizePlannedCourseSiteConfig(detail.planned_site_config),
    },
    assignments,
    assessments,
    lesson_templates: lessonTemplates,
    materials,
    surveys,
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    )
  }
  return value
}

export function canonicalizeCourseBlueprintSnapshot(
  snapshot: CourseBlueprintSnapshot
): string {
  return JSON.stringify(canonicalize(snapshot))
}

export function hashCanonicalJson(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')
}

export function hashCourseBlueprintSnapshot(snapshot: CourseBlueprintSnapshot): string {
  return hashCanonicalJson(snapshot)
}

const courseBlueprintVersionSchema = z.object({
  id: z.string().uuid(),
  course_blueprint_id: z.string().uuid(),
  version_number: z.coerce.number().int().positive(),
  source_draft_revision: z.coerce.number().int().positive(),
  snapshot_schema_version: z.coerce.number().int().positive(),
  snapshot_json: z.record(z.string(), z.unknown()),
  snapshot_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  source_kind: z.enum(['pika', 'classroom', 'package', 'repository', 'ai']),
  source_metadata: z.record(z.string(), z.unknown()),
  created_by: z.string().uuid(),
  created_at: z.string(),
})

export async function saveCourseBlueprintVersion(args: {
  supabase: Pick<SupabaseClient<any>, 'rpc'>
  teacherId: string
  detail: CourseBlueprintDetail
  sourceKind?: CourseBlueprintVersion['source_kind']
  sourceMetadata?: Record<string, unknown>
}): Promise<
  | { ok: true; version: CourseBlueprintVersion; snapshot: CourseBlueprintSnapshot }
  | { ok: false; status: number; error: string }
> {
  const snapshot = buildCourseBlueprintSnapshot(args.detail)
  const snapshotSha256 = hashCourseBlueprintSnapshot(snapshot)
  const { data, error } = await args.supabase.rpc(
    'save_course_blueprint_version_atomic',
    {
      p_teacher_id: args.teacherId,
      p_blueprint_id: args.detail.id,
      p_expected_draft_revision: args.detail.content_revision,
      p_snapshot_schema_version: snapshot.schema_version,
      p_snapshot: parseDatabaseJson(snapshot),
      p_snapshot_sha256: snapshotSha256,
      p_source_kind: args.sourceKind ?? 'pika',
      p_source_metadata: parseDatabaseJson(args.sourceMetadata ?? {}),
    }
  )

  if (error) {
    const missing = error.code === '42883'
      || error.code === 'PGRST202'
      || (error.message || '').includes('save_course_blueprint_version_atomic')
    return {
      ok: false,
      status: missing ? 503 : error.code === '40001' ? 409 : 500,
      error: missing
        ? 'Blueprint Versions require migration 112 to be applied'
        : error.code === '40001'
          ? 'Blueprint Draft changed while saving the Version; review and retry'
          : 'Failed to save Blueprint Version',
    }
  }

  const parsed = courseBlueprintVersionSchema.safeParse(
    Array.isArray(data) ? data[0] : data
  )
  if (!parsed.success) {
    return {
      ok: false,
      status: 500,
      error: 'Blueprint Version transaction returned an invalid response',
    }
  }

  return {
    ok: true,
    version: parsed.data as CourseBlueprintVersion,
    snapshot,
  }
}
