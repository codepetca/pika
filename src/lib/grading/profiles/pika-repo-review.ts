import { z } from 'zod'
import type { StructuredOutputSpec } from '@/lib/grading/engine'

export const PIKA_REPO_REVIEW_FEEDBACK_PROFILE_VERSION = 'pika-repo-review-feedback-v1'
export const PIKA_REPO_REVIEW_FEEDBACK_RUBRIC_VERSION = 'pika-repo-review-rubric-v1'
export const PIKA_REPO_REVIEW_FEEDBACK_POLICY_VERSION = 'pika-repo-review-feedback-policy-v1'
export const PIKA_REPO_REVIEW_FEEDBACK_PROMPT_VERSION = 'pika-repo-review-feedback-prompt-v1'
export const PIKA_REPO_REVIEW_CLASSIFICATION_PROFILE_VERSION = 'pika-repo-review-classification-v1'
export const PIKA_REPO_REVIEW_CLASSIFICATION_POLICY_VERSION = 'pika-repo-review-classification-policy-v1'
export const PIKA_REPO_REVIEW_CLASSIFICATION_PROMPT_VERSION = 'pika-repo-review-classification-prompt-v1'
export const PIKA_REPO_REVIEW_HEURISTIC_MODEL = 'repo-review-heuristic-v1'
export const PIKA_REPO_REVIEW_LOCAL_PROVIDER = 'pika-local'
export const PIKA_REPO_REVIEW_CLASSIFICATION_BATCH_SIZE = 50

const semanticCategorySchema = z.enum([
  'feature',
  'bugfix',
  'test',
  'refactor',
  'docs',
  'styling',
  'config',
  'generated',
])

const classificationOutputSchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1).max(64).regex(/^change_[1-9][0-9]*$/),
    category: semanticCategorySchema,
  }).strict()).max(PIKA_REPO_REVIEW_CLASSIFICATION_BATCH_SIZE),
}).strict().superRefine((output, ctx) => {
  const seen = new Set<string>()
  for (const [index, item] of output.items.entries()) {
    if (seen.has(item.id)) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate repository-review classification id: ${item.id}`,
        path: ['items', index, 'id'],
      })
    }
    seen.add(item.id)
  }
})

const feedbackOutputSchema = z.object({
  score_completion: z.number().int().min(0).max(10),
  score_thinking: z.number().int().min(0).max(10),
  score_workflow: z.number().int().min(0).max(10),
  summary: z.string().min(1).max(1200),
  strengths: z.array(z.string().min(1).max(500)).max(8),
  concerns: z.array(z.string().min(1).max(500)).max(8),
  feedback: z.string().min(1).max(2000),
  confidence: z.number().min(0).max(1),
}).strict()

export type PikaRepoReviewClassificationOutput = z.infer<typeof classificationOutputSchema>
export type PikaRepoReviewFeedbackOutput = z.infer<typeof feedbackOutputSchema>

export const PIKA_REPO_REVIEW_CLASSIFICATION_OUTPUT: StructuredOutputSpec = {
  schemaName: 'repo_review_change_classification',
  jsonSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        maxItems: PIKA_REPO_REVIEW_CLASSIFICATION_BATCH_SIZE,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            category: {
              type: 'string',
              enum: semanticCategorySchema.options,
            },
          },
          required: ['id', 'category'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
  initialMaxOutputTokens: 1200,
  fallbackMaxOutputTokens: 1800,
}

export const PIKA_REPO_REVIEW_FEEDBACK_OUTPUT: StructuredOutputSpec = {
  schemaName: 'repo_review_feedback',
  jsonSchema: {
    type: 'object',
    properties: {
      score_completion: { type: 'integer', minimum: 0, maximum: 10 },
      score_thinking: { type: 'integer', minimum: 0, maximum: 10 },
      score_workflow: { type: 'integer', minimum: 0, maximum: 10 },
      summary: { type: 'string' },
      strengths: { type: 'array', items: { type: 'string' }, maxItems: 8 },
      concerns: { type: 'array', items: { type: 'string' }, maxItems: 8 },
      feedback: { type: 'string' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: [
      'score_completion',
      'score_thinking',
      'score_workflow',
      'summary',
      'strengths',
      'concerns',
      'feedback',
      'confidence',
    ],
    additionalProperties: false,
  },
  initialMaxOutputTokens: 700,
  fallbackMaxOutputTokens: 1000,
}

export function buildPikaRepoReviewClassificationPrompt(
  items: Array<{ providerRef: string; summary: string }>,
): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: `You classify software change summaries into one category.

Allowed categories:
- feature
- bugfix
- test
- refactor
- docs
- styling
- config
- generated

Return one item for every supplied change reference. Use only the supplied summaries.`,
    userPrompt: items.map((item) => `- ${item.providerRef}: ${item.summary}`).join('\n'),
  }
}

export function buildPikaRepoReviewFeedbackPrompt(input: {
  assignmentTitle: string
  metrics: Record<string, unknown>
  evidence: unknown
  warnings: string[]
}): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: `You are grading repository contribution evidence for a teacher.

Use these rubric definitions:
- Completion (0-10): meaningful implementation ownership, task coverage, tests/refinement
- Thinking (0-10): complexity, debugging/refactoring evidence, review/problem-solving quality
- Workflow (0-10): consistency over time, iteration, commit hygiene, responsiveness to feedback

Rules:
- Use only the supplied evidence.
- Do not infer hidden work.
- Low confidence or incomplete evidence should lower confidence and lead to cautious scoring.
- Distinguish contribution size from workflow quality.
- Feedback must be 3-5 sentences total.
- If workflow is weak, include one sentence starting with "Improve:" and give a concrete workflow improvement.`,
    userPrompt: JSON.stringify({
      assignment_title: input.assignmentTitle,
      repo_ref: 'repo_1',
      student_ref: 'student_1',
      metrics: input.metrics,
      evidence: input.evidence,
      warnings: input.warnings,
    }),
  }
}

export function parsePikaRepoReviewClassificationOutput(
  outputText: string,
): PikaRepoReviewClassificationOutput {
  return classificationOutputSchema.parse(JSON.parse(outputText))
}

export function parsePikaRepoReviewFeedbackOutput(outputText: string): PikaRepoReviewFeedbackOutput {
  return feedbackOutputSchema.parse(JSON.parse(outputText))
}
