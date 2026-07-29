import type { CourseBlueprintSnapshot } from '@/lib/server/course-blueprint-versions'
import {
  buildCourseBlueprintSnapshot,
  hashCanonicalJson,
} from '@/lib/server/course-blueprint-versions'
import {
  applyPersistedCourseBlueprintProposal,
  buildClassroomCourseBlueprintSnapshot,
} from '@/lib/server/course-blueprint-proposals'
import {
  createCourseBlueprintFromClassroom,
  getCourseBlueprintDetail,
} from '@/lib/server/course-blueprints'
import {
  applyBlueprintMergeSuggestions,
  getBlueprintMergeSuggestionSet,
} from '@/lib/server/course-sites'
import { assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { loadClassroomBlueprintSource } from '@/lib/server/classroom-blueprint-source'
import { getServiceRoleClient } from '@/lib/supabase'
import { COURSE_BLUEPRINT_PACKAGE_VERSION } from '@/lib/course-blueprint-package'

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

function withoutDraftRevision(snapshot: CourseBlueprintSnapshot) {
  const { draft_revision: _draftRevision, ...content } = snapshot
  return content
}

function normalizeVersionForClassroom(
  snapshot: CourseBlueprintSnapshot,
  classDayCount: number,
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
    lesson_templates: snapshot.lesson_templates.slice(0, classDayCount),
  }
}

function classroomReusableContent(snapshot: CourseBlueprintSnapshot) {
  return {
    sections: snapshot.sections,
    grading: snapshot.grading,
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
  classDayCount: number
}) {
  const classroomBaseline = normalizeVersionForClassroom(
    args.baseVersion,
    args.classDayCount,
  )
  const currentBlueprintForClassroom = normalizeVersionForClassroom(
    args.currentBlueprint,
    args.classDayCount,
  )
  const blueprintChanged =
    hashCanonicalJson(withoutDraftRevision(args.baseVersion))
    !== hashCanonicalJson(withoutDraftRevision(args.currentBlueprint))
  const classroomChanged =
    hashCanonicalJson(classroomReusableContent(classroomBaseline))
    !== hashCanonicalJson(classroomReusableContent(args.currentClassroom))
  const currentCourseMatchesClassroom =
    hashCanonicalJson(classroomReusableContent(currentBlueprintForClassroom))
    === hashCanonicalJson(classroomReusableContent(args.currentClassroom))

  return {
    blueprintChanged,
    classroomChanged,
    currentCourseMatchesClassroom,
    classroomBaseline,
  }
}

function changedReusableAreas(
  blueprint: CourseBlueprintSnapshot,
  classroom: CourseBlueprintSnapshot,
): ReusableArea[] {
  const changed = (left: unknown, right: unknown) =>
    hashCanonicalJson(left) !== hashCanonicalJson(right)
  const areas: ReusableArea[] = []

  if (changed(blueprint.sections.overview_markdown, classroom.sections.overview_markdown)) {
    areas.push('overview')
  }
  if (changed(blueprint.sections.outline_markdown, classroom.sections.outline_markdown)) {
    areas.push('outline')
  }
  if (changed(blueprint.sections.resources_markdown, classroom.sections.resources_markdown)) {
    areas.push('resources')
  }
  if (changed(blueprint.assignments, classroom.assignments)) areas.push('assignments')
  if (changed(blueprint.assessments, classroom.assessments)) areas.push('tests')
  if (changed(blueprint.lesson_templates, classroom.lesson_templates)) areas.push('lesson-plans')
  if (changed(blueprint.materials, classroom.materials)) areas.push('materials')
  if (changed(blueprint.surveys, classroom.surveys)) areas.push('surveys')
  if (changed(blueprint.grading, classroom.grading)) areas.push('grading')

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

  const applied = await applyPersistedCourseBlueprintProposal({
    supabase: getServiceRoleClient() as any,
    teacherId: args.teacherId,
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

    const linked = await getServiceRoleClient()
      .from('classrooms')
      .update({
        source_blueprint_id: created.blueprint.id,
        source_blueprint_origin: {
          blueprint_id: created.blueprint.id,
          blueprint_title: created.blueprint.title,
          blueprint_content_revision: created.blueprint.content_revision,
          package_manifest_version: COURSE_BLUEPRINT_PACKAGE_VERSION,
          package_exported_at: new Date().toISOString(),
          operation_id: created.operation_id,
        },
      })
      .eq('id', args.classroomId)
      .eq('teacher_id', args.teacherId)
      .eq('blueprint_source_revision', source.classroom.blueprint_source_revision)
      .not('archived_at', 'is', null)
      .is('source_blueprint_id', null)
      .select('id')
      .maybeSingle()
    if (linked.error || !linked.data) {
      return {
        ok: false,
        status: 409,
        error: 'The archived classroom changed while preparing this course; retry',
      }
    }
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
    if (suggestions.suggestionSet.suggestions.length === 0) return ready()

    const sourceRevision =
      source.classroom.source_blueprint_origin?.blueprint_content_revision
    if (
      sourceRevision !== blueprint.content_revision
      || blueprint.authority_mode === 'repository'
    ) {
      return review()
    }

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
  const [versionResult, classDaysResult] = await Promise.all([
    supabase
      .from('course_blueprint_versions')
      .select('course_blueprint_id,source_draft_revision,snapshot_json')
      .eq('id', sourceVersionId)
      .eq('course_blueprint_id', blueprint.id)
      .single(),
    supabase
      .from('class_days')
      .select('id', { count: 'exact', head: true })
      .eq('classroom_id', args.classroomId),
  ])
  if (versionResult.error || !versionResult.data) return review()
  if (classDaysResult.error) {
    return { ok: false, status: 500, error: 'Failed to inspect classroom calendar' }
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
    classDayCount: classDaysResult.count ?? 0,
  })

  if (
    !classification.classroomChanged
    || classification.currentCourseMatchesClassroom
  ) {
    return ready()
  }
  if (
    classification.blueprintChanged
    || blueprint.authority_mode === 'repository'
  ) {
    return review()
  }

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
