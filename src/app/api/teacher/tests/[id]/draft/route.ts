import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { validateTestDocumentsPayload } from '@/lib/test-documents'
import {
  buildNextDraftContent,
  buildTestDraftContentFromRows,
  ensureAssessmentDraft,
  getAssessmentDraftByType,
  saveTestDraftAtomic,
} from '@/lib/server/assessment-drafts'
import { validateTestDraftContent } from '@/lib/validations/assessment-drafts'
import {
  getTestDraftIdentityResolutionOptions,
  projectPortableTestQuestionIds,
  type PersistedTestQuestionIdentity,
} from '@/lib/test-question-identity'
import { withErrorHandler } from '@/lib/api-handler'
import type { TestDraftContent } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const TEST_DRAFT_CONFIG = {
  assessmentType: 'test' as const,
  questionsTable: 'test_questions',
  questionsForeignKey: 'test_id',
  questionsSelect:
    'id, artifact_id, source_artifact_id, question_type, question_text, options, correct_option, answer_key, sample_solution, points, response_max_chars, response_monospace',
  validateContent: validateTestDraftContent,
  validateOptions: { allowEmptyQuestionText: true },
  buildFromRows: buildTestDraftContentFromRows,
  projectContent: (content: TestDraftContent, rows: unknown[]) => (
    projectPortableTestQuestionIds(
      content,
      rows as PersistedTestQuestionIdentity[],
      getTestDraftIdentityResolutionOptions(content),
    )
  ),
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
    preferPersistedRows: access.test.status !== 'draft',
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
  let nextDocuments: ReturnType<typeof validateTestDocumentsPayload> | null = null
  if (body?.documents !== undefined) {
    const validation = validateTestDocumentsPayload(body.documents)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }
    nextDocuments = validation
  }

  const supabase = getServiceRoleClient()
  const ensured = await ensureAssessmentDraft<TestDraftContent>(supabase, {
    ...TEST_DRAFT_CONFIG,
    assessment: access.test,
    userId: user.id,
    preferPersistedRows: access.test.status !== 'draft',
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
    (input: unknown) => validateTestDraftContent(input, {
      allowEmptyQuestionText: access.test.status === 'draft',
    })
  )

  if (!nextContentResult.ok) {
    return NextResponse.json(
      { error: nextContentResult.error },
      { status: nextContentResult.status }
    )
  }

  const saveResult = await saveTestDraftAtomic(supabase, {
    teacherId: user.id,
    testId,
    expectedDraftVersion: currentDraft.version,
    content: nextContentResult.content,
    expectedDocuments: access.test.documents,
    ...(nextDocuments?.valid ? { documents: nextDocuments.documents } : {}),
  })
  if (!saveResult.ok) {
    if (saveResult.status === 409) {
      const latest = await getAssessmentDraftByType<TestDraftContent>(supabase, 'test', testId)
      return NextResponse.json(
        { error: saveResult.error, ...(latest.draft ? { draft: latest.draft } : {}) },
        { status: saveResult.status },
      )
    }
    return NextResponse.json({ error: saveResult.error }, { status: saveResult.status })
  }

  return NextResponse.json({ draft: saveResult.draft })
})
