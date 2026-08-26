import { tryApplyJsonPatch } from '@/lib/json-patch'
import { preserveCurrentTestDocumentSnapshots } from '@/lib/test-documents'
import { removeQueuedTestDocumentSnapshotPath } from '@/lib/server/test-document-snapshot-storage-cleanup'
import {
  getPortableTestQuestionIdentity,
  resolveTestQuestionIdentities,
  type PersistedTestQuestionIdentity,
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
  if (error.code === '42883' || error.code === 'PGRST202') {
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
  if (
    details.includes('invalid_draft')
    || details.includes('duplicate_question_identity')
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

function parseCleanupPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((path): path is string => (
    typeof path === 'string' && path.startsWith('link-docs/')
  ))
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

  if (error) return mapTestDraftRpcError(error, 'save')

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

  if (error) return mapTestDraftRpcError(error, 'activate')

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

export async function syncTestQuestionsFromDraft(
  supabase: SupabaseLike,
  testId: string,
  content: TestDraftContent
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  return syncAssessmentQuestionRowsFromDraft(supabase, {
    table: 'test_questions',
    foreignKey: 'test_id',
    parentId: testId,
    questions: content.questions,
    existingColumns: 'id, artifact_id, source_artifact_id',
    buildUpdatePayload: (question, position) => ({
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
    }),
    buildInsertPayload: (question, position) => ({
      test_id: testId,
      // A new row gets an independent database ID. The draft UUID is the
      // stable identity carried into Blueprints, Versions, and Classrooms.
      artifact_id: question.id,
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
    }),
    errorMessages: {
      load: 'Failed to load test questions for sync',
      update: 'Failed to update synced test question',
      insert: 'Failed to insert synced test question',
      delete: 'Failed to delete removed test question',
      identity: 'Test draft question identity is ambiguous or requires backfill',
    },
  })
}

type SyncAssessmentQuestionRowsConfig<TQuestion extends { id: string }> = {
  table: string
  foreignKey: string
  parentId: string
  questions: TQuestion[]
  existingColumns: string
  buildUpdatePayload: (question: TQuestion, position: number) => Record<string, unknown>
  buildInsertPayload: (question: TQuestion, position: number) => Record<string, unknown>
  errorMessages: {
    load: string
    update: string
    insert: string
    delete: string
    identity: string
  }
}

async function syncAssessmentQuestionRowsFromDraft<TQuestion extends { id: string }>(
  supabase: SupabaseLike,
  config: SyncAssessmentQuestionRowsConfig<TQuestion>
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data: existingRows, error: existingError } = await supabase
    .from(config.table)
    .select(config.existingColumns)
    .eq(config.foreignKey, config.parentId)

  if (existingError) {
    return { ok: false, status: 500, error: config.errorMessages.load }
  }

  const rows = (existingRows || []) as PersistedTestQuestionIdentity[]
  const existingIds = new Set<string>(rows.map((row) => row.id))
  const identityResolution = resolveTestQuestionIdentities(
    config.questions.map((question) => question.id),
    rows,
  )
  if (!identityResolution.ok) {
    return { ok: false, status: 409, error: config.errorMessages.identity }
  }

  const matchedExistingIds = new Set<string>()
  const resolvedQuestions: Array<{
    question: TQuestion
    position: number
    matchingRowId?: string
  }> = []

  for (const [position, question] of config.questions.entries()) {
    const identity = identityResolution.identities[position]!
    if (identity.matchingRowId) matchedExistingIds.add(identity.matchingRowId)
    resolvedQuestions.push({
      question: { ...question, id: identity.portableId },
      position,
      matchingRowId: identity.matchingRowId,
    })
  }

  // Resolve the complete identity graph before changing content so a later
  // ambiguity cannot leave earlier rows partially synchronized.
  for (const { question, position, matchingRowId } of resolvedQuestions) {
    if (matchingRowId) {
      const { error } = await supabase
        .from(config.table)
        .update(config.buildUpdatePayload(question, position))
        .eq(config.foreignKey, config.parentId)
        .eq('id', matchingRowId)

      if (error) {
        return { ok: false, status: 500, error: config.errorMessages.update }
      }
      continue
    }

    const { error } = await supabase.from(config.table).insert(config.buildInsertPayload(question, position))

    if (error) {
      return { ok: false, status: 500, error: config.errorMessages.insert }
    }
  }

  for (const existingId of existingIds) {
    if (matchedExistingIds.has(existingId)) continue

    const { error } = await supabase
      .from(config.table)
      .delete()
      .eq(config.foreignKey, config.parentId)
      .eq('id', existingId)

    if (error) {
      return { ok: false, status: 500, error: config.errorMessages.delete }
    }
  }

  return { ok: true }
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
