import { tryApplyJsonPatch } from '@/lib/json-patch'
import { preserveCurrentTestDocumentSnapshots } from '@/lib/test-documents'
import { removeQueuedTestDocumentSnapshotPath } from '@/lib/server/test-document-snapshot-storage-cleanup'
import {
  parseCleanupPaths,
  updateTestDocumentsAtomic,
} from '@/lib/server/test-document-authoring'
import {
  getTestDraftIdentityResolutionOptions,
  getPortableTestQuestionIdentity,
  PORTABLE_TEST_QUESTION_IDENTITY_VERSION,
  resolveTestQuestionIdentities,
} from '@/lib/test-question-identity'
import type { AssessmentDraftValidationResult } from '@/lib/validations/assessment-drafts'
import type {
  AssessmentDraftType,
  JsonPatchOperation,
  TestDraftContent,
} from '@/types'

type SupabaseLike = any

export type AssessmentDraftRow<TContent> = {
  id: string
  assessment_type: AssessmentDraftType
  assessment_id: string
  classroom_id: string
  content: TContent
  version: number
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}

function parseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null

  const next: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return null
    const trimmed = item.trim()
    if (!trimmed) return null
    next.push(trimmed)
  }

  return next
}

// TODO(cleanup-045): Remove this function and all callsites once migration 045
// (`add_assessment_drafts_table`) is confirmed applied in ALL environments.
// Search: grep -r "isMissingAssessmentDraftsError" src/
// Direct callers (3 files):
//   src/app/api/teacher/tests/route.ts
//   src/app/api/teacher/tests/[id]/route.ts
//   src/app/api/teacher/tests/[id]/draft/route.ts
// Indirect callers via ensureAssessmentDraft should remove the paired TODO(cleanup-045) comment too.
export function isMissingAssessmentDraftsError(error: {
  code?: string
  message?: string
  details?: string
  hint?: string
} | null | undefined): boolean {
  if (!error) return false
  const combined = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase()
  if (!combined.includes('assessment_drafts')) return false
  return error.code === 'PGRST205' || error.code === '42P01' || combined.includes('table')
}

export function buildNextDraftContent<TContent extends object>(
  currentContent: TContent,
  payload: { patch?: JsonPatchOperation[]; content?: unknown },
  validate: (input: unknown) => AssessmentDraftValidationResult<TContent>
): { ok: true; content: TContent } | { ok: false; status: number; error: string } {
  let candidateContent: unknown

  if (Array.isArray(payload.patch)) {
    const patched = tryApplyJsonPatch(currentContent, payload.patch)
    if (!patched.success) {
      return { ok: false, status: 400, error: 'Invalid patch' }
    }
    candidateContent = patched.content
  } else {
    candidateContent = payload.content
  }

  const validation = validate(candidateContent)
  if (!validation.valid) {
    return { ok: false, status: 400, error: validation.error }
  }

  return { ok: true, content: validation.value }
}

type TestQuestionRow = {
  id: string
  artifact_id?: string | null
  source_artifact_id?: string | null
  question_type: unknown
  question_text: string
  options: unknown
  correct_option: number | null
  answer_key: string | null
  sample_solution: string | null
  points: number | string | null
  response_max_chars: number | string | null
  response_monospace: boolean | null
}

export function buildTestDraftContentFromRows(
  test: { title: string; show_results: boolean },
  rows: unknown[]
): TestDraftContent {
  const questions = rows as TestQuestionRow[]
  return {
    title: test.title,
    show_results: test.show_results,
    question_identity_version: PORTABLE_TEST_QUESTION_IDENTITY_VERSION,
    questions: (questions || []).map((question) => ({
      // Draft question IDs are portable artifact identities. Persisted row IDs
      // are an internal database contract and must not escape into draft JSON.
      id: getPortableTestQuestionIdentity(question),
      question_type: question.question_type === 'open_response' ? 'open_response' : 'multiple_choice',
      question_text: question.question_text,
      options: parseStringArray(question.options) || [],
      correct_option:
        typeof question.correct_option === 'number' && Number.isInteger(question.correct_option)
          ? question.correct_option
          : null,
      answer_key:
        typeof question.answer_key === 'string' && question.answer_key.trim().length > 0
          ? question.answer_key.trim()
          : null,
      sample_solution:
        typeof question.sample_solution === 'string' && question.sample_solution.trim().length > 0
          ? question.sample_solution.trim()
          : null,
      points: Number(question.points ?? 1),
      response_max_chars: Number(question.response_max_chars ?? 5000),
      response_monospace: question.response_monospace === true,
    })),
    source_format: 'markdown',
  }
}

export async function getAssessmentDraftByType<TContent>(
  supabase: SupabaseLike,
  assessmentType: AssessmentDraftType,
  assessmentId: string
): Promise<{ draft: AssessmentDraftRow<TContent> | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('assessment_drafts')
      .select('*')
      .eq('assessment_type', assessmentType)
      .eq('assessment_id', assessmentId)
      .maybeSingle()

    return { draft: (data as AssessmentDraftRow<TContent> | null) ?? null, error }
  } catch (error) {
    return {
      draft: null,
      error: {
        code: 'PGRST205',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

export async function createAssessmentDraft<TContent>(
  supabase: SupabaseLike,
  params: {
    assessmentType: AssessmentDraftType
    assessmentId: string
    classroomId: string
    userId: string
    content: TContent
  }
): Promise<{ draft: AssessmentDraftRow<TContent> | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('assessment_drafts')
      .insert({
        assessment_type: params.assessmentType,
        assessment_id: params.assessmentId,
        classroom_id: params.classroomId,
        content: params.content,
        version: 1,
        created_by: params.userId,
        updated_by: params.userId,
      })
      .select('*')
      .single()

    return { draft: (data as AssessmentDraftRow<TContent> | null) ?? null, error }
  } catch (error) {
    return {
      draft: null,
      error: {
        code: 'PGRST205',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

export async function updateAssessmentDraft<TContent>(
  supabase: SupabaseLike,
  draftId: string,
  expectedVersion: number,
  userId: string,
  content: TContent
): Promise<{ draft: AssessmentDraftRow<TContent> | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('assessment_drafts')
      .update({
        content,
        version: expectedVersion + 1,
        updated_by: userId,
      })
      .eq('id', draftId)
      .eq('version', expectedVersion)
      .select('*')
      .single()

    return { draft: (data as AssessmentDraftRow<TContent> | null) ?? null, error }
  } catch (error) {
    return {
      draft: null,
      error: {
        code: 'PGRST205',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

type AtomicTestDraftWriteResult =
  | {
      ok: true
      draft: AssessmentDraftRow<TestDraftContent>
      test: Record<string, unknown>
    }
  | { ok: false; status: number; error: string }

type AtomicTestActivationResult =
  | {
      ok: true
      draftVersion: number
      test: Record<string, unknown>
    }
  | { ok: false; status: number; error: string }

type PersistedTestQuestionIdentity = {
  id: string
  artifact_id: string | null
  source_artifact_id: string | null
}

function isMissingAtomicTestDraftRpcError(error: {
  code?: string
}): boolean {
  return error.code === '42883' || error.code === 'PGRST202'
}

async function buildLegacyTestDraftContent(
  supabase: SupabaseLike,
  testId: string,
  content: TestDraftContent,
): Promise<
  | { ok: true; content: TestDraftContent }
  | { ok: false; status: number; error: string }
> {
  const { data, error } = await supabase
    .from('test_questions')
    .select('id, artifact_id, source_artifact_id')
    .eq('test_id', testId)

  if (error) {
    return { ok: false, status: 500, error: 'Failed to load Test question identity' }
  }

  const resolved = resolveTestQuestionIdentities(
    content.questions.map((question) => question.id),
    (data || []) as PersistedTestQuestionIdentity[],
    getTestDraftIdentityResolutionOptions(content),
  )
  if (!resolved.ok) {
    return { ok: false, status: 409, error: 'Test draft question identity is invalid or ambiguous' }
  }

  const { question_identity_version: _identityVersion, ...legacyContent } = content
  return {
    ok: true,
    content: {
      ...legacyContent,
      questions: content.questions.map((question, index) => ({
        ...question,
        // Before migration 134, persisted Test drafts contractually carry row
        // IDs. Draft-only UUIDs remain unchanged so legacy activation inserts
        // that UUID as the new row ID. The migration later converts both forms
        // to their canonical portable identity in one transaction.
        id: resolved.identities[index]!.matchingRowId ?? question.id,
      })),
    },
  }
}

async function syncLegacyTestQuestionsFromDraft(
  supabase: SupabaseLike,
  testId: string,
  content: TestDraftContent,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data: existingRows, error: existingError } = await supabase
    .from('test_questions')
    .select('id')
    .eq('test_id', testId)

  if (existingError) {
    return { ok: false, status: 500, error: 'Failed to load Test questions for activation' }
  }

  const existingIds = new Set<string>(
    (existingRows || []).map((row: { id: string }) => row.id),
  )
  const nextIds = new Set(content.questions.map((question) => question.id))

  for (const [position, question] of content.questions.entries()) {
    const payload = {
      question_type: question.question_type,
      question_text: question.question_text,
      options: question.options,
      correct_option: question.correct_option,
      answer_key: question.answer_key,
      sample_solution: question.sample_solution,
      points: question.points,
      response_max_chars: question.response_max_chars,
      response_monospace: question.response_monospace,
      position,
    }
    if (existingIds.has(question.id)) {
      const { error } = await supabase
        .from('test_questions')
        .update(payload)
        .eq('test_id', testId)
        .eq('id', question.id)
      if (error) {
        return { ok: false, status: 500, error: 'Failed to update Test question for activation' }
      }
      continue
    }

    const { error } = await supabase.from('test_questions').insert({
      id: question.id,
      test_id: testId,
      ...payload,
    })
    if (error) {
      return { ok: false, status: 500, error: 'Failed to insert Test question for activation' }
    }
  }

  for (const existingId of existingIds) {
    if (nextIds.has(existingId)) continue
    const { error } = await supabase
      .from('test_questions')
      .delete()
      .eq('test_id', testId)
      .eq('id', existingId)
    if (error) {
      return { ok: false, status: 500, error: 'Failed to remove Test question for activation' }
    }
  }

  return { ok: true }
}

async function saveTestDraftBeforeIdentityMigration(
  supabase: SupabaseLike,
  input: {
    teacherId: string
    testId: string
    expectedDraftVersion: number
    content: TestDraftContent
    expectedDocuments?: unknown
    documents?: import('@/types').TestDocument[]
  },
): Promise<AtomicTestDraftWriteResult> {
  const { draft, error: draftError } = await getAssessmentDraftByType<TestDraftContent>(
    supabase,
    'test',
    input.testId,
  )
  if (draftError || !draft) {
    return { ok: false, status: 404, error: 'Test draft not found' }
  }
  if (draft.version !== input.expectedDraftVersion) {
    return { ok: false, status: 409, error: 'Draft updated elsewhere' }
  }

  const legacy = await buildLegacyTestDraftContent(supabase, input.testId, input.content)
  if (!legacy.ok) return legacy

  const { draft: updatedDraft, error: updateError } = await updateAssessmentDraft(
    supabase,
    draft.id,
    input.expectedDraftVersion,
    input.teacherId,
    legacy.content,
  )
  if (updateError || !updatedDraft) {
    return { ok: false, status: 409, error: 'Draft updated elsewhere' }
  }

  const { data: currentTest, error: testLoadError } = await supabase
    .from('tests')
    .select('status')
    .eq('id', input.testId)
    .single()
  if (testLoadError || !currentTest) {
    return { ok: false, status: 404, error: 'Test not found' }
  }

  let test: Record<string, unknown> | null = null
  if (input.documents !== undefined) {
    const documentResult = await updateTestDocumentsAtomic({
      supabase,
      teacherId: input.teacherId,
      testId: input.testId,
      expectedStatus: currentTest.status,
      expectedDocuments: input.expectedDocuments,
      proposedDocuments: input.documents,
      title: input.content.title,
      showResults: input.content.show_results,
    })
    if (!documentResult.ok) return documentResult
    test = documentResult.test
  } else {
    const { data, error } = await supabase
      .from('tests')
      .update({
        title: input.content.title.trim(),
        show_results: input.content.show_results,
      })
      .eq('id', input.testId)
      .eq('status', currentTest.status)
      .select()
      .single()
    if (error || !data) {
      return { ok: false, status: 500, error: 'Failed to save draft' }
    }
    test = data as Record<string, unknown>
  }

  return {
    ok: true,
    // Keep the API contract portable even though the temporary stored form is
    // legacy-compatible. Version is the only authored state that changed.
    draft: { ...updatedDraft, content: input.content },
    test,
  }
}

async function activateTestBeforeIdentityMigration(
  supabase: SupabaseLike,
  input: {
    teacherId: string
    testId: string
    expectedDraftVersion: number
  },
): Promise<AtomicTestActivationResult> {
  const { draft, error: draftError } = await getAssessmentDraftByType<TestDraftContent>(
    supabase,
    'test',
    input.testId,
  )
  if (draftError || !draft) {
    return { ok: false, status: 404, error: 'Test draft not found' }
  }
  if (draft.version !== input.expectedDraftVersion) {
    return {
      ok: false,
      status: 409,
      error: 'The Test changed after activation was requested. Review and try again.',
    }
  }

  const legacy = await buildLegacyTestDraftContent(supabase, input.testId, draft.content)
  if (!legacy.ok) return legacy

  // Keep the persisted draft readable by both old and new application
  // instances throughout the pre-migration deployment window. This is an
  // identity-only projection, so it deliberately preserves the draft version.
  const { data: legacyDraft, error: legacyDraftError } = await supabase
    .from('assessment_drafts')
    .update({ content: legacy.content, updated_by: input.teacherId })
    .eq('id', draft.id)
    .eq('version', input.expectedDraftVersion)
    .select('id')
    .single()
  if (legacyDraftError || !legacyDraft) {
    return {
      ok: false,
      status: 409,
      error: 'The Test changed after activation was requested. Review and try again.',
    }
  }

  const synchronized = await syncLegacyTestQuestionsFromDraft(
    supabase,
    input.testId,
    legacy.content,
  )
  if (!synchronized.ok) return synchronized

  const { data: test, error: testError } = await supabase
    .from('tests')
    .update({
      title: legacy.content.title.trim(),
      show_results: legacy.content.show_results,
      status: 'active',
    })
    .eq('id', input.testId)
    .eq('status', 'draft')
    .select()
    .single()
  if (testError || !test) {
    return { ok: false, status: 409, error: 'Only draft Tests can be activated' }
  }

  return {
    ok: true,
    draftVersion: input.expectedDraftVersion,
    test: test as Record<string, unknown>,
  }
}

function getRpcErrorText(error: {
  message?: string
  details?: string | null
  hint?: string | null
}): string {
  return `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase()
}

function mapTestDraftRpcError(
  error: { code?: string; message?: string; details?: string | null; hint?: string | null },
  operation: 'save' | 'activate',
): { ok: false; status: number; error: string } {
  const details = getRpcErrorText(error)
  if (isMissingAtomicTestDraftRpcError(error)) {
    return {
      ok: false,
      status: 503,
      error: `Atomic Test draft ${operation} requires migration 134 to be applied`,
    }
  }
  if (details.includes('draft_version_conflict')) {
    return {
      ok: false,
      status: 409,
      error: operation === 'save'
        ? 'Draft updated elsewhere'
        : 'The Test changed after activation was requested. Review and try again.',
    }
  }
  if (details.includes('test_not_draft')) {
    return {
      ok: false,
      status: 409,
      error: operation === 'save'
        ? 'This Test is no longer a draft'
        : 'Only draft Tests can be activated',
    }
  }
  if (details.includes('document_conflict')) {
    return { ok: false, status: 409, error: 'The test documents changed elsewhere. Reload and try again.' }
  }
  if (details.includes('test_questions_locked')) {
    return {
      ok: false,
      status: 409,
      error: 'Test questions cannot be changed after student work exists',
    }
  }
  if (details.includes('test_archived')) {
    return { ok: false, status: 403, error: 'Classroom is archived' }
  }
  if (details.includes('forbidden')) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }
  if (details.includes('test_not_found') || details.includes('test_draft_not_found')) {
    return { ok: false, status: 404, error: 'Test draft not found' }
  }
  // Check the specific invalid_draft_* codes before the identity-ambiguity
  // bucket below: a naive `includes('invalid_draft')` also matches
  // invalid_draft_version and invalid_draft_content, which are plain
  // validation failures (missing draft_version, empty title, etc.), not an
  // identity conflict, and must not surface the "changed elsewhere" /
  // merge-conflict UI that a 409 with a `draft` payload triggers client-side.
  if (details.includes('invalid_draft_version')) {
    return { ok: false, status: 400, error: 'A valid draft version is required' }
  }
  if (details.includes('invalid_draft_content')) {
    return { ok: false, status: 400, error: 'Draft content is invalid' }
  }
  if (
    details.includes('duplicate_question_identity')
    || details.includes('question_identity_')
  ) {
    return { ok: false, status: 409, error: 'Test draft question identity is invalid or ambiguous' }
  }
  return {
    ok: false,
    status: 500,
    error: operation === 'save' ? 'Failed to save draft' : 'Failed to activate Test',
  }
}

export async function saveTestDraftAtomic(
  supabase: SupabaseLike,
  input: {
    teacherId: string
    testId: string
    expectedDraftVersion: number
    content: TestDraftContent
    expectedDocuments?: unknown
    documents?: import('@/types').TestDocument[]
  },
): Promise<AtomicTestDraftWriteResult> {
  const updatesDocuments = input.documents !== undefined
  const documents = updatesDocuments
    ? preserveCurrentTestDocumentSnapshots(input.expectedDocuments, input.documents || [])
    : []
  const { data, error } = await supabase.rpc('save_test_draft_atomic', {
    p_content: input.content,
    p_documents: documents,
    p_expected_documents: input.expectedDocuments ?? [],
    p_expected_draft_version: input.expectedDraftVersion,
    p_teacher_id: input.teacherId,
    p_test_id: input.testId,
    p_update_documents: updatesDocuments,
  })

  if (error) {
    if (isMissingAtomicTestDraftRpcError(error)) {
      return saveTestDraftBeforeIdentityMigration(supabase, input)
    }
    return mapTestDraftRpcError(error, 'save')
  }

  const result = data as {
    cleanup_paths?: unknown
    draft?: AssessmentDraftRow<TestDraftContent>
    test?: Record<string, unknown>
  } | null
  if (!result?.draft || !result.test) {
    return { ok: false, status: 500, error: 'Failed to save draft' }
  }

  for (const storagePath of parseCleanupPaths(result.cleanup_paths)) {
    try {
      await removeQueuedTestDocumentSnapshotPath({ supabase, storagePath })
    } catch (cleanupError) {
      console.error('Failed to run immediate test snapshot cleanup:', {
        storagePath,
        cleanupError,
      })
    }
  }

  return { ok: true, draft: result.draft, test: result.test }
}

export async function activateTestFromDraftAtomic(
  supabase: SupabaseLike,
  input: {
    teacherId: string
    testId: string
    expectedDraftVersion: number
  },
): Promise<AtomicTestActivationResult> {
  const { data, error } = await supabase.rpc('activate_test_from_draft_atomic', {
    p_expected_draft_version: input.expectedDraftVersion,
    p_teacher_id: input.teacherId,
    p_test_id: input.testId,
  })

  if (error) {
    if (isMissingAtomicTestDraftRpcError(error)) {
      return activateTestBeforeIdentityMigration(supabase, input)
    }
    return mapTestDraftRpcError(error, 'activate')
  }

  const result = data as {
    draft_version?: unknown
    test?: Record<string, unknown>
  } | null
  const draftVersion = Number(result?.draft_version)
  if (!result?.test || !Number.isInteger(draftVersion) || draftVersion < 1) {
    return { ok: false, status: 500, error: 'Failed to activate Test' }
  }

  return { ok: true, draftVersion, test: result.test }
}

// ────────────────────────────────────────────────────────────────────────────
// Generic helpers shared by assessment draft routes
// ────────────────────────────────────────────────────────────────────────────

export type EnsureDraftConfig<TContent> = {
  /** Assessment type string used in DB. */
  assessmentType: AssessmentDraftType
  /** The parent assessment record */
  assessment: { id: string; classroom_id: string; title: string; show_results: boolean }
  /** User performing the operation */
  userId: string
  /** Name of the questions table. */
  questionsTable: string
  /** Foreign-key column in the questions table. */
  questionsForeignKey: string
  /** Columns to select from the questions table */
  questionsSelect: string
  /** Validate draft content; extra options forwarded as `opts` */
  validateContent: (
    input: unknown,
    opts?: { allowEmptyQuestionText?: boolean },
  ) => AssessmentDraftValidationResult<TContent>
  validateOptions?: { allowEmptyQuestionText?: boolean }
  /** Build a fresh draft from the assessment + questions rows */
  buildFromRows: (
    assessment: { id: string; classroom_id: string; title: string; show_results: boolean },
    rows: unknown[]
  ) => TContent
  /** Read-only projection from exact persisted identities into portable draft IDs. */
  projectContent?: (
    content: TContent,
    rows: unknown[],
  ) => { ok: true; content: TContent } | { ok: false }
  /**
   * Treat persisted rows as authoritative when reopening an already materialized
   * assessment. The returned draft keeps its optimistic-lock version, but its
   * content is rebuilt from the rows instead of trusting a stale pre-activation
   * draft snapshot.
   */
  preferPersistedRows?: boolean
}

/**
 * Ensures an assessment draft exists and is valid; creates/repairs it if not.
 * Shared by assessment draft routes to eliminate duplication.
 */
export async function ensureAssessmentDraft<TContent>(
  supabase: SupabaseLike,
  config: EnsureDraftConfig<TContent>
): Promise<
  | { ok: true; draft: AssessmentDraftRow<TContent> }
  | { ok: false; status: number; error: string }
> {
  const {
    assessment, assessmentType, userId,
    questionsTable, questionsForeignKey, questionsSelect,
    validateContent, validateOptions, buildFromRows, projectContent,
    preferPersistedRows = false,
  } = config

  const { draft, error } = await getAssessmentDraftByType<TContent>(
    supabase, assessmentType, assessment.id
  )

  // TODO(cleanup-045): Remove this fallback once migration 045 is confirmed everywhere.
  if (isMissingAssessmentDraftsError(error)) {
    return {
      ok: false,
      status: 400,
      error: 'Assessment drafts require migration 045 to be applied',
    }
  }

  if (error) {
    console.error(`Error fetching ${assessmentType} draft:`, error)
    return { ok: false, status: 500, error: 'Failed to fetch draft' }
  }

  const validDraft = draft
    ? validateContent(draft.content, validateOptions)
    : null
  if (draft && validDraft?.valid && !projectContent && !preferPersistedRows) {
    return { ok: true, draft: { ...draft, content: validDraft.value } }
  }

  const { data: questions, error: questionsError } = await supabase
    .from(questionsTable)
    .select(questionsSelect)
    .eq(questionsForeignKey, assessment.id)
    .order('position', { ascending: true })

  if (questionsError) {
    console.error(`Error building baseline ${assessmentType} draft:`, questionsError)
    return { ok: false, status: 500, error: 'Failed to build draft' }
  }

  if (draft && preferPersistedRows) {
    return {
      ok: true,
      draft: {
        ...draft,
        content: buildFromRows(assessment, questions || []),
      },
    }
  }

  if (draft && validDraft?.valid && projectContent) {
    const projected = projectContent(validDraft.value, questions || [])
    if (!projected.ok) {
      return { ok: false, status: 409, error: 'Test draft question identity is ambiguous' }
    }
    return { ok: true, draft: { ...draft, content: projected.content } }
  }

  const content = buildFromRows(assessment, questions || [])

  if (draft) {
    const { draft: updatedDraft, error: updateError } = await updateAssessmentDraft(
      supabase, draft.id, draft.version, userId, content
    )
    if (updateError || !updatedDraft) {
      console.error(`Error repairing ${assessmentType} draft:`, updateError)
      return { ok: false, status: 500, error: 'Failed to update draft' }
    }
    return { ok: true, draft: updatedDraft }
  }

  const { draft: createdDraft, error: createError } = await createAssessmentDraft(supabase, {
    assessmentType,
    assessmentId: assessment.id,
    classroomId: assessment.classroom_id,
    userId,
    content,
  })

  if (createError?.code === '23505') {
    const raced = await getAssessmentDraftByType<TContent>(supabase, assessmentType, assessment.id)
    if (raced.draft) return { ok: true, draft: raced.draft }
  }

  if (createError || !createdDraft) {
    console.error(`Error creating ${assessmentType} draft:`, createError)
    return { ok: false, status: 500, error: 'Failed to create draft' }
  }

  return { ok: true, draft: createdDraft }
}
