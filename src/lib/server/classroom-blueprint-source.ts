import { getAssignmentInstructionsMarkdown } from '@/lib/assignment-instructions'
import { getLessonPlanMarkdown } from '@/lib/lesson-plan-content'
import { tiptapToMarkdown } from '@/lib/limited-markdown'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsClassroom, hydrateClassroomRecord } from '@/lib/server/classrooms'
import type { QuizDraftContent, TestDraftContent } from '@/lib/server/assessment-drafts'
import type {
  Announcement,
  Classroom,
  ClassroomResources,
  TestDocument,
} from '@/types'

type SupabaseClient = ReturnType<typeof getServiceRoleClient>

export type ClassroomBlueprintSource = {
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
    content: QuizDraftContent
    documents: TestDocument[]
    points_possible: number | null
    include_in_final: boolean
    position: number
  }>
  tests: Array<{
    assessment_type: 'test'
    title: string
    content: TestDraftContent
    documents: TestDocument[]
    points_possible: number | null
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

async function loadAssessmentDraftContent(
  supabase: SupabaseClient,
  assessmentType: 'quiz' | 'test',
  classroomId: string,
  assessmentId: string
) {
  const { data, error } = await supabase
    .from('assessment_drafts')
    .select('content')
    .eq('classroom_id', classroomId)
    .eq('assessment_type', assessmentType)
    .eq('assessment_id', assessmentId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load ${assessmentType} draft content`)
  }

  return (data?.content as Record<string, unknown> | null) ?? null
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
      'Error loading classroom blueprint source:',
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

  let quizQuestions: Array<Record<string, any>>
  let testQuestions: Array<Record<string, any>>

  try {
    quizQuestions = await Promise.all(
      ((quizzesResult.data || []) as Array<Record<string, any>>).map(async (quiz) => {
        const { data: questions, error } = await supabase
          .from('quiz_questions')
          .select('*')
          .eq('quiz_id', quiz.id)
          .order('position', { ascending: true })

        if (error) {
          throw new Error('Failed to load quiz questions')
        }

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

    testQuestions = await Promise.all(
      ((testsResult.data || []) as Array<Record<string, any>>).map(async (test) => {
        const { data: questions, error } = await supabase
          .from('test_questions')
          .select('*')
          .eq('test_id', test.id)
          .order('position', { ascending: true })

        if (error) {
          throw new Error('Failed to load test questions')
        }

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
  } catch (error) {
    console.error('Error loading classroom blueprint assessment content:', error)
    return { ok: false, status: 500, error: 'Failed to load classroom content' }
  }

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
          points_possible: quiz.points_possible ?? null,
          include_in_final: quiz.include_in_final !== false,
          position: quiz.position ?? 0,
        })),
      tests: testQuestions
        .filter((test) => test.status !== 'draft')
        .map((test) => ({
          assessment_type: 'test' as const,
          title: test.title,
          content: test.content,
          documents: Array.isArray(test.documents) ? (test.documents as TestDocument[]) : [],
          points_possible: test.points_possible ?? null,
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
