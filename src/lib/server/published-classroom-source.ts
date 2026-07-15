import { getAssignmentInstructionsMarkdown } from '@/lib/assignment-instructions'
import { getLessonPlanMarkdown } from '@/lib/lesson-plan-content'
import { tiptapToMarkdown } from '@/lib/limited-markdown'
import { getServiceRoleClient } from '@/lib/supabase'
import type { Announcement, ClassroomResources, TestDocument } from '@/types'

export type PublishedClassroomSource = {
  resources: ClassroomResources | null
  resources_markdown: string
  assignments: Array<Record<string, any>>
  tests: Array<Record<string, any>>
  lesson_plans: Array<Record<string, any>>
  announcements: Announcement[]
}

export async function loadPublishedClassroomSource(
  classroomId: string
): Promise<
  | { ok: true; source: PublishedClassroomSource }
  | { ok: false; status: number; error: string }
> {
  const supabase = getServiceRoleClient()
  const [resourcesResult, assignmentsResult, testsResult, lessonPlansResult, announcementsResult] = await Promise.all([
    supabase
      .from('classroom_resources')
      .select('id, classroom_id, content, updated_at, updated_by')
      .eq('classroom_id', classroomId)
      .maybeSingle(),
    supabase
      .from('assignments')
      .select('id, title, instructions_markdown, rich_instructions, description, points_possible, gradebook_weight, include_in_final, is_draft, position')
      .eq('classroom_id', classroomId)
      .order('position', { ascending: true }),
    supabase
      .from('tests')
      .select('id, title, status, show_results, documents, points_possible, gradebook_weight, include_in_final, position')
      .eq('classroom_id', classroomId)
      .order('position', { ascending: true }),
    supabase
      .from('lesson_plans')
      .select('id, date, content_markdown, content')
      .eq('classroom_id', classroomId)
      .order('date', { ascending: true }),
    supabase
      .from('announcements')
      .select('id, classroom_id, title, content, created_by, scheduled_for, created_at, updated_at')
      .eq('classroom_id', classroomId)
      .order('created_at', { ascending: false }),
  ])

  const loadError = resourcesResult.error || assignmentsResult.error || testsResult.error || lessonPlansResult.error || announcementsResult.error
  if (loadError) {
    console.error('Error loading published classroom source:', loadError)
    return { ok: false, status: 500, error: 'Failed to load published classroom content' }
  }

  const publishedTests = ((testsResult.data || []) as Array<Record<string, any>>)
    .filter((test) => test.status !== 'draft')
  const testIds = publishedTests.map((test) => String(test.id))
  let testQuestions: Array<Record<string, any>> = []

  if (testIds.length > 0) {
    const questionsResult = await supabase
      .from('test_questions')
      .select('id, test_id, question_type, question_text, options, correct_option, answer_key, sample_solution, points, response_max_chars, response_monospace, position')
      .in('test_id', testIds)
      .order('position', { ascending: true })

    if (questionsResult.error) {
      console.error('Error loading published test questions:', questionsResult.error)
      return { ok: false, status: 500, error: 'Failed to load published classroom content' }
    }
    testQuestions = (questionsResult.data || []) as Array<Record<string, any>>
  }

  const questionsByTestId = new Map<string, Array<Record<string, any>>>()
  for (const question of testQuestions) {
    const testId = String(question.test_id || '')
    const questions = questionsByTestId.get(testId) || []
    questions.push(question)
    questionsByTestId.set(testId, questions)
  }

  const resources = (resourcesResult.data || null) as ClassroomResources | null

  return {
    ok: true,
    source: {
      resources,
      resources_markdown: resources?.content ? tiptapToMarkdown(resources.content).markdown : '',
      assignments: ((assignmentsResult.data || []) as Array<Record<string, any>>)
        .filter((assignment) => !assignment.is_draft)
        .map((assignment) => ({
          title: assignment.title,
          instructions_markdown: getAssignmentInstructionsMarkdown({
            instructions_markdown: assignment.instructions_markdown ?? null,
            rich_instructions: assignment.rich_instructions ?? null,
            description: assignment.description ?? null,
          }).markdown,
          points_possible: assignment.points_possible ?? null,
          gradebook_weight: assignment.gradebook_weight ?? null,
          include_in_final: assignment.include_in_final ?? true,
          position: assignment.position ?? 0,
        })),
      tests: publishedTests.map((test) => ({
        title: test.title,
        content: {
          title: test.title,
          show_results: !!test.show_results,
          questions: questionsByTestId.get(String(test.id)) || [],
        },
        documents: Array.isArray(test.documents) ? (test.documents as TestDocument[]) : [],
        points_possible: test.points_possible ?? null,
        gradebook_weight: test.gradebook_weight ?? null,
        include_in_final: test.include_in_final !== false,
        position: test.position ?? 0,
      })),
      lesson_plans: ((lessonPlansResult.data || []) as Array<Record<string, any>>).map((plan, index) => ({
        title: `Lesson ${index + 1} (${plan.date})`,
        content_markdown: getLessonPlanMarkdown({
          content_markdown: plan.content_markdown ?? '',
          content: plan.content ?? null,
        }).markdown,
        position: index,
      })),
      announcements: (announcementsResult.data || []) as Announcement[],
    },
  }
}
