import {
  extractAssignmentArtifacts,
  type AssignmentArtifact,
} from '@/lib/assignment-artifacts'
import {
  estimatePromptMetrics,
  logAiPromptTelemetry,
} from '@/lib/ai-prompt-metrics'
import {
  sanitizeAiOutputText,
  sanitizeAiText,
  type AiSanitizationContext,
} from '@/lib/ai-sanitization'
import { toGradingProvenance, type GradingProvenance } from '@/lib/grading/contracts'
import { executeGrading, executeStructuredOutput, GradingOutputError } from '@/lib/grading/engine'
import {
  PIKA_ASSIGNMENT_GRADING_PROFILE,
  PIKA_ASSIGNMENT_POLICY_VERSION,
  type PikaAssignmentGradingInput,
} from '@/lib/grading/profiles/pika-assignment'
import {
  buildPikaAssignmentAnchorPrompt,
  normalizePikaAssignmentAnchors,
  parsePikaAssignmentAnchorOutput,
  PIKA_ASSIGNMENT_ANCHOR_OUTPUT,
  PIKA_ASSIGNMENT_ANCHOR_POLICY_VERSION,
  type AssignmentGradingAnchors,
} from '@/lib/grading/profiles/pika-assignment-anchors'
import { PIKA_ASSIGNMENT_ANCHORED_GRADING_PROFILE } from '@/lib/grading/profiles/pika-assignment-anchored'
import { createDeepSeekChatProvider } from '@/lib/grading/providers/deepseek-chat'
import { GradingProviderError } from '@/lib/grading/providers/types'
import { extractPlainText } from '@/lib/tiptap-content'
import type { TiptapContent } from '@/types'

const DEFAULT_MODEL = 'deepseek-flash'

/**
 * Anchors are off by default. Turning this on changes the grading prompt and
 * the persisted prompt/profile versions, so it is a deliberate rollout step.
 */
export function isAssignmentGradingAnchorsEnabled(): boolean {
  return process.env.ASSIGNMENT_GRADING_ANCHORS_ENABLED?.trim().toLowerCase() === 'true'
}

/**
 * Anchors are generated from the instructions alone. Below this length the
 * model is guessing what the assignment asks for, and callers should surface
 * that rather than present weak anchors as authoritative.
 */
export const ASSIGNMENT_ANCHOR_THIN_INSTRUCTIONS_CHARS = 200

export function hasThinAnchorInstructions(instructions: string): boolean {
  return instructions.trim().length < ASSIGNMENT_ANCHOR_THIN_INSTRUCTIONS_CHARS
}

export type AssignmentAiErrorKind =
  | 'config'
  | 'timeout'
  | 'network'
  | 'rate_limit'
  | 'server'
  | 'bad_response'
  | 'invalid_output'

export class AssignmentAiGradingError extends Error {
  readonly kind: AssignmentAiErrorKind
  readonly retryable: boolean
  readonly statusCode: number | null

  constructor(opts: {
    kind: AssignmentAiErrorKind
    message: string
    retryable: boolean
    statusCode?: number | null
  }) {
    super(opts.message)
    this.name = 'AssignmentAiGradingError'
    this.kind = opts.kind
    this.retryable = opts.retryable
    this.statusCode = opts.statusCode ?? null
  }
}

export function isRetryableAssignmentAiGradingError(error: unknown): error is AssignmentAiGradingError {
  return error instanceof AssignmentAiGradingError && error.retryable
}

interface AssignmentGradingTelemetryContext {
  feature?: string
  operation?: string
  promptProfile?: string
  requestedStrategy?: string | null
  resolvedStrategy?: string | null
  runId?: string | null
  studentId?: string | null
  attempt?: number | null
}

function getDeepSeekKey(): string | null {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) return null
  return key.trim() || null
}

function formatArtifactLabel(artifact: AssignmentArtifact): string {
  switch (artifact.type) {
    case 'image':
      return 'Image'
    case 'repo':
      return 'Repository'
    default:
      return 'Link'
  }
}

function mergeAssignmentArtifacts(
  extractedArtifacts: AssignmentArtifact[],
  structuredArtifacts: AssignmentArtifact[] = []
): AssignmentArtifact[] {
  const byUrl = new Map<string, AssignmentArtifact>()
  for (const artifact of [...structuredArtifacts, ...extractedArtifacts]) {
    if (!artifact.url) continue
    const existing = byUrl.get(artifact.url)
    if (existing?.type === 'image') continue
    byUrl.set(artifact.url, artifact)
  }
  return Array.from(byUrl.values())
}

export function hasGradableAssignmentSubmission(
  studentWork: TiptapContent,
  submissionArtifacts: AssignmentArtifact[] = []
): boolean {
  const studentText = extractPlainText(studentWork).trim()
  const artifacts = mergeAssignmentArtifacts(extractAssignmentArtifacts(studentWork), submissionArtifacts)

  return studentText.length > 0 || artifacts.length > 0
}

function buildStudentSubmissionText(
  studentWork: TiptapContent,
  submissionArtifacts: AssignmentArtifact[] = []
): string {
  const studentText = extractPlainText(studentWork).trim()
  const artifacts = mergeAssignmentArtifacts(extractAssignmentArtifacts(studentWork), submissionArtifacts)
  const sections: string[] = []

  if (studentText) {
    sections.push(studentText)
  }

  if (artifacts.length > 0) {
    const artifactLines = artifacts.map((artifact) => {
      const repoSummary =
        artifact.type === 'repo' && artifact.repo_owner && artifact.repo_name
          ? ` (${sanitizeAiText(artifact.repo_owner)}/${sanitizeAiText(artifact.repo_name)})`
          : ''
      return `- ${formatArtifactLabel(artifact)}: ${sanitizeAiText(artifact.url)}${repoSummary}`
    })
    sections.push(`Attached Artifacts:\n${artifactLines.join('\n')}`)
  }

  if (!hasGradableAssignmentSubmission(studentWork, submissionArtifacts)) {
    throw new Error('Student work is empty')
  }

  return sections.join('\n\n')
}

export interface GradeResult {
  score_completion: number
  score_thinking: number
  score_workflow: number
  feedback: string
  provider: string
  model: string
  attempts: number
  provider_request_count: number
  policy_version: string
  prompt_version: string
  grading_profile_version: string
  rubric_version: string
  token_usage: {
    input_tokens: number | null
    output_tokens: number | null
    total_tokens: number | null
  }
  provenance: GradingProvenance
}

export interface AssignmentGradingRequest {
  model: string
  systemPrompt: string
  userPrompt: string
  input: PikaAssignmentGradingInput
  anchors: AssignmentGradingAnchors | null
}

export function resolveAssignmentGradingAnchors(
  anchors: AssignmentGradingAnchors | null | undefined,
): AssignmentGradingAnchors | null {
  if (!anchors || !isAssignmentGradingAnchorsEnabled()) return null
  return anchors.criteria.length > 0 ? anchors : null
}

export function buildAssignmentGradingRequest(opts: {
  assignmentTitle: string
  instructions: string
  studentWork: TiptapContent
  submissionArtifacts?: AssignmentArtifact[]
  sanitizationContext?: AiSanitizationContext | null
  anchors?: AssignmentGradingAnchors | null
}): AssignmentGradingRequest {
  const model = process.env.DEEPSEEK_GRADING_MODEL?.trim() || DEFAULT_MODEL
  const studentSubmission = buildStudentSubmissionText(opts.studentWork, opts.submissionArtifacts)
  const assignmentTitle = sanitizeAiText(opts.assignmentTitle, opts.sanitizationContext ?? undefined)
  const instructions = sanitizeAiText(opts.instructions, opts.sanitizationContext ?? undefined)
  const input = {
    assignmentTitle,
    instructions,
    submission: sanitizeAiText(studentSubmission, opts.sanitizationContext ?? undefined),
  }
  const anchors = resolveAssignmentGradingAnchors(opts.anchors)
  const prompt = anchors
    ? PIKA_ASSIGNMENT_ANCHORED_GRADING_PROFILE.buildPrompt({ ...input, anchors })
    : PIKA_ASSIGNMENT_GRADING_PROFILE.buildPrompt(input)

  return {
    model,
    ...prompt,
    input,
    anchors,
  }
}

function toAssignmentAiGradingError(error: unknown): AssignmentAiGradingError {
  if (error instanceof AssignmentAiGradingError) {
    return error
  }

  if (error instanceof GradingProviderError) {
    return new AssignmentAiGradingError({
      kind: error.kind,
      message: error.message,
      retryable: error.retryable,
      statusCode: error.statusCode,
    })
  }

  if (error instanceof GradingOutputError) {
    return new AssignmentAiGradingError({
      kind: 'invalid_output',
      message: error.message,
      retryable: false,
    })
  }

  if (error instanceof Error) {
    return new AssignmentAiGradingError({
      kind: 'bad_response',
      message: error.message,
      retryable: false,
    })
  }

  return new AssignmentAiGradingError({
    kind: 'bad_response',
    message: 'Unknown grading error',
    retryable: false,
  })
}

export interface AssignmentAnchorGenerationResult {
  anchors: AssignmentGradingAnchors
  model: string
  provider: string
  providerRequestCount: number
  thinInstructions: boolean
  tokenUsage: {
    input_tokens: number | null
    output_tokens: number | null
    total_tokens: number | null
  }
}

/**
 * One call per assignment, not per student. The result is reusable for every
 * submission on that assignment because it depends only on the title and the
 * instructions.
 */
export async function generateAssignmentAnchors(opts: {
  assignmentTitle: string
  instructions: string
  requestTimeoutMs?: number
  sanitizationContext?: AiSanitizationContext | null
}): Promise<AssignmentAnchorGenerationResult> {
  const apiKey = getDeepSeekKey()
  if (!apiKey) {
    throw new AssignmentAiGradingError({
      kind: 'config',
      message: 'DEEPSEEK_API_KEY is not configured',
      retryable: false,
    })
  }

  const model = process.env.DEEPSEEK_GRADING_MODEL?.trim() || DEFAULT_MODEL
  const assignmentTitle = sanitizeAiText(opts.assignmentTitle, opts.sanitizationContext ?? undefined)
  const instructions = sanitizeAiText(opts.instructions, opts.sanitizationContext ?? undefined)
  const prompt = buildPikaAssignmentAnchorPrompt({ assignmentTitle, instructions })
  const promptMetrics = estimatePromptMetrics(prompt.systemPrompt, prompt.userPrompt)

  try {
    const { output, execution } = await executeStructuredOutput({
      provider: createDeepSeekChatProvider({ apiKey }),
      policy: {
        version: PIKA_ASSIGNMENT_ANCHOR_POLICY_VERSION,
        model,
        requestTimeoutMs: opts.requestTimeoutMs,
        reasoningEffort: 'medium',
      },
      prompt,
      output: PIKA_ASSIGNMENT_ANCHOR_OUTPUT,
      parseOutput: parsePikaAssignmentAnchorOutput,
    })

    let anchors: AssignmentGradingAnchors
    try {
      anchors = normalizePikaAssignmentAnchors(output)
    } catch {
      // Normalization errors can quote provider text. Keep diagnostics content-free.
      throw new GradingOutputError('Assignment anchor generation returned invalid output')
    }

    anchors = {
      ...anchors,
      criteria: anchors.criteria.map((criterion) => ({
        ...criterion,
        bands: criterion.bands.map((band) => ({
          ...band,
          descriptor: sanitizeAiOutputText(band.descriptor),
        })),
      })),
      notes: anchors.notes ? sanitizeAiOutputText(anchors.notes) : null,
    }

    logAiPromptTelemetry({
      feature: 'assignment_auto_grade',
      operation: 'anchor_generation',
      model,
      promptProfile: 'anchors',
      status: 'success',
      requestedStrategy: 'single',
      resolvedStrategy: 'single',
      questionType: 'n/a',
      responseCount: 0,
      cacheStatus: 'miss',
      sampleSolutionIncluded: false,
      systemChars: promptMetrics.systemChars,
      userChars: promptMetrics.userChars,
      promptChars: promptMetrics.totalChars,
      estimatedInputTokens: promptMetrics.estimatedInputTokens,
      actualInputTokens: execution.tokenUsage.inputTokens,
      actualOutputTokens: execution.tokenUsage.outputTokens,
      actualTotalTokens: execution.tokenUsage.totalTokens,
    })

    return {
      anchors,
      model: execution.model,
      provider: execution.provider,
      providerRequestCount: execution.providerRequestCount,
      thinInstructions: hasThinAnchorInstructions(instructions),
      tokenUsage: {
        input_tokens: execution.tokenUsage.inputTokens,
        output_tokens: execution.tokenUsage.outputTokens,
        total_tokens: execution.tokenUsage.totalTokens,
      },
    }
  } catch (error) {
    const gradingError = toAssignmentAiGradingError(error)
    logAiPromptTelemetry({
      feature: 'assignment_auto_grade',
      operation: 'anchor_generation',
      model,
      promptProfile: 'anchors',
      status: 'error',
      errorClass: gradingError.kind,
      requestedStrategy: 'single',
      resolvedStrategy: 'single',
      questionType: 'n/a',
      responseCount: 0,
      cacheStatus: 'miss',
      sampleSolutionIncluded: false,
      systemChars: promptMetrics.systemChars,
      userChars: promptMetrics.userChars,
      promptChars: promptMetrics.totalChars,
      estimatedInputTokens: promptMetrics.estimatedInputTokens,
    })
    throw gradingError
  }
}

export async function gradeStudentWork(opts: {
  assignmentTitle: string
  instructions: string
  studentWork: TiptapContent
  submissionArtifacts?: AssignmentArtifact[]
  requestTimeoutMs?: number
  telemetry?: AssignmentGradingTelemetryContext
  sanitizationContext?: AiSanitizationContext | null
  anchors?: AssignmentGradingAnchors | null
}): Promise<GradeResult> {
  const apiKey = getDeepSeekKey()
  if (!apiKey) {
    throw new AssignmentAiGradingError({
      kind: 'config',
      message: 'DEEPSEEK_API_KEY is not configured',
      retryable: false,
    })
  }

  const request = buildAssignmentGradingRequest({
    assignmentTitle: opts.assignmentTitle,
    instructions: opts.instructions,
    studentWork: opts.studentWork,
    submissionArtifacts: opts.submissionArtifacts,
    sanitizationContext: opts.sanitizationContext,
    anchors: opts.anchors,
  })
  const promptMetrics = estimatePromptMetrics(request.systemPrompt, request.userPrompt)
  const policy = {
    version: PIKA_ASSIGNMENT_POLICY_VERSION,
    model: request.model,
    requestTimeoutMs: opts.requestTimeoutMs,
    reasoningEffort: 'medium' as const,
  }
  try {
    const gradingResult = request.anchors
      ? await executeGrading({
        input: { ...request.input, anchors: request.anchors },
        profile: PIKA_ASSIGNMENT_ANCHORED_GRADING_PROFILE,
        provider: createDeepSeekChatProvider({ apiKey }),
        policy,
      })
      : await executeGrading({
        input: request.input,
        profile: PIKA_ASSIGNMENT_GRADING_PROFILE,
        provider: createDeepSeekChatProvider({ apiKey }),
        policy,
      })
    const scores = new Map(
      gradingResult.criteriaResults.map((criterion) => [criterion.criterionId, criterion.score]),
    )
    const feedback = sanitizeAiOutputText(gradingResult.feedback.student)
    if (!feedback) {
      throw new GradingOutputError('Feedback is empty')
    }

    logAiPromptTelemetry({
      feature: opts.telemetry?.feature ?? 'assignment_auto_grade',
      operation: opts.telemetry?.operation ?? 'single_grade',
      model: request.model,
      promptProfile: opts.telemetry?.promptProfile ?? (request.anchors ? 'anchored' : 'default'),
      status: 'success',
      runId: opts.telemetry?.runId ?? null,
      studentId: opts.telemetry?.studentId ?? null,
      attempt: opts.telemetry?.attempt ?? null,
      requestedStrategy: opts.telemetry?.requestedStrategy ?? 'single',
      resolvedStrategy: opts.telemetry?.resolvedStrategy ?? 'single',
      questionType: 'n/a',
      responseCount: 1,
      cacheStatus: 'not_applicable',
      sampleSolutionIncluded: false,
      systemChars: promptMetrics.systemChars,
      userChars: promptMetrics.userChars,
      promptChars: promptMetrics.totalChars,
      estimatedInputTokens: promptMetrics.estimatedInputTokens,
      actualInputTokens: gradingResult.tokenUsage.inputTokens,
      actualOutputTokens: gradingResult.tokenUsage.outputTokens,
      actualTotalTokens: gradingResult.tokenUsage.totalTokens,
    })

    return {
      score_completion: scores.get('completion')!,
      score_thinking: scores.get('thinking')!,
      score_workflow: scores.get('workflow')!,
      feedback,
      provider: gradingResult.provider,
      model: gradingResult.model,
      attempts: 1,
      provider_request_count: gradingResult.providerRequestCount,
      policy_version: gradingResult.policyVersion,
      prompt_version: gradingResult.promptVersion,
      grading_profile_version: gradingResult.gradingProfileVersion,
      rubric_version: gradingResult.rubricVersion,
      token_usage: {
        input_tokens: gradingResult.tokenUsage.inputTokens,
        output_tokens: gradingResult.tokenUsage.outputTokens,
        total_tokens: gradingResult.tokenUsage.totalTokens,
      },
      provenance: toGradingProvenance(gradingResult),
    }
  } catch (error) {
    const gradingError = toAssignmentAiGradingError(error)
    logAiPromptTelemetry({
      feature: opts.telemetry?.feature ?? 'assignment_auto_grade',
      operation: opts.telemetry?.operation ?? 'single_grade',
      model: request.model,
      promptProfile: opts.telemetry?.promptProfile ?? (request.anchors ? 'anchored' : 'default'),
      status: 'error',
      errorClass: gradingError.kind,
      runId: opts.telemetry?.runId ?? null,
      studentId: opts.telemetry?.studentId ?? null,
      attempt: opts.telemetry?.attempt ?? null,
      requestedStrategy: opts.telemetry?.requestedStrategy ?? 'single',
      resolvedStrategy: opts.telemetry?.resolvedStrategy ?? 'single',
      questionType: 'n/a',
      responseCount: 1,
      cacheStatus: 'not_applicable',
      sampleSolutionIncluded: false,
      systemChars: promptMetrics.systemChars,
      userChars: promptMetrics.userChars,
      promptChars: promptMetrics.totalChars,
      estimatedInputTokens: promptMetrics.estimatedInputTokens,
    })
    throw gradingError
  }
}
