import type { AssignmentAiGradingRunSummary, TestAiGradingRunSummary } from '@/types'

type RunByResource = {
  assignment: AssignmentAiGradingRunSummary
  test: TestAiGradingRunSummary
}
type PollOptions<Resource extends keyof RunByResource> = {
  resource: Resource
  resourceId: string
  runId: string
  statusUrl: string
  onRun: (run: RunByResource[Resource]) => void
  onUnavailable: () => void
}

const ACTIVE_STATUSES = new Set(['queued', 'running'])
const RUN_STATUSES = new Set(['queued', 'running', 'completed', 'completed_with_errors', 'failed'])
const MAX_FAILURES = 6
const FAILURE_DEADLINE_MS = 120_000
const MAX_STATUS_WAIT_MS = 60_250

class PollFailure extends Error {
  constructor(readonly retryable: boolean) { super('Grading status unavailable') }
}

function parseRun<Resource extends keyof RunByResource>(
  data: unknown,
  options: PollOptions<Resource>,
): RunByResource[Resource] {
  const run = data && typeof data === 'object' && 'run' in data ? data.run : null
  if (!run || typeof run !== 'object') throw new PollFailure(false)
  const value = run as Record<string, unknown>
  const countFields = ['requested_count', 'processed_count', 'completed_count', 'failed_count', 'pending_count',
    ...(options.resource === 'assignment'
      ? ['gradable_count', 'skipped_missing_count', 'skipped_empty_count']
      : ['eligible_student_count', 'queued_response_count', 'skipped_unanswered_count', 'skipped_already_graded_count'])]
  if (
    value.id !== options.runId || value[`${options.resource}_id`] !== options.resourceId ||
    typeof value.status !== 'string' || !RUN_STATUSES.has(value.status) ||
    countFields.some((field) => !Number.isSafeInteger(value[field]) || (value[field] as number) < 0) ||
    !Array.isArray(value.error_samples) ||
    (value.next_retry_at !== null && (typeof value.next_retry_at !== 'string' || !Number.isFinite(Date.parse(value.next_retry_at))))
  ) throw new PollFailure(false)
  return run as RunByResource[Resource]
}

/** Fresh status must authorize each teacher-driven tick. Durable run state stays server-owned. */
export function startAiGradingRunPolling<Resource extends keyof RunByResource>(
  options: PollOptions<Resource>,
): () => void {
  let cancelled = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  let requestAbort: AbortController | undefined
  let failures = 0
  let firstFailureAt: number | undefined

  const stopUnavailable = () => {
    if (cancelled) return
    cancelled = true
    clearTimeout(timeout)
    requestAbort?.abort()
    options.onUnavailable()
  }

  const assertActive = () => {
    if (cancelled) throw new PollFailure(false)
    if (firstFailureAt !== undefined && Date.now() - firstFailureAt >= FAILURE_DEADLINE_MS) {
      stopUnavailable()
      throw new PollFailure(false)
    }
  }

  const readRun = async (method: 'GET' | 'POST') => {
    assertActive()
    const controller = new AbortController()
    requestAbort = controller
    // Ticks can own a bounded server chunk for up to the route's five-minute limit.
    const requestWait = method === 'GET' ? 30_000 : 300_000
    const failureWait = firstFailureAt === undefined ? requestWait
      : FAILURE_DEADLINE_MS - (Date.now() - firstFailureAt)
    const requestTimeout = setTimeout(() => {
      if (firstFailureAt !== undefined && Date.now() - firstFailureAt >= FAILURE_DEADLINE_MS) {
        stopUnavailable()
      } else {
        controller.abort()
      }
    }, Math.min(requestWait, failureWait))
    try {
      const response = await fetch(method === 'GET' ? options.statusUrl : `${options.statusUrl}/tick`, {
        method, signal: controller.signal, cache: 'no-store',
      })
      assertActive()
      if (controller.signal.aborted) throw new PollFailure(true)
      if (!response.ok) {
        throw new PollFailure(response.status === 408 || response.status === 429 || response.status >= 500)
      }
      let data: unknown
      // Invalid JSON is permanent; a broken body stream or timeout can recover.
      try { data = await response.json() } catch (error) {
        throw new PollFailure(!(error instanceof SyntaxError))
      }
      assertActive()
      if (controller.signal.aborted) throw new PollFailure(true)
      return parseRun(data, options)
    } finally {
      clearTimeout(requestTimeout)
      if (requestAbort === controller) requestAbort = undefined
    }
  }

  const syncRun = async () => {
    if (cancelled) return
    if (firstFailureAt !== undefined && Date.now() - firstFailureAt >= FAILURE_DEADLINE_MS) {
      stopUnavailable()
      return
    }
    let nextDelay = 2000
    try {
      let run = await readRun('GET')
      if (cancelled) return
      options.onRun(run)
      if (!ACTIVE_STATUSES.has(run.status)) return
      const retryAt = run.next_retry_at ? Date.parse(run.next_retry_at) : 0
      if (retryAt > Date.now()) {
        // Reconcile long waits at most once a minute; never tick before the due time.
        nextDelay = Math.min(retryAt - Date.now() + 250, MAX_STATUS_WAIT_MS)
      } else {
        if (cancelled) return
        run = await readRun('POST')
        if (cancelled) return
        options.onRun(run)
        if (!ACTIVE_STATUSES.has(run.status)) return
        const tickRetryAt = run.next_retry_at ? Date.parse(run.next_retry_at) : 0
        if (tickRetryAt > Date.now()) nextDelay = Math.min(tickRetryAt - Date.now() + 250, MAX_STATUS_WAIT_MS)
      }
      failures = 0
      firstFailureAt = undefined
    } catch (error) {
      if (cancelled) return
      failures += 1
      firstFailureAt ??= Date.now()
      if ((error instanceof PollFailure && !error.retryable) || failures >= MAX_FAILURES ||
        Date.now() - firstFailureAt >= FAILURE_DEADLINE_MS) {
        stopUnavailable()
        return
      }
      const backoff = Math.min(2000 * 2 ** (failures - 1), 30_000)
      nextDelay = Math.min(backoff * (1 + Math.random() * 0.05),
        FAILURE_DEADLINE_MS - (Date.now() - firstFailureAt))
    }
    if (!cancelled) timeout = setTimeout(() => { void syncRun() }, nextDelay)
  }

  void syncRun()
  return () => {
    cancelled = true
    clearTimeout(timeout)
    requestAbort?.abort()
  }
}
