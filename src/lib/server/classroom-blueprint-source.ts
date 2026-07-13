import { differenceInCalendarDays, isValid, parseISO } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { getAssignmentInstructionsMarkdown } from '@/lib/assignment-instructions'
import { getLessonPlanMarkdown } from '@/lib/lesson-plan-content'
import { tiptapToMarkdown } from '@/lib/limited-markdown'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsClassroom, hydrateClassroomRecord } from '@/lib/server/classrooms'
import type { TestDraftContent } from '@/lib/server/assessment-drafts'
import type {
  Announcement,
  AssignmentSubmissionRequirement,
  Classroom,
  ClassroomResources,
  TestDocument,
} from '@/types'

export type ClassroomBlueprintSource = {
  classroom: Classroom
  resources: ClassroomResources | null
  resources_markdown: string
  assignments: Array<{
    title: string
    instructions_markdown: string
    submission_requirements_json: AssignmentSubmissionRequirement[]
    default_due_days: number
    default_due_time: string
    points_possible: number | null
    gradebook_weight: number | null
    include_in_final: boolean
    is_draft: boolean
    position: number
  }>
  quizzes: []
  tests: Array<{
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
    title: string
    content_markdown: string
    position: number
  }>
  announcements: Announcement[]
}

type LoadClassroomBlueprintSourceOptions = {
  lessonTemplateTitleMode?: 'dated' | 'generic'
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
    announcementsResult,
  ] = await Promise.all([
    supabase.from('classroom_resources').select('*').eq('classroom_id', classroomId).maybeSingle(),
    supabase.from('assignments').select('*').eq('classroom_id', classroomId)
      .order('position', { ascending: true }).order('id', { ascending: true }),
    supabase.from('tests').select('*').eq('classroom_id', classroomId)
      .order('position', { ascending: true }).order('id', { ascending: true }),
    supabase.from('lesson_plans').select('*').eq('classroom_id', classroomId)
      .order('date', { ascending: true }).order('id', { ascending: true }),
    supabase.from('announcements').select('*').eq('classroom_id', classroomId)
      .order('created_at', { ascending: false }).order('id', { ascending: true }),
  ])

  if (
    assignmentsResult.error ||
    testsResult.error ||
    lessonPlansResult.error ||
    announcementsResult.error ||
    resourcesResult.error
  ) {
    console.error(
      'Error loading classroom blueprint source:',
      assignmentsResult.error ||
        testsResult.error ||
        lessonPlansResult.error ||
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
  const tests: Array<Record<string, any> & { content: TestDraftContent }> = testRows.map((test) => ({
    ...test,
    content: draftsByTestId.get(String(test.id)) ?? {
      title: test.title,
      show_results: !!test.show_results,
      questions: (questionsByTestId.get(String(test.id)) || []) as TestDraftContent['questions'],
    },
  }))

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
      assignments: assignmentRows.map((assignment) => ({
        title: assignment.title,
        instructions_markdown: getAssignmentInstructionsMarkdown(assignment as any).markdown,
        submission_requirements_json: requirementsByAssignmentId.get(String(assignment.id)) || [],
        ...getReusableAssignmentTiming(classroom.start_date ?? null, assignment.due_at ?? null),
        points_possible: assignment.points_possible ?? null,
        gradebook_weight: assignment.gradebook_weight ?? null,
        include_in_final: assignment.include_in_final ?? true,
        is_draft: true,
        position: assignment.position ?? 0,
      })),
      quizzes: [],
      tests: tests.map((test) => ({
          assessment_type: 'test' as const,
          title: test.title,
          content: test.content,
          documents: Array.isArray(test.documents) ? (test.documents as TestDocument[]) : [],
          points_possible: test.points_possible ?? null,
          gradebook_weight: test.gradebook_weight ?? null,
          include_in_final: test.include_in_final !== false,
          position: test.position ?? 0,
        })),
      lesson_templates: ((lessonPlansResult.data || []) as Array<Record<string, any>>).map((plan, index) => ({
        title: lessonTemplateTitleMode === 'generic' ? `Lesson ${index + 1}` : `Lesson ${index + 1} (${plan.date})`,
        content_markdown: getLessonPlanMarkdown(plan as any).markdown,
        position: index,
      })),
      announcements: (announcementsResult.data || []) as Announcement[],
    },
  }
}
