import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAiSanitizationContext } from '@/lib/ai-sanitization'
import {
  classifyAmbiguousRepoReviewChanges,
  gradeRepoReviewFeedback,
} from '@/lib/repo-review-ai'

describe('repo-review AI egress', () => {
  const originalFetch = global.fetch
  const originalApiKey = process.env.DEEPSEEK_API_KEY

  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = 'test-key'
  })

  afterEach(() => {
    global.fetch = originalFetch
    process.env.DEEPSEEK_API_KEY = originalApiKey
    vi.restoreAllMocks()
  })

  it('sends provider refs and sanitized summaries for ambiguous classification', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          items: [{ id: 'change_1', category: 'bugfix' }],
        }) }, finish_reason: 'stop' }],
      }), { status: 200 }),
    )
    global.fetch = fetchMock as typeof fetch

    const result = await classifyAmbiguousRepoReviewChanges([
      {
        id: '018f3f57-7b4b-7123-8c04-48ac061c1111',
        summary: 'Alex Lee fixed login after emailing alex@example.com.',
      },
    ])

    expect(result).toEqual({
      '018f3f57-7b4b-7123-8c04-48ac061c1111': 'bugfix',
    })

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.reasoning_effort).toBe('high')
    expect(body.max_tokens).toBe(1200)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0].content).toContain('repo_review_change_classification')
    const userPrompt = body.messages[1].content
    expect(userPrompt).toContain('change_1')
    expect(userPrompt).not.toContain('018f3f57-7b4b-7123-8c04-48ac061c1111')
    expect(userPrompt).toContain('[email redacted]')
  })

  it('chunks ambiguous classification into bounded provider requests', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      const userPrompt = String(body.messages[1].content)
      const ids = [...userPrompt.matchAll(/change_[0-9]+/g)].map((match) => match[0])
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          items: ids.map((id) => ({ id, category: 'feature' })),
        }) }, finish_reason: 'stop' }],
      }), { status: 200 })
    })
    global.fetch = fetchMock as typeof fetch

    const result = await classifyAmbiguousRepoReviewChanges(
      Array.from({ length: 51 }, (_, index) => ({
        id: `local-${index + 1}`,
        summary: `Change ${index + 1}`,
      })),
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result['local-1']).toBe('feature')
    expect(result['local-51']).toBe('feature')
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(firstBody.messages[1].content.match(/change_[0-9]+/g)).toHaveLength(50)
    expect(secondBody.messages[1].content.match(/change_[0-9]+/g)).toHaveLength(1)
  })

  it('sanitizes repo-review grading prompts and returned feedback', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          score_completion: 8,
          score_thinking: 7,
          score_workflow: 6,
          summary: 'Email alex@example.com for details.',
          strengths: ['Sam Lee made steady commits.'],
          concerns: ['Call 416-555-1212.'],
          feedback: 'Solid evidence for Sam Lee.',
          confidence: 0.8,
        }) }, finish_reason: 'stop' }],
      }), { status: 200 }),
    )
    global.fetch = fetchMock as typeof fetch
    const sanitizationContext = buildAiSanitizationContext([
      { firstName: 'Sam', lastName: 'Lee' },
    ])

    const result = await gradeRepoReviewFeedback({
      assignmentTitle: 'Essay for Sam Lee',
      repoName: 'student-login/private-repo',
      studentName: 'Sam Lee',
      githubLogin: 'samlee',
      commitCount: 2,
      activeDays: 2,
      sessionCount: 1,
      burstRatio: 0.2,
      weightedContribution: 1,
      relativeContributionShare: 1,
      spreadScore: 0.7,
      iterationScore: 0.6,
      reviewActivityCount: 0,
      areas: ['src'],
      semanticBreakdown: { feature: 1 },
      evidence: [
        {
          type: 'commit',
          id: 'commit-1',
          title: 'Sam Lee added page',
          summary: 'Contact Sam Lee at sam@example.com.',
        },
      ],
      warnings: ['Sam Lee had one warning.'],
      confidence: 0.9,
      sanitizationContext,
    })

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.reasoning_effort).toBe('high')
    expect(body.max_tokens).toBe(700)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0].content).toContain('repo_review_feedback')
    const promptPayload = JSON.parse(body.messages[1].content)
    expect(promptPayload).toMatchObject({
      assignment_title: 'Essay for S.L.',
      repo_ref: 'repo_1',
      student_ref: 'student_1',
    })
    expect(JSON.stringify(promptPayload)).not.toContain('Sam Lee')
    expect(JSON.stringify(promptPayload)).not.toContain('sam@example.com')
    expect(JSON.stringify(promptPayload)).not.toContain('samlee')
    expect(JSON.stringify(promptPayload)).toContain('[email redacted]')

    expect(result.summary).toBe('Email [email redacted] for details.')
    expect(result.concerns[0]).toBe('Call [phone redacted].')
    expect(result.feedback).toContain('[email redacted]')
    expect(result.model).toBe('deepseek-flash')
    expect(result.provenance).toMatchObject({
      schemaVersion: 'assignment-grading-provenance-v1',
      provider: 'deepseek',
      model: 'deepseek-flash',
      policyVersion: 'pika-repo-review-feedback-policy-v2',
      promptVersion: 'pika-repo-review-feedback-prompt-v1',
      gradingProfileVersion: 'pika-repo-review-feedback-v1',
      rubricVersion: 'pika-repo-review-rubric-v1',
      providerRequestCount: 1,
    })
  })

  it('sanitizes heuristic fallback feedback before persistence', async () => {
    delete process.env.DEEPSEEK_API_KEY
    const sanitizationContext = buildAiSanitizationContext([
      { firstName: 'Sam', lastName: 'Lee' },
    ])

    const result = await gradeRepoReviewFeedback({
      assignmentTitle: 'Repo review',
      repoName: 'student-login/private-repo',
      studentName: 'Sam Lee',
      githubLogin: 'samlee',
      commitCount: 1,
      activeDays: 1,
      sessionCount: 1,
      burstRatio: 0.9,
      weightedContribution: 1,
      relativeContributionShare: 1,
      spreadScore: 0.2,
      iterationScore: 0.2,
      reviewActivityCount: 0,
      areas: ['src'],
      semanticBreakdown: { feature: 1 },
      evidence: [],
      warnings: ['Sam Lee emailed sam@example.com.'],
      confidence: 0.8,
      sanitizationContext,
    })

    expect(result.model).toBe('repo-review-heuristic-v1')
    expect(result.provenance).toMatchObject({
      provider: 'pika-local',
      model: 'repo-review-heuristic-v1',
      providerRequestCount: 0,
      tokenUsage: { inputTokens: null, outputTokens: null, totalTokens: null },
    })
    expect(result.summary).toBe('S.L. contributed 100% of mapped weighted work in student-login/private-repo.')
    expect(result.concerns).toContain('S.L. emailed [email redacted].')
    expect(result.feedback).not.toContain('Sam Lee')
    expect(result.feedback).not.toContain('sam@example.com')
    expect(result.feedback).toContain('S.L.')
    expect(result.feedback).toContain('[email redacted]')
  })

  it('records local provenance when a provider failure triggers heuristic fallback', async () => {
    global.fetch = vi.fn(async () => new Response('provider unavailable', { status: 503 })) as typeof fetch

    const result = await gradeRepoReviewFeedback({
      assignmentTitle: 'Repo review',
      repoName: 'repo_1',
      studentName: 'Student',
      githubLogin: null,
      commitCount: 2,
      activeDays: 2,
      sessionCount: 2,
      burstRatio: 0.2,
      weightedContribution: 2,
      relativeContributionShare: 1,
      spreadScore: 0.8,
      iterationScore: 0.7,
      reviewActivityCount: 1,
      areas: ['src'],
      semanticBreakdown: { feature: 2 },
      evidence: [],
      warnings: [],
      confidence: 0.8,
    })

    expect(result.model).toBe('repo-review-heuristic-v1')
    expect(result.provenance).toMatchObject({
      provider: 'pika-local',
      model: 'repo-review-heuristic-v1',
      providerRequestCount: 0,
    })
  })
})
