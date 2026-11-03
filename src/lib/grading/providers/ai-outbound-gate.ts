import { GradingProviderError } from '@/lib/grading/providers/types'

/** Raised before any provider request when the server-wide AI stop is active. */
export class AIOutboundDisabledError extends GradingProviderError {
  constructor() {
    super({ kind: 'config', message: 'Outbound AI requests are disabled', retryable: false })
    this.name = 'AIOutboundDisabledError'
  }
}

/** Read at every request boundary so retries cannot bypass a newly activated stop. */
export function assertAIOutboundEnabled(): void {
  const value = process.env.PIKA_AI_API_ENABLED
  if (value !== undefined && value !== 'true') {
    throw new AIOutboundDisabledError()
  }
}
