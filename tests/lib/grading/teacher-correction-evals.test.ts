import { describe, expect, it } from 'vitest'
import {
  gradingReviewSnapshotSchema,
  summarizeGradingReviews,
  type GradingReviewSnapshot,
} from '@/lib/grading/evals'

const provenance = {
  provider: 'openai',
  model: 'gpt-5-nano',
  policyVersion: 'policy-v1',
  promptVersion: 'prompt-v1',
  gradingProfileVersion: 'profile-v1',
  rubricVersion: 'rubric-v1',
  providerRequestCount: 1,
  tokenUsage: {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
  },
} as const

function review(
  overrides: Partial<GradingReviewSnapshot> = {},
): GradingReviewSnapshot {
  return gradingReviewSnapshotSchema.parse({
    schemaVersion: 'grading-review-v1',
    assessmentKind: 'assignment',
    reviewStatus: 'reviewed',
    criteria: [
      { criterionId: 'completion', suggestedScore: 8, finalScore: 8, maxScore: 10 },
      { criterionId: 'thinking', suggestedScore: 7, finalScore: 7, maxScore: 10 },
      { criterionId: 'workflow', suggestedScore: 9, finalScore: 9, maxScore: 10 },
    ],
    feedbackDisposition: 'unchanged',
    reviewedAt: '2026-07-22T12:00:00.000Z',
    provenance,
    ...overrides,
  })
}

describe('gradingReviewSnapshotSchema', () => {
  it('accepts a bounded, identity-free reviewed correction snapshot', () => {
    expect(review()).toMatchObject({
      assessmentKind: 'assignment',
      reviewStatus: 'reviewed',
      feedbackDisposition: 'unchanged',
    })
  })

  it('rejects identity, content, and raw feedback fields', () => {
    for (const forbidden of [
      { studentId: 'student-1' },
      { assignmentId: 'assignment-1' },
      { submissionText: 'private work' },
      { suggestedFeedback: 'raw AI feedback' },
      { finalFeedback: 'raw teacher feedback' },
    ]) {
      expect(() => review(forbidden as Partial<GradingReviewSnapshot>)).toThrow()
    }
  })

  it('requires unique criteria and coherent final states', () => {
    expect(() => review({
      criteria: [
        { criterionId: 'completion', suggestedScore: 8, finalScore: 8, maxScore: 10 },
        { criterionId: 'completion', suggestedScore: 7, finalScore: 7, maxScore: 10 },
      ],
    })).toThrow(/Duplicate grading review criterion/)

    expect(() => review({
      reviewStatus: 'reviewed',
      reviewedAt: null,
    })).toThrow(/reviewedAt/)

    expect(() => review({
      reviewStatus: 'dismissed',
      reviewedAt: '2026-07-22T12:00:00.000Z',
    })).toThrow(/finalScore/)
  })
})

describe('summarizeGradingReviews', () => {
  it('measures accepted and edited teacher outcomes without model calls', () => {
    const summary = summarizeGradingReviews([
      review(),
      review({
        criteria: [
          { criterionId: 'completion', suggestedScore: 8, finalScore: 7, maxScore: 10 },
          { criterionId: 'thinking', suggestedScore: 7, finalScore: 5, maxScore: 10 },
          { criterionId: 'workflow', suggestedScore: 9, finalScore: 9, maxScore: 10 },
        ],
        feedbackDisposition: 'edited',
      }),
      review({
        assessmentKind: 'test',
        criteria: [
          { criterionId: 'response', suggestedScore: 4, finalScore: 3.5, maxScore: 5 },
        ],
      }),
      review({
        reviewStatus: 'pending',
        reviewedAt: null,
        feedbackDisposition: 'pending',
      }),
      review({
        assessmentKind: 'test',
        reviewStatus: 'dismissed',
        reviewedAt: '2026-07-22T12:00:00.000Z',
        criteria: [
          { criterionId: 'response', suggestedScore: 2, finalScore: null, maxScore: 5 },
        ],
        feedbackDisposition: 'removed',
      }),
    ], { generatedAt: '2026-07-22T13:00:00.000Z' })

    expect(summary).toMatchObject({
      schemaVersion: 'grading-review-summary-v1',
      generatedAt: '2026-07-22T13:00:00.000Z',
      sampleCount: 5,
      reviewedCount: 3,
      pendingCount: 1,
      dismissedCount: 1,
      acceptance: {
        acceptedCount: 1,
        editedCount: 2,
        acceptedRate: 1 / 3,
        editedRate: 2 / 3,
      },
      feedback: {
        comparedCount: 3,
        unchangedCount: 2,
        editedCount: 1,
        removedCount: 0,
        unchangedRate: 2 / 3,
        editedRate: 1 / 3,
        removedRate: 0,
      },
      providers: { openai: 4 },
      models: { 'gpt-5-nano': 4 },
      gradingProfiles: { 'profile-v1': 4 },
    })
    expect(summary.criteria['assignment.completion']).toEqual({
      meanAbsoluteError: 0.5,
      withinOneRate: 1,
      exactRate: 0.5,
      comparedCount: 2,
    })
    expect(summary.criteria['assignment.thinking']).toEqual({
      meanAbsoluteError: 1,
      withinOneRate: 0.5,
      exactRate: 0.5,
      comparedCount: 2,
    })
    expect(summary.criteria['test.response']).toEqual({
      meanAbsoluteError: 0.5,
      withinOneRate: 1,
      exactRate: 0,
      comparedCount: 1,
    })
    expect(summary.overall).toEqual({
      meanAbsoluteError: 7 / 6,
      withinThreeTotalRate: 1,
      comparedCount: 3,
    })
  })

  it('returns zero-valued rates when there are no finalized reviews', () => {
    const summary = summarizeGradingReviews([
      review({
        reviewStatus: 'pending',
        reviewedAt: null,
        feedbackDisposition: 'pending',
      }),
    ], { generatedAt: '2026-07-22T13:00:00.000Z' })

    expect(summary.reviewedCount).toBe(0)
    expect(summary.acceptance.acceptedRate).toBe(0)
    expect(summary.overall).toEqual({
      meanAbsoluteError: 0,
      withinThreeTotalRate: 0,
      comparedCount: 0,
    })
  })

  it('measures total-score error after offsetting criterion corrections', () => {
    const summary = summarizeGradingReviews([
      review({
        criteria: [
          { criterionId: 'completion', suggestedScore: 8, finalScore: 7, maxScore: 10 },
          { criterionId: 'thinking', suggestedScore: 7, finalScore: 8, maxScore: 10 },
          { criterionId: 'workflow', suggestedScore: 9, finalScore: 9, maxScore: 10 },
        ],
        feedbackDisposition: 'edited',
      }),
    ], { generatedAt: '2026-07-22T13:00:00.000Z' })

    expect(summary.criteria['assignment.completion'].meanAbsoluteError).toBe(1)
    expect(summary.criteria['assignment.thinking'].meanAbsoluteError).toBe(1)
    expect(summary.overall).toEqual({
      meanAbsoluteError: 0,
      withinThreeTotalRate: 1,
      comparedCount: 1,
    })
  })
})
