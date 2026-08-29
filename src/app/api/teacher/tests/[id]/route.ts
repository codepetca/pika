import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { canActivateTest } from '@/lib/tests'
import { validateTestQuestionCreate } from '@/lib/test-questions'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { deleteTeacherTestAtomic } from '@/lib/server/test-deletion'
import { normalizeTestDocuments, validateTestDocumentsPayload } from '@/lib/test-documents'
import { updateTestDocumentsAtomic } from '@/lib/server/test-document-authoring'
import {
  getAssessmentDraftByType,
  isMissingAssessmentDraftsError,
  publishTestFromDraftAtomic,
} from '@/lib/server/assessment-drafts'
import { validateTestDraftContent } from '@/lib/validations/assessment-drafts'
import {
  getPortableTestQuestionIdentity,
  getTestDraftIdentityResolutionOptions,
  projectPortableTestQuestionIds,
} from '@/lib/test-question-identity'
import { withErrorHandler } from '@/lib/api-handler'
import type { TableRow } from '@/types/database'
import type { TestDraftContent } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type TestQuestionResponse = Omit<
  TableRow<'test_questions'>,
  | 'ai_reference_cache_answers'
  | 'ai_reference_cache_generated_at'
  | 'ai_reference_cache_key'
  | 'ai_reference_cache_model'
  | 'artifact_id'
  | 'source_artifact_id'
  | 'source_blueprint_version_id'
> & Partial<Pick<
  TableRow<'test_questions'>,
  | 'ai_reference_cache_answers'
  | 'ai_reference_cache_generated_at'
  | 'ai_reference_cache_key'
  | 'ai_reference_cache_model'
>>

function toTestQuestionResponse(
  question: Omit<TableRow<'test_questions'>, 'source_blueprint_version_id'>,
): TestQuestionResponse {
  const {
    artifact_id: _artifactId,
    source_artifact_id: _sourceArtifactId,
    ...responseQuestion
  } = question
  // Report the portable identity, not the internal row id, so this field
  // means the same thing regardless of Test lifecycle stage (draft tests
  // below return the portable id via projectPortableTestQuestionIds; the
  // database row id must stay internal per the canonical identity contract).
  return { ...responseQuestion, id: getPortableTestQuestionIdentity(question) }
}

// GET /api/teacher/tests/[id] - Get test with questions
export const GET = withErrorHandler('GetTestById', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const supabase = getServiceRoleClient()

  const access = await assertTeacherOwnsTest(user.id, id)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const test = access.test

  const { data: questions, error: questionsError } = await supabase
    .from('test_questions')
    .select(`
      id,
      test_id,
      artifact_id,
      source_artifact_id,
      question_type,
      question_text,
      options,
      correct_option,
      answer_key,
      sample_solution,
      points,
      response_max_chars,
      response_monospace,
      position,
      ai_reference_cache_answers,
      ai_reference_cache_generated_at,
      ai_reference_cache_key,
      ai_reference_cache_model,
      created_at,
      updated_at
    `)
    .eq('test_id', id)
    .order('position', { ascending: true })

  if (questionsError) {
    console.error('Error fetching test questions:', questionsError)
    return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
  }

  let title = test.title
  let showResults = test.show_results
  let responseQuestions: TestQuestionResponse[] = (questions || []).map(toTestQuestionResponse)

  const { draft, error: draftError } = await getAssessmentDraftByType<TestDraftContent>(
    supabase,
    'test',
    id
  )

  if (draftError && !isMissingAssessmentDraftsError(draftError)) {
    console.error('Error fetching test draft overlay:', draftError)
  }

  if (draft && test.status === 'draft') {
    const validated = validateTestDraftContent(draft.content, {
      allowEmptyQuestionText: true,
    })
    if (validated.valid) {
      const projected = projectPortableTestQuestionIds(
        validated.value,
        questions || [],
        getTestDraftIdentityResolutionOptions(validated.value),
      )
      if (!projected.ok) {
        return NextResponse.json(
          { error: 'Test draft question identity is ambiguous' },
          { status: 409 },
        )
      }

      title = projected.content.title
      showResults = projected.content.show_results
      responseQuestions = projected.content.questions.map((question, index) => ({
        id: question.id,
        test_id: id,
        question_type: question.question_type,
        question_text: question.question_text,
        options: question.options,
        correct_option: question.correct_option,
        answer_key: question.answer_key,
        sample_solution: question.sample_solution,
        points: question.points,
        response_max_chars: question.response_max_chars,
        response_monospace: question.response_monospace,
        position: index,
        created_at: test.created_at,
        updated_at: test.updated_at,
      }))
    }
  }

  const responseTest = {
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
  }

  return NextResponse.json({
    test: responseTest,
    questions: responseQuestions,
    draft_version: draft?.version ?? null,
    classroom: test.classrooms,
  })
})

// PATCH /api/teacher/tests/[id] - Update test title/status/show_results
export const PATCH = withErrorHandler('PatchUpdateTest', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const body = await request.json()
  const { title, status, show_results, documents } = body

  const access = await assertTeacherOwnsTest(user.id, id, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const existing = access.test
  const supabase = getServiceRoleClient()
  let publishedTest: Record<string, any> | null = null
  const isPublishingDraft = existing.status === 'draft' && status === 'closed'

  if (status !== undefined) {
    const VALID_TRANSITIONS: Record<string, string[]> = {
      draft: ['closed'],
      active: [],
      closed: [],
    }
    const allowed = VALID_TRANSITIONS[existing.status] || []
    if (!allowed.includes(status)) {
      return NextResponse.json(
        { error: `Cannot transition from ${existing.status} to ${status}` },
        { status: 400 }
      )
    }
  }

  if (isPublishingDraft) {
    if (title !== undefined || show_results !== undefined || documents !== undefined) {
      return NextResponse.json(
        { error: 'Save Test draft changes before publishing' },
        { status: 400 },
      )
    }

    const expectedDraftVersion = Number(body?.draft_version)
    if (!Number.isInteger(expectedDraftVersion) || expectedDraftVersion < 1) {
      return NextResponse.json(
        { error: 'draft_version is required for publishing' },
        { status: 400 },
      )
    }

    const { draft, error: draftError } = await getAssessmentDraftByType<TestDraftContent>(
      supabase,
      'test',
      id
    )

    if (draftError && !isMissingAssessmentDraftsError(draftError)) {
      console.error('Error loading test draft for publication:', draftError)
      return NextResponse.json({ error: 'Failed to load draft for publication' }, { status: 500 })
    }

    if (!draft) {
      return NextResponse.json({ error: 'Test draft not found' }, { status: 404 })
    }
    if (draft.version !== expectedDraftVersion) {
      return NextResponse.json(
        { error: 'The Test changed after publication was requested. Review and try again.' },
        { status: 409 },
      )
    }

    // Before migration 134, an unmarked persisted draft still follows the
    // legacy activation RPC contract. Migration 134 marks every live draft and
    // its replacement RPC enforces the marker inside the activation
    // transaction, so this rollout read can remain compatible without
    // weakening the post-migration boundary.
    const validatedDraft = validateTestDraftContent(draft.content)
    if (!validatedDraft.valid) {
      return NextResponse.json({ error: validatedDraft.error }, { status: 400 })
    }

    const questionList = validatedDraft.value.questions
    const activation = canActivateTest(existing, questionList.length)
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

    const publicationResult = await publishTestFromDraftAtomic(supabase, {
      teacherId: user.id,
      testId: id,
      expectedDraftVersion,
    })
    if (!publicationResult.ok) {
      return NextResponse.json(
        { error: publicationResult.error },
        { status: publicationResult.status },
      )
    }
    if (publicationResult.test.status !== 'closed') {
      console.error('Atomic Test publication returned a non-closed Test')
      return NextResponse.json({ error: 'Failed to publish test' }, { status: 500 })
    }
    publishedTest = publicationResult.test as Record<string, any>
  }

  if (
    existing.status === 'draft'
    && !isPublishingDraft
    && (title !== undefined || show_results !== undefined)
  ) {
    return NextResponse.json(
      { error: 'Update draft Test content through the draft endpoint' },
      { status: 400 },
    )
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
  let validatedDocuments: ReturnType<typeof validateTestDocumentsPayload> | null = null
  if (title !== undefined) updates.title = title.trim()
  if (status !== undefined && !isPublishingDraft) updates.status = status
  if (show_results !== undefined) updates.show_results = show_results
  if (documents !== undefined) {
    const validated = validateTestDocumentsPayload(documents)
    if (!validated.valid) {
      return NextResponse.json({ error: validated.error }, { status: 400 })
    }
    validatedDocuments = validated
    updates.documents = validated.documents
  }

  if (Object.keys(updates).length === 0 && !publishedTest) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
  }

  let test: Record<string, any> = publishedTest ?? existing as Record<string, any>

  if (Object.keys(updates).length > 0) {
    if (validatedDocuments?.valid) {
      const result = await updateTestDocumentsAtomic({
        supabase,
        teacherId: user.id,
        testId: id,
        expectedStatus: existing.status,
        expectedDocuments: existing.documents,
        proposedDocuments: validatedDocuments.documents,
        ...(updates.title !== undefined ? { title: updates.title as string } : {}),
        ...(updates.status !== undefined ? { status: updates.status as string } : {}),
        ...(updates.show_results !== undefined
          ? { showResults: updates.show_results as boolean }
          : {}),
      })
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }
      test = result.test
    } else {
      const { data: updatedTest, error } = await supabase
        .from('tests')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) {
        console.error('Error updating test:', error)
        return NextResponse.json({ error: 'Failed to update test' }, { status: 500 })
      }

      test = updatedTest as Record<string, any>
    }
  }

  const responseTest = {
    ...test,
    documents: normalizeTestDocuments((test as { documents?: unknown }).documents),
    assessment_type: 'test',
  }

  return NextResponse.json({
    test: responseTest,
  })
})

// DELETE /api/teacher/tests/[id] - Delete test
export const DELETE = withErrorHandler('DeleteTest', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params

  const access = await assertTeacherOwnsTest(user.id, id, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const result = await deleteTeacherTestAtomic({ testId: id, teacherId: user.id })
  return NextResponse.json({ success: result.deleted, responses_count: result.responsesCount })
})
