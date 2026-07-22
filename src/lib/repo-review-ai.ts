import {
  createProviderRefMap,
  mapProviderRefToLocalId,
  sanitizeAiOutputText,
  sanitizeAiText,
  type AiSanitizationContext,
} from '@/lib/ai-sanitization'
import {
  gradingProvenanceSchema,
  type GradingProvenance,
} from '@/lib/grading/contracts'
import { executeStructuredOutput, type GradingExecutionMetadata } from '@/lib/grading/engine'
import {
  buildPikaRepoReviewClassificationPrompt,
  buildPikaRepoReviewFeedbackPrompt,
  parsePikaRepoReviewClassificationOutput,
  parsePikaRepoReviewFeedbackOutput,
  PIKA_REPO_REVIEW_CLASSIFICATION_BATCH_SIZE,
  PIKA_REPO_REVIEW_CLASSIFICATION_OUTPUT,
  PIKA_REPO_REVIEW_CLASSIFICATION_POLICY_VERSION,
  PIKA_REPO_REVIEW_FEEDBACK_OUTPUT,
  PIKA_REPO_REVIEW_FEEDBACK_POLICY_VERSION,
  PIKA_REPO_REVIEW_FEEDBACK_PROFILE_VERSION,
  PIKA_REPO_REVIEW_FEEDBACK_PROMPT_VERSION,
  PIKA_REPO_REVIEW_FEEDBACK_RUBRIC_VERSION,
  PIKA_REPO_REVIEW_HEURISTIC_MODEL,
  PIKA_REPO_REVIEW_LOCAL_PROVIDER,
} from '@/lib/grading/profiles/pika-repo-review'
import { createOpenAiResponsesProvider } from '@/lib/grading/providers/openai-responses'
import type { RepoReviewEvidenceItem, RepoReviewSemanticBreakdown } from '@/types'

const DEFAULT_MODEL = 'gpt-5-nano'
const REPO_REVIEW_REASONING_EFFORT = 'minimal'
const REPO_REVIEW_REQUEST_TIMEOUT_MS = 25_000

function getOpenAIKey(): string | null {
  const key = process.env.OPENAI_API_KEY
  if (!key) return null
  return key.trim() || null
}

export interface RepoReviewFeedbackResult {
  score_completion: number
  score_thinking: number
  score_workflow: number
  summary: string
  strengths: string[]
  concerns: string[]
  feedback: string
  confidence: number
  model: string
  provenance: GradingProvenance
}

export interface RepoReviewFeedbackInput {
  assignmentTitle: string
  repoName: string
  studentName: string
  githubLogin: string | null
  commitCount: number
  activeDays: number
  sessionCount: number
  burstRatio: number
  weightedContribution: number
  relativeContributionShare: number
  spreadScore: number
  iterationScore: number
  reviewActivityCount: number
  areas: string[]
  semanticBreakdown: Partial<RepoReviewSemanticBreakdown>
  evidence: RepoReviewEvidenceItem[]
  warnings: string[]
  confidence: number
  sanitizationContext?: AiSanitizationContext
}

type SanitizedRepoReviewValue =
  | string
  | number
  | boolean
  | null
  | SanitizedRepoReviewValue[]
  | { [key: string]: SanitizedRepoReviewValue }

function scoreFromUnit(value: number): number {
  return Math.max(0, Math.min(10, Math.round(value * 10)))
}

function formatStrengths(strengths: string[]): string {
  if (!strengths.length) return ''
  return `Strengths: ${strengths.join('; ')}`
}

function formatConcerns(concerns: string[]): string {
  if (!concerns.length) return ''
  return `Concerns: ${concerns.join('; ')}`
}

function buildRepoReviewProvenance(execution: GradingExecutionMetadata): GradingProvenance {
  return gradingProvenanceSchema.parse({
    schemaVersion: 'assignment-grading-provenance-v1',
    provider: execution.provider,
    model: execution.model,
    policyVersion: execution.policyVersion,
    promptVersion: PIKA_REPO_REVIEW_FEEDBACK_PROMPT_VERSION,
    gradingProfileVersion: PIKA_REPO_REVIEW_FEEDBACK_PROFILE_VERSION,
    rubricVersion: PIKA_REPO_REVIEW_FEEDBACK_RUBRIC_VERSION,
    providerRequestCount: execution.providerRequestCount,
    tokenUsage: execution.tokenUsage,
  })
}

function buildHeuristicRepoReviewProvenance(): GradingProvenance {
  return gradingProvenanceSchema.parse({
    schemaVersion: 'assignment-grading-provenance-v1',
    provider: PIKA_REPO_REVIEW_LOCAL_PROVIDER,
    model: PIKA_REPO_REVIEW_HEURISTIC_MODEL,
    policyVersion: PIKA_REPO_REVIEW_FEEDBACK_POLICY_VERSION,
    promptVersion: PIKA_REPO_REVIEW_FEEDBACK_PROMPT_VERSION,
    gradingProfileVersion: PIKA_REPO_REVIEW_FEEDBACK_PROFILE_VERSION,
    rubricVersion: PIKA_REPO_REVIEW_FEEDBACK_RUBRIC_VERSION,
    providerRequestCount: 0,
    tokenUsage: { inputTokens: null, outputTokens: null, totalTokens: null },
  })
}

export function buildHeuristicRepoReviewFeedback(input: RepoReviewFeedbackInput): RepoReviewFeedbackResult {
  const completion = scoreFromUnit(
    input.relativeContributionShare * 0.55
      + Math.min(input.areas.length, 4) / 4 * 0.25
      + Math.min((input.semanticBreakdown.test || 0) + (input.semanticBreakdown.refactor || 0), input.weightedContribution) / Math.max(input.weightedContribution || 1, 1) * 0.2
  )
  const thinking = scoreFromUnit(
    Math.min(input.areas.length, 4) / 4 * 0.4
      + Math.min((input.semanticBreakdown.feature || 0) + (input.semanticBreakdown.refactor || 0), input.weightedContribution) / Math.max(input.weightedContribution || 1, 1) * 0.35
      + Math.min(input.reviewActivityCount, 4) / 4 * 0.25
  )
  const workflow = scoreFromUnit(
    input.spreadScore * 0.4
      + (1 - input.burstRatio) * 0.35
      + input.iterationScore * 0.25
  )

  const strengths: string[] = []
  const concerns: string[] = []

  if (input.commitCount > 0) {
    strengths.push(`${input.commitCount} commit${input.commitCount === 1 ? '' : 's'} mapped to this student`)
  }
  if (input.spreadScore >= 0.5) {
    strengths.push('work was spread across the assignment window')
  }
  if (input.reviewActivityCount > 0) {
    strengths.push(`${input.reviewActivityCount} PR/review activit${input.reviewActivityCount === 1 ? 'y' : 'ies'} contributed collaboration evidence`)
  }
  if (input.burstRatio >= 0.75) {
    concerns.push('most work landed near the deadline')
  }
  if (input.commitCount <= 1 && input.reviewActivityCount === 0) {
    concerns.push('very limited visible activity was available to assess')
  }
  if (input.warnings.length > 0) {
    concerns.push(input.warnings[0])
  }

  const summary = `${input.studentName} contributed ${Math.round(input.relativeContributionShare * 100)}% of mapped weighted work in ${input.repoName}.`
  const improvement = workflow <= 5
    ? 'Improve: Break work into more sessions across the assignment window so the process is easier to evaluate.'
    : ''
  const parts = [
    summary,
    formatStrengths(strengths),
    formatConcerns(concerns),
    `Next Step: ${workflow <= 5 ? 'show a steadier workflow over time' : 'keep pairing implementation with visible iteration and tests'}.`,
    improvement,
  ].filter(Boolean)

  return {
    score_completion: completion,
    score_thinking: thinking,
    score_workflow: workflow,
    summary,
    strengths,
    concerns,
    feedback: parts.join(' '),
    confidence: input.confidence,
    model: PIKA_REPO_REVIEW_HEURISTIC_MODEL,
    provenance: buildHeuristicRepoReviewProvenance(),
  }
}

function sanitizeRepoReviewFeedbackResult(
  result: RepoReviewFeedbackResult,
  context?: AiSanitizationContext,
): RepoReviewFeedbackResult {
  return {
    ...result,
    summary: sanitizeAiText(result.summary, context),
    strengths: result.strengths.map((strength) => sanitizeAiText(strength, context)),
    concerns: result.concerns.map((concern) => sanitizeAiText(concern, context)),
    feedback: sanitizeAiText(result.feedback, context),
  }
}

function sanitizeRepoReviewValue(value: unknown, context?: AiSanitizationContext): SanitizedRepoReviewValue {
  if (typeof value === 'string') return sanitizeAiText(value, context)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) return value.map((item) => sanitizeRepoReviewValue(item, context))
  if (typeof value === 'object' && value) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        sanitizeRepoReviewValue(nested, context),
      ]),
    )
  }
  return null
}

export async function classifyAmbiguousRepoReviewChanges(
  items: Array<{ id: string; summary: string }>,
  sanitizationContext?: AiSanitizationContext,
): Promise<Record<string, string>> {
  const apiKey = getOpenAIKey()
  if (!apiKey || items.length === 0) return {}

  const model = process.env.OPENAI_GRADING_MODEL?.trim() || DEFAULT_MODEL
  const providerItems = createProviderRefMap(
    items.map((item) => ({
      localId: item.id,
      summary: sanitizeAiText(item.summary, sanitizationContext),
    })),
    'change',
  )
  const providerRefToLocalId = mapProviderRefToLocalId(providerItems)
  const provider = createOpenAiResponsesProvider({ apiKey })
  const classifications: Array<[string, string]> = []

  for (let index = 0; index < providerItems.length; index += PIKA_REPO_REVIEW_CLASSIFICATION_BATCH_SIZE) {
    const batch = providerItems.slice(index, index + PIKA_REPO_REVIEW_CLASSIFICATION_BATCH_SIZE)
    const result = await executeStructuredOutput({
      provider,
      policy: {
        version: PIKA_REPO_REVIEW_CLASSIFICATION_POLICY_VERSION,
        model,
        requestTimeoutMs: REPO_REVIEW_REQUEST_TIMEOUT_MS,
        reasoningEffort: REPO_REVIEW_REASONING_EFFORT,
      },
      prompt: buildPikaRepoReviewClassificationPrompt(batch),
      output: PIKA_REPO_REVIEW_CLASSIFICATION_OUTPUT,
      parseOutput: parsePikaRepoReviewClassificationOutput,
    })

    for (const item of result.output.items) {
      const localId = providerRefToLocalId.get(item.id)
      if (localId) classifications.push([localId, item.category])
    }
  }

  return Object.fromEntries(classifications)
}

export async function gradeRepoReviewFeedback(input: RepoReviewFeedbackInput): Promise<RepoReviewFeedbackResult> {
  const apiKey = getOpenAIKey()
  if (!apiKey) {
    return sanitizeRepoReviewFeedbackResult(
      buildHeuristicRepoReviewFeedback(input),
      input.sanitizationContext,
    )
  }

  const model = process.env.OPENAI_GRADING_MODEL?.trim() || DEFAULT_MODEL
  const sanitizationContext = input.sanitizationContext
  const prompt = buildPikaRepoReviewFeedbackPrompt({
    assignmentTitle: sanitizeAiText(input.assignmentTitle, sanitizationContext),
    metrics: {
      commit_count: input.commitCount,
      active_days: input.activeDays,
      session_count: input.sessionCount,
      burst_ratio: input.burstRatio,
      weighted_contribution: input.weightedContribution,
      relative_contribution_share: input.relativeContributionShare,
      spread_score: input.spreadScore,
      iteration_score: input.iterationScore,
      review_activity_count: input.reviewActivityCount,
      areas: input.areas.map((area) => sanitizeAiText(area, sanitizationContext)),
      semantic_breakdown: input.semanticBreakdown,
      confidence: input.confidence,
    },
    evidence: sanitizeRepoReviewValue(input.evidence, sanitizationContext),
    warnings: input.warnings.map((warning) => sanitizeAiText(warning, sanitizationContext)),
  })

  try {
    const result = await executeStructuredOutput({
      provider: createOpenAiResponsesProvider({ apiKey }),
      policy: {
        version: PIKA_REPO_REVIEW_FEEDBACK_POLICY_VERSION,
        model,
        requestTimeoutMs: REPO_REVIEW_REQUEST_TIMEOUT_MS,
        reasoningEffort: REPO_REVIEW_REASONING_EFFORT,
      },
      prompt,
      output: PIKA_REPO_REVIEW_FEEDBACK_OUTPUT,
      parseOutput: parsePikaRepoReviewFeedbackOutput,
    })
    const parsed = result.output
    const formattedFeedback = [
      parsed.summary,
      formatStrengths(parsed.strengths),
      formatConcerns(parsed.concerns),
      parsed.feedback,
    ].filter(Boolean).join(' ')

    return {
      ...parsed,
      summary: sanitizeAiOutputText(parsed.summary),
      strengths: parsed.strengths.map(sanitizeAiOutputText),
      concerns: parsed.concerns.map(sanitizeAiOutputText),
      feedback: sanitizeAiOutputText(formattedFeedback),
      model,
      provenance: buildRepoReviewProvenance(result.execution),
    }
  } catch {
    return sanitizeRepoReviewFeedbackResult(
      buildHeuristicRepoReviewFeedback(input),
      input.sanitizationContext,
    )
  }
}
