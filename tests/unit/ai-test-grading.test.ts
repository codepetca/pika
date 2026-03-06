import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { suggestTestOpenResponseGrade } from '@/lib/ai-test-grading'

describe('suggestTestOpenResponseGrade', () => {
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

  it('grades against teacher answer key when provided', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text: '{"score": 4.25, "feedback": "Good start. Add one more key detail."}',
      }),
    })

    const suggestion = await suggestTestOpenResponseGrade({
      testTitle: 'Unit 1 Test',
      questionText: 'Explain osmosis.',
      responseText: 'Water moves to balance concentration.',
      maxPoints: 5,
      answerKey: 'Water moves across a semi-permeable membrane from low solute to high solute concentration.',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(suggestion).toEqual({
      score: 4.25,
      feedback: 'Good start. Add one more key detail.',
      model: 'gpt-5-nano',
      grading_basis: 'teacher_key',
      reference_answers: [],
    })
  })

  it('generates references when teacher answer key is missing', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output_text:
            '{"reference_answers":["Defines osmosis accurately.","Mentions membrane and concentration gradient."]}',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output_text:
            '{"score": 3.5, "feedback": "You captured the core idea. Add membrane details for full marks."}',
        }),
      })

    const suggestion = await suggestTestOpenResponseGrade({
      testTitle: 'Unit 1 Test',
      questionText: 'Explain osmosis.',
      responseText: 'Water moves from low to high concentration.',
      maxPoints: 5,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(suggestion.grading_basis).toBe('generated_reference')
    expect(suggestion.reference_answers).toEqual([
      'Defines osmosis accurately.',
      'Mentions membrane and concentration gradient.',
    ])
    expect(suggestion.score).toBe(3.5)
  })
})
