import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { canActivateQuiz } from '@/lib/quizzes'
import { assertTeacherOwnsQuiz, hasQuizOpened } from '@/lib/server/quizzes'
import {
  getAssessmentDraftByType,
  isMissingAssessmentDraftsError,
  syncQuizQuestionsFromDraft,
  updateAssessmentDraft,
  validateQuizDraftContent,
  type QuizDraftContent,
} from '@/lib/server/assessment-drafts'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/teacher/quizzes/[id] - Get quiz with questions
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id } = await params
    const supabase = getServiceRoleClient()

    const access = await assertTeacherOwnsQuiz(user.id, id)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    const quiz = access.quiz

    const { data: questions, error: questionsError } = await supabase
      .from('quiz_questions')
      .select('*')
      .eq('quiz_id', id)
      .order('position', { ascending: true })

    if (questionsError) {
      console.error('Error fetching questions:', questionsError)
      return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
    }

    let title = quiz.title
    let showResults = quiz.show_results
    let responseQuestions = questions || []

    const { draft, error: draftError } = await getAssessmentDraftByType<QuizDraftContent>(
      supabase,
      'quiz',
      id
    )

    if (draftError && !isMissingAssessmentDraftsError(draftError)) {
      console.error('Error fetching quiz draft overlay:', draftError)
    }

    if (draft) {
      const validated = validateQuizDraftContent(draft.content)
      if (validated.valid) {
        title = validated.value.title
        showResults = validated.value.show_results
        responseQuestions = validated.value.questions.map((question, index) => ({
          id: question.id,
          quiz_id: id,
          question_text: question.question_text,
          options: question.options,
          position: index,
          created_at: quiz.created_at,
          updated_at: quiz.updated_at,
        }))
      }
    }

    return NextResponse.json({
      quiz: {
        id: quiz.id,
        classroom_id: quiz.classroom_id,
        title,
        assessment_type: 'quiz' as const,
        status: quiz.status,
        opens_at: quiz.opens_at,
        show_results: showResults,
        position: quiz.position,
        created_by: quiz.created_by,
        created_at: quiz.created_at,
        updated_at: quiz.updated_at,
      },
      questions: responseQuestions,
      classroom: quiz.classrooms,
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Get quiz error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/teacher/quizzes/[id] - Update quiz title/status/show_results
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id } = await params
    const body = await request.json()
    const { title, status, show_results, opens_at } = body as {
      title?: string
      status?: 'draft' | 'active' | 'closed'
      show_results?: boolean
      opens_at?: string | null
    }

    const access = await assertTeacherOwnsQuiz(user.id, id, { checkArchived: true })
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    const existing = access.quiz
    const supabase = getServiceRoleClient()

    let parsedOpensAt: string | null | undefined
    if (opens_at !== undefined) {
      if (opens_at === null) {
        parsedOpensAt = null
      } else {
        const parsed = new Date(opens_at)
        if (isNaN(parsed.getTime())) {
          return NextResponse.json({ error: 'Invalid open date' }, { status: 400 })
        }
        parsedOpensAt = parsed.toISOString()
      }
    }

    const now = new Date()
    const quizHasOpened = hasQuizOpened(existing, now)

    // Validate status transition
    if (status !== undefined) {
      if (existing.status === 'active' && status === 'draft') {
        if (quizHasOpened) {
          return NextResponse.json(
            { error: 'Cannot revert a quiz that has already opened to draft' },
            { status: 400 }
          )
        }
      } else {
        const VALID_TRANSITIONS: Record<string, string[]> = {
          draft: ['active'],
          active: ['closed'],
          closed: ['active'],
        }
        const allowed = VALID_TRANSITIONS[existing.status] || []
        if (!allowed.includes(status)) {
          return NextResponse.json(
            { error: `Cannot transition from ${existing.status} to ${status}` },
            { status: 400 }
          )
        }
      }
    }

    const targetStatus = status ?? existing.status

    if (targetStatus !== 'active' && opens_at !== undefined && parsedOpensAt !== null) {
      return NextResponse.json(
        { error: 'opens_at can only be set for active quizzes' },
        { status: 400 }
      )
    }

    if (quizHasOpened && opens_at !== undefined) {
      return NextResponse.json(
        { error: 'Cannot reschedule a quiz that has already opened' },
        { status: 400 }
      )
    }

    // If activating quiz, validate it has questions
    if (status === 'active' && existing.status === 'draft') {
      const { draft, error: draftError } = await getAssessmentDraftByType<QuizDraftContent>(
        supabase,
        'quiz',
        id
      )

      if (draftError && !isMissingAssessmentDraftsError(draftError)) {
        console.error('Error loading quiz draft for activation:', draftError)
        return NextResponse.json({ error: 'Failed to load draft for activation' }, { status: 500 })
      }

      if (draft) {
        const validatedDraft = validateQuizDraftContent(draft.content)
        if (!validatedDraft.valid) {
          return NextResponse.json({ error: validatedDraft.error }, { status: 400 })
        }

        const syncResult = await syncQuizQuestionsFromDraft(supabase, id, validatedDraft.value)
        if (!syncResult.ok) {
          return NextResponse.json({ error: syncResult.error }, { status: syncResult.status })
        }

        const { error: metaError } = await supabase
          .from('quizzes')
          .update({
            title: validatedDraft.value.title,
            show_results: validatedDraft.value.show_results,
          })
          .eq('id', id)

        if (metaError) {
          console.error('Error syncing quiz metadata from draft during activation:', metaError)
          return NextResponse.json({ error: 'Failed to sync quiz draft metadata' }, { status: 500 })
        }
      }

      const { count: questionsCount } = await supabase
        .from('quiz_questions')
        .select('*', { count: 'exact', head: true })
        .eq('quiz_id', id)

      const activation = canActivateQuiz(existing, questionsCount || 0)
      if (!activation.valid) {
        return NextResponse.json({ error: activation.error }, { status: 400 })
      }
    }

    if (title !== undefined) {
      const trimmed = typeof title === 'string' ? title.trim() : ''
      if (!trimmed) {
        return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 })
      }
    }

    if (show_results !== undefined && typeof show_results !== 'boolean') {
      return NextResponse.json({ error: 'show_results must be a boolean' }, { status: 400 })
    }

    const updates: Record<string, any> = {}
    if (title !== undefined) updates.title = title.trim()
    if (status !== undefined) updates.status = status
    if (show_results !== undefined) updates.show_results = show_results
    if (opens_at !== undefined) {
      updates.opens_at = parsedOpensAt
    }

    if (status === 'active') {
      // Draft/closed -> active defaults to opening now unless explicitly scheduled.
      if (opens_at === undefined) {
        updates.opens_at = new Date().toISOString()
      } else if (parsedOpensAt === null) {
        updates.opens_at = new Date().toISOString()
      }
    }

    if (status === 'draft') {
      updates.opens_at = null
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
    }

    const { data: quiz, error } = await supabase
      .from('quizzes')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating quiz:', error)
      return NextResponse.json({ error: 'Failed to update quiz' }, { status: 500 })
    }

    if (title !== undefined || show_results !== undefined) {
      const { draft, error: draftError } = await getAssessmentDraftByType<QuizDraftContent>(
        supabase,
        'quiz',
        id
      )

      if (draftError && !isMissingAssessmentDraftsError(draftError)) {
        console.error('Error loading quiz draft for metadata sync:', draftError)
      }

      if (draft) {
        const validatedDraft = validateQuizDraftContent(draft.content)
        if (validatedDraft.valid) {
          const nextContent = {
            ...validatedDraft.value,
            title: title !== undefined ? (updates.title as string) : validatedDraft.value.title,
            show_results:
              show_results !== undefined
                ? (updates.show_results as boolean)
                : validatedDraft.value.show_results,
          }

          const { error: draftUpdateError } = await updateAssessmentDraft(
            supabase,
            draft.id,
            draft.version + 1,
            user.id,
            nextContent
          )

          if (draftUpdateError) {
            console.error('Error syncing quiz draft metadata after patch:', draftUpdateError)
          }
        }
      }
    }

    return NextResponse.json({ quiz: { ...quiz, assessment_type: 'quiz' } })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Update quiz error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/teacher/quizzes/[id] - Delete quiz
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id } = await params

    const access = await assertTeacherOwnsQuiz(user.id, id, { checkArchived: true })
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    const supabase = getServiceRoleClient()

    const { count: responsesCount } = await supabase
      .from('quiz_responses')
      .select('*', { count: 'exact', head: true })
      .eq('quiz_id', id)

    const { error } = await supabase
      .from('quizzes')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting quiz:', error)
      return NextResponse.json({ error: 'Failed to delete quiz' }, { status: 500 })
    }

    return NextResponse.json({ success: true, responses_count: responsesCount || 0 })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Delete quiz error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
