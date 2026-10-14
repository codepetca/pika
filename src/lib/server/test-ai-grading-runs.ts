import { createHash, randomUUID } from 'node:crypto'
import { logServerError } from '@/lib/server/diagnostics'
import { z } from 'zod'
import { ApiError } from '@/lib/api-handler'
import { DEEPSEEK_MAX_PROVIDER_ATTEMPTS_NO_DOWNGRADE } from '@/lib/grading/providers/deepseek-chat'
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
import type {
  TestAiGradingRun,
  TestAiGradingRunErrorSample,
  TestAiGradingRunItem,
  TestAiGradingRunStatus,
  TestAiGradingRunSummary,
} from '@/types'
import type { Json } from '@/types/database.generated'
import type { TestGradingProvenance } from '@/lib/grading/contracts'
import { buildTestQuestionGradingSnapshot } from '@/lib/test-grading-context'
import type { TestAiGradeScope } from '@/lib/test-ai-grading-scope'

const TEST_AI_RETRY_BACKOFF_SECONDS = [7, 20, 45]
export const TEST_AI_GRADING_RUN_CHUNK_SIZE = 8
export const TEST_AI_GRADING_QUESTION_CONCURRENCY = 2
export const TEST_AI_GRADING_MICROBATCH_SIZE = 4
// These five values are one budget and must move together. A tick runs inside the route's
// `maxDuration` (300s). One provider call can take the request timeout on EACH of the
// adapter's attempts, so its worst case is two high-effort timeouts, plus
// time to persist the result. A tick never starts a call that could not finish and save
// inside TEST_AI_GRADING_TICK_BUDGET_MS; the lease outlasts the longest call, since it is
// only renewed around calls, never during them.
//
// 60s per attempt fits a heavy 10-point answer (measured p90 32s) and a batch of four
// (~41s at median throughput). The old 25s cut off a third of heavy single attempts.
export const TEST_AI_GRADING_REQUEST_TIMEOUT_MS = 60_000
export const TEST_AI_GRADING_MAX_ATTEMPTS = 3
const TEST_AI_GRADING_PERSIST_MARGIN_MS = 15_000
const TEST_AI_GRADING_CALL_RESERVE_MS =
  TEST_AI_GRADING_REQUEST_TIMEOUT_MS * DEEPSEEK_MAX_PROVIDER_ATTEMPTS_NO_DOWNGRADE + TEST_AI_GRADING_PERSIST_MARGIN_MS
// Below the route's 300s maxDuration, leaving room to refresh the run and respond.
export const TEST_AI_GRADING_TICK_BUDGET_MS = 270_000
export const TEST_AI_GRADING_LEASE_SECONDS = 240

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
  skipped_student_count: number
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

const startRunCountsSchema = z.object({
  eligible_student_count: z.number().int().nonnegative(),
  skipped_unanswered_count: z.number().int().nonnegative(),
  skipped_already_graded_count: z.number().int().nonnegative(),
})
const createRunResultSchema = startRunCountsSchema.extend({
  outcome: z.enum(['created', 'existing']),
  run_id: z.string().uuid(),
}).strict().or(startRunCountsSchema.extend({
  outcome: z.literal('noop'),
  run_id: z.null(),
  noop_reason: z.literal('no_open_questions').optional(),
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

function buildSelectionHash(studentIds: string[], gradeScope: TestAiGradeScope): string {
  return createHash('sha256')
    .update(`${gradeScope}:${normalizeStudentIds(studentIds).join('|')}`)
    .digest('hex')
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
    ...(options?.items ? {
      completed_student_count: new Set(options.items
        .filter((item) => item.status === 'completed')
        .map((item) => item.student_id)).size,
    } : {}),
    skipped_student_count: Math.max(Number(run.requested_count ?? 0) - Number(run.eligible_student_count ?? 0), 0),
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
    skipped_student_count: Math.max(input.requestedCount - input.eligibleStudentCount, 0),
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
    provenance: TestGradingProvenance
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
    aiGradingProvenance: opts.suggestion.provenance,
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
    message.startsWith('DeepSeek request failed') ||
    message.startsWith('DeepSeek returned invalid JSON') ||
    message === 'DeepSeek response missing structured output' ||
    message === 'DeepSeek response incomplete: max_tokens' ||
    message === 'Failed to parse AI grade suggestion' ||
    message === 'Failed to parse AI batch grade suggestions' ||
    message === 'Failed to parse AI reference answers' ||
    message.startsWith('AI batch grade suggestion omitted response')
  ) {
    return 'AI grading service failed for this response. Try again.'
  }

  return message
}

// Used in place of a provider call when every allowed attempt was started and none recorded
// an outcome — each was cut off by the worker's time limit mid-call. Another attempt would
// repeat the interruption. `kind` doubles as the stored error code.
class TestAiGradingAttemptsExhaustedError extends Error {
  readonly kind = 'timeout'
  constructor() {
    super('AI grading was interrupted repeatedly before it could finish this response. Try again.')
    this.name = 'TestAiGradingAttemptsExhaustedError'
  }
}

// Measured with performance.now(): monotonic, and independent of the wall-clock time the
// lease logic uses.
function canStartProviderCall(tickStartedAt: number): boolean {
  return (
    performance.now() - tickStartedAt + TEST_AI_GRADING_CALL_RESERVE_MS
    <= TEST_AI_GRADING_TICK_BUDGET_MS
  )
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
  recoverProviderOutput?: boolean
}): Promise<void> {
  const teacherMessage = toTeacherAutoGradeErrorMessage(opts.error)
  const providerErrorKind = opts.error instanceof Error && 'kind' in opts.error
    ? opts.error.kind
    : null
  const providerOutputFailure = opts.recoverProviderOutput && opts.error instanceof Error && (
    providerErrorKind === 'bad_response' || providerErrorKind === 'invalid_output' || providerErrorKind === null
  )
  const retryable = isRetryableTestAiGradingError(opts.error) || isBatchOmittedResponseError(opts.error) || providerOutputFailure

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
  gradeScope: TestAiGradeScope
  promptGuidelineOverride?: string | null
}): Promise<CreateTestAiGradingRunResult> {
  const supabase = getServiceRoleClient()
  const normalizedStudentIds = normalizeStudentIds(opts.studentIds)
  const promptGuidelineOverride = normalizePromptGuidelineOverride(opts.promptGuidelineOverride)
  const selectionHash = buildSelectionHash(normalizedStudentIds, opts.gradeScope)
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

  // Capture drafts, close selected unfinished attempts and create the run in
  // one transaction. Reading draft responses here would race student autosave.
  const { data: createResult, error: runError } = await supabase.rpc(
    'start_test_ai_grading_run_atomic',
    {
      p_test_id: opts.testId,
      p_teacher_id: opts.teacherId,
      p_model: model,
      p_requested_student_ids: normalizedStudentIds,
      p_selection_hash: selectionHash,
      p_grade_scope: opts.gradeScope,
      ...(promptGuidelineOverride === null
        ? {}
        : { p_prompt_guideline_override: promptGuidelineOverride }),
    },
  )

  if (runError) {
    if (runError.code === 'PGRST202' || runError.code === '42883') {
      throw new Error('Test AI grading saved-work migration is required')
    }
    if (isTestAiGradingSchemaError(runError)) {
      throw new Error('Test AI grading run tables are unavailable. Apply migration 055.')
    }
    if (runError.code === 'PT409' || runError.code === '40001') throw new ApiError(409, runError.message)
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
    const { eligible_student_count: eligibleStudentCount,
      skipped_unanswered_count: skippedUnansweredCount,
      skipped_already_graded_count: skippedAlreadyGradedCount } = parsedCreateResult.data
    const message =
      parsedCreateResult.data.noop_reason === 'no_open_questions'
        ? 'This test has no open-response questions to auto-grade.'
        : eligibleStudentCount === 0
          ? 'Selected students have no saved test work to grade.'
          : skippedAlreadyGradedCount > 0 || skippedUnansweredCount > 0
          ? 'No AI grading was needed for this selection.'
          : 'No saved open responses were eligible for AI grading.'
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
  tickStartedAt: number
}): Promise<void> {
  const { supabase, run, leaseToken, testTitle, question, items, responsesById, sanitizationContext, tickStartedAt } = opts
  const model = run.model ?? getTestOpenResponseGradingModel()
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

  let prepared: Awaited<ReturnType<typeof prepareTestOpenResponseGradingContext>> | undefined
  const prepareContext = async () => {
    const context = await prepareTestOpenResponseGradingContext({
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
      context.grading_basis === 'generated_reference' &&
      context.reference_answers_source === 'generated'
    ) {
      const { error: cacheUpdateError } = await supabase
        .from('test_questions')
        .update({
          ai_reference_cache_key: cacheResolution.expectedCacheKey,
          ai_reference_cache_answers: context.reference_answers,
          ai_reference_cache_model: context.model,
          ai_reference_cache_generated_at: new Date().toISOString(),
        })
        .eq('id', question.id)
        .eq('test_id', run.test_id)
        .eq('updated_at', question.updated_at)

      if (cacheUpdateError) {
        logServerError('grading.test_run_reference_cache', cacheUpdateError)
      }
    }
    return context
  }

  for (let start = 0; start < items.length;) {
    // Checked before anything is written, so items this tick cannot finish stay exactly as
    // they were for the next tick.
    if (!canStartProviderCall(tickStartedAt)) return

    // A failed batch is retried one response at a time. Successful first attempts retain
    // the fast path; an invalid or truncated batch no longer strands every sibling.
    const firstAttemptCount = items[start].attempt_count
    const maxSize = firstAttemptCount > 0 ? 1 : TEST_AI_GRADING_MICROBATCH_SIZE
    const untriedCandidates = items.slice(start, start + maxSize)
    const retryBoundary = firstAttemptCount === 0
      ? untriedCandidates.findIndex((item) => item.attempt_count > 0)
      : -1
    const candidates = retryBoundary > 0
      ? untriedCandidates.slice(0, retryBoundary)
      : untriedCandidates
    start += candidates.length
    // An item only reaches the attempt limit while still due if each attempt was interrupted
    // before recording an outcome; a normal failure on the last attempt marks it failed.
    for (const item of candidates) {
      if (item.attempt_count < TEST_AI_GRADING_MAX_ATTEMPTS) continue
      await failOrRetryItem({
        item,
        leaseToken,
        attemptCount: item.attempt_count,
        error: new TestAiGradingAttemptsExhaustedError(),
      })
    }
    const batchItems = candidates.filter((item) => item.attempt_count < TEST_AI_GRADING_MAX_ATTEMPTS)
    if (batchItems.length === 0) continue

    const attempts = new Map<string, number>()
    const now = new Date().toISOString()

    for (const item of batchItems) {
      const attemptCount = item.attempt_count + 1
      attempts.set(item.id, attemptCount)
      // Persisted before the provider call. Held only in memory, an attempt interrupted
      // mid-call was never counted, so the item could be retried forever.
      await updateRunItem(item.id, leaseToken, {
        status: 'processing',
        attempt_count: attemptCount,
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

    let providerCallInProgress = false
    try {
      if (!prepared) {
        await renewTestAiGradingRunLease({
          runId: run.id,
          leaseToken,
          leaseSeconds: TEST_AI_GRADING_LEASE_SECONDS,
        })
        // Preparation may generate references remotely. The batch's attempt is already
        // durable, so interruption here is bounded just like interruption during grading.
        // Reuse the same attempt for grading; later batches reuse this prepared context.
        // Persistence and lease renewal can consume the admission window themselves.
        if (!canStartProviderCall(tickStartedAt)) return
        prepared = await prepareContext()
      }
      // A generated reference may consume enough time that grading must resume next tick.
      // Its cache and the started attempt are durable; no additional provider call starts.
      if (!canStartProviderCall(tickStartedAt)) return

      if (activeBatchRequests.length === 1) {
        const only = activeBatchRequests[0]
        await renewTestAiGradingRunLease({
          runId: run.id,
          leaseToken,
          leaseSeconds: TEST_AI_GRADING_LEASE_SECONDS,
        })
        if (!canStartProviderCall(tickStartedAt)) return
        providerCallInProgress = true
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
        providerCallInProgress = false

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
      if (!canStartProviderCall(tickStartedAt)) return
      providerCallInProgress = true
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
      providerCallInProgress = false

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
          recoverProviderOutput: providerCallInProgress,
        })
      }
    }
  }
}

export async function tickTestAiGradingRun(opts: {
  testId: string
  runId: string
}): Promise<TickTestAiGradingRunResult> {
  const tickStartedAt = performance.now()
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
                  attemptCount: Math.min(item.attempt_count + 1, TEST_AI_GRADING_MAX_ATTEMPTS),
                  error: item.attempt_count >= TEST_AI_GRADING_MAX_ATTEMPTS
                    ? new TestAiGradingAttemptsExhaustedError()
                    : new Error('Question is no longer available for grading'),
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
            tickStartedAt,
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
