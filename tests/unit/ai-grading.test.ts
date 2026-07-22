import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gradeStudentWork, hasGradableAssignmentSubmission } from '@/lib/ai-grading'
import { buildAiSanitizationContext } from '@/lib/ai-sanitization'

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
        usage: { input_tokens: 120, output_tokens: 40, total_tokens: 160 },
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
    expect(result.grading_profile_version).toBe('pika-assignment-v1')
    expect(result.rubric_version).toBe('pika-essay-ctw-v1')
    expect(result.prompt_version).toBe('pika-assignment-prompt-v1')
    expect(result.policy_version).toBe('pika-grading-policy-v1')
    expect(result.provider).toBe('openai')
    expect(result.token_usage).toEqual({
      input_tokens: 120,
      output_tokens: 40,
      total_tokens: 160,
    })

    const gradingRequest = fetchMock.mock.calls[0]?.[1]
    const gradingBody = JSON.parse(String(gradingRequest?.body ?? '{}'))
    const systemPrompt = gradingBody.input?.[0]?.content?.[0]?.text as string
    expect(systemPrompt).toContain('feedback should be 1-3 sentences')
    expect(systemPrompt).toContain('sentence starting with "Strength:"')
    expect(systemPrompt).toContain('sentence starting with "Next Step:"')
    expect(systemPrompt).toContain('total score is less than 30')
    expect(gradingBody.max_output_tokens).toBe(220)
    expect(gradingBody.store).toBe(false)
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
    expect(gradingRequest?.signal).toBeUndefined()
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
    expect(userPrompt).toContain('- Link: [url redacted]')
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
    expect(userPrompt).toContain('- Image: [url redacted]')
  })

  it('redacts direct identifiers from assignment grading input and output', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text:
          '{"score_completion":7,"score_thinking":7,"score_workflow":7,"feedback":"Strength: alex@example.com included evidence. Next Step: remove phone 416-555-1212. Improve: Add a conclusion."}',
      }),
    })

    const result = await gradeStudentWork({
      assignmentTitle: 'Reflection for alex@example.com',
      instructions: 'Submit to https://example.com and include student number 123456789.',
      studentWork: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'My email is alex@example.com and my number is 416-555-1212.' }],
          },
        ],
      },
    })

    const gradingRequest = fetchMock.mock.calls[0]?.[1]
    const gradingBody = JSON.parse(String(gradingRequest?.body ?? '{}'))
    const userPrompt = gradingBody.input?.[1]?.content?.[0]?.text as string

    expect(userPrompt).toContain('Reflection for [email redacted]')
    expect(userPrompt).toContain('[url redacted]')
    expect(userPrompt).toContain('[student number redacted]')
    expect(userPrompt).toContain('[phone redacted]')
    expect(userPrompt).not.toContain('alex@example.com')
    expect(userPrompt).not.toContain('416-555-1212')
    expect(result.feedback).toContain('[email redacted]')
    expect(result.feedback).toContain('[phone redacted]')
  })

  it('replaces known student names in assignment grading input', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text:
          '{"score_completion":8,"score_thinking":8,"score_workflow":8,"feedback":"Strength: Strong reflection. Next Step: add evidence. Improve: Include one more example."}',
      }),
    })

    await gradeStudentWork({
      assignmentTitle: 'Reflection for Alice Brown',
      instructions: 'Alice Brown should explain the design choice.',
      studentWork: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Alice Brown revised the project after feedback.' }],
          },
        ],
      },
      sanitizationContext: buildAiSanitizationContext([
        { firstName: 'Alice', lastName: 'Brown' },
      ]),
    })

    const gradingRequest = fetchMock.mock.calls[0]?.[1]
    const gradingBody = JSON.parse(String(gradingRequest?.body ?? '{}'))
    const userPrompt = gradingBody.input?.[1]?.content?.[0]?.text as string

    expect(userPrompt).toContain('Reflection for A.B.')
    expect(userPrompt).toContain('A.B. should explain the design choice.')
    expect(userPrompt).toContain('A.B. revised the project after feedback.')
    expect(userPrompt).not.toContain('Alice Brown')
    expect(userPrompt).not.toContain('Alice')
    expect(userPrompt).not.toContain('Brown')
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
          usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
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
          usage: { input_tokens: 110, output_tokens: 30, total_tokens: 140 },
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
    expect(result.provider_request_count).toBe(2)
    expect(result.token_usage).toEqual({
      input_tokens: 210,
      output_tokens: 50,
      total_tokens: 260,
    })
  })

  it('uses an abort signal only when the caller supplies a timeout', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text:
          '{"score_completion":8,"score_thinking":7,"score_workflow":8,"feedback":"Strength: Complete work. Next Step: Add evidence. Improve: Include one more example."}',
      }),
    })

    await gradeStudentWork({
      assignmentTitle: 'Reflection',
      instructions: 'Write a reflection.',
      studentWork: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My response.' }] }],
      },
      requestTimeoutMs: 25_000,
    })

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('keeps aggregate usage unknown when either provider request omits usage', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output_text:
            '{"score_completion":8,"score_thinking":7,"score_workflow":8,"feedback":"Strength: Complete work. Next Step: Add evidence. Improve: Include one more example."}',
          usage: { input_tokens: 110, output_tokens: 30, total_tokens: 140 },
        }),
      })

    const result = await gradeStudentWork({
      assignmentTitle: 'Reflection',
      instructions: 'Write a reflection.',
      studentWork: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My response.' }] }],
      },
    })

    expect(result.provider_request_count).toBe(2)
    expect(result.token_usage).toEqual({
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
    })
  })

  it('keeps response-body timeouts retryable through the compatibility boundary', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    const timeoutError = new Error('body timed out')
    timeoutError.name = 'AbortError'
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => { throw timeoutError },
    })

    await expect(gradeStudentWork({
      assignmentTitle: 'Reflection',
      instructions: 'Write a reflection.',
      studentWork: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My response.' }] }],
      },
    })).rejects.toMatchObject({
      name: 'AssignmentAiGradingError',
      kind: 'timeout',
      retryable: true,
    })
  })

  it('keeps rate-limit failures retryable through the compatibility boundary', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    })

    await expect(gradeStudentWork({
      assignmentTitle: 'Reflection',
      instructions: 'Write a reflection.',
      studentWork: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My response.' }] }],
      },
    })).rejects.toMatchObject({
      name: 'AssignmentAiGradingError',
      kind: 'rate_limit',
      retryable: true,
      statusCode: 429,
    })
  })

  it('classifies schema-invalid provider output as non-retryable invalid output', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text:
          '{"score_completion":12,"score_thinking":7,"score_workflow":8,"feedback":"Feedback"}',
      }),
    })

    await expect(gradeStudentWork({
      assignmentTitle: 'Reflection',
      instructions: 'Write a reflection.',
      studentWork: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My response.' }] }],
      },
    })).rejects.toMatchObject({
      name: 'AssignmentAiGradingError',
      kind: 'invalid_output',
      retryable: false,
    })
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
