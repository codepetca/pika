import { z } from 'zod'
import { hasGradableAssignmentSubmission, isBlankAssignmentSubmission } from '@/lib/ai-grading'
import { parseContentField } from '@/lib/tiptap-content'
import { submissionArtifactsToAssignmentArtifacts } from '@/lib/assignment-submission-requirements'
import {
  AssignmentAiUsageError,
  failAssignmentAiGradingItemUsage,
  getAssignmentAiUsageFailureReason,
  reserveAssignmentAiGradingItemUsage,
  skipAssignmentAiGradingItemUsage,
  type AssignmentAiUsageFailureReason,
} from '@/lib/server/assignment-ai-grading-usage'
import { loadClassroomAiSanitizationContext } from '@/lib/server/ai-sanitization'
import {
  AssignmentAiGradingLeaseLostError,
  patchAssignmentAiGradingItemWithLease,
  patchAssignmentAiGradingRunWithLease,
} from '@/lib/server/assignment-ai-grading-lease'
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
import type { Json } from '@/types/database.generated'
import type { Assignment, AssignmentAiGradingRun, AssignmentAiGradingRunItem, AssignmentSubmissionArtifact, AuthenticityFlag } from '@/types'

export const GRADEX_ASSIGNMENT_RUN_MODEL = 'gradex:pika-assignment-v1'

const TERMINAL_GRADEX_STATUSES = new Set(['completed', 'completed_with_errors', 'failed'])
const RETRYABLE_GRADEX_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504])
const GRADEX_ASSIGNMENT_MAX_ATTEMPTS = 3
const GRADEX_ASSIGNMENT_RETRY_BACKOFF_SECONDS = [15, 60, 180]

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
  const baseUrl = process.env.GRADEX_API_URL?.trim()
  const apiKey = process.env.GRADEX_API_KEY?.trim()

  if (!baseUrl || !apiKey) {
    throw new Error('Gradex assignment grading is enabled but GRADEX_API_URL or GRADEX_API_KEY is missing')
  }

  const invalidUrl = () => new Error('Gradex API URL must be an HTTPS origin (loopback HTTP is allowed only in development)')
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw invalidUrl()
  }
  const localHttp = process.env.NODE_ENV === 'development'
    && url.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    (url.protocol !== 'https:' && !localHttp)
    || url.username || url.password || url.pathname !== '/'
    || baseUrl.includes('?') || baseUrl.includes('#')
  ) {
    throw invalidUrl()
  }
  return { baseUrl: url.origin, apiKey }
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
    try {
      response = await fetch(`${config.baseUrl}${opts.path}`, {
        method: opts.method,
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
      })
    } catch (error) {
      const aborted = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
      throw new GradexRetryableRequestError(
        aborted ? 'Gradex request timed out' : 'Gradex request failed before a response was received',
        aborted ? 'gradex_timeout' : 'gradex_network_error',
      )
    }

    if (!response.ok || response.status !== opts.expectedStatus) {
      await response.body?.cancel().catch(() => {})
      const message = `Gradex request failed with status ${response.status}`
      if (RETRYABLE_GRADEX_STATUS_CODES.has(response.status)) {
        throw new GradexRetryableRequestError(message, 'gradex_retryable_http_error', response.status)
      }
      throw new Error(message)
    }
    try {
      return opts.schema.parse(await response.json())
    } catch (error) {
      if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        throw new GradexRetryableRequestError('Gradex request timed out', 'gradex_timeout')
      }
      // JSON/schema errors can contain provider text, including echoed student work.
      throw new Error('Gradex returned an invalid response')
    }
  } finally {
    clearTimeout(timeout)
  }
}

function isGradexRetryableRequestError(error: unknown): error is GradexRetryableRequestError {
  return error instanceof GradexRetryableRequestError
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
  leaseToken: string,
  leaseFencingEnabled: boolean,
  payload: Record<string, unknown>,
): Promise<void> {
  await patchAssignmentAiGradingRunWithLease({
    supabase,
    runId,
    leaseToken,
    leaseFencingEnabled,
    patch: payload as Json,
  })
}

async function updateRunItem(
  supabase: ServiceRoleSupabase,
  itemId: string,
  leaseToken: string,
  leaseFencingEnabled: boolean,
  payload: Record<string, unknown>,
  releaseReason: AssignmentAiUsageFailureReason = 'internal_failure',
): Promise<void> {
  if (leaseFencingEnabled && payload.status === 'failed') {
    await failAssignmentAiGradingItemUsage({ supabase, itemId, leaseToken,
      attemptCount: Number(payload.attempt_count), releaseReason })
    return
  }
  await patchAssignmentAiGradingItemWithLease({
    supabase,
    itemId,
    leaseToken,
    leaseFencingEnabled,
    patch: payload as Json,
  })
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
  leaseToken: string
  leaseFencingEnabled: boolean
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
        return updateRunItem(opts.supabase, item.id, opts.leaseToken, opts.leaseFencingEnabled, {
          status: exhausted ? 'failed' : 'queued',
          attempt_count: attemptCount,
          next_retry_at: exhausted ? null : getGradexRetryAt(attemptCount),
          last_error_code: opts.errorCode,
          last_error_message: opts.errorMessage,
          completed_at: exhausted ? opts.now : null,
        }, 'provider_failed')
      }),
  )
}

async function handleRetryableGradexError(opts: {
  supabase: ServiceRoleSupabase
  items: AssignmentAiGradingRunItem[]
  leaseToken: string
  leaseFencingEnabled: boolean
  error: GradexRetryableRequestError
  now: string
}): Promise<void> {
  await markGradexItemsForRetryOrFailure({
    supabase: opts.supabase,
    items: opts.items,
    leaseToken: opts.leaseToken,
    leaseFencingEnabled: opts.leaseFencingEnabled,
    errorCode: opts.error.code,
    errorMessage: opts.error.message,
    now: opts.now,
  })
}

async function failUnresolvedGradexItems(opts: {
  supabase: ServiceRoleSupabase
  items: AssignmentAiGradingRunItem[]
  leaseToken: string
  leaseFencingEnabled: boolean
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
        updateRunItem(opts.supabase, item.id, opts.leaseToken, opts.leaseFencingEnabled, {
          status: 'failed',
          attempt_count: item.attempt_count + 1,
          next_retry_at: null,
          last_error_code: opts.errorCode,
          last_error_message: opts.errorMessage,
          completed_at: opts.now,
        }, 'provider_failed'),
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
  leaseToken: string
  leaseFencingEnabled: boolean
}): Promise<void> {
  const config = getGradexConfig()
  let dueItems = getDueGradexItems(opts.items)
  if (dueItems.length === 0) {
    return
  }

  const { gradexRequest, mappings } = await loadGradexRunInputs({
    supabase: opts.supabase,
    assignment: opts.assignment,
    items: dueItems,
  })
  const now = new Date().toISOString()
  const requestWithRunMetadata = withPseudonymousRunMetadata(gradexRequest, opts.run.id)

  await Promise.all(
    dueItems.map((item) =>
      updateRunItem(opts.supabase, item.id, opts.leaseToken, opts.leaseFencingEnabled, {
        status: 'processing',
        started_at: item.started_at ?? now,
        next_retry_at: null,
      }),
    ),
  )

  if (opts.run.worker_contract_version === 1) {
    dueItems = await admitMeteredGradexItems({ ...opts, items: dueItems })
    if (dueItems.length === 0) return
    const admittedDocs = new Set(dueItems.map((item) => item.assignment_doc_id))
    const admittedRefs = new Set(mappings.filter((mapping) => admittedDocs.has(mapping.assignment_doc_id))
      .map((mapping) => mapping.gradex_submission_id))
    requestWithRunMetadata.submissions = requestWithRunMetadata.submissions
      .filter((submission) => admittedRefs.has(submission.external_submission_id))
    requestWithRunMetadata.workflow_evidence_by_submission_id = Object.fromEntries(
      Object.entries(requestWithRunMetadata.workflow_evidence_by_submission_id)
        .filter(([ref]) => admittedRefs.has(ref)),
    )
    if (requestWithRunMetadata.submissions.length !== dueItems.length) {
      throw new Error('AI grading is temporarily unavailable')
    }
  }

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
        leaseToken: opts.leaseToken,
        leaseFencingEnabled: opts.leaseFencingEnabled,
        error,
        now,
      })
      return
    }
    if (opts.run.worker_contract_version === 1) throw new AssignmentAiUsageError('provider_failed')
    throw error
  }

  await updateRunGradexMetadata(opts.supabase, opts.run.id, opts.leaseToken, opts.leaseFencingEnabled, {
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
  leaseToken: string
  leaseFencingEnabled: boolean
  record: ReturnType<typeof mapGradexItemsToPikaGradeRecords>[number]
  now: string
}): Promise<void> {
  if (
    !isValidScore(opts.record.score_completion) ||
    !isValidScore(opts.record.score_thinking) ||
    !isValidScore(opts.record.score_workflow) ||
    !opts.record.feedback?.trim()
  ) {
    await updateRunItem(opts.supabase, opts.item.id, opts.leaseToken, opts.leaseFencingEnabled, {
      status: 'failed',
      attempt_count: opts.item.attempt_count + 1,
      last_error_code: 'invalid_gradex_result',
      last_error_message: 'Gradex completed without complete Pika assignment scores and feedback',
      completed_at: opts.now,
    }, 'provider_failed')
    return
  }

  const feedback = sanitizeAiOutputText(opts.record.feedback.trim())
  try {
    await finalizeAssignmentAiGradingItemAtomic({
      supabase: opts.supabase,
      itemId: opts.item.id,
      leaseToken: opts.leaseToken,
      leaseFencingEnabled: opts.leaseFencingEnabled,
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
  } catch (error) {
    if (error instanceof AssignmentAiGradingLeaseLostError) throw error
    await updateRunItem(opts.supabase, opts.item.id, opts.leaseToken, opts.leaseFencingEnabled, {
      status: 'failed',
      attempt_count: opts.item.attempt_count + 1,
      last_error_code: 'save_gradex_grade_failed',
      last_error_message: `Failed to save Gradex grade for student ${opts.item.student_id}`,
      completed_at: opts.now,
    }, getAssignmentAiUsageFailureReason(error))
    return
  }

}

async function pollGradexAssignmentRun(opts: {
  supabase: ServiceRoleSupabase
  assignment: Assignment
  run: AssignmentAiGradingRun
  items: AssignmentAiGradingRunItem[]
  leaseToken: string
  leaseFencingEnabled: boolean
}): Promise<void> {
  const config = getGradexConfig()
  const gradexRunId = opts.run.gradex_run_id
  if (!gradexRunId) {
    throw new Error('Gradex assignment run has not been submitted')
  }

  const now = new Date().toISOString()
  const dueItems = opts.run.worker_contract_version === 1
    ? await admitMeteredGradexItems({ ...opts, items: getDueGradexItems(opts.items) })
    : getDueGradexItems(opts.items)
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
      await handleRetryableGradexError({
        supabase: opts.supabase,
        items: dueItems,
        leaseToken: opts.leaseToken,
        leaseFencingEnabled: opts.leaseFencingEnabled,
        error,
        now,
      })
      return
    }
    if (opts.run.worker_contract_version === 1) throw new AssignmentAiUsageError('provider_failed')
    throw error
  }

  await updateRunGradexMetadata(opts.supabase, opts.run.id, opts.leaseToken, opts.leaseFencingEnabled, {
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
      await handleRetryableGradexError({
        supabase: opts.supabase,
        items: dueItems,
        leaseToken: opts.leaseToken,
        leaseFencingEnabled: opts.leaseFencingEnabled,
        error,
        now,
      })
      return
    }
    if (opts.run.worker_contract_version === 1) throw new AssignmentAiUsageError('provider_failed')
    throw error
  }

  let records: ReturnType<typeof mapGradexItemsToPikaGradeRecords>
  try {
    records = mapGradexItemsToPikaGradeRecords(mappings, itemDetails)
  } catch {
    await markGradexItemsForRetryOrFailure({
      supabase: opts.supabase,
      items: dueItems,
      leaseToken: opts.leaseToken,
      leaseFencingEnabled: opts.leaseFencingEnabled,
      errorCode: 'gradex_mapping_failed',
      errorMessage: 'Failed to map Gradex results to Pika records',
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
        await updateRunItem(opts.supabase, item.id, opts.leaseToken, opts.leaseFencingEnabled, {
          status: 'failed',
          attempt_count: item.attempt_count + 1,
          last_error_code: 'gradex_item_failed',
          last_error_message: 'Gradex failed this assignment submission',
          completed_at: now,
        }, 'provider_failed')
        return
      }

      await applyCompletedGradexRecord({
        supabase: opts.supabase,
        run: opts.run,
        item,
        leaseToken: opts.leaseToken,
        leaseFencingEnabled: opts.leaseFencingEnabled,
        record,
        now,
      })
    }),
  )

  await failUnresolvedGradexItems({
    supabase: opts.supabase,
    items: dueItems,
    leaseToken: opts.leaseToken,
    leaseFencingEnabled: opts.leaseFencingEnabled,
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
  leaseToken: string
  leaseFencingEnabled: boolean
}): Promise<void> {
  // Persisted version, never the current rollout flag, owns a running job.
  if (opts.run.worker_contract_version === 1) {
    opts = { ...opts, leaseFencingEnabled: true, items: await filterMeteredGradexSources(opts) }
    if (opts.items.length === 0) return
  }
  if (!opts.run.gradex_run_id) {
    await submitGradexAssignmentRun(opts)
    return
  }

  await pollGradexAssignmentRun(opts)
}

async function admitMeteredGradexItems(opts: {
  supabase: ServiceRoleSupabase; run: AssignmentAiGradingRun
  items: AssignmentAiGradingRunItem[]; leaseToken: string
}): Promise<AssignmentAiGradingRunItem[]> {
  const admitted: AssignmentAiGradingRunItem[] = []
  for (const item of opts.items) {
    try {
      await reserveAssignmentAiGradingItemUsage({ supabase: opts.supabase, itemId: item.id,
        leaseToken: opts.leaseToken, teacherId: opts.run.triggered_by })
      admitted.push(item)
    } catch (error) {
      if (error instanceof AssignmentAiGradingLeaseLostError) throw error
      await failAssignmentAiGradingItemUsage({ supabase: opts.supabase, itemId: item.id,
        leaseToken: opts.leaseToken, attemptCount: item.attempt_count + 1,
        releaseReason: getAssignmentAiUsageFailureReason(error) })
    }
  }
  return admitted
}

async function filterMeteredGradexSources(opts: {
  supabase: ServiceRoleSupabase; items: AssignmentAiGradingRunItem[]; leaseToken: string
}): Promise<AssignmentAiGradingRunItem[]> {
  const pending = opts.items.filter((item) => item.status === 'queued' || item.status === 'processing')
  if (!pending.length) return []
  const docIds = pending.flatMap((item) => item.assignment_doc_id ? [item.assignment_doc_id] : [])
  const { data, error } = await opts.supabase.from('assignment_docs').select('id, content').in('id', docIds)
  if (error) throw new Error('AI grading is temporarily unavailable')
  const artifacts = await loadAssignmentSubmissionArtifactsForDocs(opts.supabase, docIds)
  const eligible: AssignmentAiGradingRunItem[] = []
  for (const item of pending) {
    const doc = data?.find((candidate) => candidate.id === item.assignment_doc_id)
    const work = parseContentField(doc?.content)
    const submissionArtifacts = submissionArtifactsToAssignmentArtifacts(
      artifacts.filter((artifact) => artifact.assignment_doc_id === item.assignment_doc_id),
    )
    if (!doc || !hasGradableAssignmentSubmission(work, submissionArtifacts)
      || isBlankAssignmentSubmission(work, submissionArtifacts)) {
      await skipAssignmentAiGradingItemUsage({ supabase: opts.supabase, itemId: item.id,
        leaseToken: opts.leaseToken, attemptCount: item.attempt_count + 1,
        skipReason: doc ? 'empty_doc' : 'missing_doc' })
    } else {
      eligible.push(item)
    }
  }
  return eligible
}
