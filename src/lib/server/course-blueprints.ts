import { addDays, format, parse } from 'date-fns'
import { fromZonedTime } from 'date-fns-tz'
import { getServiceRoleClient } from '@/lib/supabase'
import { buildAssignmentInstructionFields } from '@/lib/assignment-instructions'
import { buildLessonPlanContentFields } from '@/lib/lesson-plan-content'
import { markdownToTiptapContent } from '@/lib/limited-markdown'
import { generateClassDaysForClassroom } from '@/lib/server/class-days'
import { loadClassroomBlueprintSource } from '@/lib/server/classroom-blueprint-source'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { getTodayInToronto } from '@/lib/timezone'
import {
  buildCourseBlueprintExportBundle,
  decodeCourseBlueprintPackageArchive,
  encodeCourseBlueprintPackageArchive,
  parseCourseBlueprintImportBundle,
  parseCourseBlueprintImportArchive,
  type CourseBlueprintPackageBundle,
} from '@/lib/course-blueprint-package'
import {
  DEFAULT_ACTUAL_COURSE_SITE_CONFIG,
  DEFAULT_PLANNED_COURSE_SITE_CONFIG,
  normalizeActualCourseSiteConfig,
  normalizePlannedCourseSiteConfig,
} from '@/lib/course-site-publishing'
import type {
  CourseBlueprint,
  CourseBlueprintAssignment,
  CourseBlueprintAssessment,
  CourseBlueprintDetail,
  CourseBlueprintLessonTemplate,
  CreateClassroomFromBlueprintInput,
  LinkedBlueprintClassroom,
  TestDocument,
} from '@/types'
import type { QuizDraftContent, TestDraftContent } from '@/lib/server/assessment-drafts'
import { isMissingAssessmentDraftsError } from '@/lib/server/assessment-drafts'

type SupabaseClient = ReturnType<typeof getServiceRoleClient>

type BlueprintOwnershipResult =
  | { ok: true; blueprint: CourseBlueprint }
  | { ok: false; status: number; error: string }

function getSupabase() {
  return getServiceRoleClient()
}

async function rollbackClassroomCreation(supabase: SupabaseClient, classroomId: string) {
  const { error } = await supabase.from('classrooms').delete().eq('id', classroomId)
  if (error) {
    console.error('Failed to rollback classroom creation:', error)
  }
}

async function rollbackBlueprintCreation(supabase: SupabaseClient, blueprintId: string) {
  const { error } = await supabase.from('course_blueprints').delete().eq('id', blueprintId)
  if (error) {
    console.error('Failed to rollback course blueprint creation:', error)
  }
}

export function hydrateCourseBlueprint(row: Record<string, any>): CourseBlueprint {
  return {
    ...(row as CourseBlueprint),
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
    term_label: row.term_label ?? null,
    actual_site_slug: row.actual_site_slug ?? null,
    actual_site_published: !!row.actual_site_published,
    archived_at: row.archived_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function buildDueAt(startDate: string | null, defaultDueDays: number, defaultDueTime: string): string {
  const base = parse(startDate || getTodayInToronto(), 'yyyy-MM-dd', new Date())
  const dueDate = addDays(base, defaultDueDays)
  const [hours, minutes] = defaultDueTime.split(':').map((value) => Number(value))
  const localDue = new Date(
    dueDate.getFullYear(),
    dueDate.getMonth(),
    dueDate.getDate(),
    Number.isFinite(hours) ? hours : 23,
    Number.isFinite(minutes) ? minutes : 59,
    0,
    0
  )
  return fromZonedTime(localDue, 'America/Toronto').toISOString()
}

async function maybeInsertAssessmentDraft(
  supabase: SupabaseClient,
  assessmentType: 'quiz' | 'test',
  classroomId: string,
  assessmentId: string,
  teacherId: string,
  content: QuizDraftContent | TestDraftContent
) {
  const { error } = await supabase
    .from('assessment_drafts')
    .upsert(
      {
        assessment_type: assessmentType,
        classroom_id: classroomId,
        assessment_id: assessmentId,
        content,
        version: 1,
        created_by: teacherId,
        updated_by: teacherId,
      },
      { onConflict: 'assessment_type,assessment_id' }
    )

  if (error && !isMissingAssessmentDraftsError(error)) {
    throw new Error('Failed to save assessment draft overlay')
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
      .order('position', { ascending: true }),
    supabase
      .from('course_blueprint_assessments')
      .select('*')
      .eq('course_blueprint_id', blueprintId)
      .order('position', { ascending: true }),
    supabase
      .from('course_blueprint_lesson_templates')
      .select('*')
      .eq('course_blueprint_id', blueprintId)
      .order('position', { ascending: true }),
    supabase
      .from('classrooms')
      .select('id,title,class_code,term_label,actual_site_slug,actual_site_published,archived_at,created_at,updated_at')
      .eq('teacher_id', teacherId)
      .eq('source_blueprint_id', blueprintId)
      .order('created_at', { ascending: false }),
  ])

  if (assignmentsResult.error || assessmentsResult.error || lessonsResult.error || linkedClassroomsResult.error) {
    console.error(
      'Error loading course blueprint detail:',
      assignmentsResult.error || assessmentsResult.error || lessonsResult.error || linkedClassroomsResult.error
    )
    return { detail: null, error: 'Failed to load course blueprint detail', status: 500 }
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
    default_due_days: number
    default_due_time: string
    points_possible: number | null
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
        ...assignment,
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
        default_due_days: assignment.default_due_days,
        default_due_time: assignment.default_due_time,
        points_possible: assignment.points_possible,
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
    assessment_type: 'quiz' | 'test'
    title: string
    content: QuizDraftContent | TestDraftContent
    documents: TestDocument[]
    position: number
  }>,
  options?: {
    replaceTypes?: Array<'quiz' | 'test'>
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
  const incomingIds = new Set(updates.map((assessment) => assessment.id!))
  const replaceTypes = options?.replaceTypes ? new Set(options.replaceTypes) : null
  const deleteIds = (existingAssessments || [])
    .filter((assessment) => {
      const assessmentType = assessment.assessment_type as 'quiz' | 'test'
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

export async function importCourseBlueprintBundle(teacherId: string, bundle: CourseBlueprintPackageBundle) {
  const parsed = parseCourseBlueprintImportBundle(bundle)
  if (parsed.errors.length > 0) {
    return { ok: false as const, status: 400, error: 'Invalid course package', errors: parsed.errors }
  }

  const supabase = getSupabase()
  const blueprint = await createCourseBlueprint(teacherId, {
    title: parsed.blueprint.title,
    subject: parsed.blueprint.subject,
    grade_level: parsed.blueprint.grade_level,
    course_code: parsed.blueprint.course_code,
    term_template: parsed.blueprint.term_template,
  })

  try {
    const updateResult = await updateCourseBlueprint(teacherId, blueprint.id, {
      overview_markdown: parsed.blueprint.overview_markdown,
      outline_markdown: parsed.blueprint.outline_markdown,
      resources_markdown: parsed.blueprint.resources_markdown,
      planned_site_slug: parsed.blueprint.planned_site_slug,
      planned_site_published: parsed.blueprint.planned_site_published,
      planned_site_config: parsed.blueprint.planned_site_config,
    } as Partial<CourseBlueprint>)
    if (!updateResult.ok) {
      await rollbackBlueprintCreation(supabase, blueprint.id)
      return updateResult
    }

    const assignmentsResult = await syncCourseBlueprintAssignments(teacherId, blueprint.id, parsed.assignments)
    if (!assignmentsResult.ok) {
      await rollbackBlueprintCreation(supabase, blueprint.id)
      return assignmentsResult
    }

    const assessmentsResult = await syncCourseBlueprintAssessments(teacherId, blueprint.id, parsed.assessments)
    if (!assessmentsResult.ok) {
      await rollbackBlueprintCreation(supabase, blueprint.id)
      return assessmentsResult
    }

    const lessonsResult = await syncCourseBlueprintLessonTemplates(teacherId, blueprint.id, parsed.lesson_templates)
    if (!lessonsResult.ok) {
      await rollbackBlueprintCreation(supabase, blueprint.id)
      return lessonsResult
    }

    return { ok: true as const, blueprint }
  } catch (error) {
    await rollbackBlueprintCreation(supabase, blueprint.id)
    throw error
  }
}

export async function createCourseBlueprintFromClassroom(
  teacherId: string,
  classroomId: string,
  input: { title?: string }
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
  const blueprint = await createCourseBlueprint(teacherId, {
    title: blueprintTitle,
    subject: '',
    grade_level: '',
    course_code: '',
    term_template: '',
  })

  try {
    const updateResult = await updateCourseBlueprint(teacherId, blueprint.id, {
      overview_markdown: source.classroom.course_overview_markdown,
      outline_markdown: source.classroom.course_outline_markdown,
      resources_markdown: source.resources_markdown,
    } as Partial<CourseBlueprint>)
    if (!updateResult.ok) {
      await rollbackBlueprintCreation(supabase, blueprint.id)
      return updateResult
    }

    const assignmentsResult = await syncCourseBlueprintAssignments(teacherId, blueprint.id, source.assignments)
    if (!assignmentsResult.ok) {
      await rollbackBlueprintCreation(supabase, blueprint.id)
      return assignmentsResult
    }

    const assessmentsResult = await syncCourseBlueprintAssessments(teacherId, blueprint.id, [
      ...source.quizzes,
      ...source.tests,
    ])
    if (!assessmentsResult.ok) {
      await rollbackBlueprintCreation(supabase, blueprint.id)
      return assessmentsResult
    }

    const lessonTemplatesResult = await syncCourseBlueprintLessonTemplates(
      teacherId,
      blueprint.id,
      source.lesson_templates
    )
    if (!lessonTemplatesResult.ok) {
      await rollbackBlueprintCreation(supabase, blueprint.id)
      return lessonTemplatesResult
    }

    const detailResult = await getCourseBlueprintDetail(teacherId, blueprint.id)
    if (!detailResult.detail) {
      await rollbackBlueprintCreation(supabase, blueprint.id)
      return {
        ok: false as const,
        status: detailResult.status || 500,
        error: detailResult.error || 'Failed to load new course blueprint',
      }
    }

    const blueprintBundle = buildCourseBlueprintExportBundle(detailResult.detail)
    const { error: classroomUpdateError } = await supabase
      .from('classrooms')
      .update({
        source_blueprint_id: blueprint.id,
        source_blueprint_origin: {
          blueprint_id: detailResult.detail.id,
          blueprint_title: detailResult.detail.title,
          package_manifest_version: blueprintBundle.manifest.version,
          package_exported_at: blueprintBundle.manifest.exported_at,
        },
      })
      .eq('id', classroomId)

    if (classroomUpdateError) {
      await rollbackBlueprintCreation(supabase, blueprint.id)
      return { ok: false as const, status: 500, error: 'Failed to link classroom to the new blueprint' }
    }

    return { ok: true as const, blueprint: detailResult.detail }
  } catch (error) {
    await rollbackBlueprintCreation(supabase, blueprint.id)
    throw error
  }
}

export async function importCourseBlueprintArchive(teacherId: string, archive: ArrayBuffer | Uint8Array) {
  const bundle = decodeCourseBlueprintPackageArchive(archive)
  if (!bundle) {
    const parsed = parseCourseBlueprintImportArchive(archive)
    return { ok: false as const, status: 400, error: 'Invalid course package', errors: parsed.errors }
  }

  return importCourseBlueprintBundle(teacherId, bundle)
}

async function cloneBlueprintIntoClassroom(
  supabase: SupabaseClient,
  teacherId: string,
  blueprintDetail: CourseBlueprintDetail,
  classroom: { id: string; start_date: string | null }
) {
  if (blueprintDetail.resources_markdown.trim()) {
    const { error } = await supabase.from('classroom_resources').upsert(
      {
        classroom_id: classroom.id,
        content: markdownToTiptapContent(blueprintDetail.resources_markdown),
        updated_at: new Date().toISOString(),
        updated_by: teacherId,
      },
      { onConflict: 'classroom_id' }
    )
    if (error) throw new Error('Failed to clone blueprint resources')
  }

  if (blueprintDetail.assignments.length > 0) {
    const insertAssignments = blueprintDetail.assignments.map((assignment) => {
      const instructionFields = buildAssignmentInstructionFields(assignment.instructions_markdown)
      return {
        classroom_id: classroom.id,
        title: assignment.title,
        instructions_markdown: instructionFields.instructions_markdown,
        description: instructionFields.description,
        rich_instructions: instructionFields.rich_instructions,
        due_at: buildDueAt(classroom.start_date, assignment.default_due_days, assignment.default_due_time),
        position: assignment.position,
        is_draft: assignment.is_draft,
        points_possible: assignment.points_possible,
        include_in_final: assignment.include_in_final,
        created_by: teacherId,
      }
    })
    const { error } = await supabase.from('assignments').insert(insertAssignments)
    if (error) throw new Error('Failed to clone blueprint assignments')
  }

  for (const assessment of blueprintDetail.assessments) {
    if (assessment.assessment_type === 'quiz') {
      const draft = assessment.content as unknown as QuizDraftContent
      const { data: createdQuiz, error: quizError } = await supabase
        .from('quizzes')
        .insert({
          classroom_id: classroom.id,
          title: assessment.title,
          created_by: teacherId,
          position: assessment.position,
          assessment_type: 'quiz',
          show_results: draft.show_results,
        })
        .select()
        .single()

      if (quizError || !createdQuiz) throw new Error('Failed to clone blueprint quiz')

      if (draft.questions.length > 0) {
        const { error: questionError } = await supabase.from('quiz_questions').insert(
          draft.questions.map((question, index) => ({
            quiz_id: createdQuiz.id,
            question_text: question.question_text,
            options: question.options,
            position: index,
          }))
        )
        if (questionError) throw new Error('Failed to clone blueprint quiz questions')
      }

      await maybeInsertAssessmentDraft(supabase, 'quiz', classroom.id, createdQuiz.id, teacherId, draft)
      continue
    }

    const draft = assessment.content as unknown as TestDraftContent
    const { data: createdTest, error: testError } = await supabase
      .from('tests')
      .insert({
        classroom_id: classroom.id,
        title: assessment.title,
        created_by: teacherId,
        position: assessment.position,
        assessment_type: 'test',
        show_results: draft.show_results,
        documents: assessment.documents || [],
      })
      .select()
      .single()

    if (testError || !createdTest) throw new Error('Failed to clone blueprint test')

    if (draft.questions.length > 0) {
      const { error: questionError } = await supabase.from('test_questions').insert(
        draft.questions.map((question, index) => ({
          test_id: createdTest.id,
          question_type: question.question_type,
          question_text: question.question_text,
          options: question.options,
          correct_option: question.correct_option,
          answer_key: question.answer_key,
          sample_solution: question.sample_solution,
          points: question.points,
          response_max_chars: question.response_max_chars,
          response_monospace: question.response_monospace,
          position: index,
        }))
      )
      if (questionError) throw new Error('Failed to clone blueprint test questions')
    }

    await maybeInsertAssessmentDraft(supabase, 'test', classroom.id, createdTest.id, teacherId, draft)
  }

  const { data: classDays, error: classDaysError } = await supabase
    .from('class_days')
    .select('date')
    .eq('classroom_id', classroom.id)
    .eq('is_class_day', true)
    .order('date', { ascending: true })

  if (classDaysError) throw new Error('Failed to load class days for lesson template mapping')

  const lessonTemplates = [...blueprintDetail.lesson_templates].sort((left, right) => left.position - right.position)
  const appliedTemplates = lessonTemplates.slice(0, classDays?.length || 0)
  const overflowTemplates = lessonTemplates.slice(appliedTemplates.length)

  if (appliedTemplates.length > 0) {
    const lessonRows = appliedTemplates.map((lesson, index) => {
      const fields = buildLessonPlanContentFields(lesson.content_markdown)
      return {
        classroom_id: classroom.id,
        date: classDays?.[index]?.date,
        content_markdown: fields.content_markdown,
        content: fields.content,
      }
    })
    const { error } = await supabase.from('lesson_plans').upsert(lessonRows, {
      onConflict: 'classroom_id,date',
    })
    if (error) throw new Error('Failed to clone lesson templates')
  }

  return {
    applied_lesson_templates: appliedTemplates.length,
    overflow_lesson_templates: overflowTemplates.map((lesson) => lesson.title),
  }
}

export async function createClassroomFromBlueprint(
  teacherId: string,
  input: CreateClassroomFromBlueprintInput
) {
  const detailResult = await getCourseBlueprintDetail(teacherId, input.blueprintId)
  if (!detailResult.detail) {
    return { ok: false as const, status: detailResult.status || 500, error: detailResult.error || 'Failed to load blueprint' }
  }

  const supabase = getSupabase()
  const blueprintBundle = buildCourseBlueprintExportBundle(detailResult.detail)
  const { data: classCodeConflict } = await supabase
    .from('classrooms')
    .select('id')
    .eq('class_code', input.classCode ?? '')
    .limit(1)

  if (input.classCode && classCodeConflict && classCodeConflict.length > 0) {
    return { ok: false as const, status: 400, error: 'Class code already in use' }
  }

  const classroomPosition = await (async () => {
    const { data, error } = await supabase
      .from('classrooms')
      .select('position')
      .eq('teacher_id', teacherId)
      .is('archived_at', null)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (error) return 0
    return typeof data?.position === 'number' ? data.position - 1 : 0
  })()

  const classCode = input.classCode?.trim()
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const generatedClassCode = Array.from({ length: 6 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('')

  const { data: classroom, error: classroomError } = await supabase
    .from('classrooms')
    .insert({
      teacher_id: teacherId,
      title: input.title,
      class_code: classCode || generatedClassCode,
      term_label: input.termLabel || null,
      position: classroomPosition,
      source_blueprint_id: input.blueprintId,
      source_blueprint_origin: {
        blueprint_id: detailResult.detail.id,
        blueprint_title: detailResult.detail.title,
        package_manifest_version: blueprintBundle.manifest.version,
        package_exported_at: blueprintBundle.manifest.exported_at,
      },
      course_overview_markdown: detailResult.detail.overview_markdown,
      course_outline_markdown: detailResult.detail.outline_markdown,
      actual_site_config: DEFAULT_ACTUAL_COURSE_SITE_CONFIG,
    })
    .select()
    .single()

  if (classroomError || !classroom) {
    return { ok: false as const, status: 500, error: 'Failed to create classroom' }
  }

  try {
    const classDaysResult = await generateClassDaysForClassroom({
      classroomId: classroom.id,
      semester: input.semester,
      year: input.year,
      startDate: input.start_date,
      endDate: input.end_date,
    })

    if (!classDaysResult.ok) {
      await rollbackClassroomCreation(supabase, classroom.id)
      return { ok: false as const, status: classDaysResult.status, error: classDaysResult.error }
    }

    const { data: refreshedClassroom, error: refreshedClassroomError } = await supabase
      .from('classrooms')
      .select('*')
      .eq('id', classroom.id)
      .single()

    if (refreshedClassroomError) {
      await rollbackClassroomCreation(supabase, classroom.id)
      return { ok: false as const, status: 500, error: 'Failed to load newly created classroom' }
    }

    const lessonMapping = await cloneBlueprintIntoClassroom(
      supabase,
      teacherId,
      detailResult.detail,
      { id: classroom.id, start_date: refreshedClassroom?.start_date ?? null }
    )

    return {
      ok: true as const,
      classroom: refreshedClassroom || classroom,
      lesson_mapping: lessonMapping,
    }
  } catch (error) {
    await rollbackClassroomCreation(supabase, classroom.id)
    throw error
  }
}
