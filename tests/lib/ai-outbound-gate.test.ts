import { afterEach, describe, expect, it, vi } from 'vitest'
import { AIOutboundDisabledError, assertAIOutboundEnabled } from '@/lib/ai-outbound-gate'
import { callOpenAIForSummary } from '@/lib/log-summary'
import { callOpenAIForDeveloperFeedback } from '@/lib/developer-log-feedback'
import { extractCourseGuideImportDraft } from '@/lib/server/course-guide-import'
import { generateCourseBlueprintGuidedDraft } from '@/lib/server/course-blueprint-guided-drafting'
import { createDeepSeekChatProvider } from '@/lib/grading/providers/deepseek-chat'
import type { CourseBlueprintDetail } from '@/types'

const request = {
  model: 'test', systemPrompt: 'test', userPrompt: 'test', schemaName: 'test',
  jsonSchema: {}, initialMaxOutputTokens: 100, fallbackMaxOutputTokens: 200,
  reasoningEffort: 'minimal' as const,
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('outbound AI stop', () => {
  it('defaults to enabled, accepts true, and fails closed for false and malformed values', () => {
    vi.stubEnv('PIKA_AI_API_ENABLED', undefined)
    expect(() => assertAIOutboundEnabled()).not.toThrow()
    vi.stubEnv('PIKA_AI_API_ENABLED', 'true')
    expect(() => assertAIOutboundEnabled()).not.toThrow()
    for (const value of ['false', '', 'TRUE', '0', ' true ']) {
      vi.stubEnv('PIKA_AI_API_ENABLED', value)
      expect(() => assertAIOutboundEnabled()).toThrow(AIOutboundDisabledError)
    }
  })

  it('prevents the four OpenAI feature requests and surfaces the stop', async () => {
    vi.stubEnv('PIKA_AI_API_ENABLED', 'false')
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const detail = {
      title: 'Test', subject: 'Test', grade_level: '11', outline_markdown: '', content_revision: 1,
      authoring_guidance: { course_expectations_markdown: '', assignment_guidance_markdown: '', test_guidance_markdown: '', unit_exceptions: [] },
      assignments: [], assessments: [],
    } as unknown as CourseBlueprintDetail
    const calls = [
      () => callOpenAIForSummary('system', 'user', {}),
      () => callOpenAIForDeveloperFeedback('system', 'user'),
      () => extractCourseGuideImportDraft({ type: 'file', filename: 'test.pdf', dataUrl: 'data:application/pdf;base64,JVBERi0=' }),
      () => generateCourseBlueprintGuidedDraft({ detail, target: 'assignments', prompt: '' }),
    ]
    for (const call of calls) await expect(call()).rejects.toBeInstanceOf(AIOutboundDisabledError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('prevents the initial DeepSeek request when disabled', async () => {
    vi.stubEnv('PIKA_AI_API_ENABLED', 'false')
    const fetchImpl = vi.fn()
    const provider = createDeepSeekChatProvider({ apiKey: 'test', fetchImpl: fetchImpl as typeof fetch })
    await expect(provider.generate(request)).rejects.toMatchObject({ name: 'AIOutboundDisabledError', retryable: false })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('checks again before DeepSeek truncation retries', async () => {
    vi.stubEnv('PIKA_AI_API_ENABLED', 'true')
    const fetchImpl = vi.fn(async () => {
      process.env.PIKA_AI_API_ENABLED = 'false'
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'length' }] }))
    })
    const provider = createDeepSeekChatProvider({ apiKey: 'test', fetchImpl: fetchImpl as typeof fetch })
    await expect(provider.generate(request)).rejects.toMatchObject({ name: 'AIOutboundDisabledError', retryable: false })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})
