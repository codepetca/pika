import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gradeStudentWork, hasGradableAssignmentSubmission } from '@/lib/ai-grading'
import { buildAiSanitizationContext } from '@/lib/ai-sanitization'

describe('gradeStudentWork prompt rules', () => {
  const originalApiKey = process.env.DEEPSEEK_API_KEY

  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = 'test-key'
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    process.env.DEEPSEEK_API_KEY = originalApiKey
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('states the deduction rules and feedback format in the system prompt', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"score_completion":8,"score_thinking":7,"score_workflow":4,"feedback":"Strength: Clear structure and complete sections. Next Step: tighten evidence-to-claim links. Improve: Add one concrete example in your analysis paragraph."}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
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
    expect(result.score_workflow).toBe(4)
    expect(result.feedback).toContain('Strength:')
    expect(result.feedback).toContain('Next Step:')
    expect(result.grading_profile_version).toBe('pika-assignment-v2')
    expect(result.rubric_version).toBe('pika-essay-ctw-v2')
    expect(result.prompt_version).toBe('pika-assignment-prompt-v3')
    expect(result.policy_version).toBe('pika-grading-policy-v3')
    expect(result.provider).toBe('deepseek')
    expect(result.token_usage).toEqual({
      input_tokens: 120,
      output_tokens: 40,
      total_tokens: 160,
    })
    expect(result.provenance).toEqual({
      schemaVersion: 'assignment-grading-provenance-v1',
      provider: 'deepseek',
      model: 'deepseek-flash',
      policyVersion: 'pika-grading-policy-v3',
      promptVersion: 'pika-assignment-prompt-v3',
      gradingProfileVersion: 'pika-assignment-v2',
      rubricVersion: 'pika-essay-ctw-v2',
      providerRequestCount: 1,
      tokenUsage: {
        inputTokens: 120,
        outputTokens: 40,
        totalTokens: 160,
      },
      reasoningEffortUsed: 'medium',
    })

    const gradingRequest = fetchMock.mock.calls[0]?.[1]
    const gradingBody = JSON.parse(String(gradingRequest?.body ?? '{}'))
    const systemPrompt = gradingBody.messages?.[0]?.content as string
    // Completion and Thinking deductions, presentation cap, and R9 feedback shape.
    expect(systemPrompt).toContain('equal share of the 10 points')
    expect(systemPrompt).toContain('Subtract 1 if the responses are brief')
    expect(systemPrompt).toContain('**Presentation** (0–4, reported as score_workflow)')
    expect(systemPrompt).toContain('Never consider grammar, spelling, or mechanics')
    expect(systemPrompt).toContain('give the higher one')
    expect(systemPrompt).toContain('One "Missed:" line')
    expect(systemPrompt).toContain('Only list something as missed if the instructions actually ask for it')
    expect(systemPrompt).toContain('At most one "Tip:"')
    expect(systemPrompt).not.toContain('Improve:')
    expect(gradingBody.max_tokens).toBe(2400)
    expect(gradingBody.reasoning_effort).toBe('high')
    // DeepSeek only guarantees syntactic json, so the schema rides in the prompt.
    expect(gradingBody.response_format).toEqual({ type: 'json_object' })
    expect(systemPrompt).toContain('assignment_grade')
    expect(systemPrompt).toContain('"additionalProperties":false')
    expect(gradingRequest?.signal).toBeUndefined()
  })

  it('includes extracted artifacts in the grading prompt', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"score_completion":9,"score_thinking":8,"score_workflow":4,"feedback":"Strength: You included the required project site. Next Step: add a brief note explaining your design choices. Improve: Add one concrete example showing how the site meets the assignment goals."}' }, finish_reason: 'stop' }],
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
    const systemPrompt = gradingBody.messages?.[0]?.content as string
    const userPrompt = gradingBody.messages?.[1]?.content as string

    expect(systemPrompt).toContain('You cannot view or open any of them')
    expect(systemPrompt).toContain('[Image attached]')
    expect(systemPrompt).toContain('credit it under Completion')
    expect(userPrompt).toContain('Attached Artifacts:')
    expect(userPrompt).toContain('- Link: [url redacted]')
  })

  it('marks each embedded image where the student placed it, including app-relative src', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"score_completion":10,"score_thinking":6,"score_workflow":4,"feedback":"Strength: Every task has its screenshot. Next Step: explain each page in more depth. Improve: Add what you will use each page for."}' }, finish_reason: 'stop' }],
      }),
    })

    await gradeStudentWork({
      assignmentTitle: 'Getting Started',
      instructions: 'Screenshot your score and each classroom page.',
      studentWork: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '1) My score reached 100.' }] },
          {
            type: 'image',
            attrs: {
              src: '/api/storage/submission-images?object_id=11111111-1111-4111-8111-111111111111',
              managed_object_id: '11111111-1111-4111-8111-111111111111',
              storage_bucket: 'submission-images',
            },
          },
          { type: 'paragraph', content: [{ type: 'text', text: '2) The calendar page.' }] },
          {
            type: 'image',
            attrs: { src: '/api/storage/submission-images?object_id=22222222-2222-4222-8222-222222222222' },
          },
        ],
      },
    })

    const gradingBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}'))
    const userPrompt = gradingBody.messages?.[1]?.content as string

    expect(userPrompt).toContain(
      '1) My score reached 100.\n[Image attached]\n2) The calendar page.\n[Image attached]',
    )
    expect(userPrompt).not.toContain('Attached Artifacts:')
    expect(userPrompt).not.toContain('object_id')
    expect(userPrompt).not.toContain('11111111-1111')
  })

  it('treats an image-only submission with an app-relative src as gradable', () => {
    expect(hasGradableAssignmentSubmission({
      type: 'doc',
      content: [{ type: 'image', attrs: { src: '/api/storage/submission-images?object_id=abc' } }],
    })).toBe(true)
  })

  it('accepts artifact-only submissions when building the grading prompt', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"score_completion":8,"score_thinking":7,"score_workflow":4,"feedback":"Strength: You submitted the required artifact. Next Step: add a short written explanation alongside it. Improve: Add one sentence that explains how the artifact meets the prompt."}' }, finish_reason: 'stop' }],
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
    const userPrompt = gradingBody.messages?.[1]?.content as string

    expect(result.score_completion).toBe(8)
    expect(userPrompt).toContain('Student Work:\n[Image attached]')
  })

  it('marks images nested inside other blocks after that block text', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"score_completion":9,"score_thinking":8,"score_workflow":4,"feedback":"Strength: Clear. Next Step: Expand."}' }, finish_reason: 'stop' }],
      }),
    })

    await gradeStudentWork({
      assignmentTitle: 'Lists',
      instructions: 'List each page with a screenshot.',
      studentWork: {
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [{
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Calendar page' }] },
                { type: 'image', attrs: { src: '/api/storage/submission-images?object_id=abc' } },
              ],
            }],
          },
        ],
      },
    })

    const gradingBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}'))
    const userPrompt = gradingBody.messages?.[1]?.content as string
    expect(userPrompt).toContain('Calendar page\n[Image attached]')
  })

  it('keeps structured upload images in the attached artifacts list', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"score_completion":9,"score_thinking":8,"score_workflow":4,"feedback":"Strength: Clear. Next Step: Expand."}' }, finish_reason: 'stop' }],
      }),
    })

    await gradeStudentWork({
      assignmentTitle: 'Upload',
      instructions: 'Upload your diagram.',
      studentWork: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'See upload.' }] }] },
      submissionArtifacts: [{ type: 'image', url: 'https://storage.example.com/signed/diagram.png?token=abc' }],
    })

    const gradingBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}'))
    const userPrompt = gradingBody.messages?.[1]?.content as string
    expect(userPrompt).toContain('Attached Artifacts:\n- Image: attached')
    expect(userPrompt).not.toContain('token=abc')
  })

  it('redacts direct identifiers from assignment grading input and output', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"score_completion":7,"score_thinking":7,"score_workflow":4,"feedback":"Strength: alex@example.com included evidence. Next Step: remove phone 416-555-1212. Improve: Add a conclusion."}' }, finish_reason: 'stop' }],
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
    const userPrompt = gradingBody.messages?.[1]?.content as string

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
        choices: [{ message: { content: '{"score_completion":8,"score_thinking":8,"score_workflow":4,"feedback":"Strength: Strong reflection. Next Step: add evidence. Improve: Include one more example."}' }, finish_reason: 'stop' }],
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
    const userPrompt = gradingBody.messages?.[1]?.content as string

    expect(userPrompt).toContain('Reflection for A.B.')
    expect(userPrompt).toContain('A.B. should explain the design choice.')
    expect(userPrompt).toContain('A.B. revised the project after feedback.')
    expect(userPrompt).not.toContain('Alice Brown')
    expect(userPrompt).not.toContain('Alice')
    expect(userPrompt).not.toContain('Brown')
  })

  it('parses structured output that the model wrapped in a markdown code fence', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              reasoning_content: 'Synthetic thinking that must not be parsed as the grade.',
              content: '```json\n{"score_completion":9,"score_thinking":8,"score_workflow":4,"feedback":"Strength: Strong structure. Next Step: Add one more specific detail. Improve: Expand your reflection with one concrete example."}\n```',
            },
            finish_reason: 'stop',
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
          choices: [{ message: { content: '' }, finish_reason: 'length' }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: { content: '{"score_completion":8,"score_thinking":8,"score_workflow":4,"feedback":"Strength: Complete response. Next Step: Tighten your conclusion. Improve: Add one more concrete image to strengthen the ending."}' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 110, completion_tokens: 30, total_tokens: 140 },
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
    expect(firstBody.max_tokens).toBe(2400)
    expect(secondBody.max_tokens).toBe(4800)
    expect(firstBody.reasoning_effort).toBe('high')
    expect(secondBody.reasoning_effort).toBe('high')
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
        choices: [{ message: { content: '{"score_completion":8,"score_thinking":7,"score_workflow":4,"feedback":"Strength: Complete work. Next Step: Add evidence. Improve: Include one more example."}' }, finish_reason: 'stop' }],
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
          choices: [{ message: { content: '' }, finish_reason: 'length' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"score_completion":8,"score_thinking":7,"score_workflow":4,"feedback":"Strength: Complete work. Next Step: Add evidence. Improve: Include one more example."}' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 110, completion_tokens: 30, total_tokens: 140 },
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
        choices: [{ message: { content: '{"score_completion":12,"score_thinking":7,"score_workflow":4,"feedback":"Feedback"}' }, finish_reason: 'stop' }],
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
