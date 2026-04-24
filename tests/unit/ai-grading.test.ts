import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gradeStudentWork, hasGradableAssignmentSubmission } from '@/lib/ai-grading'

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
    expect(gradingBody.max_output_tokens).toBe(220)
    expect(gradingBody.reasoning).toEqual({ effort: 'minimal' })
    expect(gradingBody.text?.format).toEqual(
      expect.objectContaining({
        type: 'json_schema',
        name: 'assignment_grade',
        strict: true,
      }),
    )
    expect(gradingBody.text?.format?.schema).toEqual(
      expect.objectContaining({
        type: 'object',
        additionalProperties: false,
      }),
    )
  })

  it('includes extracted artifacts in the grading prompt', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text:
          '{"score_completion":9,"score_thinking":8,"score_workflow":8,"feedback":"Strength: You included the required project site. Next Step: add a brief note explaining your design choices. Improve: Add one concrete example showing how the site meets the assignment goals."}',
      }),
    })

    await gradeStudentWork({
      assignmentTitle: 'Portfolio Site',
      instructions: 'Build and submit your portfolio site.',
      studentWork: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'My final portfolio is linked here.',
                marks: [
                  {
                    type: 'link',
                    attrs: { href: 'https://student.example.com/portfolio' },
                  },
                ],
              },
            ],
          },
        ],
      },
    })

    const gradingRequest = fetchMock.mock.calls[0]?.[1]
    const gradingBody = JSON.parse(String(gradingRequest?.body ?? '{}'))
    const systemPrompt = gradingBody.input?.[0]?.content?.[0]?.text as string
    const userPrompt = gradingBody.input?.[1]?.content?.[0]?.text as string

    expect(systemPrompt).toContain('Treat attached artifacts')
    expect(userPrompt).toContain('Attached Artifacts:')
    expect(userPrompt).toContain('- Link: https://student.example.com/portfolio')
  })

  it('accepts artifact-only submissions when building the grading prompt', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text:
          '{"score_completion":8,"score_thinking":7,"score_workflow":8,"feedback":"Strength: You submitted the required artifact. Next Step: add a short written explanation alongside it. Improve: Add one sentence that explains how the artifact meets the prompt."}',
      }),
    })

    const result = await gradeStudentWork({
      assignmentTitle: 'Screenshot Submission',
      instructions: 'Attach a screenshot of your completed site.',
      studentWork: {
        type: 'doc',
        content: [
          {
            type: 'image',
            attrs: {
              src: 'https://cdn.example.com/submission-images/final-site.png',
            },
          },
        ],
      },
    })

    const gradingRequest = fetchMock.mock.calls[0]?.[1]
    const gradingBody = JSON.parse(String(gradingRequest?.body ?? '{}'))
    const userPrompt = gradingBody.input?.[1]?.content?.[0]?.text as string

    expect(result.score_completion).toBe(8)
    expect(userPrompt).toContain('Attached Artifacts:')
    expect(userPrompt).toContain('- Image: https://cdn.example.com/submission-images/final-site.png')
  })

  it('parses structured output from response content when output_text is absent', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'completed',
        output: [
          { type: 'reasoning', summary: [] },
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: '{"score_completion":9,"score_thinking":8,"score_workflow":8,"feedback":"Strength: Strong structure. Next Step: Add one more specific detail. Improve: Expand your reflection with one concrete example."}',
              },
            ],
          },
        ],
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
            content: [{ type: 'text', text: 'I learned how to revise more carefully this week.' }],
          },
        ],
      },
    })

    expect(result.score_completion).toBe(9)
    expect(result.feedback).toContain('Strength:')
  })

  it('retries once with a larger output cap when the first response is incomplete', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output: [{ type: 'reasoning', summary: [] }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'completed',
          output: [
            { type: 'reasoning', summary: [] },
            {
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'output_text',
                  text: '{"score_completion":8,"score_thinking":8,"score_workflow":7,"feedback":"Strength: Complete response. Next Step: Tighten your conclusion. Improve: Add one more concrete image to strengthen the ending."}',
                },
              ],
            },
          ],
        }),
      })

    const result = await gradeStudentWork({
      assignmentTitle: 'Personal Narrative',
      instructions: 'Write about a meaningful memory.',
      studentWork: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'I wrote about baking with my grandmother and what I learned from it.' }],
          },
        ],
      },
    })

    expect(result.score_completion).toBe(8)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}'))
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body ?? '{}'))
    expect(firstBody.max_output_tokens).toBe(220)
    expect(secondBody.max_output_tokens).toBe(420)
    expect(firstBody.reasoning).toEqual({ effort: 'minimal' })
    expect(secondBody.reasoning).toEqual({ effort: 'minimal' })
  })
})

describe('hasGradableAssignmentSubmission', () => {
  it('returns false for structurally present but empty content', () => {
    expect(hasGradableAssignmentSubmission({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '   ' }],
        },
      ],
    })).toBe(false)
  })

  it('returns true when submission includes an attached artifact', () => {
    expect(hasGradableAssignmentSubmission({
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            src: 'https://cdn.example.com/submission-images/final-site.png',
          },
        },
      ],
    })).toBe(true)
  })
})
