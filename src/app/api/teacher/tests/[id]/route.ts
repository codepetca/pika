import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { canActivateQuiz } from '@/lib/quizzes'
import { validateTestQuestionCreate } from '@/lib/test-questions'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { normalizeTestDocuments, validateTestDocumentsPayload } from '@/lib/test-documents'
import { finalizeUnsubmittedTestAttemptsOnClose } from '@/lib/server/finalize-test-attempts'
import {
  getAssessmentDraftByType,
  isMissingAssessmentDraftsError,
  syncTestQuestionsFromDraft,
  updateAssessmentDraft,
  validateTestDraftContent,
  type TestDraftContent,
} from '@/lib/server/assessment-drafts'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/teacher/tests/[id] - Get test with questions
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id } = await params
    const supabase = getServiceRoleClient()

    const access = await assertTeacherOwnsTest(user.id, id)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    const test = access.test

    const { data: questions, error: questionsError } = await supabase
      .from('test_questions')
      .select('*')
      .eq('test_id', id)
      .order('position', { ascending: true })

    if (questionsError) {
      console.error('Error fetching test questions:', questionsError)
      return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
    }

    let title = test.title
    let showResults = test.show_results
    let responseQuestions = questions || []

    const { draft, error: draftError } = await getAssessmentDraftByType<TestDraftContent>(
      supabase,
      'test',
      id
    )

    if (draftError && !isMissingAssessmentDraftsError(draftError)) {
      console.error('Error fetching test draft overlay:', draftError)
    }

    if (draft) {
      const validated = validateTestDraftContent(draft.content, {
        allowEmptyQuestionText: true,
      })
      if (validated.valid) {
        title = validated.value.title
        showResults = validated.value.show_results
        responseQuestions = validated.value.questions.map((question, index) => ({
          id: question.id,
          test_id: id,
          question_type: question.question_type,
          question_text: question.question_text,
          options: question.options,
          correct_option: question.correct_option,
          answer_key: question.answer_key,
          points: question.points,
          response_max_chars: question.response_max_chars,
          response_monospace: question.response_monospace,
          position: index,
          created_at: test.created_at,
          updated_at: test.updated_at,
        }))
      }
    }

    return NextResponse.json({
      quiz: {
        id: test.id,
        classroom_id: test.classroom_id,
        title,
        assessment_type: 'test' as const,
        status: test.status,
        show_results: showResults,
        documents: normalizeTestDocuments(test.documents),
        position: test.position,
        points_possible: test.points_possible,
        include_in_final: test.include_in_final,
        created_by: test.created_by,
        created_at: test.created_at,
        updated_at: test.updated_at,
      },
      questions: responseQuestions,
      classroom: test.classrooms,
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Get test error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/teacher/tests/[id] - Update test title/status/show_results
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id } = await params
    const body = await request.json()
    const { title, status, show_results, documents } = body

    const access = await assertTeacherOwnsTest(user.id, id, { checkArchived: true })
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    const existing = access.test
    const supabase = getServiceRoleClient()

    if (status !== undefined) {
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

    if (status === 'active' && existing.status === 'draft') {
      const { draft, error: draftError } = await getAssessmentDraftByType<TestDraftContent>(
        supabase,
        'test',
        id
      )

      if (draftError && !isMissingAssessmentDraftsError(draftError)) {
        console.error('Error loading test draft for activation:', draftError)
        return NextResponse.json({ error: 'Failed to load draft for activation' }, { status: 500 })
      }

      if (draft) {
        const validatedDraft = validateTestDraftContent(draft.content)
        if (!validatedDraft.valid) {
          return NextResponse.json({ error: validatedDraft.error }, { status: 400 })
        }

        const syncResult = await syncTestQuestionsFromDraft(supabase, id, validatedDraft.value)
        if (!syncResult.ok) {
          return NextResponse.json({ error: syncResult.error }, { status: syncResult.status })
        }

        const { error: metaError } = await supabase
          .from('tests')
          .update({
            title: validatedDraft.value.title,
            show_results: validatedDraft.value.show_results,
          })
          .eq('id', id)

        if (metaError) {
          console.error('Error syncing test metadata from draft during activation:', metaError)
          return NextResponse.json({ error: 'Failed to sync test draft metadata' }, { status: 500 })
        }
      }

      const { data: questions, error: questionsError } = await supabase
        .from('test_questions')
        .select(
          'id, position, question_type, question_text, options, correct_option, points, response_max_chars, response_monospace'
        )
        .eq('test_id', id)
        .order('position', { ascending: true })

      if (questionsError) {
        console.error('Error fetching test questions for activation:', questionsError)
        return NextResponse.json({ error: 'Failed to validate test questions' }, { status: 500 })
      }

      const questionList = questions || []
      const activation = canActivateQuiz(existing, questionList.length)
      if (!activation.valid) {
        return NextResponse.json({ error: activation.error }, { status: 400 })
      }

      for (let index = 0; index < questionList.length; index += 1) {
        const question = questionList[index]
        const result = validateTestQuestionCreate(question as Record<string, unknown>)
        if (!result.valid) {
          return NextResponse.json(
            { error: `Q${index + 1}: ${result.error}` },
            { status: 400 }
          )
        }
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

    const shouldFinalizeOnClose = status === 'closed' && existing.status === 'active'

    const updates: Record<string, any> = {}
    if (title !== undefined) updates.title = title.trim()
    if (status !== undefined) updates.status = status
    if (show_results !== undefined) updates.show_results = show_results
    if (documents !== undefined) {
      const validated = validateTestDocumentsPayload(documents)
      if (!validated.valid) {
        return NextResponse.json({ error: validated.error }, { status: 400 })
      }
      updates.documents = validated.documents
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
    }

    const { data: test, error } = await supabase
      .from('tests')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (
        (error.code === '42703' || error.code === 'PGRST204') &&
        `${error.message || ''} ${error.details || ''}`.toLowerCase().includes('documents')
      ) {
        return NextResponse.json(
          { error: 'Test documents require migration 042 to be applied' },
          { status: 400 }
        )
      }
      console.error('Error updating test:', error)
      return NextResponse.json({ error: 'Failed to update test' }, { status: 500 })
    }

    if (shouldFinalizeOnClose) {
      const finalizeResult = await finalizeUnsubmittedTestAttemptsOnClose(supabase, id)
      if (!finalizeResult.ok) {
        const { error: reopenError } = await supabase
          .from('tests')
          .update({ status: 'active' })
          .eq('id', id)
          .eq('status', 'closed')

        if (reopenError) {
          console.error('Error reopening test after close finalization failure:', reopenError)
        }

        return NextResponse.json({ error: finalizeResult.error }, { status: finalizeResult.status })
      }
    }

    if (title !== undefined || show_results !== undefined) {
      const { draft, error: draftError } = await getAssessmentDraftByType<TestDraftContent>(
        supabase,
        'test',
        id
      )

      if (draftError && !isMissingAssessmentDraftsError(draftError)) {
        console.error('Error loading test draft for metadata sync:', draftError)
      }

      if (draft) {
        const validatedDraft = validateTestDraftContent(draft.content, {
          allowEmptyQuestionText: true,
        })
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
            console.error('Error syncing test draft metadata after patch:', draftUpdateError)
          }
        }
      }
    }

    return NextResponse.json({
      quiz: {
        ...test,
        documents: normalizeTestDocuments((test as { documents?: unknown }).documents),
        assessment_type: 'test',
      },
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Update test error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/teacher/tests/[id] - Delete test
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id } = await params

    const access = await assertTeacherOwnsTest(user.id, id, { checkArchived: true })
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    const supabase = getServiceRoleClient()

    const { count: responsesCount } = await supabase
      .from('test_responses')
      .select('*', { count: 'exact', head: true })
      .eq('test_id', id)

    const { error } = await supabase
      .from('tests')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting test:', error)
      return NextResponse.json({ error: 'Failed to delete test' }, { status: 500 })
    }

    return NextResponse.json({ success: true, responses_count: responsesCount || 0 })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Delete test error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
