import { createDeepSeekChatProvider } from '@/lib/grading/providers/deepseek-chat'
import { createOpenAiResponsesProvider, OpenAiSpendLimitError } from '@/lib/grading/providers/openai-responses'
import { GradingProviderError, type StructuredOutputProvider } from '@/lib/grading/providers/types'
import { assertAIOutboundEnabled } from '@/lib/grading/providers/ai-outbound-gate'

function providerMode(): 'openai' | 'deepseek' {
  const mode = process.env.PIKA_AI_GRADING_PROVIDER?.trim() || 'openai'
  if (mode === 'openai' || mode === 'deepseek') return mode
  throw new GradingProviderError({ kind: 'config', message: 'Invalid AI grading provider', retryable: false })
}

type GradingScope = 'classroom' | 'repo-review'

function getOpenAiGradingModel(scope: GradingScope): string {
  const defaultModel = scope === 'repo-review' ? 'gpt-6.1-terra' : 'gpt-6.1-sol'
  return process.env.OPENAI_GRADING_MODEL?.trim() || defaultModel
}

function getDeepSeekGradingModel(): string {
  return process.env.DEEPSEEK_GRADING_MODEL?.trim() || 'deepseek-flash'
}

export function getGradingModel(scope: GradingScope = 'classroom'): string {
  return providerMode() === 'openai' ? getOpenAiGradingModel(scope) : getDeepSeekGradingModel()
}

export function getGradingFallbackModel(): string | null {
  return providerMode() === 'openai' ? getDeepSeekGradingModel() : null
}

function key(name: 'OPENAI_API_KEY' | 'DEEPSEEK_API_KEY'): string {
  const value = process.env[name]?.trim()
  if (!value) throw new GradingProviderError({ kind: 'config', message: `${name} is not configured`, retryable: false })
  return value
}

/** Select a provider per request. Documented exhausted-credit and spend-limit responses permit fallback. */
export function createGradingProvider(scope: GradingScope = 'classroom'): StructuredOutputProvider {
  return {
    id: 'grading-router',
    async generate(request) {
      assertAIOutboundEnabled()
      const mode = providerMode()
      const deepseekModel = getDeepSeekGradingModel()
      if (mode === 'deepseek') {
        const result = await createDeepSeekChatProvider({ apiKey: key('DEEPSEEK_API_KEY') }).generate({ ...request, model: deepseekModel })
        return { ...result, providerUsed: 'deepseek', modelUsed: deepseekModel }
      }
      const openaiModel = getOpenAiGradingModel(scope)
      try {
        const result = await createOpenAiResponsesProvider({ apiKey: key('OPENAI_API_KEY') }).generate({ ...request, model: openaiModel })
        return { ...result, providerUsed: 'openai', modelUsed: openaiModel }
      } catch (error) {
        if (!(error instanceof OpenAiSpendLimitError)) throw error
        if (scope === 'repo-review' && error.spendLimitCode === 'credit_balance_exhausted') throw error
        const result = await createDeepSeekChatProvider({ apiKey: key('DEEPSEEK_API_KEY') }).generate({ ...request, model: deepseekModel })
        // The rejected OpenAI request reports no usage, so the cross-provider
        // total is unknown even if earlier and fallback responses were metered.
        // Provenance's provider/model name the successful output, not the source
        // of all usage. Do not present DeepSeek-only usage as an operation total.
        return { ...result, tokenUsage: { inputTokens: null, outputTokens: null, totalTokens: null },
          requestCount: result.requestCount + error.requestCount, providerUsed: 'deepseek', modelUsed: deepseekModel }
      }
    },
  }
}
