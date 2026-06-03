import { loadClassroomAiSanitizationContext } from '@/lib/server/ai-sanitization'
import { loadAssignmentSubmissionArtifactsForDocs } from '@/lib/server/assignment-submission-artifacts'
import {
  buildPikaAssignmentGradexRunPayload,
  getRequiredPseudonymSalt,
  pseudonymizePikaGradexRef,
  type PikaGradexMapping,
} from '@/lib/server/gradex-assignment-payload'
import { mapGradexItemsToPikaGradeRecords, type GradexSmokeRunItemResponse, type GradexSmokeRunResponse } from '@/lib/server/gradex-smoke-runner'
import { sanitizeAiOutputText } from '@/lib/ai-sanitization'
import type { Assignment, AssignmentAiGradingRun, AssignmentAiGradingRunItem, AssignmentSubmissionArtifact, AuthenticityFlag } from '@/types'

export const GRADEX_ASSIGNMENT_RUN_MODEL = 'gradex:pika-assignment-v1'

const TERMINAL_GRADEX_STATUSES = new Set(['completed', 'completed_with_errors', 'failed'])
const RETRYABLE_GRADEX_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504])
const GRADEX_ASSIGNMENT_MAX_ATTEMPTS = 3
const GRADEX_ASSIGNMENT_RETRY_BACKOFF_SECONDS = [15, 60, 180]

type ServiceRoleSupabase = {
  from: (table: string) => any
}

type GradexAssignmentDocRow = {
  id: string
  student_id: string
  content: unknown
  submitted_at?: string | null
  authenticity_score?: number | null
  authenticity_flags?: AuthenticityFlag[] | null
}

type GradexConfig = {
  baseUrl: string
  apiKey: string
}

class GradexRetryableRequestError extends Error {
  readonly code: string
  readonly status?: number

  constructor(message: string, code: string, status?: number) {
    super(message)
    this.name = 'GradexRetryableRequestError'
    this.code = code
    this.status = status
  }
}

export function isGradexAssignmentGradingEnabled(): boolean {
  return process.env.GRADEX_ASSIGNMENT_GRADING_ENABLED?.trim().toLowerCase() === 'true'
}

export function isGradexAssignmentRun(run: Pick<AssignmentAiGradingRun, 'model'>): boolean {
  return run.model === GRADEX_ASSIGNMENT_RUN_MODEL
}

function getGradexConfig(): GradexConfig {
  const baseUrl = process.env.GRADEX_API_URL?.trim().replace(/\/+$/, '')
  const apiKey = process.env.GRADEX_API_KEY?.trim()

  if (!baseUrl || !apiKey) {
    throw new Error('Gradex assignment grading is enabled but GRADEX_API_URL or GRADEX_API_KEY is missing')
  }

  return { baseUrl, apiKey }
}

function isAssignmentGradexMetadataSchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as { code?: string; message?: string; details?: string | null; hint?: string | null }
  if (record.code === 'PGRST204' || record.code === '42703') return true
  const combined = `${record.message ?? ''} ${record.details ?? ''} ${record.hint ?? ''}`.toLowerCase()
  return combined.includes('gradex_run_id') || combined.includes('gradex_status')
}

function assertGradexMetadataUpdate(error: unknown): void {
  if (!error) return
  if (isAssignmentGradexMetadataSchemaError(error)) {
    throw new Error('Assignment Gradex run metadata columns are unavailable. Apply migration 078.')
  }
  throw new Error('Failed to update assignment Gradex run metadata')
}

function isTerminalGradexRun(run: Pick<GradexSmokeRunResponse, 'status'>): boolean {
  return TERMINAL_GRADEX_STATUSES.has(run.status)
}

async function requestGradexJson<T>(
  config: GradexConfig,
  opts: {
    path: string
    method: 'GET' | 'POST'
    body?: unknown
    expectedStatus: number
    timeoutMs?: number
  },
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 25_000
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response

  try {
    response = await fetch(`${config.baseUrl}${opts.path}`, {
      method: opts.method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    })
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    throw new GradexRetryableRequestError(
      aborted ? 'Gradex request timed out' : 'Gradex request failed before a response was received',
      aborted ? 'gradex_timeout' : 'gradex_network_error',
    )
  } finally {
    clearTimeout(timeout)
  }

  const body = await response.json().catch(() => null)
  if (!response.ok || response.status !== opts.expectedStatus) {
    if (RETRYABLE_GRADEX_STATUS_CODES.has(response.status)) {
      throw new GradexRetryableRequestError(formatGradexError(body, response.status), 'gradex_retryable_http_error', response.status)
    }
    throw new Error(formatGradexError(body, response.status))
  }
  return body as T
}

function isGradexRetryableRequestError(error: unknown): error is GradexRetryableRequestError {
  return error instanceof GradexRetryableRequestError
}

function formatGradexError(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const error = (body as { error?: { message?: unknown; details?: unknown } }).error
    if (typeof error?.message === 'string') {
      return error.details === undefined
        ? error.message
        : `${error.message}: ${JSON.stringify(error.details)}`
    }
  }
  return `Gradex request failed with status ${status}`
}

async function loadGradexRunInputs(opts: {
  supabase: ServiceRoleSupabase
  assignment: Assignment
  items: AssignmentAiGradingRunItem[]
}): Promise<{
  assignmentDocs: GradexAssignmentDocRow[]
  submissionArtifacts: AssignmentSubmissionArtifact[]
  mappings: PikaGradexMapping[]
  gradexRequest: ReturnType<typeof buildPikaAssignmentGradexRunPayload>['gradexRequest']
}> {
  const itemByDocId = new Map(
    opts.items
      .filter((item) => item.assignment_doc_id)
      .map((item) => [item.assignment_doc_id!, item]),
  )
  const docIds = Array.from(itemByDocId.keys())

  if (docIds.length === 0) {
    throw new Error('Gradex assignment run has no gradable assignment documents')
  }

  const { data: docs, error: docsError } = await opts.supabase
    .from('assignment_docs')
    .select('id, student_id, content, submitted_at, authenticity_score, authenticity_flags')
    .in('id', docIds)

  if (docsError) {
    throw new Error('Failed to load assignment submissions for Gradex grading')
  }

  const docById = new Map(
    ((docs as GradexAssignmentDocRow[] | null) ?? []).map((doc) => [doc.id, doc]),
  )
  const assignmentDocs = docIds
    .map((docId) => docById.get(docId))
    .filter((doc): doc is GradexAssignmentDocRow => !!doc)

  if (assignmentDocs.length !== docIds.length) {
    throw new Error('Gradex assignment run is missing one or more assignment documents')
  }

  const submissionArtifacts = await loadAssignmentSubmissionArtifactsForDocs(opts.supabase as any, docIds)
  const sanitizationContext = await loadClassroomAiSanitizationContext(opts.supabase as any, opts.assignment.classroom_id)
  const built = buildPikaAssignmentGradexRunPayload({
    assignment: opts.assignment,
    assignmentDocs,
    submissionArtifacts,
    sanitizationContext,
  })

  return {
    assignmentDocs,
    submissionArtifacts,
    mappings: built.mappings,
    gradexRequest: built.gradexRequest,
  }
}

async function updateRunGradexMetadata(
  supabase: ServiceRoleSupabase,
  runId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from('assignment_ai_grading_runs')
    .update(payload)
    .eq('id', runId)

  assertGradexMetadataUpdate(error)
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

function getGradexRetryAt(attemptCount: number): string {
  const index = Math.max(0, Math.min(attemptCount - 1, GRADEX_ASSIGNMENT_RETRY_BACKOFF_SECONDS.length - 1))
  return new Date(Date.now() + GRADEX_ASSIGNMENT_RETRY_BACKOFF_SECONDS[index] * 1000).toISOString()
}

function isDueGradexItem(item: AssignmentAiGradingRunItem, nowMs: number): boolean {
  if (!item.assignment_doc_id || (item.status !== 'queued' && item.status !== 'processing')) {
    return false
  }
  if (!item.next_retry_at) return true

  const retryAt = new Date(item.next_retry_at).getTime()
  return !Number.isFinite(retryAt) || retryAt <= nowMs
}

function getDueGradexItems(items: AssignmentAiGradingRunItem[], nowMs = Date.now()): AssignmentAiGradingRunItem[] {
  return items.filter((item) => isDueGradexItem(item, nowMs))
}

async function markGradexItemsForRetryOrFailure(opts: {
  supabase: ServiceRoleSupabase
  items: AssignmentAiGradingRunItem[]
  errorCode: string
  errorMessage: string
  now: string
}): Promise<void> {
  await Promise.all(
    opts.items
      .filter((item) => item.assignment_doc_id && (item.status === 'queued' || item.status === 'processing'))
      .map((item) => {
        const attemptCount = item.attempt_count + 1
        const exhausted = attemptCount >= GRADEX_ASSIGNMENT_MAX_ATTEMPTS
        return updateRunItem(opts.supabase, item.id, {
          status: exhausted ? 'failed' : 'queued',
          attempt_count: attemptCount,
          next_retry_at: exhausted ? null : getGradexRetryAt(attemptCount),
          last_error_code: opts.errorCode,
          last_error_message: opts.errorMessage,
          completed_at: exhausted ? opts.now : null,
        })
      }),
  )
}

async function handleRetryableGradexError(opts: {
  supabase: ServiceRoleSupabase
  items: AssignmentAiGradingRunItem[]
  error: GradexRetryableRequestError
  now: string
}): Promise<void> {
  await markGradexItemsForRetryOrFailure({
    supabase: opts.supabase,
    items: opts.items,
    errorCode: opts.error.code,
    errorMessage: opts.error.message,
    now: opts.now,
  })
}

async function failUnresolvedGradexItems(opts: {
  supabase: ServiceRoleSupabase
  items: AssignmentAiGradingRunItem[]
  completedAssignmentDocIds: Set<string>
  errorCode: string
  errorMessage: string
  now: string
}): Promise<void> {
  await Promise.all(
    opts.items
      .filter((item) =>
        item.assignment_doc_id &&
        (item.status === 'queued' || item.status === 'processing') &&
        !opts.completedAssignmentDocIds.has(item.assignment_doc_id)
      )
      .map((item) =>
        updateRunItem(opts.supabase, item.id, {
          status: 'failed',
          attempt_count: item.attempt_count + 1,
          next_retry_at: null,
          last_error_code: opts.errorCode,
          last_error_message: opts.errorMessage,
          completed_at: opts.now,
        }),
      ),
  )
}

function withPseudonymousRunMetadata(
  request: ReturnType<typeof buildPikaAssignmentGradexRunPayload>['gradexRequest'],
  runId: string,
) {
  const runRef = pseudonymizePikaGradexRef('run', runId, getRequiredPseudonymSalt())
  return {
    ...request,
    assignment: {
      ...request.assignment,
      metadata: {
        ...request.assignment.metadata,
        client_run_ref: runRef,
        idempotency_key: runRef,
      },
    },
  }
}

async function submitGradexAssignmentRun(opts: {
  supabase: ServiceRoleSupabase
  assignment: Assignment
  run: AssignmentAiGradingRun
  items: AssignmentAiGradingRunItem[]
}): Promise<void> {
  const config = getGradexConfig()
  const dueItems = getDueGradexItems(opts.items)
  if (dueItems.length === 0) {
    return
  }

  const { gradexRequest } = await loadGradexRunInputs({
    supabase: opts.supabase,
    assignment: opts.assignment,
    items: dueItems,
  })
  const now = new Date().toISOString()
  const requestWithRunMetadata = withPseudonymousRunMetadata(gradexRequest, opts.run.id)

  await Promise.all(
    dueItems.map((item) =>
      updateRunItem(opts.supabase, item.id, {
        status: 'processing',
        started_at: item.started_at ?? now,
        next_retry_at: null,
      }),
    ),
  )

  let gradexRun: GradexSmokeRunResponse
  try {
    gradexRun = await requestGradexJson<GradexSmokeRunResponse>(config, {
      path: '/api/v1/grading-runs',
      method: 'POST',
      body: requestWithRunMetadata,
      expectedStatus: 202,
      timeoutMs: gradexRequest.settings.request_timeout_ms,
    })
  } catch (error) {
    if (isGradexRetryableRequestError(error)) {
      await handleRetryableGradexError({
        supabase: opts.supabase,
        items: dueItems,
        error,
        now,
      })
      return
    }
    throw error
  }

  await updateRunGradexMetadata(opts.supabase, opts.run.id, {
    gradex_run_id: gradexRun.id,
    gradex_status: gradexRun.status,
    gradex_submitted_at: now,
    gradex_last_polled_at: now,
  })
}

function isValidScore(value: number | null): value is number {
  return value != null && Number.isInteger(value) && value >= 0 && value <= 10
}

function formatGradexModel(record: {
  provider: string | null
  model: string | null
  tier: string | null
}) {
  const modelParts = [record.provider, record.model, record.tier].filter(Boolean)
  return modelParts.length > 0 ? `gradex:${modelParts.join('/')}` : GRADEX_ASSIGNMENT_RUN_MODEL
}

async function applyCompletedGradexRecord(opts: {
  supabase: ServiceRoleSupabase
  run: AssignmentAiGradingRun
  item: AssignmentAiGradingRunItem
  record: ReturnType<typeof mapGradexItemsToPikaGradeRecords>[number]
  now: string
}): Promise<void> {
  if (
    !isValidScore(opts.record.score_completion) ||
    !isValidScore(opts.record.score_thinking) ||
    !isValidScore(opts.record.score_workflow) ||
    !opts.record.feedback?.trim()
  ) {
    await updateRunItem(opts.supabase, opts.item.id, {
      status: 'failed',
      attempt_count: opts.item.attempt_count + 1,
      last_error_code: 'invalid_gradex_result',
      last_error_message: 'Gradex completed without complete Pika assignment scores and feedback',
      completed_at: opts.now,
    })
    return
  }

  const feedback = sanitizeAiOutputText(opts.record.feedback.trim())
  const { error } = await opts.supabase
    .from('assignment_docs')
    .update({
      score_completion: opts.record.score_completion,
      score_thinking: opts.record.score_thinking,
      score_workflow: opts.record.score_workflow,
      teacher_feedback_draft: feedback,
      teacher_feedback_draft_updated_at: opts.now,
      ai_feedback_suggestion: feedback,
      ai_feedback_suggested_at: opts.now,
      ai_feedback_model: formatGradexModel(opts.record),
      graded_at: opts.now,
      graded_by: opts.run.triggered_by,
    })
    .eq('id', opts.record.assignment_doc_id)

  if (error) {
    await updateRunItem(opts.supabase, opts.item.id, {
      status: 'failed',
      attempt_count: opts.item.attempt_count + 1,
      last_error_code: 'save_gradex_grade_failed',
      last_error_message: `Failed to save Gradex grade for student ${opts.item.student_id}`,
      completed_at: opts.now,
    })
    return
  }

  await updateRunItem(opts.supabase, opts.item.id, {
    status: 'completed',
    attempt_count: opts.item.attempt_count + 1,
    last_error_code: null,
    last_error_message: null,
    completed_at: opts.now,
  })
}

async function pollGradexAssignmentRun(opts: {
  supabase: ServiceRoleSupabase
  assignment: Assignment
  run: AssignmentAiGradingRun
  items: AssignmentAiGradingRunItem[]
}): Promise<void> {
  const config = getGradexConfig()
  const gradexRunId = opts.run.gradex_run_id
  if (!gradexRunId) {
    throw new Error('Gradex assignment run has not been submitted')
  }

  const now = new Date().toISOString()
  const dueItems = getDueGradexItems(opts.items)
  if (dueItems.length === 0) {
    return
  }

  let gradexRun: GradexSmokeRunResponse
  try {
    gradexRun = await requestGradexJson<GradexSmokeRunResponse>(config, {
      path: `/api/v1/grading-runs/${encodeURIComponent(gradexRunId)}`,
      method: 'GET',
      expectedStatus: 200,
    })
  } catch (error) {
    if (isGradexRetryableRequestError(error)) {
      await handleRetryableGradexError({
        supabase: opts.supabase,
        items: dueItems,
        error,
        now,
      })
      return
    }
    throw error
  }

  await updateRunGradexMetadata(opts.supabase, opts.run.id, {
    gradex_status: gradexRun.status,
    gradex_last_polled_at: now,
  })

  if (!isTerminalGradexRun(gradexRun)) {
    return
  }

  const { mappings } = await loadGradexRunInputs({
    supabase: opts.supabase,
    assignment: opts.assignment,
    items: dueItems,
  })
  const itemByAssignmentDocId = new Map(
    dueItems
      .filter((item) => item.assignment_doc_id)
      .map((item) => [item.assignment_doc_id!, item]),
  )
  let itemDetails: GradexSmokeRunItemResponse[]
  try {
    itemDetails = await Promise.all(
      (gradexRun.items ?? []).map((item) =>
        requestGradexJson<GradexSmokeRunItemResponse>(config, {
          path: `/api/v1/grading-runs/${encodeURIComponent(gradexRunId)}/items/${encodeURIComponent(item.id)}`,
          method: 'GET',
          expectedStatus: 200,
        }),
      ),
    )
  } catch (error) {
    if (isGradexRetryableRequestError(error)) {
      await handleRetryableGradexError({
        supabase: opts.supabase,
        items: dueItems,
        error,
        now,
      })
      return
    }
    throw error
  }

  let records: ReturnType<typeof mapGradexItemsToPikaGradeRecords>
  try {
    records = mapGradexItemsToPikaGradeRecords(mappings, itemDetails)
  } catch (error) {
    await markGradexItemsForRetryOrFailure({
      supabase: opts.supabase,
      items: dueItems,
      errorCode: 'gradex_mapping_failed',
      errorMessage: error instanceof Error ? error.message : 'Failed to map Gradex results to Pika records',
      now,
    })
    return
  }
  const resolvedAssignmentDocIds = new Set<string>()

  await Promise.all(
    records.map(async (record) => {
      const item = itemByAssignmentDocId.get(record.assignment_doc_id)
      if (!item) return
      resolvedAssignmentDocIds.add(record.assignment_doc_id)

      if (record.status !== 'completed') {
        await updateRunItem(opts.supabase, item.id, {
          status: 'failed',
          attempt_count: item.attempt_count + 1,
          last_error_code: 'gradex_item_failed',
          last_error_message: 'Gradex failed this assignment submission',
          completed_at: now,
        })
        return
      }

      await applyCompletedGradexRecord({
        supabase: opts.supabase,
        run: opts.run,
        item,
        record,
        now,
      })
    }),
  )

  await failUnresolvedGradexItems({
    supabase: opts.supabase,
    items: dueItems,
    completedAssignmentDocIds: resolvedAssignmentDocIds,
    errorCode: 'gradex_item_missing',
    errorMessage: `Gradex run ended with status ${gradexRun.status} without a result for this submission`,
    now,
  })
}

export async function submitOrPollGradexAssignmentRun(opts: {
  supabase: ServiceRoleSupabase
  assignment: Assignment
  run: AssignmentAiGradingRun
  items: AssignmentAiGradingRunItem[]
}): Promise<void> {
  if (!opts.run.gradex_run_id) {
    await submitGradexAssignmentRun(opts)
    return
  }

  await pollGradexAssignmentRun(opts)
}
