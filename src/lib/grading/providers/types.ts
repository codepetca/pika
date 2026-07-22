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
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high'
}

export interface StructuredOutputResponse {
  outputText: string
  tokenUsage: GradingTokenUsage
  requestCount: number
}

export interface StructuredOutputProvider {
  readonly id: string
  generate(request: StructuredOutputRequest): Promise<StructuredOutputResponse>
}
