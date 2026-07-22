import { z } from 'zod'
import { gradingTokenUsageSchema } from '@/lib/grading/contracts'

export const gradingReviewProvenanceSchema = z.object({
  provider: z.string().min(1).max(120),
  model: z.string().min(1).max(200),
  policyVersion: z.string().min(1).max(120),
  promptVersion: z.string().min(1).max(120),
  gradingProfileVersion: z.string().min(1).max(120),
  rubricVersion: z.string().min(1).max(120),
  providerRequestCount: z.number().int().nonnegative().max(10),
  tokenUsage: gradingTokenUsageSchema,
}).strict()

export const gradingReviewCriterionSchema = z.object({
  criterionId: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  suggestedScore: z.number().finite().nonnegative(),
  finalScore: z.number().finite().nonnegative().nullable(),
  maxScore: z.number().finite().positive(),
}).strict().superRefine((criterion, ctx) => {
  if (criterion.suggestedScore > criterion.maxScore) {
    ctx.addIssue({
      code: 'custom',
      message: 'suggestedScore cannot exceed maxScore',
      path: ['suggestedScore'],
    })
  }
  if (criterion.finalScore != null && criterion.finalScore > criterion.maxScore) {
    ctx.addIssue({
      code: 'custom',
      message: 'finalScore cannot exceed maxScore',
      path: ['finalScore'],
    })
  }
})

export const gradingReviewSnapshotSchema = z.object({
  schemaVersion: z.literal('grading-review-v1'),
  assessmentKind: z.enum(['assignment', 'test']),
  reviewStatus: z.enum(['pending', 'reviewed', 'dismissed']),
  criteria: z.array(gradingReviewCriterionSchema).min(1).max(20),
  feedbackDisposition: z.enum(['pending', 'unchanged', 'edited', 'removed']),
  reviewedAt: z.string().datetime({ offset: true }).nullable(),
  provenance: gradingReviewProvenanceSchema,
}).strict().superRefine((review, ctx) => {
  const seen = new Set<string>()
  for (const [index, criterion] of review.criteria.entries()) {
    if (seen.has(criterion.criterionId)) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate grading review criterion: ${criterion.criterionId}`,
        path: ['criteria', index, 'criterionId'],
      })
    }
    seen.add(criterion.criterionId)
  }

  if (review.reviewStatus === 'pending' && review.reviewedAt !== null) {
    ctx.addIssue({
      code: 'custom',
      message: 'Pending grading reviews cannot have reviewedAt',
      path: ['reviewedAt'],
    })
  }
  if (review.reviewStatus !== 'pending' && review.reviewedAt === null) {
    ctx.addIssue({
      code: 'custom',
      message: 'Finalized grading reviews require reviewedAt',
      path: ['reviewedAt'],
    })
  }
  if (review.reviewStatus !== 'pending' && review.feedbackDisposition === 'pending') {
    ctx.addIssue({
      code: 'custom',
      message: 'Finalized grading reviews require a final feedback disposition',
      path: ['feedbackDisposition'],
    })
  }
  if (review.reviewStatus === 'reviewed') {
    for (const [index, criterion] of review.criteria.entries()) {
      if (criterion.finalScore === null) {
        ctx.addIssue({
          code: 'custom',
          message: 'Reviewed grading reviews require every finalScore',
          path: ['criteria', index, 'finalScore'],
        })
      }
    }
  }
  if (review.reviewStatus === 'dismissed') {
    for (const [index, criterion] of review.criteria.entries()) {
      if (criterion.finalScore !== null) {
        ctx.addIssue({
          code: 'custom',
          message: 'Dismissed grading reviews require null finalScore values',
          path: ['criteria', index, 'finalScore'],
        })
      }
    }
  }
})

export type GradingReviewSnapshot = z.infer<typeof gradingReviewSnapshotSchema>

type ReviewMetric = {
  meanAbsoluteError: number
  withinOneRate: number
  exactRate: number
  comparedCount: number
}

export type GradingReviewSummary = {
  schemaVersion: 'grading-review-summary-v1'
  generatedAt: string
  sampleCount: number
  reviewedCount: number
  pendingCount: number
  dismissedCount: number
  acceptance: {
    acceptedCount: number
    editedCount: number
    acceptedRate: number
    editedRate: number
  }
  feedback: {
    comparedCount: number
    unchangedCount: number
    editedCount: number
    removedCount: number
    unchangedRate: number
    editedRate: number
    removedRate: number
  }
  criteria: Record<string, ReviewMetric>
  overall: {
    meanAbsoluteError: number
    withinThreeTotalRate: number
    comparedCount: number
  }
  providers: Record<string, number>
  models: Record<string, number>
  gradingProfiles: Record<string, number>
}

export function summarizeGradingReviews(
  values: GradingReviewSnapshot[],
  opts: { generatedAt?: string } = {},
): GradingReviewSummary {
  const reviews = values.map((value) => gradingReviewSnapshotSchema.parse(value))
  const reviewed = reviews.filter((review) => review.reviewStatus === 'reviewed')
  const finalized = reviews.filter((review) => review.reviewStatus !== 'pending')
  const criterionDiffs = new Map<string, number[]>()
  const overallDiffs: number[] = []
  let acceptedCount = 0
  let feedbackUnchangedCount = 0
  let feedbackEditedCount = 0
  let feedbackRemovedCount = 0

  for (const review of reviewed) {
    let scoreChanged = false
    let overallDiff = 0
    for (const criterion of review.criteria) {
      const finalScore = criterion.finalScore!
      const diff = Math.abs(criterion.suggestedScore - finalScore)
      const key = `${review.assessmentKind}.${criterion.criterionId}`
      const diffs = criterionDiffs.get(key) ?? []
      diffs.push(diff)
      criterionDiffs.set(key, diffs)
      overallDiff += diff
      scoreChanged ||= diff !== 0
    }
    overallDiffs.push(overallDiff)

    if (review.feedbackDisposition === 'unchanged') feedbackUnchangedCount += 1
    if (review.feedbackDisposition === 'edited') feedbackEditedCount += 1
    if (review.feedbackDisposition === 'removed') feedbackRemovedCount += 1
    if (!scoreChanged && review.feedbackDisposition === 'unchanged') acceptedCount += 1
  }

  const feedbackComparedCount = reviewed.length
  const editedCount = reviewed.length - acceptedCount

  return {
    schemaVersion: 'grading-review-summary-v1',
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    sampleCount: reviews.length,
    reviewedCount: reviewed.length,
    pendingCount: reviews.filter((review) => review.reviewStatus === 'pending').length,
    dismissedCount: reviews.filter((review) => review.reviewStatus === 'dismissed').length,
    acceptance: {
      acceptedCount,
      editedCount,
      acceptedRate: rate(acceptedCount, reviewed.length),
      editedRate: rate(editedCount, reviewed.length),
    },
    feedback: {
      comparedCount: feedbackComparedCount,
      unchangedCount: feedbackUnchangedCount,
      editedCount: feedbackEditedCount,
      removedCount: feedbackRemovedCount,
      unchangedRate: rate(feedbackUnchangedCount, feedbackComparedCount),
      editedRate: rate(feedbackEditedCount, feedbackComparedCount),
      removedRate: rate(feedbackRemovedCount, feedbackComparedCount),
    },
    criteria: Object.fromEntries(
      Array.from(criterionDiffs.entries()).map(([criterionId, diffs]) => [
        criterionId,
        summarizeDiffs(diffs),
      ]),
    ),
    overall: {
      meanAbsoluteError: mean(overallDiffs),
      withinThreeTotalRate: rate(
        overallDiffs.filter((diff) => diff <= 3).length,
        overallDiffs.length,
      ),
      comparedCount: overallDiffs.length,
    },
    providers: countBy(finalized, (review) => review.provenance.provider),
    models: countBy(finalized, (review) => review.provenance.model),
    gradingProfiles: countBy(
      finalized,
      (review) => review.provenance.gradingProfileVersion,
    ),
  }
}

function summarizeDiffs(diffs: number[]): ReviewMetric {
  return {
    meanAbsoluteError: mean(diffs),
    withinOneRate: rate(diffs.filter((diff) => diff <= 1).length, diffs.length),
    exactRate: rate(diffs.filter((diff) => diff === 0).length, diffs.length),
    comparedCount: diffs.length,
  }
}

function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

function countBy<T>(values: T[], key: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) {
    const resolved = key(value)
    counts[resolved] = (counts[resolved] ?? 0) + 1
  }
  return counts
}
