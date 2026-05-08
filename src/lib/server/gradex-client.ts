import type { GradexGradeSyncRequest } from '@/lib/server/gradex-assignment-payload'

export type GradexClientErrorKind =
  | 'config'
  | 'timeout'
  | 'network'
  | 'rate_limit'
  | 'server'
  | 'bad_response'
  | 'invalid_response'

export interface GradexPikaAssignmentResult {
  score_completion: number
  score_thinking: number
  score_workflow: number
  feedback: string
  model: string
  auditId: string | null
  gradingProfileVersion: string | null
}

export class GradexClientError extends Error {
  readonly kind: GradexClientErrorKind
  readonly retryable: boolean
  readonly statusCode: number | null

  constructor(opts: {
    kind: GradexClientErrorKind
    message: string
    retryable: boolean
    statusCode?: number | null
  }) {
    super(opts.message)
    this.name = 'GradexClientError'
    this.kind = opts.kind
    this.retryable = opts.retryable
    this.statusCode = opts.statusCode ?? null
  }
}

const DEFAULT_REQUEST_TIMEOUT_MS = 25_000
const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504])

export function isGradexAssignmentGradingEnabled(): boolean {
  const value = process.env.GRADEX_ASSIGNMENT_GRADING_ENABLED?.trim().toLowerCase()
  return value === 'true' || value === '1' || value === 'yes'
}

function getRequiredEnv(name: 'GRADEX_API_URL' | 'GRADEX_API_KEY'): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new GradexClientError({
      kind: 'config',
      message: `${name} is not configured`,
      retryable: false,
    })
  }
  return value
}

function buildGradexSyncUrl(apiUrl: string): string {
  const normalized = apiUrl.trim().replace(/\/+$/, '')

  if (!normalized) {
    throw new GradexClientError({
      kind: 'config',
      message: 'GRADEX_API_URL is not configured',
      retryable: false,
    })
  }

  if (normalized.endsWith('/api/v1/grade/sync')) {
    return normalized
  }

  if (normalized.endsWith('/api/v1')) {
    return `${normalized}/grade/sync`
  }

  return `${normalized}/api/v1/grade/sync`
}

function toHttpError(statusCode: number): GradexClientError {
  const retryable = RETRYABLE_STATUS_CODES.has(statusCode)
  const kind: GradexClientErrorKind =
    statusCode === 429
      ? 'rate_limit'
      : statusCode === 401 || statusCode === 403
        ? 'config'
        : retryable
          ? 'server'
          : 'bad_response'

  return new GradexClientError({
    kind,
    message: `Gradex request failed (${statusCode})`,
    retryable,
    statusCode,
  })
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  )
}

function coerceScore(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10) {
    throw new GradexClientError({
      kind: 'invalid_response',
      message: `Gradex response has invalid ${label}`,
      retryable: false,
    })
  }
  return value
}

function parsePikaAssignmentCompatibility(payload: unknown): GradexPikaAssignmentResult {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null
  const compatibility = record?.compatibility && typeof record.compatibility === 'object'
    ? record.compatibility as Record<string, unknown>
    : null
  const pika = compatibility?.pika_assignment_v1 && typeof compatibility.pika_assignment_v1 === 'object'
    ? compatibility.pika_assignment_v1 as Record<string, unknown>
    : null

  if (!pika) {
    throw new GradexClientError({
      kind: 'invalid_response',
      message: 'Gradex response is missing Pika assignment compatibility data',
      retryable: false,
    })
  }

  const feedback = typeof pika.feedback === 'string' ? pika.feedback.trim() : ''
  if (!feedback) {
    throw new GradexClientError({
      kind: 'invalid_response',
      message: 'Gradex response has empty Pika assignment feedback',
      retryable: false,
    })
  }

  return {
    score_completion: coerceScore(pika.score_completion, 'score_completion'),
    score_thinking: coerceScore(pika.score_thinking, 'score_thinking'),
    score_workflow: coerceScore(pika.score_workflow, 'score_workflow'),
    feedback,
    model: typeof record?.model === 'string' && record.model.trim() ? record.model.trim() : 'gradex',
    auditId: typeof record?.audit_id === 'string' && record.audit_id.trim() ? record.audit_id.trim() : null,
    gradingProfileVersion:
      typeof record?.grading_profile_version === 'string' && record.grading_profile_version.trim()
        ? record.grading_profile_version.trim()
        : null,
  }
}

export async function gradePikaAssignmentWithGradex(
  payload: GradexGradeSyncRequest,
  opts?: { requestTimeoutMs?: number },
): Promise<GradexPikaAssignmentResult> {
  const apiUrl = getRequiredEnv('GRADEX_API_URL')
  const apiKey = getRequiredEnv('GRADEX_API_KEY')
  const timeoutMs =
    opts?.requestTimeoutMs && opts.requestTimeoutMs > 0
      ? opts.requestTimeoutMs
      : payload.settings.request_timeout_ms || DEFAULT_REQUEST_TIMEOUT_MS

  let response: Response
  try {
    response = await fetch(buildGradexSyncUrl(apiUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new GradexClientError({
        kind: 'timeout',
        message: 'Gradex grading request timed out',
        retryable: true,
      })
    }

    throw new GradexClientError({
      kind: 'network',
      message: 'Gradex request failed before receiving a response',
      retryable: true,
    })
  }

  if (!response.ok) {
    throw toHttpError(response.status)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new GradexClientError({
      kind: 'invalid_response',
      message: 'Gradex response was not valid JSON',
      retryable: false,
    })
  }

  return parsePikaAssignmentCompatibility(body)
}
