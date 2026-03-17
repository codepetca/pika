import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherOwnsQuiz } from '@/lib/server/quizzes'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/quizzes/[id]/questions/reorder
// body: { question_ids: string[] }
export const POST = withErrorHandler('ReorderTeacherQuizQuestions', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: quizId } = await context.params
  const body = await request.json()
  const { question_ids } = body as { question_ids?: string[] }

  if (!Array.isArray(question_ids)) {
    return NextResponse.json({ error: 'question_ids is required' }, { status: 400 })
  }

  if (question_ids.some((id: unknown) => typeof id !== 'string' || !id)) {
    return NextResponse.json({ error: 'question_ids must be non-empty strings' }, { status: 400 })
  }

  const uniqueIds = Array.from(new Set(question_ids))
  if (uniqueIds.length !== question_ids.length) {
    return NextResponse.json({ error: 'question_ids must be unique' }, { status: 400 })
  }

  const access = await assertTeacherOwnsQuiz(user.id, quizId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const supabase = getServiceRoleClient()

  // Fetch ALL questions for this quiz to ensure complete set
  const { data: questions, error: questionsError } = await supabase
    .from('quiz_questions')
    .select('id')
    .eq('quiz_id', quizId)

  if (questionsError) {
    console.error('Error verifying questions:', questionsError)
    return NextResponse.json({ error: 'Failed to verify questions' }, { status: 500 })
  }

  const existingIds = new Set((questions || []).map((q) => q.id))
  if (uniqueIds.length !== existingIds.size || !uniqueIds.every((id) => existingIds.has(id))) {
    return NextResponse.json({ error: 'question_ids must include all questions in the quiz' }, { status: 400 })
  }

  for (const [position, id] of uniqueIds.entries()) {
    const { error: updateError } = await supabase
      .from('quiz_questions')
      .update({ position })
      .eq('quiz_id', quizId)
      .eq('id', id)

    if (updateError) {
      console.error('Error reordering questions:', updateError)
      return NextResponse.json({ error: 'Failed to reorder questions' }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true })
})
