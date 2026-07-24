import { getServiceRoleClient } from '@/lib/supabase'
import { loadClassroomBlueprintSource } from '@/lib/server/classroom-blueprint-source'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
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
  CreateClassroomFromBlueprintInput,
  LinkedBlueprintClassroom,
  TestDocument,
  TestDraftContent,
} from '@/types'
import { normalizeAssignmentSubmissionRequirementDrafts } from '@/lib/assignment-submission-requirements'
import {
  buildCreateBlueprintWritePlan,
  buildInstantiateBlueprintWritePlan,
  createCourseBlueprintAtomic,
  instantiateCourseBlueprintAtomic,
  resolveBlueprintOperationId,
} from '@/lib/server/course-blueprint-operations'

type SupabaseClient = ReturnType<typeof getServiceRoleClient>

type BlueprintOwnershipResult =
  | { ok: true; blueprint: CourseBlueprint }
  | { ok: false; status: number; error: string }

type BlueprintOperationOptions = {
  operationId?: string
}

function getSupabase() {
  return getServiceRoleClient()
}

export function hydrateCourseBlueprint(row: Record<string, any>): CourseBlueprint {
  return {
    ...(row as CourseBlueprint),
    content_revision: Number(row.content_revision ?? 1),
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
  const [assignmentsResult, assessmentsResult, lessonsResult, linkedClassroomsResult] = await Promise.all([
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
    supabase
      .from('classrooms')
      .select('id,title,class_code,theme_color,term_label,actual_site_slug,actual_site_published,archived_at,created_at,updated_at')
      .eq('teacher_id', teacherId)
      .eq('source_blueprint_id', blueprintId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true }),
  ])

  if (assignmentsResult.error || assessmentsResult.error || lessonsResult.error || linkedClassroomsResult.error) {
    console.error(
      'Error loading course blueprint detail:',
      assignmentsResult.error || assessmentsResult.error || lessonsResult.error || linkedClassroomsResult.error
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
      assignments: (assignmentsResult.data || []) as CourseBlueprintAssignment[],
      assessments: ((assessmentsResult.data || []) as CourseBlueprintAssessment[]).map((assessment) => ({
        ...assessment,
        documents: Array.isArray(assessment.documents) ? (assessment.documents as TestDocument[]) : [],
      })),
      lesson_templates: (lessonsResult.data || []) as CourseBlueprintLessonTemplate[],
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

  const effectivePlannedSiteSlug =
    updates.planned_site_slug !== undefined
      ? updates.planned_site_slug
      : ownership.blueprint.planned_site_slug
  const effectivePlannedSitePublished =
    updates.planned_site_published !== undefined
      ? updates.planned_site_published
      : ownership.blueprint.planned_site_published

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

  const supabase = getSupabase()
  const { error } = await supabase.from('course_blueprints').delete().eq('id', blueprintId)
  if (error) return { ok: false as const, status: 500, error: 'Failed to delete course blueprint' }
  return { ok: true as const }
}

export async function syncCourseBlueprintAssignments(
  teacherId: string,
  blueprintId: string,
  assignments: Array<{
    id?: string
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
    position: number
  }>
) {
  const ownership = await assertTeacherOwnsCourseBlueprint(teacherId, blueprintId)
  if (!ownership.ok) return ownership

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
        title: assignment.title,
        instructions_markdown: assignment.instructions_markdown,
        submission_requirements_json: normalizeAssignmentSubmissionRequirementDrafts(
          assignment.submission_requirements || assignment.submission_requirements_json || []
        ),
        default_due_days: assignment.default_due_days,
        default_due_time: assignment.default_due_time,
        points_possible: assignment.points_possible,
        gradebook_weight: assignment.gradebook_weight ?? 10,
        include_in_final: assignment.include_in_final,
        is_draft: assignment.is_draft,
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
        ),
        default_due_days: assignment.default_due_days,
        default_due_time: assignment.default_due_time,
        points_possible: assignment.points_possible,
        gradebook_weight: assignment.gradebook_weight ?? 10,
        include_in_final: assignment.include_in_final,
        is_draft: assignment.is_draft,
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
        assessment_type: assessment.assessment_type,
        title: assessment.title,
        content: assessment.content,
        documents: assessment.documents,
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
        documents: assessment.documents,
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
    title: string
    content_markdown: string
    position: number
  }>
) {
  const ownership = await assertTeacherOwnsCourseBlueprint(teacherId, blueprintId)
  if (!ownership.ok) return ownership

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

export async function exportCourseBlueprintBundle(teacherId: string, blueprintId: string) {
  const detailResult = await getCourseBlueprintDetail(teacherId, blueprintId)
  if (!detailResult.detail) {
    return { ok: false as const, status: detailResult.status || 500, error: detailResult.error || 'Failed to load blueprint' }
  }

  return { ok: true as const, bundle: buildCourseBlueprintExportBundle(detailResult.detail) }
}

export async function exportCourseBlueprintArchive(teacherId: string, blueprintId: string) {
  const bundleResult = await exportCourseBlueprintBundle(teacherId, blueprintId)
  if (!bundleResult.ok) return bundleResult

  return {
    ok: true as const,
    bundle: bundleResult.bundle,
    archive: encodeCourseBlueprintPackageArchive(bundleResult.bundle),
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
      submission_requirements_json: assignment.submission_requirements || [],
    })),
    assessments: parsed.assessments.map((assessment) => ({
      ...assessment,
      points_possible: assessment.points_possible ?? null,
      gradebook_weight: assessment.gradebook_weight ?? 10,
      include_in_final: assessment.include_in_final !== false,
    })),
    lessonTemplates: parsed.lesson_templates,
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
  const classroomAccess = await assertTeacherCanMutateClassroom(teacherId, classroomId)
  if (!classroomAccess.ok) return classroomAccess

  const sourceResult = await loadClassroomBlueprintSource(teacherId, classroomId, {
    lessonTemplateTitleMode: 'generic',
  })
  if (!sourceResult.ok) return sourceResult

  const source = sourceResult.source
  const blueprintTitle = input.title?.trim() || source.classroom.title
  const supabase = getSupabase()
  const operationId = resolveBlueprintOperationId(options.operationId)
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
      planned_site_slug: null,
      planned_site_published: false,
      planned_site_config: DEFAULT_PLANNED_COURSE_SITE_CONFIG,
    },
    assignments: source.assignments.map((assignment) => ({
      ...assignment,
      submission_requirements_json: assignment.submission_requirements_json || [],
      gradebook_weight: assignment.gradebook_weight ?? 10,
    })),
    assessments: source.tests.map((assessment) => ({
      ...assessment,
      points_possible: assessment.points_possible ?? null,
      gradebook_weight: assessment.gradebook_weight ?? 10,
      include_in_final: assessment.include_in_final !== false,
    })),
    lessonTemplates: source.lesson_templates,
    manifestVersion: COURSE_BLUEPRINT_PACKAGE_VERSION,
  })
  const operation = await createCourseBlueprintAtomic({
    supabase,
    operationId,
    teacherId,
    operationType: 'capture',
    sourceClassroomId: classroomId,
    expectedSourceRevision: source.classroom.blueprint_source_revision ?? 1,
    plan,
  })
  if (!operation.ok) return operation
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
  const themeColor = input.themeColor || getDefaultClassroomThemeColor(`${teacherId}:${operationId}`)
  const planResult = buildInstantiateBlueprintWritePlan({
    detail: detailResult.detail,
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
    plan: planResult.plan,
  })
  if (!operation.ok) return operation
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
}
