import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAiSanitizationContext } from '@/lib/ai-sanitization'
import {
  classifyAmbiguousRepoReviewChanges,
  gradeRepoReviewFeedback,
} from '@/lib/repo-review-ai'

describe('repo-review AI egress', () => {
  const originalFetch = global.fetch
  const originalApiKey = process.env.OPENAI_API_KEY

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key'
  })

  afterEach(() => {
    global.fetch = originalFetch
    process.env.OPENAI_API_KEY = originalApiKey
    vi.restoreAllMocks()
  })

  it('sends provider refs and sanitized summaries for ambiguous classification', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        output_text: JSON.stringify({
          items: [{ id: 'change_1', category: 'bugfix' }],
        }),
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
    expect(body.store).toBe(false)
    const userPrompt = body.input[1].content[0].text
    expect(userPrompt).toContain('change_1')
    expect(userPrompt).not.toContain('018f3f57-7b4b-7123-8c04-48ac061c1111')
    expect(userPrompt).toContain('[email redacted]')
  })

  it('sanitizes repo-review grading prompts and returned feedback', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        output_text: JSON.stringify({
          score_completion: 8,
          score_thinking: 7,
          score_workflow: 6,
          summary: 'Email alex@example.com for details.',
          strengths: ['Sam Lee made steady commits.'],
          concerns: ['Call 416-555-1212.'],
          feedback: 'Solid evidence for Sam Lee.',
          confidence: 0.8,
        }),
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
    expect(body.store).toBe(false)
    const promptPayload = JSON.parse(body.input[1].content[0].text)
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
  })
})
