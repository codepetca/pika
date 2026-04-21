export interface AiPromptMetrics {
  systemChars: number
  userChars: number
  totalChars: number
  estimatedInputTokens: number
}

export interface OpenAIResponseUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

export interface AiPromptTelemetryEvent {
  feature: string
  operation: string
  model: string
  promptProfile: string
  status?: 'success' | 'error'
  errorClass?: string | null
  runId?: string | null
  studentId?: string | null
  attempt?: number | null
  requestedStrategy?: string | null
  resolvedStrategy?: string | null
  questionType?: 'coding' | 'non-coding' | 'n/a'
  responseCount?: number | null
  cacheStatus?: 'hit' | 'miss' | 'not_applicable'
  sampleSolutionIncluded?: boolean | null
  systemChars: number
  userChars: number
  promptChars: number
  estimatedInputTokens: number
  actualInputTokens?: number | null
  actualOutputTokens?: number | null
  actualTotalTokens?: number | null
}

const ESTIMATED_CHARS_PER_TOKEN = 4

function toOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function estimatePromptMetrics(systemPrompt: string, userPrompt: string): AiPromptMetrics {
  const systemChars = systemPrompt.length
  const userChars = userPrompt.length
  const totalChars = systemChars + userChars

  return {
    systemChars,
    userChars,
    totalChars,
    estimatedInputTokens: Math.ceil(totalChars / ESTIMATED_CHARS_PER_TOKEN),
  }
}

export function extractOpenAIResponseUsage(payload: any): OpenAIResponseUsage {
  const usage = payload?.usage ?? payload ?? {}

  return {
    inputTokens: toOptionalNumber(usage?.input_tokens),
    outputTokens: toOptionalNumber(usage?.output_tokens),
    totalTokens: toOptionalNumber(usage?.total_tokens),
  }
}

export function logAiPromptTelemetry(event: AiPromptTelemetryEvent): void {
  console.info('[ai-prompt-telemetry]', JSON.stringify(event))
}
