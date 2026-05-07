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
import { loadClassroomBlueprintSource } from '@/lib/server/classroom-blueprint-source'
import type {
  Announcement,
  BlueprintMergeSuggestion,
  BlueprintMergeSuggestionArea,
  BlueprintMergeSuggestionItem,
  BlueprintMergeSuggestionSet,
  Classroom,
  ClassroomResources,
  CourseBlueprintDetail,
  TiptapContent,
} from '@/types'

export type PublishedPlannedCourseSiteData = {
  blueprint: CourseBlueprintDetail
}

export type PublishedCourseSiteGradingCategory = {
  id: 'assignments' | 'quizzes' | 'tests'
  label: string
  points_possible: number
  item_count: number
  weight_percent: number | null
}

export type PublishedCourseSiteGradingItem = {
  key: string
  category: 'assignments' | 'quizzes' | 'tests'
  category_label: string
  title: string
  points_possible: number | null
  include_in_final: boolean
  course_weight_percent: number | null
  category_weight_percent: number | null
}

export type PublishedCourseSiteGradingSummary = {
  mode: 'weighted' | 'points'
  mode_label: string
  categories: PublishedCourseSiteGradingCategory[]
  items: PublishedCourseSiteGradingItem[]
}

export type PublishedActualCourseSiteData = {
  classroom: Classroom
  resources: ClassroomResources | null
  resources_markdown: string
  assignments: Array<Record<string, any>>
  quizzes: Array<Record<string, any>>
  tests: Array<Record<string, any>>
  grading: PublishedCourseSiteGradingSummary | null
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

function roundCourseWeight(value: number) {
  return Math.round(value * 10) / 10
}

function getNumber(value: unknown, fallback: number | null = null) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function isMissingGradebookSettingsTableError(error: any) {
  const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase()
  return error?.code === 'PGRST205' || text.includes('gradebook_settings') || text.includes('could not find the table')
}

function mentionsMissingGradebookField(error: any, field: string) {
  const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase()
  return text.includes(field.toLowerCase()) && (
    error?.code === '42703' ||
    error?.code === 'PGRST204' ||
    text.includes('column')
  )
}

async function loadCourseSiteGradebookSettings(classroomId: string) {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('gradebook_settings')
    .select('use_weights, assignments_weight, quizzes_weight, tests_weight')
    .eq('classroom_id', classroomId)
    .maybeSingle()

  if (!error) {
    return {
      use_weights: !!data?.use_weights,
      assignments_weight: getNumber(data?.assignments_weight, 50) ?? 50,
      quizzes_weight: getNumber(data?.quizzes_weight, 20) ?? 20,
      tests_weight: getNumber(data?.tests_weight, 30) ?? 30,
    }
  }

  if (mentionsMissingGradebookField(error, 'tests_weight')) {
    const { data: legacyData, error: legacyError } = await supabase
      .from('gradebook_settings')
      .select('use_weights, assignments_weight, quizzes_weight')
      .eq('classroom_id', classroomId)
      .maybeSingle()

    if (!legacyError) {
      return {
        use_weights: !!legacyData?.use_weights,
        assignments_weight: getNumber(legacyData?.assignments_weight, 70) ?? 70,
        quizzes_weight: getNumber(legacyData?.quizzes_weight, 30) ?? 30,
        tests_weight: 0,
      }
    }
  }

  if (!isMissingGradebookSettingsTableError(error)) {
    console.error('Error loading course site gradebook settings:', error)
  }

  return {
    use_weights: false,
    assignments_weight: 50,
    quizzes_weight: 20,
    tests_weight: 30,
  }
}

function getTestPointsPossible(test: Record<string, any>) {
  const fromRow = getNumber(test.points_possible, null)
  if (fromRow != null) return fromRow

  const questions = Array.isArray((test.content as any)?.questions) ? (test.content as any).questions : []
  const total = questions.reduce((sum: number, question: Record<string, any>) => (
    sum + (getNumber(question.points, 0) ?? 0)
  ), 0)
  return total > 0 ? total : null
}

function buildCourseSiteGradingSummary(
  settings: Awaited<ReturnType<typeof loadCourseSiteGradebookSettings>>,
  assignments: Array<Record<string, any>>,
  quizzes: Array<Record<string, any>>,
  tests: Array<Record<string, any>>
): PublishedCourseSiteGradingSummary | null {
  const items: PublishedCourseSiteGradingItem[] = [
    ...assignments.map((assignment, index) => ({
      key: `assignment:${assignment.position ?? index}:${assignment.title}`,
      category: 'assignments' as const,
      category_label: 'Assignments',
      title: String(assignment.title || 'Untitled assignment'),
      points_possible: getNumber(assignment.points_possible, null),
      include_in_final: assignment.include_in_final !== false,
      course_weight_percent: null,
      category_weight_percent: null,
    })),
    ...quizzes.map((quiz, index) => ({
      key: `quiz:${quiz.position ?? index}:${quiz.title}`,
      category: 'quizzes' as const,
      category_label: 'Quizzes',
      title: String(quiz.title || 'Untitled quiz'),
      points_possible: getNumber(quiz.points_possible, 100),
      include_in_final: quiz.include_in_final !== false,
      course_weight_percent: null,
      category_weight_percent: null,
    })),
    ...tests.map((test, index) => ({
      key: `test:${test.position ?? index}:${test.title}`,
      category: 'tests' as const,
      category_label: 'Tests',
      title: String(test.title || 'Untitled test'),
      points_possible: getTestPointsPossible(test),
      include_in_final: test.include_in_final !== false,
      course_weight_percent: null,
      category_weight_percent: null,
    })),
  ]

  const includedItems = items.filter((item) => item.include_in_final && item.points_possible != null && item.points_possible > 0)
  if (includedItems.length === 0) return null

  const categoryPoints = {
    assignments: includedItems
      .filter((item) => item.category === 'assignments')
      .reduce((sum, item) => sum + Number(item.points_possible), 0),
    quizzes: includedItems
      .filter((item) => item.category === 'quizzes')
      .reduce((sum, item) => sum + Number(item.points_possible), 0),
    tests: includedItems
      .filter((item) => item.category === 'tests')
      .reduce((sum, item) => sum + Number(item.points_possible), 0),
  }
  const totalPoints = categoryPoints.assignments + categoryPoints.quizzes + categoryPoints.tests

  const configuredWeights = {
    assignments: settings.assignments_weight,
    quizzes: settings.quizzes_weight,
    tests: settings.tests_weight,
  }

  const categories = ([
    ['assignments', 'Assignments'],
    ['quizzes', 'Quizzes'],
    ['tests', 'Tests'],
  ] as const)
    .reduce<PublishedCourseSiteGradingCategory[]>((next, [id, label]) => {
      const points = categoryPoints[id]
      if (points <= 0) return next
      const weight = settings.use_weights
        ? configuredWeights[id]
        : totalPoints > 0
          ? (points / totalPoints) * 100
          : null
      next.push({
        id,
        label,
        points_possible: roundCourseWeight(points),
        item_count: includedItems.filter((item) => item.category === id).length,
        weight_percent: weight == null ? null : roundCourseWeight(weight),
      })
      return next
    }, [])

  const weightedItems = items.map((item) => {
    if (!item.include_in_final || item.points_possible == null || item.points_possible <= 0) return item
    const points = Number(item.points_possible)
    const pointsInCategory = categoryPoints[item.category]
    const categoryWeight = settings.use_weights
      ? configuredWeights[item.category]
      : totalPoints > 0
        ? (pointsInCategory / totalPoints) * 100
        : 0
    const categoryWeightPercent = pointsInCategory > 0 ? (points / pointsInCategory) * 100 : null
    const courseWeightPercent = pointsInCategory > 0 ? categoryWeight * (points / pointsInCategory) : null
    return {
      ...item,
      points_possible: roundCourseWeight(points),
      course_weight_percent: courseWeightPercent == null ? null : roundCourseWeight(courseWeightPercent),
      category_weight_percent: categoryWeightPercent == null ? null : roundCourseWeight(categoryWeightPercent),
    }
  })

  return {
    mode: settings.use_weights ? 'weighted' : 'points',
    mode_label: settings.use_weights ? 'Weighted by category' : 'Points-based grading',
    categories,
    items: weightedItems,
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
  const sourceResult = await loadClassroomBlueprintSource(classroom.teacher_id, classroom.id)
  if (!sourceResult.ok) return sourceResult

  const nowIso = new Date().toISOString()
  const maxLessonDate = getMaxAllowedLessonDate(classroom.actual_site_config.lesson_plan_scope)
  const assignments = sourceResult.source.assignments.filter((assignment) => !assignment.is_draft)
  const quizzes = sourceResult.source.quizzes
  const tests = sourceResult.source.tests
  const gradebookSettings = await loadCourseSiteGradebookSettings(classroom.id)

  return {
    ok: true,
    site: {
      classroom,
      resources: sourceResult.source.resources,
      resources_markdown: sourceResult.source.resources_markdown,
      assignments,
      quizzes,
      tests,
      grading: buildCourseSiteGradingSummary(gradebookSettings, assignments, quizzes, tests),
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

  const sourceResult = await loadClassroomBlueprintSource(teacherId, classroomId)
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
  const blueprintAccess = await assertTeacherOwnsCourseBlueprint(teacherId, blueprintId)
  if (!blueprintAccess.ok) {
    return { ok: false, status: blueprintAccess.status, error: blueprintAccess.error }
  }

  const sourceResult = await loadClassroomBlueprintSource(teacherId, classroomId)
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
      const result = await syncCourseBlueprintAssessments(teacherId, blueprintId, source.quizzes, {
        replaceTypes: ['quiz'],
      })
      if (!result.ok) return result
      continue
    }

    if (area === 'tests') {
      const result = await syncCourseBlueprintAssessments(teacherId, blueprintId, source.tests, {
        replaceTypes: ['test'],
      })
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
