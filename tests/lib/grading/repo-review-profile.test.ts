import { describe, expect, it } from 'vitest'
import { gradingProvenanceSchema } from '@/lib/grading/contracts'
import {
  parsePikaRepoReviewClassificationOutput,
  parsePikaRepoReviewFeedbackOutput,
  PIKA_REPO_REVIEW_CLASSIFICATION_OUTPUT,
  PIKA_REPO_REVIEW_FEEDBACK_OUTPUT,
} from '@/lib/grading/profiles/pika-repo-review'

describe('Pika repository-review grading profile', () => {
  it('uses bounded structured outputs for classification and feedback', () => {
    expect(PIKA_REPO_REVIEW_CLASSIFICATION_OUTPUT).toMatchObject({
      schemaName: 'repo_review_change_classification',
      initialMaxOutputTokens: 1200,
      fallbackMaxOutputTokens: 1800,
    })
    expect(PIKA_REPO_REVIEW_FEEDBACK_OUTPUT).toMatchObject({
      schemaName: 'repo_review_feedback',
      initialMaxOutputTokens: 700,
      fallbackMaxOutputTokens: 1000,
    })
  })

  it('parses strict classification and feedback contracts', () => {
    expect(parsePikaRepoReviewClassificationOutput(
      '{"items":[{"id":"change_1","category":"bugfix"}]}',
    )).toEqual({ items: [{ id: 'change_1', category: 'bugfix' }] })

    expect(parsePikaRepoReviewFeedbackOutput(JSON.stringify({
      score_completion: 8,
      score_thinking: 7,
      score_workflow: 6,
      summary: 'Good progress.',
      strengths: ['Iterated steadily.'],
      concerns: [],
      feedback: 'Add another focused test.',
      confidence: 0.8,
    }))).toMatchObject({ score_completion: 8, score_thinking: 7, score_workflow: 6 })
  })

  it('rejects undeclared provider output fields', () => {
    expect(() => parsePikaRepoReviewFeedbackOutput(JSON.stringify({
      score_completion: 8,
      score_thinking: 7,
      score_workflow: 6,
      summary: 'Good progress.',
      strengths: [],
      concerns: [],
      feedback: 'Add another focused test.',
      confidence: 0.8,
      student_id: 'local-id',
    }))).toThrow()
  })

  it('represents local heuristic execution without inventing a provider request', () => {
    expect(gradingProvenanceSchema.parse({
      schemaVersion: 'assignment-grading-provenance-v1',
      provider: 'pika-local',
      model: 'repo-review-heuristic-v1',
      policyVersion: 'pika-repo-review-feedback-policy-v1',
      promptVersion: 'pika-repo-review-feedback-prompt-v1',
      gradingProfileVersion: 'pika-repo-review-feedback-v1',
      rubricVersion: 'pika-repo-review-rubric-v1',
      providerRequestCount: 0,
      tokenUsage: { inputTokens: null, outputTokens: null, totalTokens: null },
    })).toMatchObject({ provider: 'pika-local', providerRequestCount: 0 })
  })
})
