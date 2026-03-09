import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import {
  buildNextDraftContent,
  buildTestDraftContentFromRows,
  ensureAssessmentDraft,
  syncAssessmentMetadataFromDraft,
  updateAssessmentDraft,
  validateTestDraftContent,
  type TestDraftContent,
} from '@/lib/server/assessment-drafts'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const TEST_DRAFT_CONFIG = {
  assessmentType: 'test' as const,
  questionsTable: 'test_questions',
  questionsForeignKey: 'test_id',
  questionsSelect:
    'id, question_type, question_text, options, correct_option, answer_key, points, response_max_chars, response_monospace',
  validateContent: validateTestDraftContent,
  // Tests allow empty question text during draft editing (unlike quizzes)
  validateOptions: { allowEmptyQuestionText: true },
  buildFromRows: buildTestDraftContentFromRows,
}

export const GET = withErrorHandler('GetTestDraft', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: testId } = await context.params

  const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const supabase = getServiceRoleClient()
  const ensured = await ensureAssessmentDraft<TestDraftContent>(supabase, {
    ...TEST_DRAFT_CONFIG,
    assessment: access.test,
    userId: user.id,
  })
  if (!ensured.ok) {
    return NextResponse.json({ error: ensured.error }, { status: ensured.status })
  }

  return NextResponse.json({ draft: ensured.draft })
})

export const PATCH = withErrorHandler('PatchTestDraft', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: testId } = await context.params
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

  const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const supabase = getServiceRoleClient()
  const ensured = await ensureAssessmentDraft<TestDraftContent>(supabase, {
    ...TEST_DRAFT_CONFIG,
    assessment: access.test,
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

  const nextContentResult = buildNextDraftContent<TestDraftContent>(
    currentDraft.content,
    { patch: body.patch, content: body.content },
    (input: unknown) => validateTestDraftContent(input, { allowEmptyQuestionText: true })
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
    console.error('Error saving test draft:', updateError)
    return NextResponse.json({ error: 'Failed to save draft' }, { status: 500 })
  }

  const metaSync = await syncAssessmentMetadataFromDraft(
    supabase, 'tests', testId, updatedDraft.content
  )
  if (!metaSync.ok) {
    return NextResponse.json({ error: metaSync.error }, { status: metaSync.status })
  }

  return NextResponse.json({ draft: updatedDraft })
})
