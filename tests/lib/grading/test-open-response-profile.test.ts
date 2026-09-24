import { describe, expect, it } from 'vitest'
import { testGradingProvenanceSchema } from '@/lib/grading/contracts'
import {
  getPikaTestPromptVersion,
  parsePikaTestBatchGradeOutput,
  parsePikaTestSingleGradeOutput,
  pikaTestBatchGradeOutput,
  PIKA_TEST_MAX_BATCH_RESPONSES,
  PIKA_TEST_OPEN_RESPONSE_BULK_PROMPT_VERSION,
  PIKA_TEST_OPEN_RESPONSE_MANUAL_PROMPT_VERSION,
  PIKA_TEST_SINGLE_GRADE_OUTPUT,
} from '@/lib/grading/profiles/pika-test-open-response'

describe('Pika test open-response profile', () => {
  it('versions manual and bulk prompts independently', () => {
    expect(getPikaTestPromptVersion('manual')).toBe(
      PIKA_TEST_OPEN_RESPONSE_MANUAL_PROMPT_VERSION,
    )
    expect(getPikaTestPromptVersion('bulk')).toBe(
      PIKA_TEST_OPEN_RESPONSE_BULK_PROMPT_VERSION,
    )
  })

  it('budgets a single grade for reasoning, not answer length', () => {
    expect(PIKA_TEST_SINGLE_GRADE_OUTPUT).toMatchObject({
      initialMaxOutputTokens: 6000,
      fallbackMaxOutputTokens: 8000,
    })
  })

  it('grows the batch budget with the number of responses in the call', () => {
    // A flat budget is what broke batch grading: four responses share one reply, and a
    // measured batch of three already spent 5,835 output tokens.
    const one = pikaTestBatchGradeOutput(1)
    const four = pikaTestBatchGradeOutput(4)
    expect(four.initialMaxOutputTokens).toBeGreaterThan(one.initialMaxOutputTokens)
    // Production's batch of four gets its full estimate on the first attempt: 1,000 base plus
    // 4,000 per response, not a halved budget that forces an avoidable retry.
    expect(four.initialMaxOutputTokens).toBe(17000)
    // Strictly greater: an equal fallback makes the truncation retry re-send the same
    // max_tokens and fail identically at full cost.
    expect(four.fallbackMaxOutputTokens).toBeGreaterThan(four.initialMaxOutputTokens)
    const huge = pikaTestBatchGradeOutput(500)
    expect(huge.fallbackMaxOutputTokens).toBeGreaterThan(huge.initialMaxOutputTokens)
  })

  it('clamps the batch budget and reports what that ceiling can serve', () => {
    const huge = pikaTestBatchGradeOutput(500)
    expect(huge.initialMaxOutputTokens).toBeLessThanOrEqual(24000)
    expect(huge.fallbackMaxOutputTokens).toBeLessThanOrEqual(24000)
    // Production chunks at TEST_AI_GRADING_MICROBATCH_SIZE = 4, so the clamp must serve
    // at least that or bulk grading silently starves again.
    expect(PIKA_TEST_MAX_BATCH_RESPONSES).toBeGreaterThanOrEqual(4)
  })

  it('parses strict single and batch results', () => {
    expect(parsePikaTestSingleGradeOutput('{"score":4,"feedback":"Clear."}')).toEqual({
      score: 4,
      feedback: 'Clear.',
    })
    expect(parsePikaTestBatchGradeOutput(
      '{"results":[{"response_id":"response_1","score":3,"feedback":"Add detail."}]}',
    )).toEqual({
      results: [{ response_id: 'response_1', score: 3, feedback: 'Add detail.' }],
    })
  })

  it('rejects undeclared output fields', () => {
    expect(() => parsePikaTestSingleGradeOutput(
      '{"score":4,"feedback":"Clear.","student_id":"local-id"}',
    )).toThrow()
  })

  it('accepts only locally generated UUID v4 grading request ids', () => {
    const provenance = {
      schemaVersion: 'test-grading-provenance-v1',
      gradingRequestId: '10000000-0000-4000-8000-000000000001',
      provider: 'openai',
      model: 'gpt-5-nano',
      policyVersion: 'policy-v1',
      promptVersion: 'prompt-v1',
      gradingProfileVersion: 'profile-v1',
      rubricVersion: 'rubric-v1',
      operation: 'single',
      batchSize: 1,
      providerRequestCount: 1,
      tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    }

    expect(testGradingProvenanceSchema.safeParse(provenance).success).toBe(true)
    expect(testGradingProvenanceSchema.safeParse({
      ...provenance,
      gradingRequestId: '10000000-0000-7000-8000-000000000001',
    }).success).toBe(false)
  })
})
