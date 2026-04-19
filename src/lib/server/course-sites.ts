import { format } from 'date-fns'
import { getAssignmentInstructionsMarkdown } from '@/lib/assignment-instructions'
import { courseBlueprintAssignmentsToMarkdown } from '@/lib/course-blueprint-assignments'
import { courseBlueprintAssessmentsToMarkdown } from '@/lib/course-blueprint-assessments-markdown'
import { courseBlueprintLessonTemplatesToMarkdown } from '@/lib/course-blueprint-lesson-templates'
import {
  DEFAULT_ACTUAL_COURSE_SITE_CONFIG,
  DEFAULT_PLANNED_COURSE_SITE_CONFIG,
  normalizeActualCourseSiteConfig,
  normalizePlannedCourseSiteConfig,
  summarizeMergeText,
} from '@/lib/course-site-publishing'
import { getLessonPlanMarkdown } from '@/lib/lesson-plan-content'
import { markdownToTiptapContent, tiptapToMarkdown } from '@/lib/limited-markdown'
import { getServiceRoleClient } from '@/lib/supabase'
import { nowInToronto } from '@/lib/timezone'
import {
  assertTeacherOwnsCourseBlueprint,
  getCourseBlueprintDetail,
  syncCourseBlueprintAssignments,
  syncCourseBlueprintAssessments,
  syncCourseBlueprintLessonTemplates,
  updateCourseBlueprint,
} from '@/lib/server/course-blueprints'
import { assertTeacherOwnsClassroom, hydrateClassroomRecord } from '@/lib/server/classrooms'
import type {
  Announcement,
  BlueprintMergeSuggestion,
  BlueprintMergeSuggestionArea,
  BlueprintMergeSuggestionItem,
  BlueprintMergeSuggestionSet,
  Classroom,
  ClassroomResources,
  CourseBlueprintAssessment,
  CourseBlueprintDetail,
  CourseBlueprintLessonTemplate,
  TestDocument,
  TiptapContent,
} from '@/types'

type SupabaseClient = ReturnType<typeof getServiceRoleClient>

type ClassroomMergeSource = {
  classroom: Classroom
  resources: ClassroomResources | null
  resources_markdown: string
  assignments: Array<{
    title: string
    instructions_markdown: string
    default_due_days: number
    default_due_time: string
    points_possible: number | null
    include_in_final: boolean
    is_draft: boolean
    position: number
  }>
  quizzes: Array<{
    assessment_type: 'quiz'
    title: string
    content: Record<string, unknown>
    documents: TestDocument[]
    position: number
  }>
  tests: Array<{
    assessment_type: 'test'
    title: string
    content: Record<string, unknown>
    documents: TestDocument[]
    position: number
  }>
  lesson_templates: Array<{
    title: string
    content_markdown: string
    position: number
  }>
  announcements: Announcement[]
}

export type PublishedPlannedCourseSiteData = {
  blueprint: CourseBlueprintDetail
}

export type PublishedActualCourseSiteData = {
  classroom: Classroom
  resources: ClassroomResources | null
  resources_markdown: string
  assignments: Array<Record<string, any>>
  quizzes: Array<Record<string, any>>
  tests: Array<Record<string, any>>
  lesson_plans: Array<Record<string, any>>
  announcements: Announcement[]
}

function getSupabase() {
  return getServiceRoleClient()
}

function buildItemSuggestions(
  currentItems: Array<{ key: string; label: string; summary: string }>,
  proposedItems: Array<{ key: string; label: string; summary: string }>
): BlueprintMergeSuggestionItem[] {
  const currentMap = new Map(currentItems.map((item) => [item.key, item]))
  const proposedMap = new Map(proposedItems.map((item) => [item.key, item]))
  const keys = new Set([...currentMap.keys(), ...proposedMap.keys()])

  const suggestions: BlueprintMergeSuggestionItem[] = []

  for (const key of Array.from(keys).sort()) {
    const current = currentMap.get(key)
    const proposed = proposedMap.get(key)
    if (!current && proposed) {
      suggestions.push({
        key,
        label: proposed.label,
        operation: 'add',
        current_summary: 'Not in blueprint',
        proposed_summary: proposed.summary,
      })
      continue
    }
    if (current && !proposed) {
      suggestions.push({
        key,
        label: current.label,
        operation: 'remove',
        current_summary: current.summary,
        proposed_summary: 'No longer present in classroom',
      })
      continue
    }
    if (current && proposed && current.summary !== proposed.summary) {
      suggestions.push({
        key,
        label: proposed.label,
        operation: 'update',
        current_summary: current.summary,
        proposed_summary: proposed.summary,
      })
    }
  }

  return suggestions
}

function compareMarkdownArea(
  area: Exclude<BlueprintMergeSuggestionArea, 'assignments' | 'quizzes' | 'tests' | 'lesson-plans' | 'announcements'>,
  title: string,
  currentMarkdown: string,
  proposedMarkdown: string
): BlueprintMergeSuggestion | null {
  const currentNormalized = currentMarkdown.trim()
  const proposedNormalized = proposedMarkdown.trim()
  if (currentNormalized === proposedNormalized) return null

  const operation = currentNormalized && proposedNormalized ? 'update' : proposedNormalized ? 'add' : 'remove'

  return {
    area,
    title,
    summary: `${title} changed in the classroom and can be promoted back into the blueprint.`,
    items: [{
      key: area,
      label: title,
      operation,
      current_summary: summarizeMergeText(currentMarkdown, 'Blank in blueprint'),
      proposed_summary: summarizeMergeText(proposedMarkdown, 'Blank in classroom'),
    }],
    preview_markdown: proposedMarkdown,
  }
}

function getMaxAllowedLessonDate(scope: Classroom['actual_site_config']['lesson_plan_scope']) {
  if (scope === 'all') return null
  const now = nowInToronto()
  const dayOfWeek = now.getDay()
  const daysUntilSaturday = (6 - dayOfWeek + 7) % 7
  const endOfCurrentWeek = new Date(now)
  endOfCurrentWeek.setDate(now.getDate() + daysUntilSaturday)

  if (scope === 'current_week') {
    return format(endOfCurrentWeek, 'yyyy-MM-dd')
  }

  const endOfNextWeek = new Date(endOfCurrentWeek)
  endOfNextWeek.setDate(endOfCurrentWeek.getDate() + 7)
  return format(endOfNextWeek, 'yyyy-MM-dd')
}

async function loadAssessmentDraftContent(
  supabase: SupabaseClient,
  assessmentType: 'quiz' | 'test',
  classroomId: string,
  assessmentId: string
) {
  const { data } = await supabase
    .from('assessment_drafts')
    .select('content')
    .eq('classroom_id', classroomId)
    .eq('assessment_type', assessmentType)
    .eq('assessment_id', assessmentId)
    .maybeSingle()

  return (data?.content as Record<string, unknown> | null) ?? null
}

async function loadClassroomMergeSource(teacherId: string, classroomId: string): Promise<{
  ok: true
  source: ClassroomMergeSource
} | {
  ok: false
  status: number
  error: string
}> {
  const ownership = await assertTeacherOwnsClassroom(teacherId, classroomId)
  if (!ownership.ok) return ownership

  const supabase = getSupabase()
  const [
    classroomResult,
    resourcesResult,
    assignmentsResult,
    quizzesResult,
    testsResult,
    lessonPlansResult,
    announcementsResult,
  ] = await Promise.all([
    supabase.from('classrooms').select('*').eq('id', classroomId).single(),
    supabase.from('classroom_resources').select('*').eq('classroom_id', classroomId).maybeSingle(),
    supabase.from('assignments').select('*').eq('classroom_id', classroomId).order('position', { ascending: true }),
    supabase.from('quizzes').select('*').eq('classroom_id', classroomId).order('position', { ascending: true }),
    supabase.from('tests').select('*').eq('classroom_id', classroomId).order('position', { ascending: true }),
    supabase.from('lesson_plans').select('*').eq('classroom_id', classroomId).order('date', { ascending: true }),
    supabase.from('announcements').select('*').eq('classroom_id', classroomId).order('created_at', { ascending: false }),
  ])

  if (
    classroomResult.error ||
    assignmentsResult.error ||
    quizzesResult.error ||
    testsResult.error ||
    lessonPlansResult.error ||
    announcementsResult.error ||
    resourcesResult.error
  ) {
    console.error(
      'Error loading classroom merge source:',
      classroomResult.error ||
        assignmentsResult.error ||
        quizzesResult.error ||
        testsResult.error ||
        lessonPlansResult.error ||
        announcementsResult.error ||
        resourcesResult.error
    )
    return { ok: false, status: 500, error: 'Failed to load classroom content' }
  }

  const classroom = hydrateClassroomRecord(classroomResult.data as Record<string, any>)
  const resources = (resourcesResult.data || null) as ClassroomResources | null
  const resourcesMarkdown = resources?.content ? tiptapToMarkdown(resources.content).markdown : ''

  const quizQuestions: Array<Record<string, any>> = await Promise.all(
    ((quizzesResult.data || []) as Array<Record<string, any>>).map(async (quiz) => {
      const { data: questions } = await supabase
        .from('quiz_questions')
        .select('*')
        .eq('quiz_id', quiz.id)
        .order('position', { ascending: true })
      const draftContent = await loadAssessmentDraftContent(supabase, 'quiz', classroomId, quiz.id)
      return {
        ...quiz,
        content: draftContent ?? {
          title: quiz.title,
          show_results: !!quiz.show_results,
          questions: questions || [],
        },
      }
    })
  )

  const testQuestions: Array<Record<string, any>> = await Promise.all(
    ((testsResult.data || []) as Array<Record<string, any>>).map(async (test) => {
      const { data: questions } = await supabase
        .from('test_questions')
        .select('*')
        .eq('test_id', test.id)
        .order('position', { ascending: true })
      const draftContent = await loadAssessmentDraftContent(supabase, 'test', classroomId, test.id)
      return {
        ...test,
        content: draftContent ?? {
          title: test.title,
          show_results: !!test.show_results,
          questions: questions || [],
        },
      }
    })
  )

  return {
    ok: true,
    source: {
      classroom,
      resources,
      resources_markdown: resourcesMarkdown,
      assignments: ((assignmentsResult.data || []) as Array<Record<string, any>>).map((assignment) => ({
        title: assignment.title,
        instructions_markdown: getAssignmentInstructionsMarkdown(assignment as any).markdown,
        default_due_days: 0,
        default_due_time: '23:59',
        points_possible: assignment.points_possible ?? null,
        include_in_final: assignment.include_in_final ?? true,
        is_draft: !!assignment.is_draft,
        position: assignment.position ?? 0,
      })),
      quizzes: quizQuestions
        .filter((quiz) => quiz.status !== 'draft')
        .map((quiz) => ({
          assessment_type: 'quiz' as const,
          title: quiz.title,
          content: quiz.content,
          documents: [],
          position: quiz.position ?? 0,
        })),
      tests: testQuestions
        .filter((test) => test.status !== 'draft')
        .map((test) => ({
          assessment_type: 'test' as const,
          title: test.title,
          content: test.content,
          documents: Array.isArray(test.documents) ? (test.documents as TestDocument[]) : [],
          position: test.position ?? 0,
        })),
      lesson_templates: ((lessonPlansResult.data || []) as Array<Record<string, any>>).map((plan, index) => ({
        title: `Lesson ${index + 1} (${plan.date})`,
        content_markdown: getLessonPlanMarkdown(plan as any).markdown,
        position: index,
      })),
      announcements: (announcementsResult.data || []) as Announcement[],
    },
  }
}

export async function getPublishedPlannedCourseSite(
  slug: string
): Promise<{ ok: true; site: PublishedPlannedCourseSiteData } | { ok: false; status: number; error: string }> {
  const supabase = getSupabase()
  const { data: blueprint, error } = await supabase
    .from('course_blueprints')
    .select('*')
    .eq('planned_site_slug', slug)
    .eq('planned_site_published', true)
    .single()

  if (error || !blueprint) {
    return { ok: false, status: 404, error: 'Planned course site not found' }
  }

  const detail = await getCourseBlueprintDetail(blueprint.teacher_id as string, blueprint.id as string)
  if (!detail.detail) {
    return { ok: false, status: detail.status || 500, error: detail.error || 'Failed to load planned course site' }
  }

  return { ok: true, site: { blueprint: detail.detail } }
}

export async function getPublishedActualCourseSite(
  slug: string
): Promise<{ ok: true; site: PublishedActualCourseSiteData } | { ok: false; status: number; error: string }> {
  const supabase = getSupabase()
  const { data: classroomRow, error } = await supabase
    .from('classrooms')
    .select('*')
    .eq('actual_site_slug', slug)
    .eq('actual_site_published', true)
    .single()

  if (error || !classroomRow) {
    return { ok: false, status: 404, error: 'Actual course site not found' }
  }

  const classroom = hydrateClassroomRecord(classroomRow as Record<string, any>)
  const sourceResult = await loadClassroomMergeSource(classroom.teacher_id, classroom.id)
  if (!sourceResult.ok) return sourceResult

  const nowIso = new Date().toISOString()
  const maxLessonDate = getMaxAllowedLessonDate(classroom.actual_site_config.lesson_plan_scope)

  return {
    ok: true,
    site: {
      classroom,
      resources: sourceResult.source.resources,
      resources_markdown: sourceResult.source.resources_markdown,
      assignments: sourceResult.source.assignments.filter((assignment) => !assignment.is_draft),
      quizzes: sourceResult.source.quizzes,
      tests: sourceResult.source.tests,
      lesson_plans: sourceResult.source.lesson_templates.filter((lesson) => {
        if (!maxLessonDate) return true
        const match = lesson.title.match(/\((\d{4}-\d{2}-\d{2})\)$/)
        return !match || match[1] <= maxLessonDate
      }),
      announcements: sourceResult.source.announcements.filter(
        (announcement) => !announcement.scheduled_for || announcement.scheduled_for <= nowIso
      ),
    },
  }
}

export async function getBlueprintMergeSuggestionSet(
  teacherId: string,
  blueprintId: string,
  classroomId: string
): Promise<{ ok: true; suggestionSet: BlueprintMergeSuggestionSet } | { ok: false; status: number; error: string }> {
  const blueprintResult = await getCourseBlueprintDetail(teacherId, blueprintId)
  if (!blueprintResult.detail) {
    return { ok: false, status: blueprintResult.status || 500, error: blueprintResult.error || 'Failed to load blueprint' }
  }

  const sourceResult = await loadClassroomMergeSource(teacherId, classroomId)
  if (!sourceResult.ok) return sourceResult

  if (sourceResult.source.classroom.source_blueprint_id !== blueprintId) {
    return { ok: false, status: 400, error: 'This classroom was not created from the selected blueprint' }
  }

  const blueprint = blueprintResult.detail
  const source = sourceResult.source

  const suggestions: BlueprintMergeSuggestion[] = []

  const overviewSuggestion = compareMarkdownArea(
    'overview',
    'Overview',
    blueprint.overview_markdown,
    source.classroom.course_overview_markdown
  )
  if (overviewSuggestion) suggestions.push(overviewSuggestion)

  const outlineSuggestion = compareMarkdownArea(
    'outline',
    'Outline',
    blueprint.outline_markdown,
    source.classroom.course_outline_markdown
  )
  if (outlineSuggestion) suggestions.push(outlineSuggestion)

  const resourcesSuggestion = compareMarkdownArea(
    'resources',
    'Resources',
    blueprint.resources_markdown,
    source.resources_markdown
  )
  if (resourcesSuggestion) suggestions.push(resourcesSuggestion)

  const assignmentItems = buildItemSuggestions(
    blueprint.assignments.map((assignment) => ({
      key: assignment.title.trim().toLowerCase(),
      label: assignment.title,
      summary: summarizeMergeText(assignment.instructions_markdown, 'No assignment instructions'),
    })),
    source.assignments.map((assignment) => ({
      key: assignment.title.trim().toLowerCase(),
      label: assignment.title,
      summary: summarizeMergeText(assignment.instructions_markdown, 'No assignment instructions'),
    }))
  )
  if (assignmentItems.length > 0) {
    suggestions.push({
      area: 'assignments',
      title: 'Assignments',
      summary: 'Assignment changes in the classroom can replace the reusable blueprint assignment set.',
      items: assignmentItems,
      preview_markdown: courseBlueprintAssignmentsToMarkdown(source.assignments),
    })
  }

  const currentQuizzes = blueprint.assessments.filter((assessment) => assessment.assessment_type === 'quiz')
  const quizItems = buildItemSuggestions(
    currentQuizzes.map((quiz) => ({
      key: quiz.title.trim().toLowerCase(),
      label: quiz.title,
      summary: summarizeMergeText(JSON.stringify(quiz.content), 'Quiz'),
    })),
    source.quizzes.map((quiz) => ({
      key: quiz.title.trim().toLowerCase(),
      label: quiz.title,
      summary: summarizeMergeText(JSON.stringify(quiz.content), 'Quiz'),
    }))
  )
  if (quizItems.length > 0) {
    suggestions.push({
      area: 'quizzes',
      title: 'Quizzes',
      summary: 'Quiz changes in the classroom can replace the reusable blueprint quiz set.',
      items: quizItems,
      preview_markdown: courseBlueprintAssessmentsToMarkdown(source.quizzes as any, 'quiz'),
    })
  }

  const currentTests = blueprint.assessments.filter((assessment) => assessment.assessment_type === 'test')
  const testItems = buildItemSuggestions(
    currentTests.map((test) => ({
      key: test.title.trim().toLowerCase(),
      label: test.title,
      summary: summarizeMergeText(JSON.stringify(test.content), 'Test'),
    })),
    source.tests.map((test) => ({
      key: test.title.trim().toLowerCase(),
      label: test.title,
      summary: summarizeMergeText(JSON.stringify(test.content), 'Test'),
    }))
  )
  if (testItems.length > 0) {
    suggestions.push({
      area: 'tests',
      title: 'Tests',
      summary: 'Test changes in the classroom can replace the reusable blueprint test set.',
      items: testItems,
      preview_markdown: courseBlueprintAssessmentsToMarkdown(source.tests as any, 'test'),
    })
  }

  const lessonItems = buildItemSuggestions(
    blueprint.lesson_templates.map((lesson) => ({
      key: `${lesson.position}:${lesson.title.trim().toLowerCase()}`,
      label: lesson.title,
      summary: summarizeMergeText(lesson.content_markdown, 'No lesson plan content'),
    })),
    source.lesson_templates.map((lesson) => ({
      key: `${lesson.position}:${lesson.title.trim().toLowerCase()}`,
      label: lesson.title,
      summary: summarizeMergeText(lesson.content_markdown, 'No lesson plan content'),
    }))
  )
  if (lessonItems.length > 0) {
    suggestions.push({
      area: 'lesson-plans',
      title: 'Lesson Plans',
      summary: 'The classroom lesson sequence differs from the blueprint lesson templates.',
      items: lessonItems,
      preview_markdown: courseBlueprintLessonTemplatesToMarkdown(source.lesson_templates),
    })
  }

  return {
    ok: true,
    suggestionSet: {
      classroom_id: source.classroom.id,
      classroom_title: source.classroom.title,
      blueprint_id: blueprint.id,
      generated_at: new Date().toISOString(),
      suggestions,
    },
  }
}

export async function applyBlueprintMergeSuggestions(
  teacherId: string,
  blueprintId: string,
  classroomId: string,
  areas: Array<'overview' | 'outline' | 'resources' | 'assignments' | 'quizzes' | 'tests' | 'lesson-plans'>
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const blueprintOwnership = await assertTeacherOwnsCourseBlueprint(teacherId, blueprintId)
  if (!blueprintOwnership.ok) return blueprintOwnership

  const sourceResult = await loadClassroomMergeSource(teacherId, classroomId)
  if (!sourceResult.ok) return sourceResult

  if (sourceResult.source.classroom.source_blueprint_id !== blueprintId) {
    return { ok: false, status: 400, error: 'This classroom was not created from the selected blueprint' }
  }

  const source = sourceResult.source

  for (const area of areas) {
    if (area === 'overview') {
      const result = await updateCourseBlueprint(teacherId, blueprintId, {
        overview_markdown: source.classroom.course_overview_markdown,
      })
      if (!result.ok) return result
      continue
    }

    if (area === 'outline') {
      const result = await updateCourseBlueprint(teacherId, blueprintId, {
        outline_markdown: source.classroom.course_outline_markdown,
      })
      if (!result.ok) return result
      continue
    }

    if (area === 'resources') {
      const result = await updateCourseBlueprint(teacherId, blueprintId, {
        resources_markdown: source.resources_markdown,
      })
      if (!result.ok) return result
      continue
    }

    if (area === 'assignments') {
      const result = await syncCourseBlueprintAssignments(teacherId, blueprintId, source.assignments)
      if (!result.ok) return result
      continue
    }

    if (area === 'quizzes') {
      const result = await syncCourseBlueprintAssessments(teacherId, blueprintId, source.quizzes as any)
      if (!result.ok) return result
      continue
    }

    if (area === 'tests') {
      const result = await syncCourseBlueprintAssessments(teacherId, blueprintId, source.tests as any)
      if (!result.ok) return result
      continue
    }

    const result = await syncCourseBlueprintLessonTemplates(teacherId, blueprintId, source.lesson_templates)
    if (!result.ok) return result
  }

  return { ok: true }
}

export function buildMarkdownSectionContent(markdown: string): TiptapContent {
  return markdownToTiptapContent(markdown || '')
}
