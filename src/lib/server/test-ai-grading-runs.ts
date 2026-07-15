import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from '@/lib/api-handler'
import {
  getTestOpenResponseGradingModel,
  isRetryableTestAiGradingError,
  prepareTestOpenResponseGradingContext,
  resolveReusableTestOpenResponseReferenceAnswers,
  suggestTestOpenResponseGradeWithContext,
  suggestTestOpenResponseGradesBatchWithContext,
} from '@/lib/ai-test-grading'
import type { AiSanitizationContext } from '@/lib/ai-sanitization'
import { loadClassroomAiSanitizationContext } from '@/lib/server/ai-sanitization'
import {
  finalizeTestAiGradingItem,
  renewTestAiGradingRunLease,
  setTestAiGradingItemState,
  TestAiGradingLeaseLostError,
} from '@/lib/server/test-grades'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  isMissingTestAttemptReturnColumnsError,
  isMissingTestResponseAiColumnsError,
} from '@/lib/server/tests'
import type {
  TestAiGradingRun,
  TestAiGradingRunErrorSample,
  TestAiGradingRunItem,
  TestAiGradingRunStatus,
  TestAiGradingRunSummary,
} from '@/types'
import type { Json } from '@/types/database.generated'
import {
  buildTestQuestionGradingSnapshot,
  hasPersistedTestResponseGrade,
} from '@/lib/test-grading-context'

const TEST_AI_RETRY_BACKOFF_SECONDS = [7, 20, 45]
export const TEST_AI_GRADING_RUN_CHUNK_SIZE = 8
export const TEST_AI_GRADING_QUESTION_CONCURRENCY = 2
export const TEST_AI_GRADING_MICROBATCH_SIZE = 4
export const TEST_AI_GRADING_REQUEST_TIMEOUT_MS = 25_000
export const TEST_AI_GRADING_MAX_ATTEMPTS = 3
export const TEST_AI_GRADING_LEASE_SECONDS = 120

type ServiceRoleSupabase = ReturnType<typeof getServiceRoleClient>

type CreateTestAiGradingRunResult =
  | { kind: 'created'; run: TestAiGradingRunSummary }
  | { kind: 'resumed'; run: TestAiGradingRunSummary }
  | { kind: 'conflict'; run: TestAiGradingRunSummary }
  | { kind: 'noop'; summary: TestAiGradingNoopSummary }

type TickTestAiGradingRunResult = {
  run: TestAiGradingRunSummary
  claimed: boolean
}

export interface TestAiGradingNoopSummary {
  requested_count: number
  eligible_student_count: number
  queued_response_count: number
  skipped_unanswered_count: number
  skipped_already_graded_count: number
  failed_count: number
  message: string
}

type SupabaseSchemaError = {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

type OpenQuestionRow = {
  id: string
  updated_at: string
  question_text: string
  points: number | null
  response_monospace: boolean | null
  answer_key: string | null
  sample_solution: string | null
  ai_reference_cache_key?: string | null
  ai_reference_cache_answers?: unknown
  ai_reference_cache_model?: string | null
}

type PreflightResponseRow = {
  id: string
  student_id: string
  question_id: string
  response_text: string | null
  submitted_at: string | null
  ai_model: string | null
  graded_at: string | null
  score: number | null
  feedback: string | null
  revision: number
}

type QueuedItemSeed = {
  student_id: string
  question_id: string
  response_id: string
  response_revision: number
  queue_position: number
}

const createRunResultSchema = z.object({
  outcome: z.enum(['created', 'existing']),
  run_id: z.string().uuid(),
}).strict().or(z.object({
  outcome: z.literal('noop'),
  run_id: z.null(),
}).strict())

function normalizeStudentIds(studentIds: string[]): string[] {
  return Array.from(
    new Set(
      studentIds
        .filter((studentId) => typeof studentId === 'string' && studentId.trim().length > 0)
        .map((studentId) => studentId.trim()),
    ),
  )
}

function normalizePromptGuidelineOverride(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed || null
}

function buildSelectionHash(studentIds: string[]): string {
  return createHash('sha256').update(normalizeStudentIds(studentIds).join('|')).digest('hex')
}

function mapErrorSamples(rawSamples: unknown): TestAiGradingRunErrorSample[] {
  if (!Array.isArray(rawSamples)) return []

  return rawSamples
    .map((sample) => {
      if (!sample || typeof sample !== 'object') return null
      const record = sample as Record<string, unknown>
      const message = typeof record.message === 'string' ? record.message.trim() : ''
      if (!message) return null

      return {
        student_id: typeof record.student_id === 'string' ? record.student_id : null,
        code: typeof record.code === 'string' ? record.code : null,
        message,
      } satisfies TestAiGradingRunErrorSample
    })
    .filter((sample): sample is TestAiGradingRunErrorSample => !!sample)
}

function isTestAiGradingSchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const record = error as SupabaseSchemaError
  if (record.code === 'PGRST205' || record.code === '42P01') {
    return true
  }

  const combined = `${record.message ?? ''} ${record.details ?? ''} ${record.hint ?? ''}`.toLowerCase()
  return combined.includes('test_ai_grading_run')
}

function getSummaryNextRetryAt(items: TestAiGradingRunItem[]): string | null {
  if (items.length === 0) return null

  const now = Date.now()
  let earliestFutureRetryAt: number | null = null

  for (const item of items) {
    if (item.status !== 'queued' && item.status !== 'processing') {
      continue
    }

    if (!item.next_retry_at) {
      return null
    }

    const retryAt = new Date(item.next_retry_at).getTime()
    if (!Number.isFinite(retryAt) || retryAt <= now) {
      return null
    }

    earliestFutureRetryAt =
      earliestFutureRetryAt == null ? retryAt : Math.min(earliestFutureRetryAt, retryAt)
  }

  return earliestFutureRetryAt == null ? null : new Date(earliestFutureRetryAt).toISOString()
}

export function toTestAiGradingRunSummary(
  run: Partial<TestAiGradingRun> & Pick<TestAiGradingRun, 'id' | 'test_id' | 'status' | 'created_at'>,
  options?: { items?: TestAiGradingRunItem[] },
): TestAiGradingRunSummary {
  const queuedResponseCount = Number(run.queued_response_count ?? 0)
  const processedCount = Number(run.processed_count ?? 0)

  return {
    id: run.id,
    test_id: run.test_id,
    status: run.status,
    model: run.model ?? null,
    prompt_guideline_override: run.prompt_guideline_override ?? null,
    requested_count: Number(run.requested_count ?? 0),
    eligible_student_count: Number(run.eligible_student_count ?? 0),
    queued_response_count: queuedResponseCount,
    processed_count: processedCount,
    completed_count: Number(run.completed_count ?? 0),
    skipped_unanswered_count: Number(run.skipped_unanswered_count ?? 0),
    skipped_already_graded_count: Number(run.skipped_already_graded_count ?? 0),
    failed_count: Number(run.failed_count ?? 0),
    pending_count: Math.max(queuedResponseCount - processedCount, 0),
    next_retry_at: options?.items ? getSummaryNextRetryAt(options.items) : null,
    error_samples: mapErrorSamples(run.error_samples_json),
    started_at: run.started_at ?? null,
    completed_at: run.completed_at ?? null,
    created_at: run.created_at,
  }
}

async function fetchTestAiGradingRunRow(
  supabase: ServiceRoleSupabase,
  runId: string,
): Promise<TestAiGradingRun | null> {
  const { data, error } = await supabase
    .from('test_ai_grading_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle()

  if (error) {
    if (isTestAiGradingSchemaError(error)) {
      return null
    }
    throw new Error('Failed to load test AI grading run')
  }

  return (data as TestAiGradingRun | null) ?? null
}

async function fetchTestAiGradingRunItems(
  supabase: ServiceRoleSupabase,
  runId: string,
): Promise<TestAiGradingRunItem[]> {
  const { data, error } = await supabase
    .from('test_ai_grading_run_items')
    .select('*')
    .eq('run_id', runId)
    .order('queue_position', { ascending: true })

  if (error) {
    if (isTestAiGradingSchemaError(error)) {
      return []
    }
    throw new Error('Failed to load test AI grading run items')
  }

  return (data as TestAiGradingRunItem[]) ?? []
}

async function fetchLatestActiveRun(
  supabase: ServiceRoleSupabase,
  testId: string,
): Promise<TestAiGradingRun | null> {
  const { data, error } = await supabase
    .from('test_ai_grading_runs')
    .select('*')
    .eq('test_id', testId)
    .in('status', ['queued', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) {
    if (isTestAiGradingSchemaError(error)) {
      return null
    }
    throw new Error('Failed to load active test AI grading run')
  }

  return ((data as TestAiGradingRun[] | null) ?? [])[0] ?? null
}

async function loadTestForRun(
  supabase: ServiceRoleSupabase,
  testId: string,
): Promise<{ id: string; title: string; classroom_id: string }> {
  const { data, error } = await supabase
    .from('tests')
    .select('id, title, classroom_id')
    .eq('id', testId)
    .single()

  if (error || !data) {
    throw new Error('Test not found for AI grading run')
  }

  return {
    id: data.id,
    title: typeof data.title === 'string' ? data.title : 'Untitled Test',
    classroom_id: String(data.classroom_id || ''),
  }
}

async function loadOpenQuestionRows(
  supabase: ServiceRoleSupabase,
  testId: string,
): Promise<OpenQuestionRow[]> {
  const { data, error } = await supabase
    .from('test_questions')
    .select('id, updated_at, question_text, points, response_monospace, answer_key, sample_solution, ai_reference_cache_key, ai_reference_cache_answers, ai_reference_cache_model')
    .eq('test_id', testId)
    .eq('question_type', 'open_response')

  if (error) {
    throw new Error('Failed to load test questions for AI grading')
  }

  return ((data as OpenQuestionRow[] | null) ?? []).map((row) => ({
    ...row,
    answer_key: typeof row.answer_key === 'string' ? row.answer_key : null,
    sample_solution: typeof row.sample_solution === 'string' ? row.sample_solution : null,
  }))
}

async function loadOpenResponseRowsForPreflight(
  supabase: ServiceRoleSupabase,
  testId: string,
  studentIds: string[],
  questionIds: string[],
): Promise<PreflightResponseRow[]> {
  let data: unknown = null
  let error: SupabaseSchemaError | null = null

  {
    const result = await supabase
      .from('test_responses')
      .select('id, student_id, question_id, response_text, submitted_at, ai_model, graded_at, score, feedback, revision')
      .eq('test_id', testId)
      .in('student_id', studentIds)
      .in('question_id', questionIds)
    data = result.data
    error = result.error
  }

  if (error && isMissingTestResponseAiColumnsError(error)) {
    const legacyResult = await supabase
      .from('test_responses')
      .select('id, student_id, question_id, response_text, submitted_at, graded_at, score, feedback, revision')
      .eq('test_id', testId)
      .in('student_id', studentIds)
      .in('question_id', questionIds)

    data = ((legacyResult.data as Array<Record<string, unknown>> | null) ?? []).map((row) => ({
      ...row,
      ai_model: null,
    }))
    error = legacyResult.error
  }

  if (error) {
    throw new Error('Failed to load test responses for AI grading')
  }

  return ((data as Array<Record<string, unknown>> | null) ?? []).map((row) => ({
    id: String(row.id),
    student_id: String(row.student_id),
    question_id: String(row.question_id),
    response_text: typeof row.response_text === 'string' ? row.response_text : null,
    submitted_at: typeof row.submitted_at === 'string' ? row.submitted_at : null,
    ai_model: typeof row.ai_model === 'string' ? row.ai_model : null,
    graded_at: typeof row.graded_at === 'string' ? row.graded_at : null,
    score: typeof row.score === 'number' ? row.score : null,
    feedback: typeof row.feedback === 'string' ? row.feedback : null,
    revision: Number(row.revision),
  }))
}

async function loadSubmittedAtByStudent(
  supabase: ServiceRoleSupabase,
  testId: string,
  studentIds: string[],
): Promise<Map<string, string | null>> {
  const submittedAtByStudent = new Map<string, string | null>()
  const { data: attemptRows, error: attemptError } = await supabase
    .from('test_attempts')
    .select('student_id, is_submitted, submitted_at')
    .eq('test_id', testId)
    .in('student_id', studentIds)

  if (attemptError && !isMissingTestAttemptReturnColumnsError(attemptError) && attemptError.code !== 'PGRST205') {
    throw new Error('Failed to load test attempts for AI grading')
  }

  for (const row of attemptRows || []) {
    if (!row.is_submitted) continue
    submittedAtByStudent.set(row.student_id, row.submitted_at || null)
  }

  return submittedAtByStudent
}

function buildNoopSummary(input: {
  requestedCount: number
  eligibleStudentCount: number
  queuedResponseCount?: number
  skippedUnansweredCount: number
  skippedAlreadyGradedCount: number
  message: string
}): TestAiGradingNoopSummary {
  return {
    requested_count: input.requestedCount,
    eligible_student_count: input.eligibleStudentCount,
    queued_response_count: input.queuedResponseCount ?? 0,
    skipped_unanswered_count: input.skippedUnansweredCount,
    skipped_already_graded_count: input.skippedAlreadyGradedCount,
    failed_count: 0,
    message: input.message,
  }
}

async function refreshTestAiGradingRun(
  supabase: ServiceRoleSupabase,
  runId: string,
  options: { leaseToken: string; clearLease?: boolean },
): Promise<TestAiGradingRunSummary> {
  const run = await fetchTestAiGradingRunRow(supabase, runId)
  if (!run) {
    throw new Error('Test AI grading run not found')
  }

  const items = await fetchTestAiGradingRunItems(supabase, runId)
  let completedCount = 0
  let failedCount = 0
  let hasPending = false

  for (const item of items) {
    if (item.status === 'completed') {
      completedCount += 1
      continue
    }
    if (item.status === 'failed') {
      failedCount += 1
      continue
    }
    hasPending = true
  }

  const processedCount = completedCount + failedCount
  let nextStatus: TestAiGradingRunStatus = run.status

  if (hasPending) {
    nextStatus = 'running'
  } else if (failedCount > 0) {
    nextStatus = 'completed_with_errors'
  } else {
    nextStatus = 'completed'
  }

  const errorSamples = items
    .filter((item) => item.status === 'failed' && item.last_error_message)
    .slice(0, 3)
    .map((item) => ({
      student_id: item.student_id,
      code: item.last_error_code,
      message: item.last_error_message || 'AI grading failed',
    }))

  const { data, error } = await supabase
    .from('test_ai_grading_runs')
    .update({
      status: nextStatus,
      processed_count: processedCount,
      completed_count: completedCount,
      failed_count: failedCount,
      error_samples_json: errorSamples,
      completed_at: hasPending ? null : run.completed_at ?? new Date().toISOString(),
      lease_token: options.clearLease ? null : run.lease_token,
      lease_expires_at: options.clearLease ? null : run.lease_expires_at,
    })
    .eq('id', runId)
    .eq('lease_token', options.leaseToken)
    .gt('lease_expires_at', new Date().toISOString())
    .select('*')
    .maybeSingle()

  if (error || !data) {
    if (isTestAiGradingSchemaError(error)) {
      throw new Error('Test AI grading run tables are unavailable. Apply migration 055.')
    }
    if (error) throw new Error('Failed to refresh test AI grading run summary')
    throw new TestAiGradingLeaseLostError()
  }

  return toTestAiGradingRunSummary(data as TestAiGradingRun, { items })
}

async function claimTestAiGradingRun(
  supabase: ServiceRoleSupabase,
  runId: string,
): Promise<string | null> {
  const leaseToken = randomUUID()
  const { data, error } = await supabase.rpc('claim_test_ai_grading_run', {
    p_run_id: runId,
    p_lease_token: leaseToken,
    p_lease_seconds: TEST_AI_GRADING_LEASE_SECONDS,
  })

  if (error) {
    if (isTestAiGradingSchemaError(error)) {
      throw new Error('Test AI grading run tables are unavailable. Apply migration 055.')
    }
    throw new Error('Failed to claim test AI grading run lease')
  }

  if (Array.isArray(data)) {
    return data.length > 0 ? leaseToken : null
  }

  return data ? leaseToken : null
}

async function updateRunItem(
  itemId: string,
  leaseToken: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await setTestAiGradingItemState({
    itemId,
    leaseToken,
    status: payload.status as 'queued' | 'processing' | 'failed',
    attemptCount: Number(payload.attempt_count ?? 0),
    nextRetryAt: typeof payload.next_retry_at === 'string' ? payload.next_retry_at : null,
    lastErrorCode: typeof payload.last_error_code === 'string' ? payload.last_error_code : null,
    lastErrorMessage: typeof payload.last_error_message === 'string' ? payload.last_error_message : null,
    startedAt: typeof payload.started_at === 'string' ? payload.started_at : null,
    completedAt: typeof payload.completed_at === 'string' ? payload.completed_at : null,
    questionGradingSnapshot:
      payload.question_grading_snapshot &&
      typeof payload.question_grading_snapshot === 'object' &&
      !Array.isArray(payload.question_grading_snapshot)
        ? payload.question_grading_snapshot as Json
        : null,
  })
}

async function persistSuggestionForResponse(opts: {
  item: TestAiGradingRunItem
  leaseToken: string
  teacherId: string
  attemptCount: number
  suggestion: {
    score: number
    feedback: string
    model: string
    grading_basis: 'teacher_key' | 'generated_reference'
    reference_answers: string[]
  }
}): Promise<void> {
  const result = await finalizeTestAiGradingItem({
    itemId: opts.item.id,
    teacherId: opts.teacherId,
    leaseToken: opts.leaseToken,
    score: opts.suggestion.score,
    feedback: opts.suggestion.feedback,
    aiModel: opts.suggestion.model,
    aiGradingBasis: opts.suggestion.grading_basis,
    aiReferenceAnswers:
      opts.suggestion.grading_basis === 'generated_reference'
        ? opts.suggestion.reference_answers
        : null,
    attemptCount: opts.attemptCount,
  })
  if (result.outcome === 'stale') return
}

function getNextRetryAt(attemptCount: number): string {
  const seconds = TEST_AI_RETRY_BACKOFF_SECONDS[Math.min(attemptCount - 1, TEST_AI_RETRY_BACKOFF_SECONDS.length - 1)]
  return new Date(Date.now() + seconds * 1000).toISOString()
}

function toTeacherAutoGradeErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'kind' in error &&
    (error as { kind?: string }).kind === 'config'
  ) {
    return 'AI grading is not configured.'
  }

  const message = error instanceof Error ? error.message.trim() : ''
  if (!message) {
    return 'AI grading failed for this response. Try again.'
  }

  if (
    message.startsWith('OpenAI request failed') ||
    message.startsWith('OpenAI returned invalid JSON') ||
    message === 'OpenAI response missing structured output' ||
    message === 'OpenAI response incomplete: max_output_tokens' ||
    message === 'Failed to parse AI grade suggestion' ||
    message === 'Failed to parse AI batch grade suggestions' ||
    message === 'Failed to parse AI reference answers' ||
    message.startsWith('AI batch grade suggestion omitted response')
  ) {
    return 'AI grading service failed for this response. Try again.'
  }

  return message
}

function isBatchOmittedResponseError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('AI batch grade suggestion omitted response')
}

function getRunItemErrorCode(error: unknown): string {
  if (isBatchOmittedResponseError(error)) return 'invalid_output'
  return error instanceof Error && 'kind' in error && typeof error.kind === 'string'
    ? error.kind
    : 'internal'
}

async function failOrRetryItem(opts: {
  item: TestAiGradingRunItem
  leaseToken: string
  attemptCount: number
  error: unknown
}): Promise<void> {
  const teacherMessage = toTeacherAutoGradeErrorMessage(opts.error)
  const retryable = isRetryableTestAiGradingError(opts.error) || isBatchOmittedResponseError(opts.error)

  if (retryable && opts.attemptCount < TEST_AI_GRADING_MAX_ATTEMPTS) {
    await updateRunItem(opts.item.id, opts.leaseToken, {
      status: 'queued',
      attempt_count: opts.attemptCount,
      last_error_code: getRunItemErrorCode(opts.error),
      last_error_message: teacherMessage,
      next_retry_at: getNextRetryAt(opts.attemptCount),
      completed_at: null,
    })
    return
  }

  await updateRunItem(opts.item.id, opts.leaseToken, {
    status: 'failed',
    attempt_count: opts.attemptCount,
    last_error_code: getRunItemErrorCode(opts.error),
    last_error_message: teacherMessage,
    completed_at: new Date().toISOString(),
  })
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0

  async function processNext() {
    while (index < items.length) {
      const currentIndex = index
      index += 1
      await worker(items[currentIndex])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => processNext()),
  )
}

export async function createOrResumeTestAiGradingRun(opts: {
  testId: string
  teacherId: string
  studentIds: string[]
  promptGuidelineOverride?: string | null
}): Promise<CreateTestAiGradingRunResult> {
  const supabase = getServiceRoleClient()
  const normalizedStudentIds = normalizeStudentIds(opts.studentIds)
  const promptGuidelineOverride = normalizePromptGuidelineOverride(opts.promptGuidelineOverride)
  const selectionHash = buildSelectionHash(normalizedStudentIds)
  const model = getTestOpenResponseGradingModel()
  const activeRun = await fetchLatestActiveRun(supabase, opts.testId)

  if (activeRun) {
    const items = await fetchTestAiGradingRunItems(supabase, activeRun.id)
    const summary = toTestAiGradingRunSummary(activeRun, { items })
    if (
      activeRun.selection_hash === selectionHash &&
      (activeRun.prompt_guideline_override ?? null) === promptGuidelineOverride &&
      (activeRun.model ?? null) === model
    ) {
      return { kind: 'resumed', run: summary }
    }
    return { kind: 'conflict', run: summary }
  }

  const test = await loadTestForRun(supabase, opts.testId)
  const openQuestions = await loadOpenQuestionRows(supabase, opts.testId)
  if (openQuestions.length === 0) {
    return {
      kind: 'noop',
      summary: buildNoopSummary({
        requestedCount: normalizedStudentIds.length,
        eligibleStudentCount: 0,
        skippedUnansweredCount: 0,
        skippedAlreadyGradedCount: 0,
        message: 'This test has no open-response questions to auto-grade.',
      }),
    }
  }

  const openQuestionIds = openQuestions.map((question) => question.id)
  const responses = await loadOpenResponseRowsForPreflight(
    supabase,
    opts.testId,
    normalizedStudentIds,
    openQuestionIds,
  )
  const submittedAtByStudent = await loadSubmittedAtByStudent(
    supabase,
    opts.testId,
    normalizedStudentIds,
  )
  const eligibleStudentIds = normalizedStudentIds.filter((studentId) => submittedAtByStudent.has(studentId))

  const responseByStudentQuestion = new Map<string, PreflightResponseRow>()
  for (const response of responses) {
    responseByStudentQuestion.set(`${response.student_id}:${response.question_id}`, response)
  }

  const unansweredRows: Array<{
    question_id: string
    student_id: string
    response_id: string | null
    expected_response_revision: number | null
    submitted_at: string | null
  }> = []
  const queuedItems: QueuedItemSeed[] = []
  let skippedUnansweredCount = 0
  let skippedAlreadyGradedCount = 0

  for (const studentId of normalizedStudentIds) {
    if (!submittedAtByStudent.has(studentId)) continue
    const submittedAt = submittedAtByStudent.get(studentId) || new Date().toISOString()

    for (const question of openQuestions) {
      const existing = responseByStudentQuestion.get(`${studentId}:${question.id}`)
      if (!existing) {
        unansweredRows.push({
          question_id: question.id,
          student_id: studentId,
          response_id: null,
          expected_response_revision: null,
          submitted_at: submittedAt,
        })
        skippedUnansweredCount += 1
        continue
      }

      const responseText = typeof existing.response_text === 'string' ? existing.response_text.trim() : ''
      if (!responseText) {
        if (hasPersistedTestResponseGrade(existing)) {
          skippedAlreadyGradedCount += 1
          continue
        }
        unansweredRows.push({
          question_id: question.id,
          student_id: studentId,
          response_id: existing.id,
          expected_response_revision: existing.revision,
          submitted_at: null,
        })
        skippedUnansweredCount += 1
        continue
      }

      const alreadyAiGraded =
        promptGuidelineOverride == null &&
        existing.ai_model === model &&
        existing.graded_at != null &&
        existing.score != null
      if (alreadyAiGraded) {
        skippedAlreadyGradedCount += 1
        continue
      }

      queuedItems.push({
        student_id: studentId,
        question_id: question.id,
        response_id: existing.id,
        response_revision: existing.revision,
        queue_position: queuedItems.length,
      })
    }
  }

  const { data: createResult, error: runError } = await supabase.rpc(
    'create_test_ai_grading_run_atomic',
    {
      p_test_id: opts.testId,
      p_teacher_id: opts.teacherId,
      p_model: model,
      p_requested_student_ids: normalizedStudentIds,
      p_eligible_student_ids: eligibleStudentIds,
      p_selection_hash: selectionHash,
      p_eligible_student_count: eligibleStudentIds.length,
      p_skipped_unanswered_count: skippedUnansweredCount,
      p_skipped_already_graded_count: skippedAlreadyGradedCount,
      p_item_rows: queuedItems,
      p_unanswered_rows: unansweredRows,
      ...(promptGuidelineOverride === null
        ? {}
        : { p_prompt_guideline_override: promptGuidelineOverride }),
    },
  )

  if (runError) {
    if (isTestAiGradingSchemaError(runError)) {
      throw new Error('Test AI grading run tables are unavailable. Apply migration 055.')
    }
    if (runError.code === '40001') throw new ApiError(409, runError.message)
    if (runError.code === '42501') throw new ApiError(403, runError.message)
    if (runError.code === '22023' || runError.code === '22P02') {
      throw new ApiError(400, runError.message)
    }
    throw new Error('Failed to create test AI grading run')
  }
  const parsedCreateResult = createRunResultSchema.safeParse(createResult)
  if (!parsedCreateResult.success) {
    throw new Error('Invalid test AI grading run creation result')
  }

  if (parsedCreateResult.data.outcome === 'noop') {
    const eligibleStudentCount = eligibleStudentIds.length
    const message =
      eligibleStudentCount === 0
        ? 'Selected students have not submitted this test yet.'
        : skippedAlreadyGradedCount > 0 || skippedUnansweredCount > 0
          ? 'No AI grading was needed for this selection.'
          : 'No submitted open responses were eligible for AI grading.'
    return {
      kind: 'noop',
      summary: buildNoopSummary({
        requestedCount: normalizedStudentIds.length,
        eligibleStudentCount,
        skippedUnansweredCount,
        skippedAlreadyGradedCount,
        message,
      }),
    }
  }

  const run = await fetchTestAiGradingRunRow(supabase, parsedCreateResult.data.run_id)
  if (!run || run.test_id !== opts.testId) throw new Error('Created test AI grading run was not found')
  const items = await fetchTestAiGradingRunItems(supabase, run.id)
  const summary = toTestAiGradingRunSummary(run, { items })

  if (parsedCreateResult.data.outcome === 'existing') {
    if (
      run.selection_hash === selectionHash &&
      (run.prompt_guideline_override ?? null) === promptGuidelineOverride &&
      (run.model ?? null) === model
    ) {
      return { kind: 'resumed', run: summary }
    }
    return { kind: 'conflict', run: summary }
  }

  return {
    kind: 'created',
    run: summary,
  }
}

export async function getTestAiGradingRunSummary(opts: {
  testId: string
  runId: string
}): Promise<TestAiGradingRunSummary | null> {
  const supabase = getServiceRoleClient()
  const run = await fetchTestAiGradingRunRow(supabase, opts.runId)
  if (!run || run.test_id !== opts.testId) {
    return null
  }

  const items = await fetchTestAiGradingRunItems(supabase, run.id)
  return toTestAiGradingRunSummary(run, { items })
}

export async function getActiveTestAiGradingRunSummary(
  testId: string,
): Promise<TestAiGradingRunSummary | null> {
  const supabase = getServiceRoleClient()
  const run = await fetchLatestActiveRun(supabase, testId)
  if (!run) return null

  const items = await fetchTestAiGradingRunItems(supabase, run.id)
  return toTestAiGradingRunSummary(run, { items })
}

async function processQuestionBatch(opts: {
  supabase: ServiceRoleSupabase
  run: TestAiGradingRun
  leaseToken: string
  testTitle: string
  question: OpenQuestionRow
  items: TestAiGradingRunItem[]
  responsesById: Map<string, { id: string; response_text: string | null }>
  sanitizationContext?: AiSanitizationContext | null
}): Promise<void> {
  const { supabase, run, leaseToken, testTitle, question, items, responsesById, sanitizationContext } = opts
  const model = run.model ?? getTestOpenResponseGradingModel()
  await renewTestAiGradingRunLease({
    runId: run.id,
    leaseToken,
    leaseSeconds: TEST_AI_GRADING_LEASE_SECONDS,
  })
  const cacheResolution = resolveReusableTestOpenResponseReferenceAnswers({
    testTitle,
    questionText: String(question.question_text || ''),
    maxPoints: Number(question.points ?? 0),
    model,
    isCodingQuestion: question.response_monospace === true,
    cacheKey: typeof question.ai_reference_cache_key === 'string' ? question.ai_reference_cache_key : null,
    cacheAnswers: question.ai_reference_cache_answers,
    cacheModel: typeof question.ai_reference_cache_model === 'string' ? question.ai_reference_cache_model : null,
  })

  let prepared
  try {
    prepared = await prepareTestOpenResponseGradingContext({
      testTitle,
      questionText: String(question.question_text || ''),
      maxPoints: Number(question.points ?? 0),
      responseMonospace: question.response_monospace === true,
      answerKey: question.answer_key,
      sampleSolution: question.sample_solution,
      referenceAnswers: cacheResolution.referenceAnswers,
      promptGuidelineOverride: run.prompt_guideline_override,
      promptProfile: 'bulk',
      telemetryContext: {
        feature: 'test_auto_grade',
        requestedStrategy: 'background_chunked',
        resolvedStrategy: 'background_chunked',
        runId: run.id,
      },
      requestTimeoutMs: TEST_AI_GRADING_REQUEST_TIMEOUT_MS,
      sanitizationContext,
    })

    if (
      prepared.grading_basis === 'generated_reference' &&
      prepared.reference_answers_source === 'generated'
    ) {
      const { error: cacheUpdateError } = await supabase
        .from('test_questions')
        .update({
          ai_reference_cache_key: cacheResolution.expectedCacheKey,
          ai_reference_cache_answers: prepared.reference_answers,
          ai_reference_cache_model: prepared.model,
          ai_reference_cache_generated_at: new Date().toISOString(),
        })
        .eq('id', question.id)
        .eq('test_id', run.test_id)
        .eq('updated_at', question.updated_at)

      if (cacheUpdateError) {
        console.error('Error caching generated reference answers for test grading run:', {
          runId: run.id,
          questionId: question.id,
          error: cacheUpdateError,
        })
      }
    }
  } catch (error) {
    await mapWithConcurrency(items, TEST_AI_GRADING_MICROBATCH_SIZE, async (item) => {
      const attemptCount = item.attempt_count + 1
      await updateRunItem(item.id, leaseToken, {
        status: 'processing',
        started_at: item.started_at ?? new Date().toISOString(),
        next_retry_at: null,
        completed_at: null,
        question_grading_snapshot: buildTestQuestionGradingSnapshot({ testTitle, question }),
      })
      await failOrRetryItem({ item, leaseToken, attemptCount, error })
    })
    return
  }

  for (let start = 0; start < items.length; start += TEST_AI_GRADING_MICROBATCH_SIZE) {
    const batchItems = items.slice(start, start + TEST_AI_GRADING_MICROBATCH_SIZE)
    const attempts = new Map<string, number>()
    const now = new Date().toISOString()

    for (const item of batchItems) {
      const attemptCount = item.attempt_count + 1
      attempts.set(item.id, attemptCount)
      await updateRunItem(item.id, leaseToken, {
        status: 'processing',
        started_at: item.started_at ?? now,
        next_retry_at: null,
        completed_at: null,
        question_grading_snapshot: buildTestQuestionGradingSnapshot({ testTitle, question }),
      })
    }

    const batchRequests = batchItems.map((item) => {
      const response = responsesById.get(item.response_id)
      return {
        item,
        responseText: typeof response?.response_text === 'string' ? response.response_text.trim() : '',
      }
    })

    const activeBatchRequests = batchRequests.filter((entry) => entry.responseText)
    const missingResponseEntries = batchRequests.filter((entry) => !entry.responseText)
    if (missingResponseEntries.length > 0) {
      for (const entry of missingResponseEntries) {
        await failOrRetryItem({
          item: entry.item,
          leaseToken,
          attemptCount: attempts.get(entry.item.id) ?? entry.item.attempt_count + 1,
          error: new Error('Response is no longer available for grading'),
        })
      }
    }

    if (activeBatchRequests.length === 0) {
      continue
    }

    try {
      if (activeBatchRequests.length === 1) {
        const only = activeBatchRequests[0]
        await renewTestAiGradingRunLease({
          runId: run.id,
          leaseToken,
          leaseSeconds: TEST_AI_GRADING_LEASE_SECONDS,
        })
        const suggestion = await suggestTestOpenResponseGradeWithContext(
          prepared,
          only.responseText,
          {
            feature: 'test_auto_grade',
            requestedStrategy: 'background_chunked',
            resolvedStrategy: 'single',
            runId: run.id,
            studentId: only.item.student_id,
            attempt: attempts.get(only.item.id) ?? null,
          },
          TEST_AI_GRADING_REQUEST_TIMEOUT_MS,
        )

        await renewTestAiGradingRunLease({
          runId: run.id,
          leaseToken,
          leaseSeconds: TEST_AI_GRADING_LEASE_SECONDS,
        })

        await persistSuggestionForResponse({
          item: only.item,
          leaseToken,
          teacherId: run.triggered_by,
          attemptCount: attempts.get(only.item.id) ?? only.item.attempt_count + 1,
          suggestion,
        })
        continue
      }

      await renewTestAiGradingRunLease({
        runId: run.id,
        leaseToken,
        leaseSeconds: TEST_AI_GRADING_LEASE_SECONDS,
      })
      const suggestions = await suggestTestOpenResponseGradesBatchWithContext(
        prepared,
        activeBatchRequests.map((entry) => ({
          responseId: entry.item.response_id,
          responseText: entry.responseText,
        })),
        {
          feature: 'test_auto_grade',
          requestedStrategy: 'background_chunked',
          resolvedStrategy: 'batch',
          runId: run.id,
        },
        TEST_AI_GRADING_REQUEST_TIMEOUT_MS,
      )

      await renewTestAiGradingRunLease({
        runId: run.id,
        leaseToken,
        leaseSeconds: TEST_AI_GRADING_LEASE_SECONDS,
      })

      const suggestionByResponseId = new Map(
        suggestions.map((suggestion) => [suggestion.responseId, suggestion]),
      )

      for (const entry of activeBatchRequests) {
        const suggestion = suggestionByResponseId.get(entry.item.response_id)
        if (!suggestion) {
          await failOrRetryItem({
            item: entry.item,
            leaseToken,
            attemptCount: attempts.get(entry.item.id) ?? entry.item.attempt_count + 1,
            error: new Error(`AI batch grade suggestion omitted response ${entry.item.response_id}`),
          })
          continue
        }

        try {
          await persistSuggestionForResponse({
            item: entry.item,
            leaseToken,
            teacherId: run.triggered_by,
            attemptCount: attempts.get(entry.item.id) ?? entry.item.attempt_count + 1,
            suggestion,
          })
        } catch (error) {
          if (error instanceof TestAiGradingLeaseLostError) throw error
          await failOrRetryItem({
            item: entry.item,
            leaseToken,
            attemptCount: attempts.get(entry.item.id) ?? entry.item.attempt_count + 1,
            error,
          })
        }
      }
    } catch (error) {
      if (error instanceof TestAiGradingLeaseLostError) throw error
      for (const entry of activeBatchRequests) {
        await failOrRetryItem({
          item: entry.item,
          leaseToken,
          attemptCount: attempts.get(entry.item.id) ?? entry.item.attempt_count + 1,
          error,
        })
      }
    }
  }
}

export async function tickTestAiGradingRun(opts: {
  testId: string
  runId: string
}): Promise<TickTestAiGradingRunResult> {
  const supabase = getServiceRoleClient()
  const run = await fetchTestAiGradingRunRow(supabase, opts.runId)
  if (!run || run.test_id !== opts.testId) {
    throw new Error('Test AI grading run not found')
  }

  if (!['queued', 'running'].includes(run.status)) {
    const items = await fetchTestAiGradingRunItems(supabase, run.id)
    return { run: toTestAiGradingRunSummary(run, { items }), claimed: false }
  }

  const leaseToken = await claimTestAiGradingRun(supabase, run.id)
  if (!leaseToken) {
    const latest = await fetchTestAiGradingRunRow(supabase, run.id)
    if (!latest) {
      throw new Error('Test AI grading run not found after lease claim')
    }
    const items = await fetchTestAiGradingRunItems(supabase, latest.id)
    return { run: toTestAiGradingRunSummary(latest, { items }), claimed: false }
  }

  try {
    const claimedRun = await fetchTestAiGradingRunRow(supabase, run.id)
    if (!claimedRun) {
      throw new Error('Test AI grading run disappeared during processing')
    }

    const test = await loadTestForRun(supabase, claimedRun.test_id)
    const allItems = await fetchTestAiGradingRunItems(supabase, claimedRun.id)
    const now = Date.now()
    const dueItems = allItems
      .filter((item) => {
        if (item.status !== 'queued' && item.status !== 'processing') return false
        if (!item.next_retry_at) return true
        return new Date(item.next_retry_at).getTime() <= now
      })
      .slice(0, TEST_AI_GRADING_RUN_CHUNK_SIZE)

    if (dueItems.length > 0) {
      const sanitizationContext = await loadClassroomAiSanitizationContext(
        supabase,
        test.classroom_id,
      )
      const responseIds = dueItems.map((item) => item.response_id)
      const questionIds = Array.from(new Set(dueItems.map((item) => item.question_id)))

      const [{ data: responseRows, error: responseError }, questionRows] = await Promise.all([
        supabase
          .from('test_responses')
          .select('id, response_text')
          .eq('test_id', claimedRun.test_id)
          .in('id', responseIds),
        loadOpenQuestionRows(supabase, claimedRun.test_id),
      ])

      if (responseError) {
        throw new Error('Failed to load queued test responses')
      }

      const responsesById = new Map(
        ((responseRows as Array<{ id: string; response_text: string | null }> | null) ?? []).map((row) => [
          row.id,
          row,
        ]),
      )
      const questionsById = new Map(questionRows.map((question) => [question.id, question]))

      const groupedItems = questionIds
        .map((questionId) => ({
          question: questionsById.get(questionId) ?? null,
          items: dueItems.filter((item) => item.question_id === questionId),
        }))
        .filter((group) => group.items.length > 0)

      await mapWithConcurrency(
        groupedItems,
        TEST_AI_GRADING_QUESTION_CONCURRENCY,
        async (group) => {
          if (!group.question) {
            await Promise.all(
              group.items.map((item) =>
                failOrRetryItem({
                  item,
                  leaseToken,
                  attemptCount: item.attempt_count + 1,
                  error: new Error('Question is no longer available for grading'),
                }),
              ),
            )
            return
          }

          await processQuestionBatch({
            supabase,
            run: claimedRun,
            leaseToken,
            testTitle: test.title,
            question: group.question,
            items: group.items,
            responsesById,
            sanitizationContext,
          })
        },
      )
    }

    return {
      run: await refreshTestAiGradingRun(supabase, claimedRun.id, {
        leaseToken,
        clearLease: true,
      }),
      claimed: true,
    }
  } catch (error) {
    if (error instanceof TestAiGradingLeaseLostError) {
      const latest = await fetchTestAiGradingRunRow(supabase, run.id)
      if (!latest) throw new Error('Test AI grading run not found after lease loss')
      const items = await fetchTestAiGradingRunItems(supabase, latest.id)
      return { run: toTestAiGradingRunSummary(latest, { items }), claimed: false }
    }

    const { data: failedRun, error: failedRunError } = await supabase
      .from('test_ai_grading_runs')
      .update({
        status: 'failed',
        lease_token: null,
        lease_expires_at: null,
        completed_at: new Date().toISOString(),
        error_samples_json: [
          {
            student_id: null,
            code: 'run_failed',
            message: error instanceof Error ? error.message : 'Test AI grading run failed',
          },
        ],
      })
      .eq('id', run.id)
      .eq('lease_token', leaseToken)
      .gt('lease_expires_at', new Date().toISOString())
      .select('*')
      .maybeSingle()

    if (failedRun) {
      const items = await fetchTestAiGradingRunItems(supabase, run.id)
      return {
        run: toTestAiGradingRunSummary(failedRun as TestAiGradingRun, { items }),
        claimed: true,
      }
    }

    if (!failedRun && !failedRunError) {
      const latest = await fetchTestAiGradingRunRow(supabase, run.id)
      if (!latest) throw new Error('Test AI grading run not found after lease loss')
      const items = await fetchTestAiGradingRunItems(supabase, latest.id)
      return { run: toTestAiGradingRunSummary(latest, { items }), claimed: false }
    }

    throw error
  }
}
