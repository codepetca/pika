import { createHash, createHmac } from 'node:crypto'
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
  gradingProvenance: {
    schemaVersion: 'test-grading-provenance-v1' as const,
    gradingRequestId: '10000000-0000-4000-8000-000000000001',
    provider: 'openai',
    model: 'gpt-5-nano',
    policyVersion: 'pika-test-open-response-policy-v1',
    promptVersion: 'pika-test-open-response-manual-prompt-v1',
    gradingProfileVersion: 'pika-test-open-response-v1',
    rubricVersion: 'pika-test-open-response-rubric-v1',
    operation: 'single' as const,
    batchSize: 1,
    providerRequestCount: 1,
    tokenUsage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
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
      expected: {
        ...identity,
        gradingProvenance: {
          ...identity.gradingProvenance,
          providerRequestCount: 2,
        },
      },
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
    const [payload, signature] = token.split('.')
    const tamperedSignature = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`
    expect(verifyManualTestAiProvenanceToken({
      token: `${payload}.${tamperedSignature}`,
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

  it('accepts rolling-deploy v1 tokens only when no new provenance is supplied', () => {
    const legacyIdentity = { ...identity, gradingProvenance: null }
    const hash = (value: unknown) => createHash('sha256')
      .update(JSON.stringify(value))
      .digest('hex')
    const payload = Buffer.from(JSON.stringify({
      version: 1,
      teacher_id: legacyIdentity.teacherId,
      test_id: legacyIdentity.testId,
      response_id: legacyIdentity.responseId,
      response_revision: legacyIdentity.responseRevision,
      grading_basis: legacyIdentity.gradingBasis,
      reference_answers_sha256: hash(legacyIdentity.referenceAnswers),
      model: legacyIdentity.model,
      suggested_score: legacyIdentity.suggestedScore,
      suggested_feedback_sha256: hash(legacyIdentity.suggestedFeedback),
      question_grading_snapshot_sha256: hash(legacyIdentity.questionGradingSnapshot),
      issued_at_ms: 1_000,
      expires_at_ms: 24 * 60 * 60 * 1000 + 1_000,
    })).toString('base64url')
    const signature = createHmac('sha256', process.env.SESSION_SECRET!)
      .update(payload)
      .digest('base64url')
    const token = `${payload}.${signature}`

    expect(verifyManualTestAiProvenanceToken({
      token,
      expected: legacyIdentity,
      nowMs: 2_000,
    })).toBe(true)
    expect(verifyManualTestAiProvenanceToken({
      token,
      expected: identity,
      nowMs: 2_000,
    })).toBe(false)
  })
})
