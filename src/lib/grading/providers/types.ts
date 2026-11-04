import type { GradingTokenUsage } from '@/lib/grading/contracts'

export type GradingProviderErrorKind =
  | 'config'
  | 'timeout'
  | 'network'
  | 'rate_limit'
  | 'server'
  | 'bad_response'

export class GradingProviderError extends Error {
  readonly kind: GradingProviderErrorKind
  readonly retryable: boolean
  readonly statusCode: number | null

  constructor(opts: {
    kind: GradingProviderErrorKind
    message: string
    retryable: boolean
    statusCode?: number | null
  }) {
    super(opts.message)
    this.name = 'GradingProviderError'
    this.kind = opts.kind
    this.retryable = opts.retryable
    this.statusCode = opts.statusCode ?? null
  }
}

export interface StructuredOutputRequest {
  model: string
  systemPrompt: string
  userPrompt: string
  schemaName: string
  jsonSchema: Record<string, unknown>
  initialMaxOutputTokens: number
  fallbackMaxOutputTokens: number
  requestTimeoutMs?: number
  /** Absolute performance.now() deadline shared across all provider attempts. */
  deadlineMs?: number
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high'
  /** Some grading policies require every attempt to stay at the requested effort. */
  allowEffortDowngrade?: boolean
}

export interface StructuredOutputResponse {
  outputText: string
  /** Actual provider and model when a routing provider selected an alternative. */
  providerUsed?: string
  modelUsed?: string
  tokenUsage: GradingTokenUsage
  requestCount: number
  /**
   * The effort the successful attempt actually ran at. Lower than the requested effort
   * when a provider had to think less to fit its output budget, so a downgraded grade is
   * distinguishable from a normal one after the fact.
   */
  reasoningEffortUsed: StructuredOutputRequest['reasoningEffort']
}

export interface StructuredOutputProvider {
  readonly id: string
  generate(request: StructuredOutputRequest): Promise<StructuredOutputResponse>
}

/** Limit each HTTP attempt by both its timeout and the shared monotonic deadline. */
export function gradingProviderAttemptSignal(request: StructuredOutputRequest): AbortSignal | undefined {
  const remaining = request.deadlineMs === undefined ? Infinity : request.deadlineMs - performance.now()
  if (remaining <= 0) {
    throw new GradingProviderError({ kind: 'timeout', message: 'Grading request timed out', retryable: true })
  }
  const perAttempt = request.requestTimeoutMs && request.requestTimeoutMs > 0 ? request.requestTimeoutMs : Infinity
  const timeout = Math.min(perAttempt, remaining)
  return Number.isFinite(timeout) ? AbortSignal.timeout(Math.max(1, Math.ceil(timeout))) : undefined
}
