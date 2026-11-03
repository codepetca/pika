import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGradingProvider, getGradingModel } from '@/lib/ai-grading-provider'
import { OpenAiSpendLimitError } from '@/lib/grading/providers/openai-responses'

const { openai, deepseek } = vi.hoisted(() => ({ openai: vi.fn(), deepseek: vi.fn() }))
vi.mock('@/lib/grading/providers/openai-responses', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/grading/providers/openai-responses')>()
  return { ...actual, createOpenAiResponsesProvider: () => ({ id: 'openai', generate: openai }) }
})
vi.mock('@/lib/grading/providers/deepseek-chat', () => ({
  createDeepSeekChatProvider: () => ({ id: 'deepseek', generate: deepseek }),
}))

const request = {
  model: 'unused', systemPrompt: '', userPrompt: '', schemaName: 'grade', jsonSchema: {},
  initialMaxOutputTokens: 100, fallbackMaxOutputTokens: 200, reasoningEffort: 'medium' as const,
}
const response = { outputText: '{}', tokenUsage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, requestCount: 1, reasoningEffortUsed: 'medium' as const }

describe('grading provider routing', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

  it('uses OpenAI by default and records its actual model', async () => {
    vi.stubEnv('PIKA_AI_GRADING_PROVIDER', '')
    vi.stubEnv('OPENAI_API_KEY', 'test')
    vi.stubEnv('OPENAI_GRADING_MODEL', 'openai-model')
    openai.mockResolvedValue(response)
    expect(getGradingModel()).toBe('openai-model')
    expect(await createGradingProvider().generate(request)).toMatchObject({ providerUsed: 'openai', modelUsed: 'openai-model' })
    expect(deepseek).not.toHaveBeenCalled()
  })

  it('switches to DeepSeek on a verified spend-limit error', async () => {
    vi.stubEnv('PIKA_AI_GRADING_PROVIDER', 'openai')
    vi.stubEnv('OPENAI_API_KEY', 'test')
    vi.stubEnv('DEEPSEEK_API_KEY', 'test')
    vi.stubEnv('DEEPSEEK_GRADING_MODEL', 'deepseek-model')
    openai.mockRejectedValue(new OpenAiSpendLimitError('project_spend_limit_exceeded', 429))
    deepseek.mockResolvedValue(response)
    expect(await createGradingProvider().generate(request)).toMatchObject({ providerUsed: 'deepseek', modelUsed: 'deepseek-model' })
    expect(deepseek).toHaveBeenCalledWith(expect.objectContaining({ model: 'deepseek-model' }))
  })

  it('does not switch on an unrelated error', async () => {
    vi.stubEnv('PIKA_AI_GRADING_PROVIDER', 'openai')
    vi.stubEnv('OPENAI_API_KEY', 'test')
    openai.mockRejectedValue(new Error('rate limit'))
    await expect(createGradingProvider().generate(request)).rejects.toThrow('rate limit')
    expect(deepseek).not.toHaveBeenCalled()
  })

  it('does not send a request when the master stop is active', async () => {
    vi.stubEnv('PIKA_AI_API_ENABLED', 'false')
    await expect(createGradingProvider().generate(request)).rejects.toThrow('Outbound AI requests are disabled')
    expect(openai).not.toHaveBeenCalled()
    expect(deepseek).not.toHaveBeenCalled()
  })
})
