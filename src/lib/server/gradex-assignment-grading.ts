import { z } from 'zod'
import { loadClassroomAiSanitizationContext } from '@/lib/server/ai-sanitization'
import { finalizeAssignmentAiGradingItemAtomic } from '@/lib/server/assignment-grades'
import { loadAssignmentSubmissionArtifactsForDocs } from '@/lib/server/assignment-submission-artifacts'
import {
  buildPikaAssignmentGradexRunPayload,
  getRequiredPseudonymSalt,
  pseudonymizePikaGradexRef,
  type PikaGradexMapping,
} from '@/lib/server/gradex-assignment-payload'
import { mapGradexItemsToPikaGradeRecords, type GradexSmokeRunItemResponse, type GradexSmokeRunResponse } from '@/lib/server/gradex-smoke-runner'
import { sanitizeAiOutputText } from '@/lib/ai-sanitization'
import { getServiceRoleClient } from '@/lib/supabase'
import type { Assignment, AssignmentAiGradingRun, AssignmentAiGradingRunItem, AssignmentSubmissionArtifact, AuthenticityFlag } from '@/types'

export const GRADEX_ASSIGNMENT_RUN_MODEL = 'gradex:pika-assignment-v1'

const TERMINAL_GRADEX_STATUSES = new Set(['completed', 'completed_with_errors', 'failed'])
const RETRYABLE_GRADEX_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504])
const GRADEX_ASSIGNMENT_MAX_ATTEMPTS = 3
const GRADEX_ASSIGNMENT_RETRY_BACKOFF_SECONDS = [15, 60, 180]
const GRADEX_RECONCILIATION_RETRY_SECONDS = 60
const GRADEX_RECONCILIATION_DEADLINE_MS = 60 * 60 * 1000

const gradexRunItemSummarySchema = z.object({
  id: z.string().min(1),
  status: z.enum(['queued', 'processing', 'completed', 'failed', 'skipped']),
  external_submission_id: z.string().nullable(),
  external_student_id: z.string().nullable(),
  error: z.unknown().nullable(),
})

export const gradexAssignmentRunResponseSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['queued', 'running', 'completed', 'completed_with_errors', 'failed']),
  counts: z.object({
    requested: z.number().int().nonnegative(),
    processed: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
  }),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  tier: z.string().nullable(),
  policy_version: z.string().nullable(),
  prompt_version: z.string().nullable(),
  items: z.array(gradexRunItemSummarySchema).optional(),
})

export const gradexAssignmentRunItemResponseSchema = gradexRunItemSummarySchema.extend({
  result: z.object({
    provider: z.string(),
    model: z.string(),
    tier: z.string(),
    policy_version: z.string(),
    prompt_version: z.string(),
    audit_id: z.string(),
    token_usage: z.unknown().nullable(),
    criteria_results: z.array(z.object({
      criterion_id: z.string(),
      score: z.number(),
    })).optional(),
    feedback: z.object({ student: z.string().optional() }).optional(),
    compatibility: z.object({
      pika_assignment_v1: z.object({
        score_completion: z.number(),
        score_thinking: z.number(),
        score_workflow: z.number(),
        feedback: z.string(),
      }).optional(),
    }).optional(),
  }).nullable(),
})

type ServiceRoleSupabase = ReturnType<typeof getServiceRoleClient>

type GradexAssignmentDocRow = {
  id: string
  student_id: string
  content: unknown
  updated_at: string
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
    schema: z.ZodType<T>
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

  let body: unknown
  try {
    body = await response.json()
  } catch {
    if (response.ok && response.status === opts.expectedStatus) {
      throw new GradexRetryableRequestError(
        'Gradex returned an invalid JSON response',
        'gradex_invalid_response',
        response.status,
      )
    }
    body = null
  }
  if (!response.ok || response.status !== opts.expectedStatus) {
    if (RETRYABLE_GRADEX_STATUS_CODES.has(response.status)) {
      throw new GradexRetryableRequestError(formatGradexError(body, response.status), 'gradex_retryable_http_error', response.status)
    }
    throw new Error(formatGradexError(body, response.status))
  }
  const parsed = opts.schema.safeParse(body)
  if (!parsed.success) {
    throw new GradexRetryableRequestError(
      'Gradex returned a response that did not match the expected contract',
      'gradex_invalid_response',
      response.status,
    )
  }
  return parsed.data
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
    .select('id, student_id, content, updated_at, submitted_at, authenticity_score, authenticity_flags')
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

  const submissionArtifacts = await loadAssignmentSubmissionArtifactsForDocs(opts.supabase, docIds)
  const sanitizationContext = await loadClassroomAiSanitizationContext(opts.supabase, opts.assignment.classroom_id)
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
    .in('status', ['queued', 'processing'])

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

function hasGradexReconciliationDeadlineElapsed(
  run: Pick<AssignmentAiGradingRun, 'gradex_submitted_at' | 'created_at'>,
  nowMs: number,
): boolean {
  const submittedAt = new Date(run.gradex_submitted_at ?? run.created_at).getTime()
  return !Number.isFinite(submittedAt) || nowMs - submittedAt >= GRADEX_RECONCILIATION_DEADLINE_MS
}

async function scheduleGradexReconciliation(opts: {
  supabase: ServiceRoleSupabase
  run: Pick<AssignmentAiGradingRun, 'gradex_submitted_at' | 'created_at'>
  items: AssignmentAiGradingRunItem[]
  now: string
  error?: GradexRetryableRequestError
}): Promise<void> {
  const deadlineElapsed = hasGradexReconciliationDeadlineElapsed(opts.run, new Date(opts.now).getTime())
  const nextRetryAt = new Date(
    new Date(opts.now).getTime() + GRADEX_RECONCILIATION_RETRY_SECONDS * 1000,
  ).toISOString()

  await Promise.all(
    opts.items
      .filter((item) => item.assignment_doc_id && (item.status === 'queued' || item.status === 'processing'))
      .map((item) => updateRunItem(opts.supabase, item.id, deadlineElapsed
        ? {
            status: 'failed',
            attempt_count: item.attempt_count,
            next_retry_at: null,
            last_error_code: 'gradex_reconciliation_deadline_exceeded',
            last_error_message: 'Gradex run did not reach a reconcilable terminal state before the deadline',
            completed_at: opts.now,
          }
        : {
            status: 'processing',
            next_retry_at: nextRetryAt,
            last_error_code: opts.error?.code ?? null,
            last_error_message: opts.error?.message ?? null,
            completed_at: null,
          }),
      ),
  )
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
    gradexRun = await requestGradexJson(config, {
      path: '/api/v1/grading-runs',
      method: 'POST',
      body: requestWithRunMetadata,
      expectedStatus: 202,
      schema: gradexAssignmentRunResponseSchema,
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
  try {
    await finalizeAssignmentAiGradingItemAtomic({
      supabase: opts.supabase,
      itemId: opts.item.id,
      teacherId: opts.run.triggered_by,
      grade: {
        scoreCompletion: opts.record.score_completion,
        scoreThinking: opts.record.score_thinking,
        scoreWorkflow: opts.record.score_workflow,
        feedback,
        aiFeedbackSuggestion: feedback,
        aiFeedbackModel: formatGradexModel(opts.record),
        gradedBy: opts.run.triggered_by,
      },
      attemptCount: opts.item.attempt_count + 1,
      itemStatus: 'completed',
      now: opts.now,
    })
  } catch {
    await updateRunItem(opts.supabase, opts.item.id, {
      status: 'failed',
      attempt_count: opts.item.attempt_count + 1,
      last_error_code: 'save_gradex_grade_failed',
      last_error_message: `Failed to save Gradex grade for student ${opts.item.student_id}`,
      completed_at: opts.now,
    })
    return
  }

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
    gradexRun = await requestGradexJson(config, {
      path: `/api/v1/grading-runs/${encodeURIComponent(gradexRunId)}`,
      method: 'GET',
      expectedStatus: 200,
      schema: gradexAssignmentRunResponseSchema,
    })
  } catch (error) {
    if (isGradexRetryableRequestError(error)) {
      await scheduleGradexReconciliation({
        supabase: opts.supabase,
        run: opts.run,
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
    await scheduleGradexReconciliation({
      supabase: opts.supabase,
      run: opts.run,
      items: dueItems,
      now,
    })
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
        requestGradexJson(config, {
          path: `/api/v1/grading-runs/${encodeURIComponent(gradexRunId)}/items/${encodeURIComponent(item.id)}`,
          method: 'GET',
          expectedStatus: 200,
          schema: gradexAssignmentRunItemResponseSchema,
        }),
      ),
    )
  } catch (error) {
    if (isGradexRetryableRequestError(error)) {
      await scheduleGradexReconciliation({
        supabase: opts.supabase,
        run: opts.run,
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
