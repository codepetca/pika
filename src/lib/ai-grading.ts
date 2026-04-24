import {
  extractAssignmentArtifacts,
  type AssignmentArtifact,
} from '@/lib/assignment-artifacts'
import {
  estimatePromptMetrics,
  extractOpenAIResponseUsage,
  logAiPromptTelemetry,
} from '@/lib/ai-prompt-metrics'
import { extractPlainText } from '@/lib/tiptap-content'
import type { TiptapContent } from '@/types'

const DEFAULT_MODEL = 'gpt-5-nano'
const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504])
const ASSIGNMENT_GRADING_MAX_OUTPUT_TOKENS = 220
const ASSIGNMENT_GRADING_FALLBACK_MAX_OUTPUT_TOKENS = 420
const ASSIGNMENT_GRADING_REASONING_EFFORT = 'minimal'

const ASSIGNMENT_GRADE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    score_completion: {
      type: 'integer',
      minimum: 0,
      maximum: 10,
    },
    score_thinking: {
      type: 'integer',
      minimum: 0,
      maximum: 10,
    },
    score_workflow: {
      type: 'integer',
      minimum: 0,
      maximum: 10,
    },
    feedback: {
      type: 'string',
      minLength: 1,
    },
  },
  required: ['score_completion', 'score_thinking', 'score_workflow', 'feedback'],
  additionalProperties: false,
} as const

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

function getOpenAIKey(): string | null {
  const key = process.env.OPENAI_API_KEY
  if (!key) return null
  return key.trim() || null
}

function extractResponseOutputText(payload: any): string | null {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  if (payload?.output_parsed && typeof payload.output_parsed === 'object') {
    return JSON.stringify(payload.output_parsed)
  }

  const output = payload?.output
  if (!Array.isArray(output)) return null

  const textParts: string[] = []

  for (const item of output) {
    const content = item?.content
    if (!Array.isArray(content)) continue
    for (const c of content) {
      if (c?.type === 'output_text' && typeof c?.text === 'string' && c.text.trim()) {
        textParts.push(c.text.trim())
        continue
      }
      if (c?.parsed && typeof c.parsed === 'object') {
        return JSON.stringify(c.parsed)
      }
      if (c?.json && typeof c.json === 'object') {
        return JSON.stringify(c.json)
      }
    }
  }

  return textParts.length > 0 ? textParts.join('\n') : null
}

function isMaxOutputIncomplete(payload: any): boolean {
  return (
    payload?.status === 'incomplete' &&
    payload?.incomplete_details?.reason === 'max_output_tokens'
  )
}

function buildAssignmentGradingApiBody(
  request: AssignmentGradingRequest,
  maxOutputTokens: number,
) {
  return {
    model: request.model,
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: request.systemPrompt }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: request.userPrompt }],
      },
    ],
    reasoning: {
      effort: ASSIGNMENT_GRADING_REASONING_EFFORT,
    },
    max_output_tokens: maxOutputTokens,
    text: {
      format: {
        type: 'json_schema',
        name: 'assignment_grade',
        strict: true,
        schema: ASSIGNMENT_GRADE_JSON_SCHEMA,
      },
    },
  }
}

async function fetchAssignmentGradingPayload(opts: {
  apiKey: string
  request: AssignmentGradingRequest
  requestTimeoutMs?: number
  maxOutputTokens: number
}): Promise<any> {
  let response: Response
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildAssignmentGradingApiBody(opts.request, opts.maxOutputTokens)),
      signal:
        opts.requestTimeoutMs && opts.requestTimeoutMs > 0
          ? AbortSignal.timeout(opts.requestTimeoutMs)
          : undefined,
    })
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    ) {
      throw new AssignmentAiGradingError({
        kind: 'timeout',
        message: 'OpenAI grading request timed out',
        retryable: true,
      })
    }

    throw new AssignmentAiGradingError({
      kind: 'network',
      message: error instanceof Error ? error.message : 'OpenAI request failed',
      retryable: true,
    })
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    const statusCode = response.status
    const retryable = RETRYABLE_STATUS_CODES.has(statusCode)
    const kind: AssignmentAiErrorKind =
      statusCode === 429
        ? 'rate_limit'
        : retryable
          ? 'server'
          : statusCode === 401 || statusCode === 403
            ? 'config'
            : 'bad_response'

    throw new AssignmentAiGradingError({
      kind,
      message: `OpenAI request failed (${statusCode}): ${bodyText}`,
      retryable,
      statusCode,
    })
  }

  return response.json()
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

export function hasGradableAssignmentSubmission(studentWork: TiptapContent): boolean {
  const studentText = extractPlainText(studentWork).trim()
  const artifacts = extractAssignmentArtifacts(studentWork)

  return studentText.length > 0 || artifacts.length > 0
}

function buildStudentSubmissionText(studentWork: TiptapContent): string {
  const studentText = extractPlainText(studentWork).trim()
  const artifacts = extractAssignmentArtifacts(studentWork)
  const sections: string[] = []

  if (studentText) {
    sections.push(studentText)
  }

  if (artifacts.length > 0) {
    const artifactLines = artifacts.map((artifact) => {
      const repoSummary =
        artifact.type === 'repo' && artifact.repo_owner && artifact.repo_name
          ? ` (${artifact.repo_owner}/${artifact.repo_name})`
          : ''
      return `- ${formatArtifactLabel(artifact)}: ${artifact.url}${repoSummary}`
    })
    sections.push(`Attached Artifacts:\n${artifactLines.join('\n')}`)
  }

  if (!hasGradableAssignmentSubmission(studentWork)) {
    throw new Error('Student work is empty')
  }

  return sections.join('\n\n')
}

export interface GradeResult {
  score_completion: number
  score_thinking: number
  score_workflow: number
  feedback: string
  model: string
  attempts: number
}

export interface AssignmentGradingRequest {
  model: string
  systemPrompt: string
  userPrompt: string
}

interface AssignmentGradingApiResponse {
  payload: any
  outputText: string
}

export function buildAssignmentGradingRequest(opts: {
  assignmentTitle: string
  instructions: string
  studentWork: TiptapContent
}): AssignmentGradingRequest {
  const model = process.env.OPENAI_GRADING_MODEL?.trim() || DEFAULT_MODEL
  const studentSubmission = buildStudentSubmissionText(opts.studentWork)

  return {
    model,
    systemPrompt: `You are an assignment grader. Grade the student's work using this rubric:

- **Completion** (0–10): Did the student complete all parts of the assignment?
- **Thinking** (0–10): Does the work show depth of thought, analysis, or understanding?
- **Workflow** (0–10): Is the work organized, clear, and well-presented?
- Treat attached artifacts (links, repositories, images) as part of the student's submission. Do not say a required site or artifact is missing if it appears in the "Attached Artifacts" section.

Respond with ONLY valid JSON in this format:
{"score_completion":N,"score_thinking":N,"score_workflow":N,"feedback":"..."}

Feedback rules:
- feedback should be 1-3 sentences
- include one sentence starting with "Strength:"
- include one sentence starting with "Next Step:"
- if total score is less than 30, include one sentence starting with "Improve:" and give one concrete improvement to reach full marks.`,
    userPrompt: `Assignment: ${opts.assignmentTitle}
Instructions: ${opts.instructions}

Student Work:
${studentSubmission}`,
  }
}

function toAssignmentAiGradingError(error: unknown): AssignmentAiGradingError {
  if (error instanceof AssignmentAiGradingError) {
    return error
  }

  if (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  ) {
    return new AssignmentAiGradingError({
      kind: 'timeout',
      message: 'OpenAI grading request timed out',
      retryable: true,
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

async function callAssignmentGradingApi(opts: {
  apiKey: string
  request: AssignmentGradingRequest
  requestTimeoutMs?: number
}): Promise<AssignmentGradingApiResponse> {
  let payload = await fetchAssignmentGradingPayload({
    apiKey: opts.apiKey,
    request: opts.request,
    requestTimeoutMs: opts.requestTimeoutMs,
    maxOutputTokens: ASSIGNMENT_GRADING_MAX_OUTPUT_TOKENS,
  })

  if (isMaxOutputIncomplete(payload)) {
    payload = await fetchAssignmentGradingPayload({
      apiKey: opts.apiKey,
      request: opts.request,
      requestTimeoutMs: opts.requestTimeoutMs,
      maxOutputTokens: ASSIGNMENT_GRADING_FALLBACK_MAX_OUTPUT_TOKENS,
    })
  }

  if (isMaxOutputIncomplete(payload)) {
    throw new AssignmentAiGradingError({
      kind: 'bad_response',
      message: 'OpenAI response incomplete: max_output_tokens',
      retryable: false,
    })
  }

  const outputText = extractResponseOutputText(payload)
  if (!outputText) {
    throw new AssignmentAiGradingError({
      kind: 'bad_response',
      message: 'OpenAI response missing structured output',
      retryable: false,
    })
  }

  return {
    payload,
    outputText,
  }
}

function parseAssignmentGradingResponse(outputText: string, previousFeedback?: string | null) {
  let jsonText = outputText
  const codeBlockMatch = outputText.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    jsonText = codeBlockMatch[1].trim()
  }

  let parsed: any
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new AssignmentAiGradingError({
      kind: 'invalid_output',
      message: `Failed to parse grading response as JSON: ${outputText.slice(0, 200)}`,
      retryable: false,
    })
  }

  const sc = Number(parsed.score_completion)
  const st = Number(parsed.score_thinking)
  const sw = Number(parsed.score_workflow)

  if ([sc, st, sw].some((n) => !Number.isInteger(n) || n < 0 || n > 10)) {
    throw new AssignmentAiGradingError({
      kind: 'invalid_output',
      message: 'Scores must be integers 0–10',
      retryable: false,
    })
  }

  let feedback = String(parsed.feedback || '').trim()
  if (!feedback) {
    throw new AssignmentAiGradingError({
      kind: 'invalid_output',
      message: 'Feedback is empty',
      retryable: false,
    })
  }

  if (previousFeedback) {
    feedback = `${previousFeedback}\n\n--- Resubmission ---\n\n${feedback}`
  }

  return {
    score_completion: sc,
    score_thinking: st,
    score_workflow: sw,
    feedback,
  }
}

export async function gradeStudentWork(opts: {
  assignmentTitle: string
  instructions: string
  studentWork: TiptapContent
  previousFeedback?: string | null
  requestTimeoutMs?: number
  telemetry?: AssignmentGradingTelemetryContext
}): Promise<GradeResult> {
  const apiKey = getOpenAIKey()
  if (!apiKey) {
    throw new AssignmentAiGradingError({
      kind: 'config',
      message: 'OPENAI_API_KEY is not configured',
      retryable: false,
    })
  }

  const request = buildAssignmentGradingRequest({
    assignmentTitle: opts.assignmentTitle,
    instructions: opts.instructions,
    studentWork: opts.studentWork,
  })
  const promptMetrics = estimatePromptMetrics(request.systemPrompt, request.userPrompt)
  try {
    const { payload, outputText } = await callAssignmentGradingApi({
      apiKey,
      request,
      requestTimeoutMs: opts.requestTimeoutMs,
    })
    const usage = extractOpenAIResponseUsage(payload)
    const parsed = parseAssignmentGradingResponse(outputText, opts.previousFeedback)

    logAiPromptTelemetry({
      feature: opts.telemetry?.feature ?? 'assignment_auto_grade',
      operation: opts.telemetry?.operation ?? 'single_grade',
      model: request.model,
      promptProfile: opts.telemetry?.promptProfile ?? 'default',
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
      actualInputTokens: usage.inputTokens,
      actualOutputTokens: usage.outputTokens,
      actualTotalTokens: usage.totalTokens,
    })

    return {
      ...parsed,
      model: request.model,
      attempts: 1,
    }
  } catch (error) {
    const gradingError = toAssignmentAiGradingError(error)
    logAiPromptTelemetry({
      feature: opts.telemetry?.feature ?? 'assignment_auto_grade',
      operation: opts.telemetry?.operation ?? 'single_grade',
      model: request.model,
      promptProfile: opts.telemetry?.promptProfile ?? 'default',
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
