import { format } from 'date-fns'
import { courseBlueprintAssignmentsToMarkdown } from '@/lib/course-blueprint-assignments'
import { courseBlueprintAssessmentsToMarkdown } from '@/lib/course-blueprint-assessments-markdown'
import { courseBlueprintLessonTemplatesToMarkdown } from '@/lib/course-blueprint-lesson-templates'
import { courseBlueprintMaterialsToMarkdown } from '@/lib/course-blueprint-materials'
import { courseBlueprintSurveysToMarkdown } from '@/lib/course-blueprint-surveys'
import {
  DEFAULT_ACTUAL_COURSE_SITE_CONFIG,
  DEFAULT_PLANNED_COURSE_SITE_CONFIG,
  normalizeActualCourseSiteConfig,
  normalizePlannedCourseSiteConfig,
  summarizeMergeText,
} from '@/lib/course-site-publishing'
import { markdownToTiptapContent } from '@/lib/limited-markdown'
import { getServiceRoleClient } from '@/lib/supabase'
import { nowInToronto } from '@/lib/timezone'
import {
  getCourseBlueprintDetail,
} from '@/lib/server/course-blueprints'
import { buildCourseBlueprintSnapshot } from '@/lib/server/course-blueprint-versions'
import {
  submitCourseBlueprintProposal,
  type CourseBlueprintProposalRecord,
} from '@/lib/server/course-blueprint-proposals'
import { assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { loadClassroomBlueprintSource } from '@/lib/server/classroom-blueprint-source'
import { loadPublishedClassroomSource } from '@/lib/server/published-classroom-source'
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
  classroom: Pick<
    Classroom,
    | 'id'
    | 'title'
    | 'class_code'
    | 'term_label'
    | 'start_date'
    | 'end_date'
    | 'actual_site_config'
    | 'course_overview_markdown'
    | 'course_outline_markdown'
  >
  resources: ClassroomResources | null
  resources_markdown: string
  assignments: Array<Record<string, any>>
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
  area: 'overview' | 'outline' | 'resources',
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

async function buildActualCourseSite(
  classroomRow: Record<string, any>,
): Promise<{ ok: true; site: PublishedActualCourseSiteData } | { ok: false; status: number; error: string }> {
  const classroom: PublishedActualCourseSiteData['classroom'] = {
    id: String(classroomRow.id),
    title: String(classroomRow.title || ''),
    class_code: String(classroomRow.class_code || ''),
    term_label: typeof classroomRow.term_label === 'string' ? classroomRow.term_label : null,
    start_date: typeof classroomRow.start_date === 'string' ? classroomRow.start_date : null,
    end_date: typeof classroomRow.end_date === 'string' ? classroomRow.end_date : null,
    actual_site_config: normalizeActualCourseSiteConfig(classroomRow.actual_site_config),
    course_overview_markdown: String(classroomRow.course_overview_markdown || ''),
    course_outline_markdown: String(classroomRow.course_outline_markdown || ''),
  }
  const sourceResult = await loadPublishedClassroomSource(classroom.id)
  if (!sourceResult.ok) return sourceResult

  const nowIso = new Date().toISOString()
  const maxLessonDate = getMaxAllowedLessonDate(classroom.actual_site_config.lesson_plan_scope)
  const assignments = sourceResult.source.assignments
  const tests = sourceResult.source.tests

  return {
    ok: true,
    site: {
      classroom,
      resources: sourceResult.source.resources,
      resources_markdown: sourceResult.source.resources_markdown,
      assignments,
      tests,
      grading: buildCourseSiteGradingSummary(assignments, tests),
      lesson_plans: sourceResult.source.lesson_plans.filter((lesson) => {
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

const ACTUAL_COURSE_SITE_CLASSROOM_COLUMNS =
  'id, title, class_code, term_label, start_date, end_date, actual_site_config, course_overview_markdown, course_outline_markdown'

export async function getClassroomActualCourseSite(
  classroomId: string,
): Promise<{ ok: true; site: PublishedActualCourseSiteData } | { ok: false; status: number; error: string }> {
  const supabase = getSupabase()
  const { data: classroomRow, error } = await supabase
    .from('classrooms')
    .select(ACTUAL_COURSE_SITE_CLASSROOM_COLUMNS)
    .eq('id', classroomId)
    .single()

  if (error || !classroomRow) {
    return { ok: false, status: 404, error: 'Classroom not found' }
  }

  return buildActualCourseSite(classroomRow as Record<string, any>)
}

export async function getPublishedActualCourseSite(
  slug: string
): Promise<{ ok: true; site: PublishedActualCourseSiteData } | { ok: false; status: number; error: string }> {
  const supabase = getSupabase()
  const { data: classroomRow, error } = await supabase
    .from('classrooms')
    .select(ACTUAL_COURSE_SITE_CLASSROOM_COLUMNS)
    .eq('actual_site_slug', slug)
    .eq('actual_site_published', true)
    .single()

  if (error || !classroomRow) {
    return { ok: false, status: 404, error: 'Actual course site not found' }
  }

  return buildActualCourseSite(classroomRow as Record<string, any>)
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

  const sourceResult = await loadClassroomBlueprintSource(teacherId, classroomId, {
    lessonTemplateTitleMode: 'generic',
  })
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
      key: assignment.artifact_id,
      label: assignment.title,
      summary: summarizeMergeText(assignment.instructions_markdown, 'No assignment instructions'),
    })),
    source.assignments.map((assignment) => ({
      key: assignment.artifact_id,
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
      key: test.artifact_id,
      label: test.title,
      summary: summarizeMergeText(JSON.stringify(test.content), 'Test'),
    })),
    source.tests.map((test) => ({
      key: test.artifact_id,
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

  const materialItems = buildItemSuggestions(
    (blueprint.materials || []).map((material) => ({
      key: material.artifact_id,
      label: material.title,
      summary: summarizeMergeText(material.content_markdown, 'No material content'),
    })),
    (source.materials || []).map((material) => ({
      key: material.artifact_id,
      label: material.title,
      summary: summarizeMergeText(material.content_markdown, 'No material content'),
    })),
  )
  if (materialItems.length > 0) {
    suggestions.push({
      area: 'materials',
      title: 'Materials',
      summary: 'Classroom material changes can replace the reusable Blueprint material set.',
      items: materialItems,
      preview_markdown: courseBlueprintMaterialsToMarkdown(source.materials || []),
    })
  }

  const surveyItems = buildItemSuggestions(
    (blueprint.surveys || []).map((survey) => ({
      key: survey.artifact_id,
      label: survey.title,
      summary: `${survey.questions_json.length} questions • results ${survey.show_results ? 'shown' : 'hidden'}`,
    })),
    (source.surveys || []).map((survey) => ({
      key: survey.artifact_id,
      label: survey.title,
      summary: `${survey.questions_json.length} questions • results ${survey.show_results ? 'shown' : 'hidden'}`,
    })),
  )
  if (surveyItems.length > 0) {
    suggestions.push({
      area: 'surveys',
      title: 'Surveys',
      summary: 'Classroom survey changes can replace the reusable Blueprint survey set.',
      items: surveyItems,
      preview_markdown: courseBlueprintSurveysToMarkdown(source.surveys || []),
    })
  }

  const currentGrading = {
    use_weights: blueprint.gradebook_use_weights ?? false,
    assignments_weight: blueprint.gradebook_assignments_weight ?? 70,
    tests_weight: blueprint.gradebook_tests_weight ?? 30,
  }
  const sourceGrading = source.grading || {
    use_weights: false,
    assignments_weight: 70,
    tests_weight: 30,
  }
  if (JSON.stringify(currentGrading) !== JSON.stringify(sourceGrading)) {
    suggestions.push({
      area: 'grading',
      title: 'Grading',
      summary: 'Classroom gradebook category settings differ from the Blueprint defaults.',
      items: [{
        key: 'grading',
        label: 'Gradebook categories',
        operation: 'update',
        current_summary: currentGrading.use_weights
          ? `${currentGrading.assignments_weight}% assignments • ${currentGrading.tests_weight}% tests`
          : 'Points-based',
        proposed_summary: sourceGrading.use_weights
          ? `${sourceGrading.assignments_weight}% assignments • ${sourceGrading.tests_weight}% tests`
          : 'Points-based',
      }],
    })
  }

  const currentSiteVisibility = normalizePlannedCourseSiteConfig(
    blueprint.planned_site_config,
  )
  const sourceSiteVisibility = normalizePlannedCourseSiteConfig(
    source.classroom.actual_site_config,
  )
  if (
    JSON.stringify(currentSiteVisibility)
    !== JSON.stringify(sourceSiteVisibility)
  ) {
    const visibleCount = (config: typeof currentSiteVisibility) =>
      Object.values(config).filter(Boolean).length
    suggestions.push({
      area: 'site-visibility',
      title: 'Site visibility',
      summary: 'Classroom site visibility differs from the Blueprint defaults.',
      items: [{
        key: 'site-visibility',
        label: 'Reusable page defaults',
        operation: 'update',
        current_summary: `${visibleCount(currentSiteVisibility)} sections visible`,
        proposed_summary: `${visibleCount(sourceSiteVisibility)} sections visible`,
      }],
    })
  }

  return {
    ok: true,
    suggestionSet: {
      classroom_id: source.classroom.id,
      classroom_title: source.classroom.title,
      classroom_revision: source.classroom.blueprint_source_revision,
      blueprint_id: blueprint.id,
      blueprint_revision: blueprint.content_revision,
      generated_at: new Date().toISOString(),
      suggestions,
    },
  }
}

export async function applyBlueprintMergeSuggestions(
  teacherId: string,
  blueprintId: string,
  classroomId: string,
  areas: Array<
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
  >,
  expected: {
    expectedBlueprintRevision: number
    expectedClassroomRevision: number
  }
): Promise<
  | { ok: true; proposal: CourseBlueprintProposalRecord }
  | { ok: false; status: number; error: string }
> {
  const blueprintResult = await getCourseBlueprintDetail(teacherId, blueprintId)
  if (!blueprintResult.detail) {
    return {
      ok: false,
      status: blueprintResult.status || 500,
      error: blueprintResult.error || 'Failed to load Blueprint',
    }
  }
  if (blueprintResult.detail.content_revision !== expected.expectedBlueprintRevision) {
    return {
      ok: false,
      status: 409,
      error: 'The Blueprint changed after these suggestions were prepared; review them again',
    }
  }
  if (blueprintResult.detail.authority_mode === 'repository') {
    return {
      ok: false,
      status: 409,
      error: 'This Blueprint is repository-managed and accepts repository proposals only',
    }
  }

  const sourceResult = await loadClassroomBlueprintSource(teacherId, classroomId, {
    lessonTemplateTitleMode: 'generic',
  })
  if (!sourceResult.ok) return sourceResult

  if (sourceResult.source.classroom.source_blueprint_id !== blueprintId) {
    return { ok: false, status: 400, error: 'This classroom was not created from the selected blueprint' }
  }

  const source = sourceResult.source
  const sourceGrading = source.grading || {
    use_weights: false,
    assignments_weight: 70,
    tests_weight: 30,
  }
  if (source.classroom.blueprint_source_revision !== expected.expectedClassroomRevision) {
    return {
      ok: false,
      status: 409,
      error: 'The classroom changed after these suggestions were prepared; review them again',
    }
  }

  const candidateDetail = structuredClone(blueprintResult.detail)
  const now = new Date().toISOString()
  if (areas.includes('overview')) {
    candidateDetail.overview_markdown = source.classroom.course_overview_markdown
  }
  if (areas.includes('outline')) {
    candidateDetail.outline_markdown = source.classroom.course_outline_markdown
  }
  if (areas.includes('resources')) {
    candidateDetail.resources_markdown = source.resources_markdown
  }
  if (areas.includes('assignments')) {
    candidateDetail.assignments = source.assignments.map((assignment) => ({
      id: assignment.artifact_id,
      artifact_id: assignment.artifact_id,
      course_blueprint_id: blueprintId,
      title: assignment.title,
      instructions_markdown: assignment.instructions_markdown,
      submission_requirements_json: assignment.submission_requirements_json,
      default_due_days: assignment.default_due_days,
      default_due_time: assignment.default_due_time,
      points_possible: assignment.points_possible,
      gradebook_weight: assignment.gradebook_weight ?? 10,
      include_in_final: assignment.include_in_final,
      is_draft: assignment.is_draft,
      track_authenticity: assignment.track_authenticity,
      position: assignment.position,
      created_at: now,
      updated_at: now,
    }))
  }
  if (areas.includes('tests')) {
    candidateDetail.assessments = source.tests.map((assessment) => ({
      id: assessment.artifact_id,
      artifact_id: assessment.artifact_id,
      course_blueprint_id: blueprintId,
      assessment_type: 'test',
      title: assessment.title,
      content: assessment.content,
      documents: assessment.documents,
      points_possible: assessment.points_possible,
      gradebook_weight: assessment.gradebook_weight ?? 10,
      include_in_final: assessment.include_in_final,
      position: assessment.position,
      created_at: now,
      updated_at: now,
    }))
  }
  if (areas.includes('lesson-plans')) {
    candidateDetail.lesson_templates = source.lesson_templates.map((lesson) => ({
      id: lesson.artifact_id,
      artifact_id: lesson.artifact_id,
      course_blueprint_id: blueprintId,
      title: lesson.title,
      content_markdown: lesson.content_markdown,
      position: lesson.position,
      created_at: now,
      updated_at: now,
    }))
  }
  if (areas.includes('materials')) {
    candidateDetail.materials = (source.materials || []).map((material) => ({
      id: material.artifact_id,
      artifact_id: material.artifact_id,
      course_blueprint_id: blueprintId,
      title: material.title,
      content_markdown: material.content_markdown,
      position: material.position,
      created_at: now,
      updated_at: now,
    }))
  }
  if (areas.includes('surveys')) {
    candidateDetail.surveys = (source.surveys || []).map((survey) => ({
      id: survey.artifact_id,
      artifact_id: survey.artifact_id,
      course_blueprint_id: blueprintId,
      title: survey.title,
      show_results: survey.show_results,
      dynamic_responses: survey.dynamic_responses,
      questions_json: survey.questions_json,
      position: survey.position,
      created_at: now,
      updated_at: now,
    }))
  }
  if (areas.includes('grading')) {
    candidateDetail.gradebook_use_weights = sourceGrading.use_weights
    candidateDetail.gradebook_assignments_weight = sourceGrading.assignments_weight
    candidateDetail.gradebook_tests_weight = sourceGrading.tests_weight
  }
  if (areas.includes('site-visibility')) {
    candidateDetail.planned_site_config = normalizePlannedCourseSiteConfig(
      source.classroom.actual_site_config,
    )
  }

  let base
  let candidate
  try {
    base = buildCourseBlueprintSnapshot(blueprintResult.detail)
    candidate = buildCourseBlueprintSnapshot(candidateDetail)
  } catch (error) {
    return {
      ok: false,
      status: 400,
      error: error instanceof Error ? error.message : 'Classroom changes cannot form a valid proposal',
    }
  }

  return submitCourseBlueprintProposal({
    supabase: getServiceRoleClient() as any,
    teacherId,
    base,
    candidate,
    source: 'classroom',
    idempotencyKey: crypto.randomUUID(),
    expectedBlueprintRevision: expected.expectedBlueprintRevision,
    sourceClassroomId: classroomId,
    baseClassroomRevision: expected.expectedClassroomRevision,
  })
}

export function buildMarkdownSectionContent(markdown: string): TiptapContent {
  return markdownToTiptapContent(markdown || '')
}
