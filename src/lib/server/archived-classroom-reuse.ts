import type { CourseBlueprintSnapshot } from '@/lib/server/course-blueprint-versions'
import {
  buildCourseBlueprintSnapshot,
  hashCanonicalJson,
} from '@/lib/server/course-blueprint-versions'
import {
  applyArchivedClassroomCourseBlueprintProposal,
  buildClassroomCourseBlueprintSnapshot,
} from '@/lib/server/course-blueprint-proposals'
import {
  createCourseBlueprintFromClassroom,
  getCourseBlueprintDetail,
} from '@/lib/server/course-blueprints'
import { markPortableTestQuestionIdentity } from '@/lib/test-question-identity'
import {
  applyBlueprintMergeSuggestions,
  getBlueprintMergeSuggestionSet,
} from '@/lib/server/course-sites'
import { assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { loadClassroomBlueprintSource } from '@/lib/server/classroom-blueprint-source'
import { getServiceRoleClient } from '@/lib/supabase'

type ReusableArea =
  | 'overview'
  | 'outline'
  | 'resources'
  | 'assignments'
  | 'tests'
  | 'lesson-plans'
  | 'materials'
  | 'surveys'
  | 'grading'
  | 'site-visibility'

type ArchivedClassroomReuseReady = {
  ok: true
  status: 'ready'
  blueprint_id: string
  blueprint_title: string
}

type ArchivedClassroomReuseReview = {
  ok: true
  status: 'review_required'
  blueprint_id: string
  blueprint_title: string
  review_url: string
}

export type ArchivedClassroomReuseResult =
  | ArchivedClassroomReuseReady
  | ArchivedClassroomReuseReview
  | { ok: false; status: number; error: string }

function reusableBlueprintContent(snapshot: CourseBlueprintSnapshot) {
  const { draft_revision: _draftRevision, ...content } = snapshot
  return {
    ...content,
    planned_site: { config: snapshot.planned_site.config },
  }
}

function normalizeTestQuestionIdentityFormat(
  snapshot: CourseBlueprintSnapshot,
): CourseBlueprintSnapshot {
  const normalized = structuredClone(snapshot)
  return {
    ...normalized,
    assessments: normalized.assessments.map((assessment) => ({
      ...assessment,
      content: markPortableTestQuestionIdentity(assessment.content),
    })),
  }
}

function normalizeVersionForClassroom(
  snapshot: CourseBlueprintSnapshot,
  appliedLessonArtifactIds: ReadonlySet<string>,
): CourseBlueprintSnapshot {
  return {
    ...structuredClone(snapshot),
    assignments: snapshot.assignments.map((assignment) => ({
      ...assignment,
      is_draft: true,
      points_possible: assignment.points_possible ?? 30,
    })),
    assessments: snapshot.assessments.map((assessment) => ({
      ...assessment,
      points_possible: assessment.points_possible ?? 100,
    })),
    lesson_templates: snapshot.lesson_templates.filter((lesson) =>
      appliedLessonArtifactIds.has(lesson.artifact_id),
    ),
  }
}

function classroomReusableContent(snapshot: CourseBlueprintSnapshot) {
  return {
    sections: snapshot.sections,
    grading: snapshot.grading,
    planned_site: { config: snapshot.planned_site.config },
    assignments: snapshot.assignments,
    assessments: snapshot.assessments,
    lesson_templates: snapshot.lesson_templates,
    materials: snapshot.materials,
    surveys: snapshot.surveys,
  }
}

export function classifyArchivedClassroomReuseSnapshots(args: {
  baseVersion: CourseBlueprintSnapshot
  currentBlueprint: CourseBlueprintSnapshot
  currentClassroom: CourseBlueprintSnapshot
  appliedLessonArtifactIds: ReadonlySet<string>
}) {
  // Immutable Versions created before the explicit discriminator already carry
  // portable question IDs. Normalize that older serialization in memory so a
  // format-only marker addition is not mistaken for authored Blueprint or
  // Classroom divergence. Persisted Version snapshots remain immutable.
  const baseVersion = normalizeTestQuestionIdentityFormat(args.baseVersion)
  const currentBlueprint = normalizeTestQuestionIdentityFormat(args.currentBlueprint)
  const currentClassroom = normalizeTestQuestionIdentityFormat(args.currentClassroom)
  const classroomBaseline = normalizeVersionForClassroom(
    baseVersion,
    args.appliedLessonArtifactIds,
  )
  const blueprintChanged =
    hashCanonicalJson(reusableBlueprintContent(baseVersion))
    !== hashCanonicalJson(reusableBlueprintContent(currentBlueprint))
  const classroomChanged =
    hashCanonicalJson(classroomReusableContent(classroomBaseline))
    !== hashCanonicalJson(classroomReusableContent(currentClassroom))

  return {
    blueprintChanged,
    classroomChanged,
    classroomBaseline,
  }
}

export function decideArchivedClassroomReuse(args: {
  blueprintChanged: boolean
  classroomChanged: boolean
  authorityMode: 'pika' | 'repository'
}): 'ready' | 'review' | 'promote' {
  if (!args.classroomChanged) return 'ready'
  if (args.blueprintChanged || args.authorityMode === 'repository') {
    return 'review'
  }
  return 'promote'
}

export function changedReusableAreas(
  blueprint: CourseBlueprintSnapshot,
  classroom: CourseBlueprintSnapshot,
): ReusableArea[] {
  const normalizedBlueprint = normalizeTestQuestionIdentityFormat(blueprint)
  const normalizedClassroom = normalizeTestQuestionIdentityFormat(classroom)
  const changed = (left: unknown, right: unknown) =>
    hashCanonicalJson(left) !== hashCanonicalJson(right)
  const areas: ReusableArea[] = []

  if (changed(
    normalizedBlueprint.sections.overview_markdown,
    normalizedClassroom.sections.overview_markdown,
  )) {
    areas.push('overview')
  }
  if (changed(
    normalizedBlueprint.sections.outline_markdown,
    normalizedClassroom.sections.outline_markdown,
  )) {
    areas.push('outline')
  }
  if (changed(
    normalizedBlueprint.sections.resources_markdown,
    normalizedClassroom.sections.resources_markdown,
  )) {
    areas.push('resources')
  }
  if (changed(normalizedBlueprint.assignments, normalizedClassroom.assignments)) {
    areas.push('assignments')
  }
  if (changed(normalizedBlueprint.assessments, normalizedClassroom.assessments)) {
    areas.push('tests')
  }
  if (changed(
    normalizedBlueprint.lesson_templates,
    normalizedClassroom.lesson_templates,
  )) {
    areas.push('lesson-plans')
  }
  if (changed(normalizedBlueprint.materials, normalizedClassroom.materials)) {
    areas.push('materials')
  }
  if (changed(normalizedBlueprint.surveys, normalizedClassroom.surveys)) {
    areas.push('surveys')
  }
  if (changed(normalizedBlueprint.grading, normalizedClassroom.grading)) {
    areas.push('grading')
  }
  if (changed(
    normalizedBlueprint.planned_site.config,
    normalizedClassroom.planned_site.config,
  )) {
    areas.push('site-visibility')
  }

  return areas
}

function reviewResult(args: {
  blueprintId: string
  blueprintTitle: string
  classroomId: string
}): ArchivedClassroomReuseReview {
  return {
    ok: true,
    status: 'review_required',
    blueprint_id: args.blueprintId,
    blueprint_title: args.blueprintTitle,
    review_url:
      `/teacher/blueprints?blueprint=${encodeURIComponent(args.blueprintId)}`
      + `&reviewClassroom=${encodeURIComponent(args.classroomId)}`,
  }
}

async function applyClassroomChanges(args: {
  teacherId: string
  blueprintId: string
  classroomId: string
  blueprintRevision: number
  classroomRevision: number
  areas: ReusableArea[]
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const proposalResult = await applyBlueprintMergeSuggestions(
    args.teacherId,
    args.blueprintId,
    args.classroomId,
    args.areas,
    {
      expectedBlueprintRevision: args.blueprintRevision,
      expectedClassroomRevision: args.classroomRevision,
    },
  )
  if (!proposalResult.ok) return proposalResult
  if (
    proposalResult.proposal.status !== 'ready'
    && proposalResult.proposal.status !== 'needs_review'
  ) {
    return {
      ok: false,
      status: 409,
      error: 'Course changes need review before this classroom can be used again',
    }
  }

  const candidate = proposalResult.proposal.diff_json
    .candidate_snapshot as CourseBlueprintSnapshot | undefined
  if (!candidate) {
    return {
      ok: false,
      status: 409,
      error: 'Course changes need review before this classroom can be used again',
    }
  }

  const applied = await applyArchivedClassroomCourseBlueprintProposal({
    supabase: getServiceRoleClient() as any,
    teacherId: args.teacherId,
    classroomId: args.classroomId,
    expectedClassroomRevision: args.classroomRevision,
    proposalId: proposalResult.proposal.id,
    candidate,
  })
  if (!applied.ok) return applied
  if (applied.proposal.status !== 'applied') {
    return {
      ok: false,
      status: 409,
      error: 'Course changes need review before this classroom can be used again',
    }
  }
  return { ok: true }
}

export async function prepareArchivedClassroomReuse(args: {
  teacherId: string
  classroomId: string
  operationId: string
}): Promise<ArchivedClassroomReuseResult> {
  const access = await assertTeacherOwnsClassroom(args.teacherId, args.classroomId)
  if (!access.ok) return access
  if (!access.classroom.archived_at) {
    return {
      ok: false,
      status: 409,
      error: 'Only archived classrooms can be used again',
    }
  }

  const sourceResult = await loadClassroomBlueprintSource(
    args.teacherId,
    args.classroomId,
    { lessonTemplateTitleMode: 'generic' },
  )
  if (!sourceResult.ok) return sourceResult
  const source = sourceResult.source

  if (!source.classroom.source_blueprint_id) {
    const created = await createCourseBlueprintFromClassroom(
      args.teacherId,
      args.classroomId,
      { title: source.classroom.title },
      { operationId: args.operationId, copyOnly: true },
    )
    if (!created.ok) return created
    return {
      ok: true,
      status: 'ready',
      blueprint_id: created.blueprint.id,
      blueprint_title: created.blueprint.title,
    }
  }

  const blueprintId = source.classroom.source_blueprint_id
  const blueprintResult = await getCourseBlueprintDetail(args.teacherId, blueprintId)
  if (!blueprintResult.detail) {
    return {
      ok: false,
      status: blueprintResult.status || 500,
      error: blueprintResult.error || 'Failed to load Course Blueprint',
    }
  }
  const blueprint = blueprintResult.detail
  const ready = (): ArchivedClassroomReuseReady => ({
    ok: true,
    status: 'ready',
    blueprint_id: blueprint.id,
    blueprint_title: blueprint.title,
  })
  const review = () => reviewResult({
    blueprintId: blueprint.id,
    blueprintTitle: blueprint.title,
    classroomId: args.classroomId,
  })

  const sourceVersionId = source.classroom.source_blueprint_version_id
  if (!sourceVersionId) {
    const suggestions = await getBlueprintMergeSuggestionSet(
      args.teacherId,
      blueprint.id,
      args.classroomId,
    )
    if (!suggestions.ok) return suggestions

    const sourceRevision =
      source.classroom.source_blueprint_origin?.blueprint_content_revision
    if (
      sourceRevision !== blueprint.content_revision
      || blueprint.authority_mode === 'repository'
    ) {
      return review()
    }
    if (suggestions.suggestionSet.suggestions.length === 0) return ready()

    const areas = suggestions.suggestionSet.suggestions
      .map((suggestion) => suggestion.area)
      .filter((area): area is ReusableArea => area !== 'announcements')
    if (areas.length === 0) return ready()
    const applied = await applyClassroomChanges({
      teacherId: args.teacherId,
      blueprintId: blueprint.id,
      classroomId: args.classroomId,
      blueprintRevision: blueprint.content_revision,
      classroomRevision: source.classroom.blueprint_source_revision,
      areas,
    })
    return applied.ok ? ready() : applied.status === 409 ? review() : applied
  }

  const supabase = getServiceRoleClient()
  const [versionResult, lessonProvenanceResult] = await Promise.all([
    supabase
      .from('course_blueprint_versions')
      .select('course_blueprint_id,source_draft_revision,snapshot_json')
      .eq('id', sourceVersionId)
      .eq('course_blueprint_id', blueprint.id)
      .single(),
    supabase
      .from('lesson_plans')
      .select('source_artifact_id')
      .eq('classroom_id', args.classroomId)
      .not('source_artifact_id', 'is', null),
  ])
  if (versionResult.error || !versionResult.data) return review()
  if (lessonProvenanceResult.error) {
    return { ok: false, status: 500, error: 'Failed to inspect lesson provenance' }
  }

  const baseVersion =
    versionResult.data.snapshot_json as unknown as CourseBlueprintSnapshot
  const currentBlueprint = buildCourseBlueprintSnapshot(blueprint)
  const currentClassroom = buildClassroomCourseBlueprintSnapshot({
    source,
    blueprintId: blueprint.id,
    blueprintRevision: Number(versionResult.data.source_draft_revision),
    candidate: baseVersion,
  })
  const classification = classifyArchivedClassroomReuseSnapshots({
    baseVersion,
    currentBlueprint,
    currentClassroom,
    appliedLessonArtifactIds: new Set(
      (lessonProvenanceResult.data || [])
        .map((lesson) => lesson.source_artifact_id)
        .filter((id): id is string => typeof id === 'string'),
    ),
  })

  const decision = decideArchivedClassroomReuse({
    blueprintChanged: classification.blueprintChanged,
    classroomChanged: classification.classroomChanged,
    authorityMode:
      blueprint.authority_mode === 'repository' ? 'repository' : 'pika',
  })
  if (decision === 'ready') return ready()
  if (decision === 'review') return review()

  const areas = changedReusableAreas(
    classification.classroomBaseline,
    currentClassroom,
  )
  if (areas.length === 0) return ready()
  const applied = await applyClassroomChanges({
    teacherId: args.teacherId,
    blueprintId: blueprint.id,
    classroomId: args.classroomId,
    blueprintRevision: blueprint.content_revision,
    classroomRevision: source.classroom.blueprint_source_revision,
    areas,
  })
  return applied.ok ? ready() : applied.status === 409 ? review() : applied
}
