import {
  gradingResultSchema,
  gradingRubricSchema,
  type GradingResult,
} from '@/lib/grading/contracts'
import type { GradingProfile } from '@/lib/grading/profiles/types'
import type { StructuredOutputProvider } from '@/lib/grading/providers/types'

export class GradingOutputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'GradingOutputError'
  }
}

export interface GradingPolicy {
  version: string
  model: string
  requestTimeoutMs: number
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high'
}

export async function executeGrading<TInput, TOutput>(opts: {
  input: TInput
  profile: GradingProfile<TInput, TOutput>
  provider: StructuredOutputProvider
  policy: GradingPolicy
}): Promise<GradingResult> {
  const rubric = gradingRubricSchema.parse(opts.profile.rubric)
  const prompt = opts.profile.buildPrompt(opts.input)
  const providerResponse = await opts.provider.generate({
    model: opts.policy.model,
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    schemaName: opts.profile.output.schemaName,
    jsonSchema: opts.profile.output.jsonSchema,
    initialMaxOutputTokens: opts.profile.output.initialMaxOutputTokens,
    fallbackMaxOutputTokens: opts.profile.output.fallbackMaxOutputTokens,
    requestTimeoutMs: opts.policy.requestTimeoutMs,
    reasoningEffort: opts.policy.reasoningEffort,
  })

  let normalized: ReturnType<typeof opts.profile.normalizeOutput>
  try {
    normalized = opts.profile.normalizeOutput(opts.profile.parseOutput(providerResponse.outputText))
  } catch (error) {
    throw new GradingOutputError(
      error instanceof Error ? error.message : 'Grading provider returned invalid output',
      { cause: error },
    )
  }

  if (!normalized.feedback.student.trim()) {
    throw new GradingOutputError('Grading feedback is empty')
  }

  const criteriaById = new Map(rubric.criteria.map((criterion) => [criterion.id, criterion]))
  const seen = new Set<string>()
  for (const result of normalized.criteria) {
    if (!criteriaById.has(result.criterionId)) {
      throw new GradingOutputError(`Unknown grading criterion: ${result.criterionId}`)
    }
    if (seen.has(result.criterionId)) {
      throw new GradingOutputError(`Duplicate grading criterion result: ${result.criterionId}`)
    }
    seen.add(result.criterionId)
  }

  const criteriaResults = rubric.criteria.map((criterion) => {
    const result = normalized.criteria.find((candidate) => candidate.criterionId === criterion.id)
    if (!result) {
      throw new GradingOutputError(`Missing grading criterion: ${criterion.id}`)
    }
    if (!Number.isFinite(result.score) || result.score < criterion.scale.min || result.score > criterion.scale.max) {
      throw new GradingOutputError(
        `Score for ${criterion.id} must be between ${criterion.scale.min} and ${criterion.scale.max}`,
      )
    }

    return {
      criterionId: criterion.id,
      score: result.score,
      maxScore: criterion.scale.max,
      weightedScore: round2(result.score * criterion.weight),
      weightedMaxScore: round2(criterion.scale.max * criterion.weight),
      rationale: result.rationale ?? null,
      evidence: result.evidence ?? [],
      confidence: result.confidence ?? null,
      flags: result.flags ?? [],
    }
  })
  const overallScore = round2(criteriaResults.reduce((sum, result) => sum + result.weightedScore, 0))
  const maxScore = round2(criteriaResults.reduce((sum, result) => sum + result.weightedMaxScore, 0))

  return gradingResultSchema.parse({
    overallScore,
    maxScore,
    percent: maxScore > 0 ? round2((overallScore / maxScore) * 100) : 0,
    criteriaResults,
    feedback: {
      student: normalized.feedback.student.trim(),
      teacherNotes: normalized.feedback.teacherNotes,
    },
    provider: opts.provider.id,
    model: opts.policy.model,
    policyVersion: opts.policy.version,
    promptVersion: opts.profile.promptVersion,
    gradingProfileVersion: opts.profile.version,
    rubricVersion: rubric.version,
    tokenUsage: providerResponse.tokenUsage,
    providerRequestCount: providerResponse.requestCount,
  })
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
