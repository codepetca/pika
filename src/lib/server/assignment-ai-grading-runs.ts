import { createHash, randomUUID } from 'node:crypto'
import { gradeStudentWork, isRetryableAssignmentAiGradingError } from '@/lib/ai-grading'
import { getAssignmentInstructionsMarkdown } from '@/lib/assignment-instructions'
import { analyzeAuthenticity } from '@/lib/authenticity'
import { limitedMarkdownToPlainText } from '@/lib/limited-markdown'
import { getServiceRoleClient } from '@/lib/supabase'
import { parseContentField } from '@/lib/tiptap-content'
import type {
  Assignment,
  AssignmentAiGradingRun,
  AssignmentAiGradingRunErrorSample,
  AssignmentAiGradingRunItem,
  AssignmentAiGradingRunStatus,
  AssignmentAiGradingRunSummary,
  AssignmentDocHistoryEntry,
} from '@/types'

const DEFAULT_MODEL = 'gpt-5-nano'
const RETRY_BACKOFF_SECONDS = [15, 60, 180]
const TIMEOUT_RETRY_BACKOFF_SECONDS = [7, 20, 45]

export const ASSIGNMENT_AI_GRADING_RUN_CHUNK_SIZE = 4
export const ASSIGNMENT_AI_GRADING_ITEM_CONCURRENCY = 2
export const ASSIGNMENT_AI_GRADING_REQUEST_TIMEOUT_MS = 25_000
export const ASSIGNMENT_AI_GRADING_MAX_ATTEMPTS = 3
export const ASSIGNMENT_AI_GRADING_LEASE_SECONDS = 60

type ServiceRoleSupabase = ReturnType<typeof getServiceRoleClient>

type CreateAssignmentAiGradingRunResult =
  | { kind: 'created'; run: AssignmentAiGradingRunSummary }
  | { kind: 'resumed'; run: AssignmentAiGradingRunSummary }
  | { kind: 'conflict'; run: AssignmentAiGradingRunSummary }

type GradeAssignmentDocWithAiOptions = {
  supabase: ServiceRoleSupabase
  assignment: Assignment
  assignmentDoc: {
    id: string
    student_id: string
    content: unknown
    feedback: string | null
    authenticity_score: number | null
  }
  requestTimeoutMs?: number
  telemetry?: {
    operation?: string
    requestedStrategy?: string | null
    resolvedStrategy?: string | null
    runId?: string | null
    studentId?: string | null
    attempt?: number | null
  }
}

type TickAssignmentAiGradingRunResult = {
  run: AssignmentAiGradingRunSummary
  claimed: boolean
}

type SupabaseSchemaError = {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

function getModelAlias(): string {
  return process.env.OPENAI_GRADING_MODEL?.trim() || DEFAULT_MODEL
}

function normalizeStudentIds(studentIds: string[]): string[] {
  return Array.from(
    new Set(studentIds.filter((studentId) => typeof studentId === 'string' && studentId.trim()).map((studentId) => studentId.trim())),
  )
}

function buildSelectionHash(studentIds: string[]): string {
  return createHash('sha256').update(normalizeStudentIds(studentIds).join('|')).digest('hex')
}

function getAssignmentInstructionsText(assignment: Assignment): string {
  return limitedMarkdownToPlainText(
    getAssignmentInstructionsMarkdown(assignment).markdown,
  )
}

function mapErrorSamples(rawSamples: unknown): AssignmentAiGradingRunErrorSample[] {
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
      } satisfies AssignmentAiGradingRunErrorSample
    })
    .filter((sample): sample is AssignmentAiGradingRunErrorSample => !!sample)
}

function isAssignmentAiGradingSchemaError(error: unknown): error is SupabaseSchemaError {
  if (!error || typeof error !== 'object') return false

  const record = error as SupabaseSchemaError
  if (record.code === 'PGRST205' || record.code === '42P01') {
    return true
  }

  const combined = `${record.message ?? ''} ${record.details ?? ''} ${record.hint ?? ''}`.toLowerCase()
  return combined.includes('assignment_ai_grading_run')
}

function getSummaryNextRetryAt(items: AssignmentAiGradingRunItem[]): string | null {
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

  return earliestFutureRetryAt == null
    ? null
    : new Date(earliestFutureRetryAt).toISOString()
}

export function toAssignmentAiGradingRunSummary(
  run: Partial<AssignmentAiGradingRun> & Pick<AssignmentAiGradingRun, 'id' | 'assignment_id' | 'status' | 'created_at'>,
  options?: { items?: AssignmentAiGradingRunItem[] },
): AssignmentAiGradingRunSummary {
  const requestedCount = Number(run.requested_count ?? 0)
  const processedCount = Number(run.processed_count ?? 0)

  return {
    id: run.id,
    assignment_id: run.assignment_id,
    status: run.status,
    model: run.model ?? null,
    requested_count: requestedCount,
    gradable_count: Number(run.gradable_count ?? 0),
    processed_count: processedCount,
    completed_count: Number(run.completed_count ?? 0),
    skipped_missing_count: Number(run.skipped_missing_count ?? 0),
    skipped_empty_count: Number(run.skipped_empty_count ?? 0),
    failed_count: Number(run.failed_count ?? 0),
    pending_count: Math.max(requestedCount - processedCount, 0),
    next_retry_at: options?.items ? getSummaryNextRetryAt(options.items) : null,
    error_samples: mapErrorSamples(run.error_samples_json),
    started_at: run.started_at ?? null,
    completed_at: run.completed_at ?? null,
    created_at: run.created_at,
  }
}

async function fetchAssignmentAiGradingRunRow(
  supabase: ServiceRoleSupabase,
  runId: string,
): Promise<AssignmentAiGradingRun | null> {
  const { data, error } = await supabase
    .from('assignment_ai_grading_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle()

  if (error) {
    if (isAssignmentAiGradingSchemaError(error)) {
      return null
    }
    throw new Error('Failed to load assignment AI grading run')
  }

  return (data as AssignmentAiGradingRun | null) ?? null
}

async function fetchAssignmentAiGradingRunItems(
  supabase: ServiceRoleSupabase,
  runId: string,
): Promise<AssignmentAiGradingRunItem[]> {
  const { data, error } = await supabase
    .from('assignment_ai_grading_run_items')
    .select('*')
    .eq('run_id', runId)
    .order('queue_position', { ascending: true })

  if (error) {
    if (isAssignmentAiGradingSchemaError(error)) {
      return []
    }
    throw new Error('Failed to load assignment AI grading run items')
  }

  return (data as AssignmentAiGradingRunItem[]) ?? []
}

async function fetchLatestActiveRun(
  supabase: ServiceRoleSupabase,
  assignmentId: string,
): Promise<AssignmentAiGradingRun | null> {
  const { data, error } = await supabase
    .from('assignment_ai_grading_runs')
    .select('*')
    .eq('assignment_id', assignmentId)
    .in('status', ['queued', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) {
    if (isAssignmentAiGradingSchemaError(error)) {
      return null
    }
    throw new Error('Failed to load active assignment AI grading run')
  }

  return ((data as AssignmentAiGradingRun[] | null) ?? [])[0] ?? null
}

async function maybeScoreAuthenticity(
  supabase: ServiceRoleSupabase,
  assignmentDocId: string,
): Promise<void> {
  const { data: historyEntries } = await supabase
    .from('assignment_doc_history')
    .select('id, assignment_doc_id, patch, snapshot, word_count, char_count, paste_word_count, keystroke_count, trigger, created_at')
    .eq('assignment_doc_id', assignmentDocId)
    .order('created_at', { ascending: true })

  if (!historyEntries || historyEntries.length <= 1) {
    return
  }

  const authResult = analyzeAuthenticity(historyEntries as AssignmentDocHistoryEntry[])
  if (authResult.score === null) {
    return
  }

  await supabase
    .from('assignment_docs')
    .update({
      authenticity_score: authResult.score,
      authenticity_flags: authResult.flags,
    })
    .eq('id', assignmentDocId)
}

export async function gradeAssignmentDocWithAi({
  supabase,
  assignment,
  assignmentDoc,
  requestTimeoutMs,
  telemetry,
}: GradeAssignmentDocWithAiOptions): Promise<void> {
  const studentWork = parseContentField(assignmentDoc.content)
  if (!studentWork.content || studentWork.content.length === 0) {
    throw new Error('No gradable content found')
  }

  const result = await gradeStudentWork({
    assignmentTitle: assignment.title,
    instructions: getAssignmentInstructionsText(assignment),
    studentWork,
    previousFeedback: assignmentDoc.feedback,
    requestTimeoutMs,
    telemetry: {
      feature: 'assignment_auto_grade',
      operation: telemetry?.operation ?? 'single_grade',
      promptProfile: 'default',
      requestedStrategy: telemetry?.requestedStrategy ?? 'single',
      resolvedStrategy: telemetry?.resolvedStrategy ?? 'single',
      runId: telemetry?.runId ?? null,
      studentId: telemetry?.studentId ?? assignmentDoc.student_id,
      attempt: telemetry?.attempt ?? null,
    },
  })

  const { error: updateError } = await supabase
    .from('assignment_docs')
    .update({
      score_completion: result.score_completion,
      score_thinking: result.score_thinking,
      score_workflow: result.score_workflow,
      ai_feedback_suggestion: result.feedback,
      ai_feedback_suggested_at: new Date().toISOString(),
      ai_feedback_model: result.model,
      graded_at: null,
      graded_by: null,
    })
    .eq('id', assignmentDoc.id)

  if (updateError) {
    throw new Error(`Failed to save AI grade for student ${assignmentDoc.student_id}`)
  }

  if (assignmentDoc.authenticity_score == null) {
    try {
      await maybeScoreAuthenticity(supabase, assignmentDoc.id)
    } catch {
      // Non-fatal: authenticity scoring failure should not block grade persistence.
    }
  }
}

async function refreshAssignmentAiGradingRun(
  supabase: ServiceRoleSupabase,
  runId: string,
  options?: { clearLease?: boolean },
): Promise<AssignmentAiGradingRunSummary> {
  const run = await fetchAssignmentAiGradingRunRow(supabase, runId)
  if (!run) {
    throw new Error('Assignment AI grading run not found')
  }

  const items = await fetchAssignmentAiGradingRunItems(supabase, runId)
  let completedCount = 0
  let skippedMissingCount = 0
  let skippedEmptyCount = 0
  let failedCount = 0
  let hasPending = false

  for (const item of items) {
    if (item.status === 'completed') {
      completedCount += 1
      continue
    }
    if (item.status === 'skipped') {
      if (item.skip_reason === 'missing_doc') {
        skippedMissingCount += 1
      } else if (item.skip_reason === 'empty_doc') {
        skippedEmptyCount += 1
      }
      continue
    }
    if (item.status === 'failed') {
      failedCount += 1
      continue
    }
    hasPending = true
  }

  const processedCount = completedCount + skippedMissingCount + skippedEmptyCount + failedCount
  let nextStatus: AssignmentAiGradingRunStatus = run.status

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

  const updates = {
    status: nextStatus,
    processed_count: processedCount,
    completed_count: completedCount,
    skipped_missing_count: skippedMissingCount,
    skipped_empty_count: skippedEmptyCount,
    failed_count: failedCount,
    error_samples_json: errorSamples,
    completed_at: hasPending ? null : run.completed_at ?? new Date().toISOString(),
    lease_token: options?.clearLease ? null : run.lease_token,
    lease_expires_at: options?.clearLease ? null : run.lease_expires_at,
  }

  const { data, error } = await supabase
    .from('assignment_ai_grading_runs')
    .update(updates)
    .eq('id', runId)
    .select('*')
    .single()

  if (error || !data) {
    if (isAssignmentAiGradingSchemaError(error)) {
      throw new Error('Assignment AI grading run tables are unavailable. Apply migration 054.')
    }
    throw new Error('Failed to refresh assignment AI grading run summary')
  }

  return toAssignmentAiGradingRunSummary(data as AssignmentAiGradingRun, { items })
}

async function claimAssignmentAiGradingRun(
  supabase: ServiceRoleSupabase,
  runId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('claim_assignment_ai_grading_run', {
    p_run_id: runId,
    p_lease_token: randomUUID(),
    p_lease_seconds: ASSIGNMENT_AI_GRADING_LEASE_SECONDS,
  })

  if (error) {
    if (isAssignmentAiGradingSchemaError(error)) {
      throw new Error('Assignment AI grading run tables are unavailable. Apply migration 054.')
    }
    throw new Error('Failed to claim assignment AI grading run lease')
  }

  if (Array.isArray(data)) {
    return data.length > 0
  }

  return !!data
}

async function loadAssignmentForRun(
  supabase: ServiceRoleSupabase,
  assignmentId: string,
): Promise<Assignment> {
  const { data, error } = await supabase
    .from('assignments')
    .select('*')
    .eq('id', assignmentId)
    .single()

  if (error || !data) {
    throw new Error('Assignment not found for AI grading run')
  }

  return data as Assignment
}

function getNextRetryAt(
  attemptCount: number,
  errorKind?: string | null,
): string {
  const backoffSchedule =
    errorKind === 'timeout' ? TIMEOUT_RETRY_BACKOFF_SECONDS : RETRY_BACKOFF_SECONDS
  const seconds = backoffSchedule[Math.min(attemptCount - 1, backoffSchedule.length - 1)]
  return new Date(Date.now() + seconds * 1000).toISOString()
}

async function updateRunItem(
  supabase: ServiceRoleSupabase,
  itemId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from('assignment_ai_grading_run_items')
    .update(payload)
    .eq('id', itemId)

  if (error) {
    throw new Error('Failed to update assignment AI grading run item')
  }
}

async function processAssignmentAiRunItem(opts: {
  supabase: ServiceRoleSupabase
  assignment: Assignment
  run: AssignmentAiGradingRun
  item: AssignmentAiGradingRunItem
}): Promise<void> {
  const { supabase, assignment, run, item } = opts
  const attemptCount = item.attempt_count + 1
  const now = new Date().toISOString()

  await updateRunItem(supabase, item.id, {
    status: 'processing',
    started_at: item.started_at ?? now,
    next_retry_at: null,
  })

  const { data: assignmentDoc, error: assignmentDocError } = await supabase
    .from('assignment_docs')
    .select('id, student_id, content, feedback, authenticity_score')
    .eq('id', item.assignment_doc_id)
    .maybeSingle()

  if (assignmentDocError) {
    await updateRunItem(supabase, item.id, {
      status: 'failed',
      attempt_count: attemptCount,
      last_error_code: 'load_doc_failed',
      last_error_message: 'Failed to load assignment submission',
      completed_at: now,
    })
    return
  }

  if (!assignmentDoc) {
    await updateRunItem(supabase, item.id, {
      status: 'skipped',
      skip_reason: 'missing_doc',
      attempt_count: attemptCount,
      last_error_code: null,
      last_error_message: null,
      completed_at: now,
    })
    return
  }

  const studentWork = parseContentField(assignmentDoc.content)
  if (!studentWork.content || studentWork.content.length === 0) {
    await updateRunItem(supabase, item.id, {
      status: 'skipped',
      skip_reason: 'empty_doc',
      attempt_count: attemptCount,
      last_error_code: null,
      last_error_message: null,
      completed_at: now,
    })
    return
  }

  try {
    await gradeAssignmentDocWithAi({
      supabase,
      assignment,
      assignmentDoc,
      requestTimeoutMs: ASSIGNMENT_AI_GRADING_REQUEST_TIMEOUT_MS,
      telemetry: {
        operation: 'background_batch_item',
        requestedStrategy: 'background_chunked',
        resolvedStrategy: 'background_chunked',
        runId: run.id,
        studentId: item.student_id,
        attempt: attemptCount,
      },
    })

    await updateRunItem(supabase, item.id, {
      status: 'completed',
      attempt_count: attemptCount,
      last_error_code: null,
      last_error_message: null,
      completed_at: now,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI grading failed'

    if (
      isRetryableAssignmentAiGradingError(error) &&
      attemptCount < ASSIGNMENT_AI_GRADING_MAX_ATTEMPTS
    ) {
      await updateRunItem(supabase, item.id, {
        status: 'queued',
        attempt_count: attemptCount,
        last_error_code: error.kind,
        last_error_message: message,
        next_retry_at: getNextRetryAt(attemptCount, error.kind),
      })
      return
    }

    await updateRunItem(supabase, item.id, {
      status: 'failed',
      attempt_count: attemptCount,
      last_error_code:
        error instanceof Error && 'kind' in error && typeof error.kind === 'string'
          ? error.kind
          : 'internal',
      last_error_message: message,
      completed_at: now,
    })
  }
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

export async function createOrResumeAssignmentAiGradingRun(opts: {
  assignmentId: string
  teacherId: string
  studentIds: string[]
}): Promise<CreateAssignmentAiGradingRunResult> {
  const supabase = getServiceRoleClient()
  const normalizedStudentIds = normalizeStudentIds(opts.studentIds)
  const selectionHash = buildSelectionHash(normalizedStudentIds)
  const activeRun = await fetchLatestActiveRun(supabase, opts.assignmentId)

  if (activeRun) {
    const items = await fetchAssignmentAiGradingRunItems(supabase, activeRun.id)
    const summary = toAssignmentAiGradingRunSummary(activeRun, { items })
    if (activeRun.selection_hash === selectionHash) {
      return { kind: 'resumed', run: summary }
    }
    return { kind: 'conflict', run: summary }
  }

  const { data: docs, error: docsError } = await supabase
    .from('assignment_docs')
    .select('id, student_id, content')
    .eq('assignment_id', opts.assignmentId)
    .in('student_id', normalizedStudentIds)

  if (docsError) {
    throw new Error('Failed to load assignment submissions for AI grading run')
  }

  const docByStudentId = new Map(
    ((docs as Array<{ id: string; student_id: string; content: unknown }> | null) ?? []).map((doc) => [doc.student_id, doc]),
  )

  let gradableCount = 0
  let skippedMissingCount = 0
  let skippedEmptyCount = 0

  const itemRows = normalizedStudentIds.map((studentId, index) => {
    const doc = docByStudentId.get(studentId)
    if (!doc) {
      skippedMissingCount += 1
      return {
        assignment_id: opts.assignmentId,
        student_id: studentId,
        assignment_doc_id: null,
        queue_position: index,
        status: 'skipped',
        skip_reason: 'missing_doc',
        attempt_count: 0,
        next_retry_at: null,
        last_error_code: null,
        last_error_message: null,
        started_at: null,
        completed_at: new Date().toISOString(),
      }
    }

    const parsed = parseContentField(doc.content)
    if (!parsed.content || parsed.content.length === 0) {
      skippedEmptyCount += 1
      return {
        assignment_id: opts.assignmentId,
        student_id: studentId,
        assignment_doc_id: doc.id,
        queue_position: index,
        status: 'skipped',
        skip_reason: 'empty_doc',
        attempt_count: 0,
        next_retry_at: null,
        last_error_code: null,
        last_error_message: null,
        started_at: null,
        completed_at: new Date().toISOString(),
      }
    }

    gradableCount += 1
    return {
      assignment_id: opts.assignmentId,
      student_id: studentId,
      assignment_doc_id: doc.id,
      queue_position: index,
      status: 'queued',
      skip_reason: null,
      attempt_count: 0,
      next_retry_at: null,
      last_error_code: null,
      last_error_message: null,
      started_at: null,
      completed_at: null,
    }
  })

  const initialStatus: AssignmentAiGradingRunStatus =
    gradableCount === 0 ? 'completed' : 'queued'
  const now = new Date().toISOString()
  const runPayload = {
    assignment_id: opts.assignmentId,
    status: initialStatus,
    triggered_by: opts.teacherId,
    model: getModelAlias(),
    requested_student_ids_json: normalizedStudentIds,
    selection_hash: selectionHash,
    requested_count: normalizedStudentIds.length,
    gradable_count: gradableCount,
    processed_count: skippedMissingCount + skippedEmptyCount,
    completed_count: 0,
    skipped_missing_count: skippedMissingCount,
    skipped_empty_count: skippedEmptyCount,
    failed_count: 0,
    error_samples_json: [],
    started_at: gradableCount === 0 ? now : null,
    completed_at: gradableCount === 0 ? now : null,
  }

  const { data: run, error: runError } = await supabase
    .from('assignment_ai_grading_runs')
    .insert(runPayload)
    .select('*')
    .single()

  if (runError || !run) {
    if (isAssignmentAiGradingSchemaError(runError)) {
      throw new Error('Assignment AI grading run tables are unavailable. Apply migration 054.')
    }
    throw new Error('Failed to create assignment AI grading run')
  }

  const rowsWithRunId = itemRows.map((item) => ({
    run_id: run.id,
    ...item,
  }))
  const { error: itemsError } = await supabase
    .from('assignment_ai_grading_run_items')
    .insert(rowsWithRunId)

  if (itemsError) {
    if (isAssignmentAiGradingSchemaError(itemsError)) {
      throw new Error('Assignment AI grading run tables are unavailable. Apply migration 054.')
    }
    throw new Error('Failed to create assignment AI grading run items')
  }

  return {
    kind: 'created',
    run: toAssignmentAiGradingRunSummary(run as AssignmentAiGradingRun),
  }
}

export async function getAssignmentAiGradingRunSummary(opts: {
  assignmentId: string
  runId: string
}): Promise<AssignmentAiGradingRunSummary | null> {
  const supabase = getServiceRoleClient()
  const run = await fetchAssignmentAiGradingRunRow(supabase, opts.runId)
  if (!run || run.assignment_id !== opts.assignmentId) {
    return null
  }

  const items = await fetchAssignmentAiGradingRunItems(supabase, run.id)
  return toAssignmentAiGradingRunSummary(run, { items })
}

export async function getActiveAssignmentAiGradingRunSummary(
  assignmentId: string,
): Promise<AssignmentAiGradingRunSummary | null> {
  const supabase = getServiceRoleClient()
  const run = await fetchLatestActiveRun(supabase, assignmentId)
  if (!run) return null

  const items = await fetchAssignmentAiGradingRunItems(supabase, run.id)
  return toAssignmentAiGradingRunSummary(run, { items })
}

export async function tickAssignmentAiGradingRun(opts: {
  assignmentId: string
  runId: string
}): Promise<TickAssignmentAiGradingRunResult> {
  const supabase = getServiceRoleClient()
  const run = await fetchAssignmentAiGradingRunRow(supabase, opts.runId)
  if (!run || run.assignment_id !== opts.assignmentId) {
    throw new Error('Assignment AI grading run not found')
  }

  if (!['queued', 'running'].includes(run.status)) {
    const items = await fetchAssignmentAiGradingRunItems(supabase, run.id)
    return { run: toAssignmentAiGradingRunSummary(run, { items }), claimed: false }
  }

  const claimed = await claimAssignmentAiGradingRun(supabase, run.id)
  if (!claimed) {
    const latest = await fetchAssignmentAiGradingRunRow(supabase, run.id)
    if (!latest) {
      throw new Error('Assignment AI grading run not found after lease claim')
    }
    const items = await fetchAssignmentAiGradingRunItems(supabase, latest.id)
    return { run: toAssignmentAiGradingRunSummary(latest, { items }), claimed: false }
  }

  try {
    const claimedRun = await fetchAssignmentAiGradingRunRow(supabase, run.id)
    if (!claimedRun) {
      throw new Error('Assignment AI grading run disappeared during processing')
    }

    const assignment = await loadAssignmentForRun(supabase, claimedRun.assignment_id)
    const allItems = await fetchAssignmentAiGradingRunItems(supabase, claimedRun.id)
    const now = Date.now()
    const dueItems = allItems
      .filter((item) => {
        if (item.status !== 'queued' && item.status !== 'processing') return false
        if (!item.next_retry_at) return true
        return new Date(item.next_retry_at).getTime() <= now
      })
      .slice(0, ASSIGNMENT_AI_GRADING_RUN_CHUNK_SIZE)

    if (dueItems.length > 0) {
      await mapWithConcurrency(
        dueItems,
        ASSIGNMENT_AI_GRADING_ITEM_CONCURRENCY,
        async (item) => {
          await processAssignmentAiRunItem({
            supabase,
            assignment,
            run: claimedRun,
            item,
          })
        },
      )
    }

    return {
      run: await refreshAssignmentAiGradingRun(supabase, claimedRun.id, { clearLease: true }),
      claimed: true,
    }
  } catch (error) {
    const { data: failedRun } = await supabase
      .from('assignment_ai_grading_runs')
      .update({
        status: 'failed',
        lease_token: null,
        lease_expires_at: null,
        completed_at: new Date().toISOString(),
        error_samples_json: [
          {
            student_id: null,
            code: 'run_failed',
            message: error instanceof Error ? error.message : 'Assignment AI grading run failed',
          },
        ],
      })
      .eq('id', run.id)
      .select('*')
      .single()

    if (failedRun) {
      const items = await fetchAssignmentAiGradingRunItems(supabase, run.id)
      return {
        run: toAssignmentAiGradingRunSummary(failedRun as AssignmentAiGradingRun, { items }),
        claimed: true,
      }
    }

    throw error
  }
}

export async function listRunnableAssignmentAiGradingRuns(
  limit: number,
): Promise<AssignmentAiGradingRunSummary[]> {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase
    .from('assignment_ai_grading_runs')
    .select('*')
    .in('status', ['queued', 'running'])
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    if (isAssignmentAiGradingSchemaError(error)) {
      return []
    }
    throw new Error('Failed to list runnable assignment AI grading runs')
  }

  return ((data as AssignmentAiGradingRun[] | null) ?? []).map((run) => toAssignmentAiGradingRunSummary(run))
}
