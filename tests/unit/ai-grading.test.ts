import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gradeStudentWork } from '@/lib/ai-grading'

describe('gradeStudentWork prompt rules', () => {
  const originalApiKey = process.env.OPENAI_API_KEY

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key'
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalApiKey
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('uses structured strength/next-step/improve guidance in system prompt', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text:
          '{"score_completion":8,"score_thinking":7,"score_workflow":8,"feedback":"Strength: Clear structure and complete sections. Next Step: tighten evidence-to-claim links. Improve: Add one concrete example in your analysis paragraph."}',
      }),
    })

    const result = await gradeStudentWork({
      assignmentTitle: 'Reflection',
      instructions: 'Write a reflection about your learning process.',
      studentWork: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'I learned how to organize my thinking better this week.' }],
          },
        ],
      },
    })

    expect(result.score_completion).toBe(8)
    expect(result.score_thinking).toBe(7)
    expect(result.score_workflow).toBe(8)
    expect(result.feedback).toContain('Strength:')
    expect(result.feedback).toContain('Next Step:')

    const gradingRequest = fetchMock.mock.calls[0]?.[1]
    const gradingBody = JSON.parse(String(gradingRequest?.body ?? '{}'))
    const systemPrompt = gradingBody.input?.[0]?.content?.[0]?.text as string
    expect(systemPrompt).toContain('feedback should be 1-3 sentences')
    expect(systemPrompt).toContain('sentence starting with "Strength:"')
    expect(systemPrompt).toContain('sentence starting with "Next Step:"')
    expect(systemPrompt).toContain('total score is less than 30')
  })
})
