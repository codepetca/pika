import { z } from 'zod'

export const gradingCriterionKindSchema = z.enum([
  'content',
  'thinking',
  'communication',
  'workflow',
])

export const gradingCriterionSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(1200),
  kind: gradingCriterionKindSchema,
  scale: z.object({
    min: z.number().finite(),
    max: z.number().finite(),
  }).refine((scale) => scale.max > scale.min, 'Criterion maximum must exceed its minimum'),
  weight: z.number().positive().max(100),
})

export const gradingRubricSchema = z.object({
  version: z.string().min(1).max(120),
  criteria: z.array(gradingCriterionSchema).min(1).max(20),
}).superRefine((rubric, ctx) => {
  const seen = new Set<string>()
  for (const [index, criterion] of rubric.criteria.entries()) {
    if (seen.has(criterion.id)) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate grading criterion: ${criterion.id}`,
        path: ['criteria', index, 'id'],
      })
    }
    seen.add(criterion.id)
  }
})

export const gradingTokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
})

export const gradingCriterionResultSchema = z.object({
  criterionId: z.string().min(1),
  score: z.number().finite(),
  maxScore: z.number().finite(),
  weightedScore: z.number().finite(),
  weightedMaxScore: z.number().finite(),
  rationale: z.string().nullable(),
  evidence: z.array(z.string()),
  confidence: z.number().min(0).max(1).nullable(),
  flags: z.array(z.string()),
})

export const gradingResultSchema = z.object({
  overallScore: z.number().finite(),
  maxScore: z.number().positive(),
  percent: z.number().min(0).max(100),
  criteriaResults: z.array(gradingCriterionResultSchema).min(1),
  feedback: z.object({
    student: z.string().min(1),
    teacherNotes: z.string().nullable(),
  }),
  provider: z.string().min(1),
  model: z.string().min(1),
  policyVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  gradingProfileVersion: z.string().min(1),
  rubricVersion: z.string().min(1),
  tokenUsage: gradingTokenUsageSchema,
  providerRequestCount: z.number().int().positive(),
})

export type GradingRubric = z.infer<typeof gradingRubricSchema>
export type GradingTokenUsage = z.infer<typeof gradingTokenUsageSchema>
export type GradingResult = z.infer<typeof gradingResultSchema>
