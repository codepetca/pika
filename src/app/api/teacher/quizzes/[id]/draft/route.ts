import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsQuiz } from '@/lib/server/quizzes'
import {
  buildNextDraftContent,
  buildQuizDraftContentFromRows,
  ensureAssessmentDraft,
  syncAssessmentMetadataFromDraft,
  updateAssessmentDraft,
  validateQuizDraftContent,
  type QuizDraftContent,
} from '@/lib/server/assessment-drafts'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const QUIZ_DRAFT_CONFIG = {
  assessmentType: 'quiz' as const,
  questionsTable: 'quiz_questions',
  questionsForeignKey: 'quiz_id',
  questionsSelect: 'id, question_text, options',
  validateContent: validateQuizDraftContent,
  buildFromRows: buildQuizDraftContentFromRows,
}

export const GET = withErrorHandler('GetQuizDraft', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: quizId } = await context.params

  const access = await assertTeacherOwnsQuiz(user.id, quizId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const supabase = getServiceRoleClient()
  const ensured = await ensureAssessmentDraft<QuizDraftContent>(supabase, {
    ...QUIZ_DRAFT_CONFIG,
    assessment: access.quiz,
    userId: user.id,
  })
  if (!ensured.ok) {
    return NextResponse.json({ error: ensured.error }, { status: ensured.status })
  }

  return NextResponse.json({ draft: ensured.draft })
})

export const PATCH = withErrorHandler('PatchQuizDraft', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: quizId } = await context.params
  const body = await request.json()

  const version = Number(body?.version)
  if (!Number.isInteger(version) || version < 1) {
    return NextResponse.json({ error: 'version is required' }, { status: 400 })
  }

  if (body?.patch !== undefined && !Array.isArray(body.patch)) {
    return NextResponse.json({ error: 'Invalid patch format' }, { status: 400 })
  }

  if (body?.content === undefined && !Array.isArray(body?.patch)) {
    return NextResponse.json({ error: 'content or patch is required' }, { status: 400 })
  }

  const access = await assertTeacherOwnsQuiz(user.id, quizId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const supabase = getServiceRoleClient()
  const ensured = await ensureAssessmentDraft<QuizDraftContent>(supabase, {
    ...QUIZ_DRAFT_CONFIG,
    assessment: access.quiz,
    userId: user.id,
  })
  if (!ensured.ok) {
    return NextResponse.json({ error: ensured.error }, { status: ensured.status })
  }

  const currentDraft = ensured.draft
  if (version !== currentDraft.version) {
    return NextResponse.json(
      { error: 'Draft updated elsewhere', draft: currentDraft },
      { status: 409 }
    )
  }

  const nextContentResult = buildNextDraftContent<QuizDraftContent>(
    currentDraft.content,
    { patch: body.patch, content: body.content },
    validateQuizDraftContent
  )

  if (!nextContentResult.ok) {
    return NextResponse.json(
      { error: nextContentResult.error },
      { status: nextContentResult.status }
    )
  }

  const { draft: updatedDraft, error: updateError } = await updateAssessmentDraft(
    supabase,
    currentDraft.id,
    currentDraft.version + 1,
    user.id,
    nextContentResult.content
  )

  if (updateError || !updatedDraft) {
    console.error('Error saving quiz draft:', updateError)
    return NextResponse.json({ error: 'Failed to save draft' }, { status: 500 })
  }

  const metaSync = await syncAssessmentMetadataFromDraft(
    supabase, 'quizzes', quizId, updatedDraft.content
  )
  if (!metaSync.ok) {
    return NextResponse.json({ error: metaSync.error }, { status: metaSync.status })
  }

  return NextResponse.json({ draft: updatedDraft })
})
