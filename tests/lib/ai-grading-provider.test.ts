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

  it('uses Terra by default and records its actual model', async () => {
    vi.stubEnv('PIKA_AI_GRADING_PROVIDER', undefined)
    vi.stubEnv('OPENAI_GRADING_MODEL', undefined)
    vi.stubEnv('OPENAI_API_KEY', 'test')
    openai.mockResolvedValue(response)
    expect(getGradingModel()).toBe('gpt-6.1-terra')
    expect(await createGradingProvider().generate(request)).toMatchObject({
      providerUsed: 'openai', modelUsed: 'gpt-6.1-terra',
    })
    expect(openai).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-6.1-terra' }))
    expect(deepseek).not.toHaveBeenCalled()
  })

  it('uses DeepSeek when explicitly selected and records its actual model', async () => {
    vi.stubEnv('PIKA_AI_GRADING_PROVIDER', 'deepseek')
    vi.stubEnv('DEEPSEEK_API_KEY', 'test')
    vi.stubEnv('DEEPSEEK_GRADING_MODEL', 'deepseek-model')
    deepseek.mockResolvedValue(response)
    expect(getGradingModel()).toBe('deepseek-model')
    expect(await createGradingProvider().generate(request)).toMatchObject({ providerUsed: 'deepseek', modelUsed: 'deepseek-model' })
    expect(openai).not.toHaveBeenCalled()
  })

  it('uses OpenAI when explicitly selected', async () => {
    vi.stubEnv('PIKA_AI_GRADING_PROVIDER', 'openai')
    vi.stubEnv('OPENAI_API_KEY', 'test')
    vi.stubEnv('OPENAI_GRADING_MODEL', 'openai-model')
    openai.mockResolvedValue(response)
    expect(getGradingModel()).toBe('openai-model')
    expect(await createGradingProvider().generate(request)).toMatchObject({ providerUsed: 'openai', modelUsed: 'openai-model' })
    expect(deepseek).not.toHaveBeenCalled()
  })

  it('switches from default Terra to DeepSeek on a verified spend-limit error', async () => {
    vi.stubEnv('PIKA_AI_GRADING_PROVIDER', '')
    vi.stubEnv('OPENAI_GRADING_MODEL', '')
    vi.stubEnv('OPENAI_API_KEY', 'test')
    vi.stubEnv('DEEPSEEK_API_KEY', 'test')
    vi.stubEnv('DEEPSEEK_GRADING_MODEL', 'deepseek-model')
    openai.mockRejectedValue(new OpenAiSpendLimitError('project_spend_limit_exceeded', 429))
    deepseek.mockResolvedValue(response)
    expect(await createGradingProvider().generate(request)).toMatchObject({ providerUsed: 'deepseek', modelUsed: 'deepseek-model',
      requestCount: 2, tokenUsage: { inputTokens: null, outputTokens: null, totalTokens: null } })
    expect(openai).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-6.1-terra' }))
    expect(deepseek).toHaveBeenCalledWith(expect.objectContaining({ model: 'deepseek-model' }))
  })

  it('does not report partial combined usage as a complete total after a truncated attempt', async () => {
    vi.stubEnv('PIKA_AI_GRADING_PROVIDER', 'openai')
    vi.stubEnv('OPENAI_API_KEY', 'test')
    vi.stubEnv('DEEPSEEK_API_KEY', 'test')
    const error = new OpenAiSpendLimitError('project_spend_limit_exceeded', 429)
    error.requestCount = 2
    error.priorTokenUsage = { inputTokens: 10, outputTokens: 100, totalTokens: 110 }
    openai.mockRejectedValue(error)
    deepseek.mockResolvedValue({ ...response, tokenUsage: { inputTokens: 30, outputTokens: 20, totalTokens: 50,
      cachedInputTokens: 10, reasoningTokens: 5 } })
    const result = await createGradingProvider().generate(request)
    expect(result).toMatchObject({ providerUsed: 'deepseek', requestCount: 3,
      tokenUsage: { inputTokens: null, outputTokens: null, totalTokens: null } })
    expect(result.tokenUsage).not.toHaveProperty('cachedInputTokens')
    expect(result.tokenUsage).not.toHaveProperty('reasoningTokens')
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
