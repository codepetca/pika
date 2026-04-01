import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildTestOpenResponseReferenceCacheKey,
  normalizeTestOpenResponseReferenceAnswers,
  prepareTestOpenResponseGradingContext,
  suggestTestOpenResponseGradeWithContext,
  suggestTestOpenResponseGradesBatch,
  suggestTestOpenResponseGrade,
} from '@/lib/ai-test-grading'
import { GRADE_11CS_JAVA_CODEHS_PROMPT_GUIDELINE } from '@/lib/test-ai-prompt-guideline'

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
    expect(systemPrompt).toContain('Forgive one small formatting/style issue.')
    expect(systemPrompt).toContain('two or more minor formatting issues or one major formatting issue')
    expect(systemPrompt).toContain('Cap any readability/style deduction at 2 points for this question.')
    expect(systemPrompt).toContain('CodeHS')
    expect(systemPrompt).toContain('ConsoleProgram')
    expect(systemPrompt).toContain('If score buckets are not provided, output one whole-number score only.')
    expect(systemPrompt).toContain('Feedback must be 2 or 3 sentences total.')
    expect(systemPrompt).toContain('if the score is less than 10, feedback should include one concrete improvement needed for full marks')
    expect(systemPrompt).toContain('sentence starting with "Strength:"')
    expect(systemPrompt).toContain('sentence starting with "Next Step:"')
    expect(systemPrompt).toContain('sentence starting with "Improve:"')
  })

  it('uses a capped one-point readability deduction on 5-point coding questions', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text:
          '{"score": 4, "feedback": "Strength: Correct logic. Next Step: improve indentation. Improve: Reformat nested blocks for full marks."}',
      }),
    })

    await suggestTestOpenResponseGrade({
      testTitle: 'Coding Test',
      questionText: 'Write a method that counts vowels.',
      responseText: 'public int countVowels(String s) { return 0; }',
      maxPoints: 5,
      answerKey: 'Loops through the string and counts vowels.',
      responseMonospace: true,
    })

    const gradingRequest = fetchMock.mock.calls[0]?.[1]
    const gradingBody = JSON.parse(String(gradingRequest?.body ?? '{}'))
    const systemPrompt = gradingBody.input?.[0]?.content?.[0]?.text as string

    expect(systemPrompt).toContain('Cap any readability/style deduction at 1 point for this question.')
  })

  it('includes sample solutions as secondary grading context', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text:
          '{"score": 5, "feedback": "Strength: Strong logic. Next Step: keep naming consistent."}',
      }),
    })

    await suggestTestOpenResponseGrade({
      testTitle: 'Unit 3 Test',
      questionText: 'Implement formatName.',
      responseText: 'return first + " " + last;',
      maxPoints: 5,
      answerKey: 'Returns the name in first last format.',
      sampleSolution:
        'public String formatName(String name) {\n  int comma = name.indexOf(",");\n  return name.substring(comma + 2) + " " + name.substring(0, comma);\n}',
      responseMonospace: true,
    })

    const gradingRequest = fetchMock.mock.calls[0]?.[1]
    const gradingBody = JSON.parse(String(gradingRequest?.body ?? '{}'))
    const userPrompt = gradingBody.input?.[1]?.content?.[0]?.text as string

    expect(userPrompt).toContain('Teacher answer key:')
    expect(userPrompt).toContain('Sample solution (one valid approach, not a required exact match):')
    expect(userPrompt).toContain('formatName')
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
    expect(systemPrompt).toContain('If score buckets are provided, choose the nearest bucket exactly.')
    expect(systemPrompt).toContain('Feedback must be exactly 1 sentence.')
    expect(systemPrompt).toContain('sentence starting with "Strength:"')
    expect(systemPrompt).toContain('Additional teacher instructions:')
  })

  it('keeps rounded integer scores within fractional max points', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text:
          '{"score": 2.5, "feedback": "Strength: Clear core idea. Next Step: be more precise. Improve: Add one concrete example."}',
      }),
    })

    const suggestion = await suggestTestOpenResponseGrade({
      testTitle: 'Fractional Points Test',
      questionText: 'Explain inheritance briefly.',
      responseText: 'A child class can use and extend parent behavior.',
      maxPoints: 2.5,
      answerKey: 'Inheritance allows subclasses to reuse and specialize superclass members.',
    })

    expect(suggestion.score).toBe(2)
  })

  it('sanitizes conflicting output-format instructions from the code grading guideline', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text:
          '{"score": 3, "feedback": "Strength: Correct use of loops. Next Step: improve variable naming. Improve: Add method decomposition for full marks."}',
      }),
    })

    await suggestTestOpenResponseGrade({
      testTitle: 'Grade 11 CS Unit 3',
      questionText: 'Write a method to reverse a string.',
      responseText: 'public String reverse(String s) { ... }',
      maxPoints: 5,
      answerKey: 'A correct solution iterates from end to start and builds a result string.',
      promptGuidelineOverride: GRADE_11CS_JAVA_CODEHS_PROMPT_GUIDELINE,
    })

    const gradingRequest = fetchMock.mock.calls[0]?.[1]
    const gradingBody = JSON.parse(String(gradingRequest?.body ?? '{}'))
    const systemPrompt = gradingBody.input?.[0]?.content?.[0]?.text as string

    expect(systemPrompt).toContain('Teacher grading guideline:')
    expect(systemPrompt).toContain('Grade 11 CS AI Grading Rules for Coding Questions')
    expect(systemPrompt).toContain('Do not expect concepts from later units unless the question requires them.')
    expect(systemPrompt).not.toContain('Output exactly in this format')
    expect(systemPrompt).not.toContain('Score:')
    expect(systemPrompt).not.toContain('Feedback:')
  })

  it('surfaces a clear error when OpenAI returns a non-JSON body', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/plain; charset=utf-8' }),
      json: async () => {
        throw new SyntaxError(`Unexpected token 'A', "An error o"... is not valid JSON`)
      },
      clone: () => ({
        text: async () => 'An error occurred while processing your request.',
      }),
    })

    await expect(
      suggestTestOpenResponseGrade({
        testTitle: 'Java Practice Test',
        questionText: 'Write a loop that prints numbers 1 to 10.',
        responseText: 'for (int i = 1; i <= 10; i++) { println(i); }',
        maxPoints: 5,
        answerKey: 'Use a counted loop from 1 through 10 and print each value.',
      })
    ).rejects.toThrow(
      'OpenAI returned invalid JSON (status 200, text/plain; charset=utf-8): An error occurred while processing your request.'
    )
  })
})

describe('prepared test grading context', () => {
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

  it('reuses generated reference answers across multiple responses for the same question', async () => {
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
            '{"score": 4, "feedback": "Strong answer. Add one more membrane detail for full marks."}',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output_text:
            '{"score": 3, "feedback": "Good core idea. Add direction of movement for full marks."}',
        }),
      })

    const prepared = await prepareTestOpenResponseGradingContext({
      testTitle: 'Unit 1 Test',
      questionText: 'Explain osmosis.',
      maxPoints: 5,
    })

    const first = await suggestTestOpenResponseGradeWithContext(
      prepared,
      'Water moves through a membrane.'
    )
    const second = await suggestTestOpenResponseGradeWithContext(
      prepared,
      'Water balances concentration.'
    )

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(prepared.grading_basis).toBe('generated_reference')
    expect(prepared.reference_answers).toEqual([
      'Defines osmosis accurately.',
      'Mentions membrane and concentration gradient.',
    ])
    expect(first.score).toBe(4)
    expect(second.score).toBe(3)
  })
})

describe('suggestTestOpenResponseGradesBatch', () => {
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

  it('grades multiple responses for one question in a single batch call', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text:
          '{"results":[{"response_id":"response-1","score":5,"feedback":"Excellent answer."},{"response_id":"response-2","score":3,"feedback":"Good start. Add one more key detail."}]}',
      }),
    })

    const suggestions = await suggestTestOpenResponseGradesBatch({
      testTitle: 'Unit 3 Test',
      questionText: 'Explain what a method does.',
      maxPoints: 5,
      answerKey: 'A method groups reusable instructions and can take parameters and return a value.',
      responses: [
        { responseId: 'response-1', responseText: 'A method is reusable code.' },
        { responseId: 'response-2', responseText: 'A method runs code.' },
      ],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(suggestions).toEqual([
      expect.objectContaining({
        responseId: 'response-1',
        score: 5,
        grading_basis: 'teacher_key',
      }),
      expect.objectContaining({
        responseId: 'response-2',
        score: 3,
        grading_basis: 'teacher_key',
      }),
    ])
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
