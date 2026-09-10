import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withRedirectCanary } from '../helpers/redirect-canary'
import { createOpenAiResponsesProvider } from '@/lib/grading/providers/openai-responses'
import { sendBrevoEmail } from '@/lib/brevo'
import { callOpenAIForSummary } from '@/lib/log-summary'
import { callOpenAIForDeveloperFeedback } from '@/lib/developer-log-feedback'
import { extractCourseGuideImportDraft } from '@/lib/server/course-guide-import'
import { mintPalReadToken } from '@/lib/server/pal-read-token'

const openaiUrl = 'https://api.openai.com/v1/responses'
const callers = [
  { name: 'OpenAI grading', url: openaiUrl, run: () => createOpenAiResponsesProvider({ apiKey: 'synthetic-key' }).generate({
    model: 'synthetic', systemPrompt: 'Synthetic', userPrompt: 'Synthetic work',
    schemaName: 'synthetic', jsonSchema: { type: 'object' }, reasoningEffort: 'minimal',
    initialMaxOutputTokens: 100, fallbackMaxOutputTokens: 200,
  }) },
  { name: 'OpenAI log summary', url: openaiUrl, run: () => callOpenAIForSummary('Synthetic', 'Synthetic work', {}) },
  { name: 'OpenAI product feedback', url: openaiUrl, run: () => callOpenAIForDeveloperFeedback('Synthetic', 'Synthetic work') },
  { name: 'OpenAI curriculum', url: openaiUrl, run: () => extractCourseGuideImportDraft({
    type: 'file', filename: 'synthetic.pdf', dataUrl: 'data:application/pdf;base64,JVBERi0=',
  }) },
  { name: 'Brevo email', url: 'https://api.brevo.com/v3/smtp/email', run: () => sendBrevoEmail({
    to: 'synthetic@example.invalid', templateParams: { code: 'synthetic-code' },
  }) },
  { name: 'Pal read token', url: 'https://pal.example.test/api/v1/integration/read-token', run: () => mintPalReadToken({ studentId: 'synthetic-student' }) },
]

describe('authenticated outbound redirect boundaries', () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', 'synthetic-key')
    vi.stubEnv('BREVO_API_KEY', 'synthetic-key')
    vi.stubEnv('BREVO_TEMPLATE_ID', '1')
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'synthetic-integration-secret-32-characters')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'synthetic-pseudonym-secret-32-characters')
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  for (const caller of callers) {
    it.each([301, 302, 303, 307, 308])(`${caller.name} rejects HTTP %i without sending to the redirect destination`, async (status) => {
      await withRedirectCanary(status, caller.url, async (canary) => {
        vi.stubGlobal('fetch', canary.fetchImpl)
        await expect(caller.run()).rejects.toThrow()
        expect(canary.sourceRequests()).toBe(1)
        expect(canary.targetRequests()).toBe(0)
      })
    })
  }
})
