import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import {
  buildNextDraftContent,
  buildTestDraftContentFromRows,
  createAssessmentDraft,
  getAssessmentDraftByType,
  isMissingAssessmentDraftsError,
  updateAssessmentDraft,
  validateTestDraftContent,
  type AssessmentDraftRow,
  type TestDraftContent,
} from '@/lib/server/assessment-drafts'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function ensureTestDraft(
  supabase: any,
  test: { id: string; classroom_id: string; title: string; show_results: boolean },
  userId: string
): Promise<
  | { ok: true; draft: AssessmentDraftRow<TestDraftContent> }
  | { ok: false; status: number; error: string }
> {
  const { draft, error } = await getAssessmentDraftByType<TestDraftContent>(
    supabase,
    'test',
    test.id
  )

  if (isMissingAssessmentDraftsError(error)) {
    return {
      ok: false,
      status: 400,
      error: 'Assessment drafts require migration 045 to be applied',
    }
  }

  if (error) {
    console.error('Error fetching test draft:', error)
    return { ok: false, status: 500, error: 'Failed to fetch draft' }
  }

  if (draft) {
    const valid = validateTestDraftContent(draft.content, {
      allowEmptyQuestionText: true,
    })
    if (valid.valid) {
      return { ok: true, draft: { ...draft, content: valid.value } }
    }
  }

  const { data: questions, error: questionsError } = await supabase
    .from('test_questions')
    .select(
      'id, question_type, question_text, options, correct_option, points, response_max_chars, response_monospace'
    )
    .eq('test_id', test.id)
    .order('position', { ascending: true })

  if (questionsError) {
    console.error('Error building baseline test draft:', questionsError)
    return { ok: false, status: 500, error: 'Failed to build draft' }
  }

  const content = buildTestDraftContentFromRows(test, questions || [])

  if (draft) {
    const { draft: updatedDraft, error: updateError } = await updateAssessmentDraft(
      supabase,
      draft.id,
      draft.version + 1,
      userId,
      content
    )

    if (updateError || !updatedDraft) {
      console.error('Error repairing test draft:', updateError)
      return { ok: false, status: 500, error: 'Failed to update draft' }
    }

    return { ok: true, draft: updatedDraft }
  }

  const { draft: createdDraft, error: createError } = await createAssessmentDraft(
    supabase,
    {
      assessmentType: 'test',
      assessmentId: test.id,
      classroomId: test.classroom_id,
      userId,
      content,
    }
  )

  if (createError?.code === '23505') {
    const raced = await getAssessmentDraftByType<TestDraftContent>(
      supabase,
      'test',
      test.id
    )
    if (raced.draft) return { ok: true, draft: raced.draft }
  }

  if (createError || !createdDraft) {
    console.error('Error creating test draft:', createError)
    return { ok: false, status: 500, error: 'Failed to create draft' }
  }

  return { ok: true, draft: createdDraft }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id: testId } = await params

    const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    const supabase = getServiceRoleClient()
    const ensured = await ensureTestDraft(supabase, access.test, user.id)
    if (!ensured.ok) {
      return NextResponse.json({ error: ensured.error }, { status: ensured.status })
    }

    return NextResponse.json({ draft: ensured.draft })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    console.error('Get test draft error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id: testId } = await params
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
    const ensured = await ensureTestDraft(supabase, access.test, user.id)
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
      (input: unknown) =>
        validateTestDraftContent(input, {
          allowEmptyQuestionText: true,
        })
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

    const { error: metaError } = await supabase
      .from('tests')
      .update({
        title: updatedDraft.content.title,
        show_results: updatedDraft.content.show_results,
      })
      .eq('id', testId)

    if (metaError) {
      console.error('Error syncing test metadata from draft:', metaError)
      return NextResponse.json({ error: 'Failed to sync assessment metadata' }, { status: 500 })
    }

    return NextResponse.json({ draft: updatedDraft })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    console.error('Patch test draft error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
