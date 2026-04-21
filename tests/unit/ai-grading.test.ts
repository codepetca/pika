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
})
