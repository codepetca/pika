import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildTestOpenResponseReferenceCacheKey,
  normalizeTestOpenResponseReferenceAnswers,
  suggestTestOpenResponseGrade,
} from '@/lib/ai-test-grading'

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

  it('reuses provided reference answers without generating new ones', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text:
          '{"score": 4, "feedback": "Accurate core idea with good specificity. Add one edge case."}',
      }),
    })

    const suggestion = await suggestTestOpenResponseGrade({
      testTitle: 'Unit 1 Test',
      questionText: 'Explain osmosis.',
      responseText: 'Water moves through a semipermeable membrane.',
      maxPoints: 5,
      referenceAnswers: [
        'Defines osmosis accurately.',
        'Mentions semipermeable membrane and concentration gradient.',
      ],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(suggestion.grading_basis).toBe('generated_reference')
    expect(suggestion.reference_answers).toEqual([
      'Defines osmosis accurately.',
      'Mentions semipermeable membrane and concentration gradient.',
    ])
  })
})

describe('open-response reference cache helpers', () => {
  it('builds stable cache keys for equivalent question versions', () => {
    const left = buildTestOpenResponseReferenceCacheKey({
      questionText: 'Explain osmosis.',
      maxPoints: 5,
      model: 'gpt-5-nano',
    })
    const right = buildTestOpenResponseReferenceCacheKey({
      questionText: 'Explain osmosis.',
      maxPoints: 5,
      model: 'gpt-5-nano',
    })
    const changed = buildTestOpenResponseReferenceCacheKey({
      questionText: 'Explain osmosis in detail.',
      maxPoints: 5,
      model: 'gpt-5-nano',
    })

    expect(left).toBe(right)
    expect(changed).not.toBe(left)
  })

  it('normalizes cached reference answers and drops empty items', () => {
    const normalized = normalizeTestOpenResponseReferenceAnswers([
      '  First answer  ',
      '',
      'Second answer',
      '   ',
    ])

    expect(normalized).toEqual(['First answer', 'Second answer'])
  })
})
