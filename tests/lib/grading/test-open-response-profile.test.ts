import { describe, expect, it } from 'vitest'
import { testGradingProvenanceSchema } from '@/lib/grading/contracts'
import {
  getPikaTestPromptVersion,
  parsePikaTestBatchGradeOutput,
  parsePikaTestSingleGradeOutput,
  PIKA_TEST_BATCH_GRADE_OUTPUT,
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

  it('preserves the existing single and batch output budgets', () => {
    expect(PIKA_TEST_SINGLE_GRADE_OUTPUT).toMatchObject({
      initialMaxOutputTokens: 220,
      fallbackMaxOutputTokens: 420,
    })
    expect(PIKA_TEST_BATCH_GRADE_OUTPUT).toMatchObject({
      initialMaxOutputTokens: 600,
      fallbackMaxOutputTokens: 900,
    })
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
