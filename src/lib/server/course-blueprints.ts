import { getServiceRoleClient } from '@/lib/supabase'
import { loadClassroomBlueprintSource } from '@/lib/server/classroom-blueprint-source'
import {
  assertTeacherCanMutateClassroom,
  assertTeacherOwnsClassroom,
} from '@/lib/server/classrooms'
import {
  COURSE_BLUEPRINT_PACKAGE_VERSION,
  buildCourseBlueprintExportBundle,
  decodeCourseBlueprintPackageArchive,
  encodeCourseBlueprintPackageArchive,
  parseCourseBlueprintImportBundle,
  parseCourseBlueprintImportArchive,
} from '@/lib/course-blueprint-package'
import {
  DEFAULT_PLANNED_COURSE_SITE_CONFIG,
  normalizePlannedCourseSiteConfig,
} from '@/lib/course-site-publishing'
import { getDefaultClassroomThemeColor, normalizeClassroomThemeColor } from '@/lib/classroom-theme'
import type {
  CourseBlueprint,
  CourseBlueprintAssignment,
  CourseBlueprintAssessment,
  CourseBlueprintDetail,
  CourseBlueprintLessonTemplate,
  CourseBlueprintMaterial,
  CourseBlueprintSurvey,
  CreateClassroomFromBlueprintInput,
  LinkedBlueprintClassroom,
  TestDocument,
  TestDraftContent,
} from '@/types'
import { normalizeAssignmentSubmissionRequirementDrafts } from '@/lib/assignment-submission-requirements'
import { stripTestDocumentSnapshots } from '@/lib/test-documents'
import {
  buildCreateBlueprintWritePlan,
  buildInstantiateBlueprintWritePlan,
  createArchivedClassroomBlueprintAtomic,
  createCourseBlueprintAtomic,
  instantiateCourseBlueprintAtomic,
  resolveBlueprintOperationId,
} from '@/lib/server/course-blueprint-operations'
import { saveCourseBlueprintVersion } from '@/lib/server/course-blueprint-versions'
import { createCourseBlueprintArtifactId } from '@/lib/course-blueprint-artifact-identity'
import { createHash, randomUUID } from 'node:crypto'
import {
  copyManagedTestDocumentsForBlueprintOperation,
  queueBlueprintManagedStorageCopiesBestEffort,
} from '@/lib/server/course-blueprint-managed-storage'

type SupabaseClient = ReturnType<typeof getServiceRoleClient>

type BlueprintOwnershipResult =
  | { ok: true; blueprint: CourseBlueprint }
  | { ok: false; status: number; error: string }

type BlueprintOperationOptions = {
  operationId?: string
  copyOnly?: boolean
}

function getSupabase() {
  return getServiceRoleClient()
}

export function hydrateCourseBlueprint(row: Record<string, any>): CourseBlueprint {
  return {
    ...(row as CourseBlueprint),
    content_revision: Number(row.content_revision ?? 1),
    authority_mode: row.authority_mode === 'repository' ? 'repository' : 'pika',
    latest_version_number: Number(row.latest_version_number ?? 0),
    gradebook_use_weights: Boolean(row.gradebook_use_weights),
    gradebook_assignments_weight: Number(row.gradebook_assignments_weight ?? 70),
    gradebook_tests_weight: Number(row.gradebook_tests_weight ?? 30),
    planned_site_slug: row.planned_site_slug ?? null,
    planned_site_published: !!row.planned_site_published,
    planned_site_config: normalizePlannedCourseSiteConfig(
      row.planned_site_config ?? DEFAULT_PLANNED_COURSE_SITE_CONFIG
    ),
  }
}

function hydrateLinkedBlueprintClassroom(row: Record<string, any>): LinkedBlueprintClassroom {
  return {
    id: row.id,
    title: row.title,
    class_code: row.class_code,
    theme_color: normalizeClassroomThemeColor(row.theme_color),
    term_label: row.term_label ?? null,
    actual_site_slug: row.actual_site_slug ?? null,
    actual_site_published: !!row.actual_site_published,
    archived_at: row.archived_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function assertTeacherOwnsCourseBlueprint(
  teacherId: string,
  blueprintId: string
): Promise<BlueprintOwnershipResult> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('course_blueprints')
    .select('*')
    .eq('id', blueprintId)
    .single()

  if (error?.code === 'PGRST116' || !data) {
    return { ok: false, status: 404, error: 'Course blueprint not found' }
  }

  if (error) {
    console.error('Error loading course blueprint:', error)
    return { ok: false, status: 500, error: 'Failed to load course blueprint' }
  }

  if (data.teacher_id !== teacherId) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }

  return { ok: true, blueprint: hydrateCourseBlueprint(data as Record<string, any>) }
}

export async function listTeacherCourseBlueprints(
  supabase: SupabaseClient,
  teacherId: string
) {
  return supabase
    .from('course_blueprints')
    .select('*')
    .eq('teacher_id', teacherId)
    .order('position', { ascending: true })
    .order('updated_at', { ascending: false })
}

export async function getNextTeacherCourseBlueprintPosition(
  supabase: SupabaseClient,
  teacherId: string
): Promise<number> {
  const { data, error } = await supabase
    .from('course_blueprints')
    .select('position')
    .eq('teacher_id', teacherId)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) return 0
  return typeof data?.position === 'number' ? data.position - 1 : 0
}

export async function getCourseBlueprintDetail(
  teacherId: string,
  blueprintId: string
): Promise<{ detail: CourseBlueprintDetail | null; error?: string; status?: number }> {
  const ownership = await assertTeacherOwnsCourseBlueprint(teacherId, blueprintId)
  if (!ownership.ok) return { detail: null, error: ownership.error, status: ownership.status }

  const supabase = getSupabase()
  const [
    assignmentsResult,
    assessmentsResult,
    lessonsResult,
    materialsResult,
    surveysResult,
    linkedClassroomsResult,
  ] = await Promise.all([
    supabase
      .from('course_blueprint_assignments')
      .select('*')
      .eq('course_blueprint_id', blueprintId)
      .order('position', { ascending: true })
      .order('id', { ascending: true }),
    supabase
      .from('course_blueprint_assessments')
      .select('*')
      .eq('course_blueprint_id', blueprintId)
      .order('position', { ascending: true })
      .order('id', { ascending: true }),
    supabase
      .from('course_blueprint_lesson_templates')
      .select('*')
      .eq('course_blueprint_id', blueprintId)
      .order('position', { ascending: true })
      .order('id', { ascending: true }),
    (supabase as any)
      .from('course_blueprint_materials')
      .select('*')
      .eq('course_blueprint_id', blueprintId)
      .order('position', { ascending: true })
      .order('id', { ascending: true }),
    (supabase as any)
      .from('course_blueprint_surveys')
      .select('*')
      .eq('course_blueprint_id', blueprintId)
      .order('position', { ascending: true })
      .order('id', { ascending: true }),
    supabase
      .from('classrooms')
      .select('id,title,class_code,theme_color,term_label,actual_site_slug,actual_site_published,archived_at,created_at,updated_at')
      .eq('teacher_id', teacherId)
      .eq('source_blueprint_id', blueprintId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true }),
  ])

  if (
    assignmentsResult.error
    || assessmentsResult.error
    || lessonsResult.error
    || materialsResult.error
    || surveysResult.error
    || linkedClassroomsResult.error
  ) {
    console.error(
      'Error loading course blueprint detail:',
      assignmentsResult.error
        || assessmentsResult.error
        || lessonsResult.error
        || materialsResult.error
        || surveysResult.error
        || linkedClassroomsResult.error
    )
    return { detail: null, error: 'Failed to load course blueprint detail', status: 500 }
  }

  const { data: revisionRow, error: revisionError } = await supabase
    .from('course_blueprints')
    .select('content_revision')
    .eq('id', blueprintId)
    .eq('teacher_id', teacherId)
    .single()
  if (
    revisionError ||
    Number(revisionRow?.content_revision ?? 0) !== ownership.blueprint.content_revision
  ) {
    return {
      detail: null,
      error: 'Course blueprint changed while loading; review and retry',
      status: 409,
    }
  }

  return {
    detail: {
      ...ownership.blueprint,
      assignments: (assignmentsResult.data || []) as unknown as CourseBlueprintAssignment[],
      assessments: ((assessmentsResult.data || []) as unknown as CourseBlueprintAssessment[]).map((assessment) => ({
        ...assessment,
        documents: stripTestDocumentSnapshots(assessment.documents),
      })),
      lesson_templates: (lessonsResult.data || []) as unknown as CourseBlueprintLessonTemplate[],
      materials: (materialsResult.data || []) as unknown as CourseBlueprintMaterial[],
      surveys: (surveysResult.data || []) as unknown as CourseBlueprintSurvey[],
      linked_classrooms: (linkedClassroomsResult.data || []).map((classroom: Record<string, any>) =>
        hydrateLinkedBlueprintClassroom(classroom)
      ),
    },
  }
}

export async function createCourseBlueprint(
  teacherId: string,
  input: Pick<CourseBlueprint, 'title' | 'subject' | 'grade_level' | 'course_code' | 'term_template'>
) {
  const supabase = getSupabase()
  const position = await getNextTeacherCourseBlueprintPosition(supabase, teacherId)
  const { data, error } = await supabase
    .from('course_blueprints')
    .insert({
      teacher_id: teacherId,
      ...input,
      position,
      planned_site_config: DEFAULT_PLANNED_COURSE_SITE_CONFIG,
    })
    .select()
    .single()

  if (error) throw new Error('Failed to create course blueprint')
  return hydrateCourseBlueprint(data as Record<string, any>)
}

export async function updateCourseBlueprint(
  teacherId: string,
  blueprintId: string,
  updates: Partial<CourseBlueprint>
) {
  const ownership = await assertTeacherOwnsCourseBlueprint(teacherId, blueprintId)
  if (!ownership.ok) return ownership
  const updateKeys = Object.keys(updates)
  const isAuthorityOnlyUpdate =
    updateKeys.length === 1 && updateKeys[0] === 'authority_mode'
  if (
    ownership.blueprint.authority_mode === 'repository'
    && updateKeys.length > 0
    && !isAuthorityOnlyUpdate
  ) {
    return {
      ok: false as const,
      status: 409,
      error: 'This Blueprint is repository-managed. Pull it, propose changes, and apply the reviewed proposal in Pika.',
    }
  }

  const effectivePlannedSiteSlug =
    updates.planned_site_slug !== undefined
      ? updates.planned_site_slug
      : ownership.blueprint.planned_site_slug
  const effectivePlannedSitePublished =
    updates.planned_site_published !== undefined
      ? updates.planned_site_published
      : ownership.blueprint.planned_site_published
  const effectiveUseWeights =
    updates.gradebook_use_weights ?? ownership.blueprint.gradebook_use_weights
  const effectiveAssignmentsWeight =
    updates.gradebook_assignments_weight
    ?? ownership.blueprint.gradebook_assignments_weight
  const effectiveTestsWeight =
    updates.gradebook_tests_weight ?? ownership.blueprint.gradebook_tests_weight

  if (
    effectiveUseWeights
    && effectiveAssignmentsWeight + effectiveTestsWeight !== 100
  ) {
    return {
      ok: false as const,
      status: 400,
      error: 'Assignment and test weights must total 100%',
    }
  }

  if (effectivePlannedSitePublished && !effectivePlannedSiteSlug) {
    return {
      ok: false as const,
      status: 400,
      error: 'A planned site slug is required before publishing the planned site',
    }
  }

  const supabase = getSupabase()
  if (updates.planned_site_slug) {
    const { data: slugConflict, error: slugError } = await supabase
      .from('course_blueprints')
      .select('id')
      .eq('planned_site_slug', updates.planned_site_slug)
      .neq('id', blueprintId)
      .limit(1)

    if (slugError) {
      return { ok: false as const, status: 500, error: 'Failed to validate planned site slug' }
    }

    if ((slugConflict || []).length > 0) {
      return { ok: false as const, status: 409, error: 'That planned site slug is already in use' }
    }
  }

  const { data, error } = await supabase
    .from('course_blueprints')
    .update({
      ...updates,
      planned_site_config: updates.planned_site_config
        ? normalizePlannedCourseSiteConfig(updates.planned_site_config)
        : updates.planned_site_config,
    })
    .eq('id', blueprintId)
    .select()
    .single()

  if (error) return { ok: false as const, status: 500, error: 'Failed to update course blueprint' }
  return { ok: true as const, blueprint: hydrateCourseBlueprint(data as Record<string, any>) }
}

export async function deleteCourseBlueprint(teacherId: string, blueprintId: string) {
  const ownership = await assertTeacherOwnsCourseBlueprint(teacherId, blueprintId)
  if (!ownership.ok) return ownership
  if (ownership.blueprint.authority_mode === 'repository') {
    return {
      ok: false as const,
      status: 409,
      error: 'This Blueprint is repository-managed. Switch to Pika as Editor before deleting it.',
    }
  }

  return {
    ok: false as const,
    status: 409,
    error: 'Use the durable permanent-deletion flow for Course Blueprints.',
  }
}

async function validateBlueprintClassworkPositions(
  supabase: SupabaseClient,
  blueprintId: string,
  activeKind: 'assignments' | 'materials' | 'surveys',
  positions: number[],
) {
  if (new Set(positions).size !== positions.length) {
    return 'Classwork positions must be unique'
  }
  const tableByKind = {
    assignments: 'course_blueprint_assignments',
    materials: 'course_blueprint_materials',
    surveys: 'course_blueprint_surveys',
  } as const
  const otherKinds = (Object.keys(tableByKind) as Array<keyof typeof tableByKind>)
    .filter((kind) => kind !== activeKind)
  const results = await Promise.all(
    otherKinds.map((kind) =>
      (supabase as any)
        .from(tableByKind[kind])
        .select('position')
        .eq('course_blueprint_id', blueprintId)
    )
  )
  if (results.some((result) => result.error)) {
    return 'Failed to validate classwork ordering'
  }
  const occupied = new Set(
    results.flatMap((result) =>
      (result.data || []).map((row: { position: number }) => Number(row.position))
    )
  )
  return positions.some((position) => occupied.has(position))
    ? 'Assignments, materials, and surveys must use distinct classwork positions'
    : null
}

export async function syncCourseBlueprintAssignments(
  teacherId: string,
  blueprintId: string,
  assignments: Array<{
    id?: string
    artifact_id?: string
    title: string
    instructions_markdown: string
    submission_requirements?: CourseBlueprintAssignment['submission_requirements_json']
    submission_requirements_json?: CourseBlueprintAssignment['submission_requirements_json']
    default_due_days: number
    default_due_time: string
    points_possible: number | null
    gradebook_weight?: number | null
    include_in_final: boolean
    is_draft: boolean
    track_authenticity?: boolean
    position: number
  }>
) {
  const ownership = await assertTeacherOwnsCourseBlueprint(teacherId, blueprintId)
  if (!ownership.ok) return ownership
  if (ownership.blueprint.authority_mode === 'repository') {
    return {
      ok: false as const,
      status: 409,
      error: 'This Blueprint is repository-managed. Submit a versioned proposal instead of editing it directly.',
    }
  }

  const supabase = getSupabase()
  const { data: existingAssignments, error: existingAssignmentsError } = await supabase
    .from('course_blueprint_assignments')
    .select('id')
    .eq('course_blueprint_id', blueprintId)

  if (existingAssignmentsError) {
    return { ok: false as const, status: 500, error: 'Failed to load blueprint assignments' }
  }

  const creates = assignments.filter((assignment) => !assignment.id)
  const updates = assignments.filter((assignment) => assignment.id)
  const existingIds = new Set((existingAssignments || []).map((assignment) => assignment.id as string))
  const unknownUpdate = updates.find((assignment) => !existingIds.has(assignment.id!))
  if (unknownUpdate) {
    return { ok: false as const, status: 400, error: 'Cannot update unknown blueprint assignment' }
  }
  const positionError = await validateBlueprintClassworkPositions(
    supabase,
    blueprintId,
    'assignments',
    assignments.map((assignment) => assignment.position),
  )
  if (positionError) {
    return { ok: false as const, status: 400, error: positionError }
  }

  const incomingIds = new Set(updates.map((assignment) => assignment.id!))
  const deleteIds = (existingAssignments || [])
    .map((assignment) => assignment.id as string)
    .filter((id) => !incomingIds.has(id))

  if (deleteIds.length > 0) {
    const { error } = await supabase
      .from('course_blueprint_assignments')
      .delete()
      .eq('course_blueprint_id', blueprintId)
      .in('id', deleteIds)
    if (error) return { ok: false as const, status: 500, error: 'Failed to delete removed blueprint assignments' }
  }

  if (creates.length > 0) {
    const { error } = await supabase.from('course_blueprint_assignments').insert(
      creates.map((assignment) => ({
        course_blueprint_id: blueprintId,
        artifact_id: assignment.artifact_id ?? createCourseBlueprintArtifactId(),
        title: assignment.title,
        instructions_markdown: assignment.instructions_markdown,
        submission_requirements_json: normalizeAssignmentSubmissionRequirementDrafts(
          assignment.submission_requirements || assignment.submission_requirements_json || []
        ).map((requirement) => ({
          ...requirement,
          id: requirement.id ?? createCourseBlueprintArtifactId(),
        })),
        default_due_days: assignment.default_due_days,
        default_due_time: assignment.default_due_time,
        points_possible: assignment.points_possible,
        gradebook_weight: assignment.gradebook_weight ?? 10,
        include_in_final: assignment.include_in_final,
        is_draft: assignment.is_draft,
        track_authenticity: assignment.track_authenticity ?? false,
        position: assignment.position,
      }))
    )
    if (error) return { ok: false as const, status: 500, error: 'Failed to create blueprint assignments' }
  }

  for (const assignment of updates) {
    const { error } = await supabase
      .from('course_blueprint_assignments')
      .update({
        title: assignment.title,
        instructions_markdown: assignment.instructions_markdown,
        submission_requirements_json: normalizeAssignmentSubmissionRequirementDrafts(
          assignment.submission_requirements || assignment.submission_requirements_json || []
        ).map((requirement) => ({
          ...requirement,
          id: requirement.id ?? createCourseBlueprintArtifactId(),
        })),
        default_due_days: assignment.default_due_days,
        default_due_time: assignment.default_due_time,
        points_possible: assignment.points_possible,
        gradebook_weight: assignment.gradebook_weight ?? 10,
        include_in_final: assignment.include_in_final,
        is_draft: assignment.is_draft,
        track_authenticity: assignment.track_authenticity ?? false,
        position: assignment.position,
      })
      .eq('id', assignment.id!)
      .eq('course_blueprint_id', blueprintId)
    if (error) return { ok: false as const, status: 500, error: 'Failed to update blueprint assignments' }
  }

  return { ok: true as const }
}

export async function syncCourseBlueprintAssessments(
  teacherId: string,
  blueprintId: string,
  assessments: Array<{
    id?: string
    artifact_id?: string
    assessment_type: 'test'
    title: string
    content: TestDraftContent
    documents: TestDocument[]
    points_possible?: number | null
    gradebook_weight?: number | null
    include_in_final?: boolean
    position: number
  }>,
  options?: {
    replaceTypes?: Array<'test'>
  }
) {
  const ownership = await assertTeacherOwnsCourseBlueprint(teacherId, blueprintId)
  if (!ownership.ok) return ownership
  if (ownership.blueprint.authority_mode === 'repository') {
    return {
      ok: false as const,
      status: 409,
      error: 'This Blueprint is repository-managed. Submit a versioned proposal instead of editing it directly.',
    }
  }

  const supabase = getSupabase()
  const { data: existingAssessments, error: existingAssessmentsError } = await supabase
    .from('course_blueprint_assessments')
    .select('id, assessment_type')
    .eq('course_blueprint_id', blueprintId)

  if (existingAssessmentsError) {
    return { ok: false as const, status: 500, error: 'Failed to load blueprint assessments' }
  }

  const creates = assessments.filter((assessment) => !assessment.id)
  const updates = assessments.filter((assessment) => assessment.id)
  const existingAssessmentTypesById = new Map(
    (existingAssessments || []).map((assessment) => [
      assessment.id as string,
      assessment.assessment_type as 'test',
    ])
  )
  const unknownUpdate = updates.find((assessment) => !existingAssessmentTypesById.has(assessment.id!))
  if (unknownUpdate) {
    return { ok: false as const, status: 400, error: 'Cannot update unknown blueprint assessment' }
  }

  const incomingIds = new Set(updates.map((assessment) => assessment.id!))
  const replaceTypes = options?.replaceTypes ? new Set(options.replaceTypes) : null
  const outOfScopeUpdate = replaceTypes
    ? updates.find((assessment) => !replaceTypes.has(existingAssessmentTypesById.get(assessment.id!)!))
    : undefined
  if (outOfScopeUpdate) {
    return {
      ok: false as const,
      status: 400,
      error: 'Cannot update a blueprint assessment outside the selected assessment type',
    }
  }
  const typeChange = updates.find(
    (assessment) => existingAssessmentTypesById.get(assessment.id!) !== assessment.assessment_type
  )
  if (typeChange) {
    return { ok: false as const, status: 400, error: 'Cannot change blueprint assessment type during bulk sync' }
  }

  const deleteIds = (existingAssessments || [])
    .filter((assessment) => {
      const assessmentType = assessment.assessment_type as 'test'
      if (replaceTypes && !replaceTypes.has(assessmentType)) return false
      return !incomingIds.has(assessment.id as string)
    })
    .map((assessment) => assessment.id as string)

  if (deleteIds.length > 0) {
    const { error } = await supabase
      .from('course_blueprint_assessments')
      .delete()
      .eq('course_blueprint_id', blueprintId)
      .in('id', deleteIds)
    if (error) return { ok: false as const, status: 500, error: 'Failed to delete removed blueprint assessments' }
  }

  if (creates.length > 0) {
    const { error } = await supabase.from('course_blueprint_assessments').insert(
      creates.map((assessment) => ({
        course_blueprint_id: blueprintId,
        artifact_id: assessment.artifact_id ?? createCourseBlueprintArtifactId(),
        assessment_type: assessment.assessment_type,
        title: assessment.title,
        content: assessment.content,
        documents: stripTestDocumentSnapshots(assessment.documents),
        points_possible: assessment.points_possible ?? null,
        gradebook_weight: assessment.gradebook_weight ?? 10,
        include_in_final: assessment.include_in_final ?? true,
        position: assessment.position,
      }))
    )
    if (error) return { ok: false as const, status: 500, error: 'Failed to create blueprint assessments' }
  }

  for (const assessment of updates) {
    const { error } = await supabase
      .from('course_blueprint_assessments')
      .update({
        assessment_type: assessment.assessment_type,
        title: assessment.title,
        content: assessment.content,
        documents: stripTestDocumentSnapshots(assessment.documents),
        points_possible: assessment.points_possible ?? null,
        gradebook_weight: assessment.gradebook_weight ?? 10,
        include_in_final: assessment.include_in_final ?? true,
        position: assessment.position,
      })
      .eq('id', assessment.id!)
      .eq('course_blueprint_id', blueprintId)
    if (error) return { ok: false as const, status: 500, error: 'Failed to update blueprint assessments' }
  }

  return { ok: true as const }
}

export async function syncCourseBlueprintLessonTemplates(
  teacherId: string,
  blueprintId: string,
  lessonTemplates: Array<{
    id?: string
    artifact_id?: string
    title: string
    content_markdown: string
    position: number
  }>
) {
  const ownership = await assertTeacherOwnsCourseBlueprint(teacherId, blueprintId)
  if (!ownership.ok) return ownership
  if (ownership.blueprint.authority_mode === 'repository') {
    return {
      ok: false as const,
      status: 409,
      error: 'This Blueprint is repository-managed. Submit a versioned proposal instead of editing it directly.',
    }
  }

  const supabase = getSupabase()
  const { data: existingLessons, error: existingLessonsError } = await supabase
    .from('course_blueprint_lesson_templates')
    .select('id')
    .eq('course_blueprint_id', blueprintId)

  if (existingLessonsError) {
    return { ok: false as const, status: 500, error: 'Failed to load lesson templates' }
  }

  const creates = lessonTemplates.filter((lesson) => !lesson.id)
  const updates = lessonTemplates.filter((lesson) => lesson.id)
  const existingIds = new Set((existingLessons || []).map((lesson) => lesson.id as string))
  const unknownUpdate = updates.find((lesson) => !existingIds.has(lesson.id!))
  if (unknownUpdate) {
    return { ok: false as const, status: 400, error: 'Cannot update unknown lesson template' }
  }

  const incomingIds = new Set(updates.map((lesson) => lesson.id!))
  const deleteIds = (existingLessons || [])
    .map((lesson) => lesson.id as string)
    .filter((id) => !incomingIds.has(id))

  if (deleteIds.length > 0) {
    const { error } = await supabase
      .from('course_blueprint_lesson_templates')
      .delete()
      .eq('course_blueprint_id', blueprintId)
      .in('id', deleteIds)
    if (error) return { ok: false as const, status: 500, error: 'Failed to delete removed lesson templates' }
  }

  if (creates.length > 0) {
    const { error } = await supabase.from('course_blueprint_lesson_templates').insert(
      creates.map((lesson) => ({
        course_blueprint_id: blueprintId,
        artifact_id: lesson.artifact_id ?? createCourseBlueprintArtifactId(),
        title: lesson.title,
        content_markdown: lesson.content_markdown,
        position: lesson.position,
      }))
    )
    if (error) return { ok: false as const, status: 500, error: 'Failed to create lesson templates' }
  }

  for (const lesson of updates) {
    const { error } = await supabase
      .from('course_blueprint_lesson_templates')
      .update({
        title: lesson.title,
        content_markdown: lesson.content_markdown,
        position: lesson.position,
      })
      .eq('id', lesson.id!)
      .eq('course_blueprint_id', blueprintId)
    if (error) return { ok: false as const, status: 500, error: 'Failed to update lesson templates' }
  }

  return { ok: true as const }
}

export async function syncCourseBlueprintMaterials(
  teacherId: string,
  blueprintId: string,
  materials: Array<{
    id?: string
    artifact_id?: string
    title: string
    content_markdown: string
    position: number
  }>,
) {
  const ownership = await assertTeacherOwnsCourseBlueprint(teacherId, blueprintId)
  if (!ownership.ok) return ownership
  if (ownership.blueprint.authority_mode === 'repository') {
    return {
      ok: false as const,
      status: 409,
      error: 'This Blueprint is repository-managed. Submit a versioned proposal instead of editing it directly.',
    }
  }

  const supabase = getSupabase()
  const positionError = await validateBlueprintClassworkPositions(
    supabase,
    blueprintId,
    'materials',
    materials.map((material) => material.position),
  )
  if (positionError) {
    return { ok: false as const, status: 400, error: positionError }
  }
  const { data: existing, error: loadError } = await (supabase as any)
    .from('course_blueprint_materials')
    .select('id')
    .eq('course_blueprint_id', blueprintId)
  if (loadError) {
    return { ok: false as const, status: 500, error: 'Failed to load blueprint materials' }
  }

  const existingIds = new Set<string>(
    (existing || []).map((row: { id: string }) => row.id)
  )
  const updates = materials.filter((material) => material.id)
  if (updates.some((material) => !existingIds.has(material.id!))) {
    return { ok: false as const, status: 400, error: 'Cannot update unknown blueprint material' }
  }
  const incomingIds = new Set(updates.map((material) => material.id!))
  const deleteIds = [...existingIds].filter((id) => !incomingIds.has(id))
  if (deleteIds.length > 0) {
    const { error } = await (supabase as any)
      .from('course_blueprint_materials')
      .delete()
      .eq('course_blueprint_id', blueprintId)
      .in('id', deleteIds)
    if (error) {
      return { ok: false as const, status: 500, error: 'Failed to delete removed blueprint materials' }
    }
  }

  const creates = materials.filter((material) => !material.id)
  if (creates.length > 0) {
    const { error } = await (supabase as any).from('course_blueprint_materials').insert(
      creates.map((material) => ({
        course_blueprint_id: blueprintId,
        artifact_id: material.artifact_id ?? createCourseBlueprintArtifactId(),
        title: material.title,
        content_markdown: material.content_markdown,
        position: material.position,
      }))
    )
    if (error) {
      return { ok: false as const, status: 500, error: 'Failed to create blueprint materials' }
    }
  }
  for (const material of updates) {
    const { error } = await (supabase as any)
      .from('course_blueprint_materials')
      .update({
        title: material.title,
        content_markdown: material.content_markdown,
        position: material.position,
      })
      .eq('id', material.id!)
      .eq('course_blueprint_id', blueprintId)
    if (error) {
      return { ok: false as const, status: 500, error: 'Failed to update blueprint materials' }
    }
  }
  return { ok: true as const }
}

export async function syncCourseBlueprintSurveys(
  teacherId: string,
  blueprintId: string,
  surveys: Array<{
    id?: string
    artifact_id?: string
    title: string
    show_results: boolean
    dynamic_responses: boolean
    questions_json: Array<{
      id?: string
      question_type: 'multiple_choice' | 'short_text' | 'link'
      question_text: string
      options: string[]
      response_max_chars: number
      position: number
    }>
    position: number
  }>,
) {
  const ownership = await assertTeacherOwnsCourseBlueprint(teacherId, blueprintId)
  if (!ownership.ok) return ownership
  if (ownership.blueprint.authority_mode === 'repository') {
    return {
      ok: false as const,
      status: 409,
      error: 'This Blueprint is repository-managed. Submit a versioned proposal instead of editing it directly.',
    }
  }

  const supabase = getSupabase()
  const positionError = await validateBlueprintClassworkPositions(
    supabase,
    blueprintId,
    'surveys',
    surveys.map((survey) => survey.position),
  )
  if (positionError) {
    return { ok: false as const, status: 400, error: positionError }
  }
  const artifactIds = new Set<string>()
  const normalizedSurveys = surveys.map((survey) => ({
    ...survey,
    questions_json: survey.questions_json.map((question) => ({
      ...question,
      id: question.id ?? createCourseBlueprintArtifactId(),
    })),
  }))
  for (const survey of normalizedSurveys) {
    if (survey.artifact_id) {
      if (artifactIds.has(survey.artifact_id)) {
        return { ok: false as const, status: 400, error: 'Survey Artifact IDs must be unique' }
      }
      artifactIds.add(survey.artifact_id)
    }
    for (const question of survey.questions_json) {
      if (artifactIds.has(question.id)) {
        return { ok: false as const, status: 400, error: 'Survey question Artifact IDs must be unique' }
      }
      artifactIds.add(question.id)
    }
  }

  const { data: existing, error: loadError } = await (supabase as any)
    .from('course_blueprint_surveys')
    .select('id')
    .eq('course_blueprint_id', blueprintId)
  if (loadError) {
    return { ok: false as const, status: 500, error: 'Failed to load blueprint surveys' }
  }
  const existingIds = new Set<string>(
    (existing || []).map((row: { id: string }) => row.id)
  )
  const updates = normalizedSurveys.filter((survey) => survey.id)
  if (updates.some((survey) => !existingIds.has(survey.id!))) {
    return { ok: false as const, status: 400, error: 'Cannot update unknown blueprint survey' }
  }
  const incomingIds = new Set(updates.map((survey) => survey.id!))
  const deleteIds = [...existingIds].filter((id) => !incomingIds.has(id))
  if (deleteIds.length > 0) {
    const { error } = await (supabase as any)
      .from('course_blueprint_surveys')
      .delete()
      .eq('course_blueprint_id', blueprintId)
      .in('id', deleteIds)
    if (error) {
      return { ok: false as const, status: 500, error: 'Failed to delete removed blueprint surveys' }
    }
  }

  const creates = normalizedSurveys.filter((survey) => !survey.id)
  if (creates.length > 0) {
    const { error } = await (supabase as any).from('course_blueprint_surveys').insert(
      creates.map((survey) => ({
        course_blueprint_id: blueprintId,
        artifact_id: survey.artifact_id ?? createCourseBlueprintArtifactId(),
        title: survey.title,
        show_results: survey.show_results,
        dynamic_responses: survey.dynamic_responses,
        questions_json: survey.questions_json,
        position: survey.position,
      }))
    )
    if (error) {
      return { ok: false as const, status: 500, error: 'Failed to create blueprint surveys' }
    }
  }
  for (const survey of updates) {
    const { error } = await (supabase as any)
      .from('course_blueprint_surveys')
      .update({
        title: survey.title,
        show_results: survey.show_results,
        dynamic_responses: survey.dynamic_responses,
        questions_json: survey.questions_json,
        position: survey.position,
      })
      .eq('id', survey.id!)
      .eq('course_blueprint_id', blueprintId)
    if (error) {
      return { ok: false as const, status: 500, error: 'Failed to update blueprint surveys' }
    }
  }
  return { ok: true as const }
}

export async function exportCourseBlueprintBundle(teacherId: string, blueprintId: string) {
  const detailResult = await getCourseBlueprintDetail(teacherId, blueprintId)
  if (!detailResult.detail) {
    return { ok: false as const, status: detailResult.status || 500, error: detailResult.error || 'Failed to load blueprint' }
  }

  const supabase = getSupabase()
  const versionResult = await saveCourseBlueprintVersion({
    supabase,
    teacherId,
    detail: detailResult.detail,
    sourceKind:
      detailResult.detail.authority_mode === 'repository' ? 'repository' : 'pika',
    sourceMetadata: { reason: 'external_editing_session' },
  })
  if (!versionResult.ok) return versionResult

  const editingSessionId = randomUUID()
  const bundle = buildCourseBlueprintExportBundle(detailResult.detail, {
    blueprintVersionId: versionResult.version.id,
    blueprintVersionNumber: versionResult.version.version_number,
    editingSessionId,
  })
  const archive = encodeCourseBlueprintPackageArchive(bundle)
  const packageSha256 = createHash('sha256').update(archive).digest('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await (supabase as any)
    .from('course_blueprint_editing_sessions')
    .insert({
      id: editingSessionId,
      teacher_id: teacherId,
      course_blueprint_id: blueprintId,
      classroom_id: null,
      base_blueprint_version_id: versionResult.version.id,
      base_blueprint_revision: detailResult.detail.content_revision,
      base_classroom_revision: null,
      package_sha256: packageSha256,
      status: 'ready',
      expires_at: expiresAt,
    })
  if (error) {
    return {
      ok: false as const,
      status: 500,
      error: 'Failed to open external Blueprint editing session',
    }
  }

  return {
    ok: true as const,
    bundle,
    archive,
    editing_session_id: editingSessionId,
    expires_at: expiresAt,
  }
}

export async function exportCourseBlueprintArchive(teacherId: string, blueprintId: string) {
  const bundleResult = await exportCourseBlueprintBundle(teacherId, blueprintId)
  if (!bundleResult.ok) return bundleResult

  return {
    ...bundleResult,
    ok: true as const,
  }
}

export async function importCourseBlueprintBundle(
  teacherId: string,
  bundle: unknown,
  options: BlueprintOperationOptions = {},
) {
  const parsed = parseCourseBlueprintImportBundle(bundle)
  if (parsed.errors.length > 0 || !parsed.manifest) {
    return { ok: false as const, status: 400, error: 'Invalid course package', errors: parsed.errors }
  }

  const supabase = getSupabase()
  const operationId = resolveBlueprintOperationId(options.operationId)
  const plan = buildCreateBlueprintWritePlan({
    blueprint: parsed.blueprint,
    assignments: parsed.assignments.map((assignment) => ({
      ...assignment,
      artifact_id: assignment.artifact_id!,
      submission_requirements_json: assignment.submission_requirements || [],
      track_authenticity: assignment.track_authenticity ?? false,
    })),
    assessments: parsed.assessments.map((assessment) => ({
      ...assessment,
      artifact_id: assessment.artifact_id!,
      points_possible: assessment.points_possible ?? null,
      gradebook_weight: assessment.gradebook_weight ?? 10,
      include_in_final: assessment.include_in_final !== false,
    })),
    lessonTemplates: parsed.lesson_templates.map((lesson) => ({
      ...lesson,
      artifact_id: lesson.artifact_id!,
    })),
    materials: parsed.materials.map((material) => ({
      ...material,
      artifact_id: material.artifact_id!,
    })),
    surveys: parsed.surveys.map((survey) => ({
      ...survey,
      artifact_id: survey.artifact_id!,
      questions_json: survey.questions_json.map((question) => ({
        ...question,
        id: question.id!,
      })),
    })),
    manifestVersion: parsed.manifest.version,
    sourcePackageExportedAt: parsed.manifest.exported_at,
  })
  const operation = await createCourseBlueprintAtomic({
    supabase,
    operationId,
    teacherId,
    operationType: 'import',
    plan,
  })
  if (!operation.ok) return operation
  if (!operation.blueprint_id) {
    return { ok: false as const, status: 500, error: 'Atomic blueprint import returned no blueprint id' }
  }

  const detailResult = await getCourseBlueprintDetail(teacherId, operation.blueprint_id)
  if (!detailResult.detail) {
    return {
      ok: false as const,
      status: detailResult.status || 500,
      error: detailResult.error || 'Imported blueprint was committed but could not be loaded',
      operation_id: operation.operation_id,
    }
  }

  return {
    ok: true as const,
    blueprint: detailResult.detail,
    operation_id: operation.operation_id,
    replayed: operation.replayed,
    counts: operation.counts,
  }
}

export async function createCourseBlueprintFromClassroom(
  teacherId: string,
  classroomId: string,
  input: { title?: string },
  options: BlueprintOperationOptions = {},
) {
  const classroomAccess = options.copyOnly
    ? await assertTeacherOwnsClassroom(teacherId, classroomId)
    : await assertTeacherCanMutateClassroom(teacherId, classroomId)
  if (!classroomAccess.ok) return classroomAccess

  const sourceResult = await loadClassroomBlueprintSource(teacherId, classroomId, {
    lessonTemplateTitleMode: 'generic',
  })
  if (!sourceResult.ok) return sourceResult

  const source = sourceResult.source
  const blueprintTitle = input.title?.trim() || source.classroom.title
  const supabase = getSupabase()
  const operationId = resolveBlueprintOperationId(options.operationId)
  const managedCopies = await copyManagedTestDocumentsForBlueprintOperation({
    supabase,
    teacherId,
    operationId,
    direction: 'to_blueprint',
    sourceClassroomId: classroomId,
    assessments: source.tests,
  })
  let managedCopiesAdopted = false
  try {
    const plan = buildCreateBlueprintWritePlan({
      blueprint: {
        title: blueprintTitle,
        subject: '',
        grade_level: '',
        course_code: '',
        term_template: '',
        overview_markdown: source.classroom.course_overview_markdown,
        outline_markdown: source.classroom.course_outline_markdown,
        resources_markdown: source.resources_markdown,
        gradebook_use_weights: source.grading?.use_weights ?? false,
        gradebook_assignments_weight: source.grading?.assignments_weight ?? 70,
        gradebook_tests_weight: source.grading?.tests_weight ?? 30,
        planned_site_slug: null,
        planned_site_published: false,
        planned_site_config: normalizePlannedCourseSiteConfig(
          source.classroom.actual_site_config,
        ),
      },
      assignments: source.assignments.map((assignment) => ({
        ...assignment,
        submission_requirements_json: assignment.submission_requirements_json || [],
        gradebook_weight: assignment.gradebook_weight ?? 10,
      })),
      assessments: managedCopies.assessments.map((assessment) => ({
        ...assessment,
        points_possible: assessment.points_possible ?? null,
        gradebook_weight: assessment.gradebook_weight ?? 10,
        include_in_final: assessment.include_in_final !== false,
      })),
      lessonTemplates: source.lesson_templates,
      materials: source.materials || [],
      surveys: source.surveys || [],
      manifestVersion: COURSE_BLUEPRINT_PACKAGE_VERSION,
    })
    const expectedSourceRevision =
      source.classroom.blueprint_source_revision ?? 1
    const operation = options.copyOnly
      ? await createArchivedClassroomBlueprintAtomic({
          supabase,
          operationId,
          teacherId,
          sourceClassroomId: classroomId,
          expectedSourceRevision,
          plan,
        })
      : await createCourseBlueprintAtomic({
          supabase,
          operationId,
          teacherId,
          operationType: 'capture',
          sourceClassroomId: classroomId,
          expectedSourceRevision,
          plan,
        })
    if (!operation.ok) return operation
    managedCopiesAdopted = !operation.replayed
    if (!operation.blueprint_id) {
      return { ok: false as const, status: 500, error: 'Atomic classroom capture returned no blueprint id' }
    }

    const detailResult = await getCourseBlueprintDetail(teacherId, operation.blueprint_id)
    if (!detailResult.detail) {
      return {
        ok: false as const,
        status: detailResult.status || 500,
        error: detailResult.error || 'New blueprint was committed but could not be loaded',
        operation_id: operation.operation_id,
      }
    }

    return {
      ok: true as const,
      blueprint: detailResult.detail,
      operation_id: operation.operation_id,
      replayed: operation.replayed,
      counts: operation.counts,
    }
  } finally {
    await queueBlueprintManagedStorageCopiesBestEffort({
      supabase,
      objectIds: managedCopies.cleanupObjectIds,
      errorCode: 'blueprint_capture_not_adopted',
      provisionalOwnerId: managedCopies.provisionalOwnerId,
      operationId,
      teacherId,
      adopted: managedCopiesAdopted,
    })
  }
}

export async function importCourseBlueprintArchive(
  teacherId: string,
  archive: ArrayBuffer | Uint8Array,
  options: BlueprintOperationOptions = {},
) {
  const bundle = decodeCourseBlueprintPackageArchive(archive)
  if (!bundle) {
    const parsed = parseCourseBlueprintImportArchive(archive)
    return { ok: false as const, status: 400, error: 'Invalid course package', errors: parsed.errors }
  }

  return importCourseBlueprintBundle(teacherId, bundle, options)
}

export async function createClassroomFromBlueprint(
  teacherId: string,
  input: CreateClassroomFromBlueprintInput,
  options: BlueprintOperationOptions = {},
) {
  const detailResult = await getCourseBlueprintDetail(teacherId, input.blueprintId)
  if (!detailResult.detail) {
    return { ok: false as const, status: detailResult.status || 500, error: detailResult.error || 'Failed to load blueprint' }
  }

  const supabase = getSupabase()
  const operationId = resolveBlueprintOperationId(options.operationId)
  const managedCopies = await copyManagedTestDocumentsForBlueprintOperation({
    supabase,
    teacherId,
    operationId,
    direction: 'to_classroom',
    sourceCourseBlueprintId: input.blueprintId,
    assessments: detailResult.detail.assessments,
  })
  let managedCopiesAdopted = false
  try {
    const copiedDetail = {
      ...detailResult.detail,
      assessments: managedCopies.assessments,
    }
    const versionResult = await saveCourseBlueprintVersion({
      supabase,
      teacherId,
      detail: detailResult.detail,
      sourceKind:
        detailResult.detail.authority_mode === 'repository' ? 'repository' : 'pika',
      sourceMetadata: { reason: 'classroom_instantiation' },
    })
    if (!versionResult.ok) return versionResult
    const themeColor = input.themeColor || getDefaultClassroomThemeColor(`${teacherId}:${operationId}`)
    const planResult = buildInstantiateBlueprintWritePlan({
      detail: copiedDetail,
      input,
      themeColor,
      manifestVersion: COURSE_BLUEPRINT_PACKAGE_VERSION,
      operationId,
    })
    if (!planResult.ok) return planResult

    const operation = await instantiateCourseBlueprintAtomic({
      supabase,
      operationId,
      teacherId,
      blueprintId: input.blueprintId,
      blueprintVersionId: versionResult.version.id,
      plan: planResult.plan,
    })
    if (!operation.ok) return operation
    managedCopiesAdopted = !operation.replayed
    if (!operation.classroom_id) {
      return { ok: false as const, status: 500, error: 'Atomic blueprint instantiation returned no classroom id' }
    }

    const { data: classroom, error: classroomError } = await supabase
      .from('classrooms')
      .select('*')
      .eq('id', operation.classroom_id)
      .eq('teacher_id', teacherId)
      .single()

    if (classroomError || !classroom) {
      return {
        ok: false as const,
        status: 500,
        error: 'Classroom was committed but could not be loaded',
        operation_id: operation.operation_id,
      }
    }

    return {
      ok: true as const,
      classroom,
      lesson_mapping: operation.lesson_mapping || {
        applied_lesson_templates: 0,
        overflow_lesson_templates: [],
      },
      operation_id: operation.operation_id,
      replayed: operation.replayed,
      counts: operation.counts,
    }
  } finally {
    await queueBlueprintManagedStorageCopiesBestEffort({
      supabase,
      objectIds: managedCopies.cleanupObjectIds,
      errorCode: 'blueprint_instantiation_not_adopted',
      provisionalOwnerId: managedCopies.provisionalOwnerId,
      operationId,
      teacherId,
      sourceCourseBlueprintId: input.blueprintId,
      adopted: managedCopiesAdopted,
    })
  }
}
