import { differenceInCalendarDays, isValid, parseISO } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { getAssignmentInstructionsMarkdown } from '@/lib/assignment-instructions'
import { getLessonPlanMarkdown } from '@/lib/lesson-plan-content'
import { tiptapToMarkdown } from '@/lib/limited-markdown'
import { stripTestDocumentSnapshots } from '@/lib/test-documents'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsClassroom, hydrateClassroomRecord } from '@/lib/server/classrooms'
import type {
  Announcement,
  AssignmentSubmissionRequirement,
  Classroom,
  ClassroomResources,
  GradebookSettings,
  TestDocument,
  TestDraftContent,
} from '@/types'

export type ClassroomBlueprintSource = {
  classroom: Classroom
  resources: ClassroomResources | null
  resources_markdown: string
  grading: Pick<
    GradebookSettings,
    'use_weights' | 'assignments_weight' | 'tests_weight'
  >
  assignments: Array<{
    artifact_id: string
    source_artifact_id: string | null
    title: string
    instructions_markdown: string
    submission_requirements_json: AssignmentSubmissionRequirement[]
    default_due_days: number
    default_due_time: string
    points_possible: number | null
    gradebook_weight: number | null
    include_in_final: boolean
    is_draft: boolean
    track_authenticity: boolean
    position: number
  }>
  tests: Array<{
    artifact_id: string
    source_artifact_id: string | null
    assessment_type: 'test'
    title: string
    content: TestDraftContent
    documents: TestDocument[]
    points_possible: number | null
    gradebook_weight: number | null
    include_in_final: boolean
    position: number
  }>
  lesson_templates: Array<{
    artifact_id: string
    source_artifact_id: string | null
    title: string
    content_markdown: string
    position: number
  }>
  materials: Array<{
    artifact_id: string
    source_artifact_id: string | null
    title: string
    content_markdown: string
    position: number
  }>
  surveys: Array<{
    artifact_id: string
    source_artifact_id: string | null
    title: string
    show_results: boolean
    dynamic_responses: boolean
    questions_json: Array<{
      id: string
      question_type: 'multiple_choice' | 'short_text' | 'link'
      question_text: string
      options: string[]
      response_max_chars: number
      position: number
    }>
    position: number
  }>
  announcements: Announcement[]
}

type LoadClassroomBlueprintSourceOptions = {
  lessonTemplateTitleMode?: 'dated' | 'generic'
}

type PersistedTestQuestionIdentity = {
  id: string
  artifact_id?: string | null
  source_artifact_id?: string | null
}

export function projectPortableTestQuestionIds(
  content: TestDraftContent,
  persistedQuestions: PersistedTestQuestionIdentity[],
): { ok: true; content: TestDraftContent } | { ok: false } {
  const rowIdsByKnownIdentity = new Map<string, Set<string>>()
  const portableIdByRowId = new Map<string, string>()

  for (const question of persistedQuestions) {
    const portableId = question.source_artifact_id ?? question.artifact_id ?? question.id
    portableIdByRowId.set(question.id, portableId)

    for (const identity of new Set([
      question.source_artifact_id,
      question.artifact_id,
    ].filter(Boolean))) {
      const rowIds = rowIdsByKnownIdentity.get(identity as string) ?? new Set<string>()
      rowIds.add(question.id)
      rowIdsByKnownIdentity.set(identity as string, rowIds)
    }
  }

  const questions = [] as TestDraftContent['questions']
  for (const question of content.questions) {
    const questionId = String(question.id)
    const matchingRowIds = new Set(
      rowIdsByKnownIdentity.get(questionId) ?? [],
    )
    if (portableIdByRowId.has(questionId)) matchingRowIds.add(questionId)
    if (matchingRowIds.size > 1) return { ok: false }

    const [matchingRowId] = matchingRowIds
    const portableId = matchingRowId
      ? portableIdByRowId.get(matchingRowId)
      : undefined

    questions.push({
      ...question,
      // The row-id branch is a read-only compatibility path for legacy draft
      // JSON. Migration 134 persists this normalization once.
      id: portableId ?? question.id,
    })
  }

  return { ok: true, content: { ...content, questions } }
}

function getSupabase() {
  return getServiceRoleClient()
}

function getReusableAssignmentTiming(classroomStartDate: string | null, dueAt: string | null) {
  if (!dueAt) return { default_due_days: 0, default_due_time: '23:59' }

  const dueDate = parseISO(dueAt)
  if (!isValid(dueDate)) return { default_due_days: 0, default_due_time: '23:59' }

  const torontoDueDate = toZonedTime(dueDate, 'America/Toronto')
  const defaultDueTime = `${String(torontoDueDate.getHours()).padStart(2, '0')}:${String(torontoDueDate.getMinutes()).padStart(2, '0')}`
  if (!classroomStartDate) return { default_due_days: 0, default_due_time: defaultDueTime }

  const startDate = parseISO(classroomStartDate)
  return {
    default_due_days: isValid(startDate) ? differenceInCalendarDays(torontoDueDate, startDate) : 0,
    default_due_time: defaultDueTime,
  }
}

export async function loadClassroomBlueprintSource(
  teacherId: string,
  classroomId: string,
  options: LoadClassroomBlueprintSourceOptions = {}
): Promise<{
  ok: true
  source: ClassroomBlueprintSource
} | {
  ok: false
  status: number
  error: string
}> {
  const ownership = await assertTeacherOwnsClassroom(teacherId, classroomId)
  if (!ownership.ok) return ownership

  const supabase = getSupabase()
  const lessonTemplateTitleMode = options.lessonTemplateTitleMode || 'dated'
  const initialClassroomResult = await supabase
    .from('classrooms')
    .select('*')
    .eq('id', classroomId)
    .single()

  if (initialClassroomResult.error || !initialClassroomResult.data) {
    console.error('Error loading classroom blueprint source:', initialClassroomResult.error)
    return { ok: false, status: 500, error: 'Failed to load classroom content' }
  }

  const initialSourceRevision = Number(
    initialClassroomResult.data.blueprint_source_revision ?? 1,
  )
  const [
    resourcesResult,
    assignmentsResult,
    testsResult,
    lessonPlansResult,
    materialsResult,
    surveysResult,
    gradebookResult,
    announcementsResult,
  ] = await Promise.all([
    supabase.from('classroom_resources').select('*').eq('classroom_id', classroomId).maybeSingle(),
    supabase.from('assignments').select('*').eq('classroom_id', classroomId)
      .is('blueprint_archived_at', null)
      .order('position', { ascending: true }).order('id', { ascending: true }),
    supabase.from('tests').select('*').eq('classroom_id', classroomId)
      .is('blueprint_archived_at', null)
      .order('position', { ascending: true }).order('id', { ascending: true }),
    supabase.from('lesson_plans').select('*').eq('classroom_id', classroomId)
      .is('blueprint_archived_at', null)
      .order('date', { ascending: true }).order('id', { ascending: true }),
    supabase.from('classwork_materials').select('*').eq('classroom_id', classroomId)
      .is('blueprint_archived_at', null)
      .order('position', { ascending: true }).order('id', { ascending: true }),
    supabase.from('surveys').select('*').eq('classroom_id', classroomId)
      .is('blueprint_archived_at', null)
      .order('position', { ascending: true }).order('id', { ascending: true }),
    supabase.from('gradebook_settings').select('*').eq('classroom_id', classroomId).maybeSingle(),
    supabase.from('announcements').select('*').eq('classroom_id', classroomId)
      .order('created_at', { ascending: false }).order('id', { ascending: true }),
  ])

  if (
    assignmentsResult.error ||
    testsResult.error ||
    lessonPlansResult.error ||
    materialsResult.error ||
    surveysResult.error ||
    gradebookResult.error ||
    announcementsResult.error ||
    resourcesResult.error
  ) {
    console.error(
      'Error loading classroom blueprint source:',
      assignmentsResult.error ||
        testsResult.error ||
        lessonPlansResult.error ||
        materialsResult.error ||
        surveysResult.error ||
        gradebookResult.error ||
        announcementsResult.error ||
        resourcesResult.error
    )
    return { ok: false, status: 500, error: 'Failed to load classroom content' }
  }

  const classroom = hydrateClassroomRecord(initialClassroomResult.data as Record<string, any>)
  const resources = (resourcesResult.data || null) as ClassroomResources | null
  const resourcesMarkdown = resources?.content ? tiptapToMarkdown(resources.content).markdown : ''

  const assignmentRows = (assignmentsResult.data || []) as Array<Record<string, any>>
  const assignmentIds = assignmentRows.map((assignment) => String(assignment.id))
  let assignmentRequirementRows: AssignmentSubmissionRequirement[] = []
  if (assignmentIds.length > 0) {
    const { data, error } = await supabase
      .from('assignment_submission_requirements')
      .select('*')
      .in('assignment_id', assignmentIds)
      .order('position', { ascending: true })
      .order('id', { ascending: true })

    if (error) {
      console.error('Error loading classroom blueprint assignment requirements:', error)
      return { ok: false, status: 500, error: 'Failed to load classroom content' }
    }
    assignmentRequirementRows = (data || []) as AssignmentSubmissionRequirement[]
  }

  const requirementsByAssignmentId = new Map<string, AssignmentSubmissionRequirement[]>()
  for (const requirement of assignmentRequirementRows) {
    const requirements = requirementsByAssignmentId.get(requirement.assignment_id) || []
    requirements.push(requirement)
    requirementsByAssignmentId.set(requirement.assignment_id, requirements)
  }

  const testRows = (testsResult.data || []) as Array<Record<string, any>>
  const testIds = testRows.map((test) => String(test.id))
  let questionRows: Array<Record<string, any>> = []
  let draftRows: Array<Record<string, any>> = []

  if (testIds.length > 0) {
    const [questionsResult, draftsResult] = await Promise.all([
      supabase
        .from('test_questions')
        .select('*')
        .in('test_id', testIds)
        .order('position', { ascending: true })
        .order('id', { ascending: true }),
      supabase
        .from('assessment_drafts')
        .select('assessment_id, content')
        .eq('classroom_id', classroomId)
        .eq('assessment_type', 'test')
        .in('assessment_id', testIds),
    ])

    if (questionsResult.error || draftsResult.error) {
      console.error(
        'Error loading classroom blueprint assessment content:',
        questionsResult.error || draftsResult.error
      )
      return { ok: false, status: 500, error: 'Failed to load classroom content' }
    }

    questionRows = (questionsResult.data || []) as Array<Record<string, any>>
    draftRows = (draftsResult.data || []) as Array<Record<string, any>>
  }

  const questionsByTestId = new Map<string, Array<Record<string, any>>>()
  for (const question of questionRows) {
    const testId = String(question.test_id || '')
    const questions = questionsByTestId.get(testId) || []
    questions.push(question)
    questionsByTestId.set(testId, questions)
  }
  const draftsByTestId = new Map<string, TestDraftContent>()
  for (const draft of draftRows) {
    draftsByTestId.set(String(draft.assessment_id), draft.content as TestDraftContent)
  }
  const tests: Array<Record<string, any> & { content: TestDraftContent }> = []
  for (const test of testRows) {
    const questions = questionsByTestId.get(String(test.id)) || []
    const content = draftsByTestId.get(String(test.id)) ?? {
      title: test.title,
      show_results: !!test.show_results,
      questions: questions as TestDraftContent['questions'],
    }
    const projectedContent = projectPortableTestQuestionIds(content, questions.map((question) => ({
      id: String(question.id),
      artifact_id: question.artifact_id ?? null,
      source_artifact_id: question.source_artifact_id ?? null,
    })))
    if (!projectedContent.ok) {
      return {
        ok: false,
        status: 409,
        error: 'Test question identity is ambiguous; resolve it before creating a Blueprint',
      }
    }

    tests.push({
      ...test,
      content: projectedContent.content,
    })
  }

  const surveyRows = (surveysResult.data || []) as Array<Record<string, any>>
  const surveyIds = surveyRows.map((survey) => String(survey.id))
  let surveyQuestionRows: Array<Record<string, any>> = []
  if (surveyIds.length > 0) {
    const { data, error } = await supabase
      .from('survey_questions')
      .select('*')
      .in('survey_id', surveyIds)
      .order('position', { ascending: true })
      .order('id', { ascending: true })
    if (error) {
      console.error('Error loading classroom blueprint survey questions:', error)
      return { ok: false, status: 500, error: 'Failed to load classroom content' }
    }
    surveyQuestionRows = (data || []) as Array<Record<string, any>>
  }
  const questionsBySurveyId = new Map<string, Array<Record<string, any>>>()
  surveyQuestionRows.forEach((question) => {
    const surveyId = String(question.survey_id)
    const questions = questionsBySurveyId.get(surveyId) || []
    questions.push(question)
    questionsBySurveyId.set(surveyId, questions)
  })

  const finalRevisionResult = await supabase
    .from('classrooms')
    .select('blueprint_source_revision')
    .eq('id', classroomId)
    .single()
  const finalSourceRevision = Number(finalRevisionResult.data?.blueprint_source_revision ?? 0)
  if (finalRevisionResult.error || finalSourceRevision !== initialSourceRevision) {
    return {
      ok: false,
      status: 409,
      error: 'Classroom content changed while preparing the blueprint; review and retry',
    }
  }

  return {
    ok: true,
    source: {
      classroom,
      resources,
      resources_markdown: resourcesMarkdown,
      grading: {
        use_weights: Boolean(gradebookResult.data?.use_weights),
        assignments_weight: Number(gradebookResult.data?.assignments_weight ?? 70),
        tests_weight: Number(gradebookResult.data?.tests_weight ?? 30),
      },
      assignments: assignmentRows.map((assignment) => ({
        artifact_id: assignment.source_artifact_id ?? assignment.artifact_id ?? assignment.id,
        source_artifact_id: assignment.source_artifact_id ?? null,
        title: assignment.title,
        instructions_markdown: getAssignmentInstructionsMarkdown(assignment as any).markdown,
        submission_requirements_json: (
          requirementsByAssignmentId.get(String(assignment.id)) || []
        ).map((requirement) => ({
          ...requirement,
          id: (requirement as AssignmentSubmissionRequirement & {
            artifact_id?: string
            source_artifact_id?: string | null
          }).source_artifact_id
            ?? (requirement as AssignmentSubmissionRequirement & { artifact_id?: string }).artifact_id
            ?? requirement.id,
        })),
        ...getReusableAssignmentTiming(classroom.start_date ?? null, assignment.due_at ?? null),
        points_possible: assignment.points_possible ?? null,
        gradebook_weight: assignment.gradebook_weight ?? null,
        include_in_final: assignment.include_in_final ?? true,
        is_draft: true,
        track_authenticity: assignment.track_authenticity === true,
        position: assignment.position ?? 0,
      })),
      tests: tests.map((test) => ({
          artifact_id: test.source_artifact_id ?? test.artifact_id ?? test.id,
          source_artifact_id: test.source_artifact_id ?? null,
          assessment_type: 'test' as const,
          title: test.title,
          content: test.content,
          documents: stripTestDocumentSnapshots(test.documents),
          points_possible: test.points_possible ?? null,
          gradebook_weight: test.gradebook_weight ?? null,
          include_in_final: test.include_in_final !== false,
          position: test.position ?? 0,
        })),
      lesson_templates: ((lessonPlansResult.data || []) as Array<Record<string, any>>).map((plan, index) => ({
        artifact_id: plan.source_artifact_id ?? plan.artifact_id ?? plan.id,
        source_artifact_id: plan.source_artifact_id ?? null,
        title: lessonTemplateTitleMode === 'generic' ? `Lesson ${index + 1}` : `Lesson ${index + 1} (${plan.date})`,
        content_markdown: getLessonPlanMarkdown(plan as any).markdown,
        position: index,
      })),
      materials: ((materialsResult.data || []) as Array<Record<string, any>>).map((material) => ({
        artifact_id: material.source_artifact_id ?? material.artifact_id ?? material.id,
        source_artifact_id: material.source_artifact_id ?? null,
        title: material.title,
        content_markdown: tiptapToMarkdown(material.content).markdown,
        position: material.position ?? 0,
      })),
      surveys: surveyRows.map((survey) => ({
        artifact_id: survey.source_artifact_id ?? survey.artifact_id ?? survey.id,
        source_artifact_id: survey.source_artifact_id ?? null,
        title: survey.title,
        show_results: survey.show_results !== false,
        dynamic_responses: survey.dynamic_responses === true,
        questions_json: (questionsBySurveyId.get(String(survey.id)) || []).map((question) => ({
          id: question.source_artifact_id ?? question.artifact_id ?? question.id,
          question_type: question.question_type,
          question_text: question.question_text,
          options: Array.isArray(question.options) ? question.options : [],
          response_max_chars: question.response_max_chars ?? 500,
          position: question.position ?? 0,
        })),
        position: survey.position ?? 0,
      })),
      announcements: (announcementsResult.data || []) as Announcement[],
    },
  }
}
