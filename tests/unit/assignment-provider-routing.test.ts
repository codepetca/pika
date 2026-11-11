import { afterEach, describe, expect, it, vi } from 'vitest'
import { gradeStudentWork } from '@/lib/ai-grading'
import { gradeRepoReviewFeedback } from '@/lib/repo-review-ai'
import { AIOutboundDisabledError } from '@/lib/grading/providers/ai-outbound-gate'

const work = { type: 'doc' as const, content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'A complete response with details about the topic.' }] }] }

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('grading provider routing integration', () => {
  it.each(['project_spend_limit_exceeded', 'credit_balance_exhausted'])('records assignment fallback provenance for %s', async (code) => {
    vi.stubEnv('PIKA_AI_GRADING_PROVIDER', 'openai')
    vi.stubEnv('PIKA_AI_API_ENABLED', 'true')
    vi.stubEnv('OPENAI_API_KEY', 'test')
    vi.stubEnv('DEEPSEEK_API_KEY', 'test')
    vi.stubEnv('OPENAI_GRADING_MODEL', 'primary-model')
    vi.stubEnv('DEEPSEEK_GRADING_MODEL', 'fallback-model')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ score_completion: 8, score_thinking: 7, score_workflow: 4, feedback: 'Strength: Clear work.' }) }, finish_reason: 'stop' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await gradeStudentWork({ assignmentTitle: 'Reflection', instructions: 'Explain your work', studentWork: work })
    expect(result).toMatchObject({ provider: 'deepseek', model: 'fallback-model', provenance: { provider: 'deepseek', model: 'fallback-model' } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('records unknown aggregate usage when truncated OpenAI usage precedes a fallback', async () => {
    vi.stubEnv('PIKA_AI_GRADING_PROVIDER', 'openai')
    vi.stubEnv('PIKA_AI_API_ENABLED', 'true')
    vi.stubEnv('OPENAI_API_KEY', 'test')
    vi.stubEnv('DEEPSEEK_API_KEY', 'test')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
        usage: { input_tokens: 10, output_tokens: 100, total_tokens: 110 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'project_spend_limit_exceeded' } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ score_completion: 8,
        score_thinking: 7, score_workflow: 4, feedback: 'Strength: Clear work.' }) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 } })))
    vi.stubGlobal('fetch', fetchMock)
    const result = await gradeStudentWork({ assignmentTitle: 'Reflection', instructions: 'Explain your work', studentWork: work })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.provenance).toMatchObject({ provider: 'deepseek', providerRequestCount: 3,
      tokenUsage: { inputTokens: null, outputTokens: null, totalTokens: null } })
  })

  it('does not silently produce heuristic repository feedback when the stop is active', async () => {
    vi.stubEnv('PIKA_AI_GRADING_PROVIDER', 'openai')
    vi.stubEnv('PIKA_AI_API_ENABLED', 'false')
    vi.stubEnv('OPENAI_API_KEY', 'test')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(gradeRepoReviewFeedback({
      assignmentTitle: 'Project', repoName: 'repo', studentName: 'Student', githubLogin: null,
      commitCount: 1, activeDays: 1, sessionCount: 1, burstRatio: 0.5, weightedContribution: 1,
      relativeContributionShare: 1, spreadScore: 0.5, iterationScore: 0.5, reviewActivityCount: 0,
      areas: [], semanticBreakdown: {}, evidence: [], warnings: [], confidence: 0.5,
    })).rejects.toBeInstanceOf(AIOutboundDisabledError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
