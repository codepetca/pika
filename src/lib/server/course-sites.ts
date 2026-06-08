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
  id: 'assignments' | 'tests'
  label: string
  points_possible: number
  item_count: number
  weight_percent: number | null
}

export type PublishedCourseSiteGradingItem = {
  key: string
  category: 'assignments' | 'tests'
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

type WeightedPublishedCourseSiteGradingItem = PublishedCourseSiteGradingItem & {
  assessment_weight: number
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
  area: Exclude<BlueprintMergeSuggestionArea, 'assignments' | 'tests' | 'lesson-plans' | 'announcements'>,
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

function getAssessmentWeight(value: unknown) {
  const parsed = getNumber(value, 10) ?? 10
  return parsed > 0 ? parsed : 10
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
  assignments: Array<Record<string, any>>,
  tests: Array<Record<string, any>>
): PublishedCourseSiteGradingSummary | null {
  const items: WeightedPublishedCourseSiteGradingItem[] = [
    ...assignments.map((assignment, index) => ({
      key: `assignment:${assignment.position ?? index}:${assignment.title}`,
      category: 'assignments' as const,
      category_label: 'Assignments',
      title: String(assignment.title || 'Untitled assignment'),
      points_possible: getNumber(assignment.points_possible, null),
      assessment_weight: getAssessmentWeight(assignment.gradebook_weight),
      include_in_final: assignment.include_in_final !== false,
      course_weight_percent: null,
      category_weight_percent: null,
    })),
    ...tests.map((test, index) => ({
      key: `test:${test.position ?? index}:${test.title}`,
      category: 'tests' as const,
      category_label: 'Tests',
      title: String(test.title || 'Untitled test'),
      points_possible: getTestPointsPossible(test),
      assessment_weight: getAssessmentWeight(test.gradebook_weight),
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
    tests: includedItems
      .filter((item) => item.category === 'tests')
      .reduce((sum, item) => sum + Number(item.points_possible), 0),
  }
  const categoryWeights = {
    assignments: includedItems
      .filter((item) => item.category === 'assignments')
      .reduce((sum, item) => sum + item.assessment_weight, 0),
    tests: includedItems
      .filter((item) => item.category === 'tests')
      .reduce((sum, item) => sum + item.assessment_weight, 0),
  }
  const totalWeight = categoryWeights.assignments + categoryWeights.tests

  const categories = ([
    ['assignments', 'Assignments'],
    ['tests', 'Tests'],
  ] as const)
    .reduce<PublishedCourseSiteGradingCategory[]>((next, [id, label]) => {
      const points = categoryPoints[id]
      if (points <= 0) return next
      const weight = totalWeight > 0 ? (categoryWeights[id] / totalWeight) * 100 : null
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
    const { assessment_weight, ...publicItem } = item
    if (!item.include_in_final || item.points_possible == null || item.points_possible <= 0) return publicItem
    const points = Number(item.points_possible)
    const weightInCategory = categoryWeights[item.category]
    const categoryWeightPercent = weightInCategory > 0 ? (assessment_weight / weightInCategory) * 100 : null
    const courseWeightPercent = totalWeight > 0 ? (assessment_weight / totalWeight) * 100 : null
    return {
      ...publicItem,
      points_possible: roundCourseWeight(points),
      course_weight_percent: courseWeightPercent == null ? null : roundCourseWeight(courseWeightPercent),
      category_weight_percent: categoryWeightPercent == null ? null : roundCourseWeight(categoryWeightPercent),
    }
  })

  return {
    mode: 'weighted',
    mode_label: 'Weighted by assessment',
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
  const quizzes: Array<Record<string, any>> = []
  const tests = sourceResult.source.tests

  return {
    ok: true,
    site: {
      classroom,
      resources: sourceResult.source.resources,
      resources_markdown: sourceResult.source.resources_markdown,
      assignments,
      quizzes,
      tests,
      grading: buildCourseSiteGradingSummary(assignments, tests),
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
  areas: Array<'overview' | 'outline' | 'resources' | 'assignments' | 'tests' | 'lesson-plans'>
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
