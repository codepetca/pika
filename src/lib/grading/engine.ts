import {
  gradingResultSchema,
  gradingRubricSchema,
  type GradingTokenUsage,
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
  requestTimeoutMs?: number
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high'
}

export interface StructuredOutputSpec {
  schemaName: string
  jsonSchema: Record<string, unknown>
  initialMaxOutputTokens: number
  fallbackMaxOutputTokens: number
}

export interface GradingExecutionMetadata {
  provider: string
  model: string
  policyVersion: string
  providerRequestCount: number
  tokenUsage: GradingTokenUsage
}

export async function executeStructuredOutput<TOutput>(opts: {
  provider: StructuredOutputProvider
  policy: GradingPolicy
  prompt: {
    systemPrompt: string
    userPrompt: string
  }
  output: StructuredOutputSpec
  parseOutput(outputText: string): TOutput
}): Promise<{ output: TOutput; execution: GradingExecutionMetadata }> {
  const providerResponse = await opts.provider.generate({
    model: opts.policy.model,
    systemPrompt: opts.prompt.systemPrompt,
    userPrompt: opts.prompt.userPrompt,
    schemaName: opts.output.schemaName,
    jsonSchema: opts.output.jsonSchema,
    initialMaxOutputTokens: opts.output.initialMaxOutputTokens,
    fallbackMaxOutputTokens: opts.output.fallbackMaxOutputTokens,
    requestTimeoutMs: opts.policy.requestTimeoutMs,
    reasoningEffort: opts.policy.reasoningEffort,
  })

  let output: TOutput
  try {
    output = opts.parseOutput(providerResponse.outputText)
  } catch (error) {
    throw new GradingOutputError(
      error instanceof Error ? error.message : 'Grading provider returned invalid output',
      { cause: error },
    )
  }

  return {
    output,
    execution: {
      provider: opts.provider.id,
      model: opts.policy.model,
      policyVersion: opts.policy.version,
      providerRequestCount: providerResponse.requestCount,
      tokenUsage: providerResponse.tokenUsage,
    },
  }
}

export async function executeGrading<TInput, TOutput>(opts: {
  input: TInput
  profile: GradingProfile<TInput, TOutput>
  provider: StructuredOutputProvider
  policy: GradingPolicy
}): Promise<GradingResult> {
  const rubric = gradingRubricSchema.parse(opts.profile.rubric)
  const prompt = opts.profile.buildPrompt(opts.input)
  const structured = await executeStructuredOutput({
    provider: opts.provider,
    policy: opts.policy,
    prompt,
    output: opts.profile.output,
    parseOutput: opts.profile.parseOutput,
  })

  let normalized: ReturnType<typeof opts.profile.normalizeOutput>
  try {
    normalized = opts.profile.normalizeOutput(structured.output)
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
    provider: structured.execution.provider,
    model: structured.execution.model,
    policyVersion: structured.execution.policyVersion,
    promptVersion: opts.profile.promptVersion,
    gradingProfileVersion: opts.profile.version,
    rubricVersion: rubric.version,
    tokenUsage: structured.execution.tokenUsage,
    providerRequestCount: structured.execution.providerRequestCount,
  })
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
