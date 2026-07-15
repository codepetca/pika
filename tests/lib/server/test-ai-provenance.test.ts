import { beforeEach, describe, expect, it } from 'vitest'
import {
  createManualTestAiProvenanceToken,
  verifyManualTestAiProvenanceToken,
} from '@/lib/server/test-ai-provenance'

const identity = {
  teacherId: 'teacher-1',
  testId: 'test-1',
  responseId: 'response-1',
  responseRevision: 4,
  gradingBasis: 'generated_reference' as const,
  referenceAnswers: ['Reference answer'],
  model: 'gpt-5-nano',
  suggestedScore: 4,
  suggestedFeedback: 'Original AI feedback',
  questionGradingSnapshot: {
    test_title: 'Unit Test',
    question_text: 'Explain the result.',
    points: 5,
    response_monospace: false,
    answer_key: null,
    sample_solution: null,
  },
}

describe('manual test AI provenance', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough'
  })

  it('binds the token to the full provenance identity', () => {
    const token = createManualTestAiProvenanceToken(identity, 1_000)
    expect(verifyManualTestAiProvenanceToken({
      token,
      expected: identity,
      nowMs: 2_000,
    })).toBe(true)
    expect(verifyManualTestAiProvenanceToken({
      token,
      expected: { ...identity, responseRevision: 5 },
      nowMs: 2_000,
    })).toBe(false)
    expect(verifyManualTestAiProvenanceToken({
      token,
      expected: { ...identity, model: 'forged-model' },
      nowMs: 2_000,
    })).toBe(false)
    expect(verifyManualTestAiProvenanceToken({
      token,
      expected: { ...identity, suggestedScore: 1 },
      nowMs: 2_000,
    })).toBe(false)
    expect(verifyManualTestAiProvenanceToken({
      token,
      expected: { ...identity, suggestedFeedback: 'Forged feedback' },
      nowMs: 2_000,
    })).toBe(false)
  })

  it('rejects tampered and expired tokens', () => {
    const token = createManualTestAiProvenanceToken(identity, 1_000)
    expect(verifyManualTestAiProvenanceToken({
      token: `${token.slice(0, -1)}x`,
      expected: identity,
      nowMs: 2_000,
    })).toBe(false)
    expect(verifyManualTestAiProvenanceToken({
      token,
      expected: identity,
      nowMs: 24 * 60 * 60 * 1000 + 1_001,
    })).toBe(false)
  })

  it('keeps large grading contexts compact by signing hashes', () => {
    const longText = 'context-'.repeat(10_000)
    const largeIdentity = {
      ...identity,
      questionGradingSnapshot: {
        ...identity.questionGradingSnapshot,
        question_text: longText,
        answer_key: longText,
        sample_solution: longText,
      },
    }
    const token = createManualTestAiProvenanceToken(largeIdentity, 1_000)

    expect(token.length).toBeLessThan(2_000)
    expect(token).not.toContain('context-')
    expect(verifyManualTestAiProvenanceToken({
      token,
      expected: largeIdentity,
      nowMs: 2_000,
    })).toBe(true)
  })
})
