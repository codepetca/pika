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
      score: 4,
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
    expect(suggestion.score).toBe(4)
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

  it('uses coding-specific grading rubric when response is marked monospace', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output_text:
            '{"reference_answers":["Uses an array and iterates once with O(n) complexity."]}',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output_text:
            '{"score": 9, "feedback": "Strong logic and readable structure. Add edge-case handling for full marks."}',
        }),
      })

    await suggestTestOpenResponseGrade({
      testTitle: 'Coding Test',
      questionText: 'Write a function to find duplicates.',
      responseText: 'function findDups(items) { ... }',
      maxPoints: 10,
      responseMonospace: true,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const gradingRequest = fetchMock.mock.calls[1]?.[1]
    const gradingBody = JSON.parse(String(gradingRequest?.body ?? '{}'))
    const systemPrompt = gradingBody.input?.[0]?.content?.[0]?.text as string

    expect(systemPrompt).toContain('This is a coding response.')
    expect(systemPrompt).toContain('award high partial credit')
    expect(systemPrompt).toContain('Penalize poor communication/readability')
    expect(systemPrompt).toContain('missing indentation')
    expect(systemPrompt).toContain('CodeHS')
    expect(systemPrompt).toContain('ConsoleProgram')
    expect(systemPrompt).toContain('If no score buckets are provided, use no decimal places')
    expect(systemPrompt).toContain('Feedback should be 1-3 sentences')
    expect(systemPrompt).toContain('if the score is less than 10, feedback should include one concrete improvement needed for full marks')
    expect(systemPrompt).toContain('sentence starting with "Strength:"')
    expect(systemPrompt).toContain('sentence starting with "Next Step:"')
    expect(systemPrompt).toContain('sentence starting with "Improve:"')
  })

  it('maps score to nearest bucket when score buckets are provided', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text:
          '{"score": 5, "feedback": "Strength: Good core idea. Next Step: tighten your explanation. Improve: Add membrane detail for full marks."}',
      }),
    })

    const suggestion = await suggestTestOpenResponseGrade({
      testTitle: 'Unit 1 Test',
      questionText: 'Explain osmosis.',
      responseText: 'Water moves to balance concentration.',
      maxPoints: 10,
      answerKey: 'Water moves across a semipermeable membrane down its concentration gradient.',
      scoreBuckets: [0, 2, 4, 6, 8, 10],
    })

    expect(suggestion.score).toBe(6)
  })

  it('uses prompt guideline override when provided', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text:
          '{"score": 3, "feedback": "Use loop invariant language and include one dry-run."}',
      }),
    })

    await suggestTestOpenResponseGrade({
      testTitle: 'Unit 1 Test',
      questionText: 'Explain insertion sort.',
      responseText: 'It inserts each item into the sorted part.',
      maxPoints: 5,
      answerKey: 'Insertion sort grows a sorted prefix by inserting each next element into its correct spot.',
      promptGuidelineOverride: 'Feedback must be exactly 1 sentence.',
    })

    const gradingRequest = fetchMock.mock.calls[0]?.[1]
    const gradingBody = JSON.parse(String(gradingRequest?.body ?? '{}'))
    const systemPrompt = gradingBody.input?.[0]?.content?.[0]?.text as string

    expect(systemPrompt).toContain('Teacher grading guideline:')
    expect(systemPrompt).toContain('Feedback must be exactly 1 sentence.')
    expect(systemPrompt).not.toContain('sentence starting with "Strength:"')
  })
})

describe('open-response reference cache helpers', () => {
  it('builds stable cache keys for equivalent question versions', () => {
    const left = buildTestOpenResponseReferenceCacheKey({
      testTitle: 'Unit 1 Test',
      questionText: 'Explain osmosis.',
      maxPoints: 5,
      model: 'gpt-5-nano',
    })
    const right = buildTestOpenResponseReferenceCacheKey({
      testTitle: 'Unit 1 Test',
      questionText: 'Explain osmosis.',
      maxPoints: 5,
      model: 'gpt-5-nano',
    })
    const changed = buildTestOpenResponseReferenceCacheKey({
      testTitle: 'Unit 1 Test',
      questionText: 'Explain osmosis in detail.',
      maxPoints: 5,
      model: 'gpt-5-nano',
    })

    expect(left).toBe(right)
    expect(changed).not.toBe(left)
  })

  it('includes coding flag in cache key versioning', () => {
    const nonCoding = buildTestOpenResponseReferenceCacheKey({
      testTitle: 'Coding Test',
      questionText: 'Write a function to find duplicates.',
      maxPoints: 10,
      model: 'gpt-5-nano',
      isCodingQuestion: false,
    })
    const coding = buildTestOpenResponseReferenceCacheKey({
      testTitle: 'Coding Test',
      questionText: 'Write a function to find duplicates.',
      maxPoints: 10,
      model: 'gpt-5-nano',
      isCodingQuestion: true,
    })

    expect(coding).not.toBe(nonCoding)
  })

  it('includes test title in cache key versioning', () => {
    const first = buildTestOpenResponseReferenceCacheKey({
      testTitle: 'Biology Test',
      questionText: 'Explain osmosis.',
      maxPoints: 5,
      model: 'gpt-5-nano',
    })
    const second = buildTestOpenResponseReferenceCacheKey({
      testTitle: 'Chemistry Test',
      questionText: 'Explain osmosis.',
      maxPoints: 5,
      model: 'gpt-5-nano',
    })

    expect(first).not.toBe(second)
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
