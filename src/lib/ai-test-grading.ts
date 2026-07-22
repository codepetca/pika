import { createHash, randomUUID } from 'node:crypto'
import type { TestAiGradingBasis } from '@/types'
import {
  estimatePromptMetrics,
  logAiPromptTelemetry,
  type AiPromptMetrics,
  type OpenAIResponseUsage,
} from '@/lib/ai-prompt-metrics'
import {
  createProviderRefMap,
  mapProviderRefToLocalId,
  sanitizeAiOutputText,
  sanitizeAiText,
  type AiSanitizationContext,
} from '@/lib/ai-sanitization'
import {
  testGradingProvenanceSchema,
  type TestGradingProvenance,
} from '@/lib/grading/contracts'
import {
  executeStructuredOutput,
  GradingOutputError,
  type GradingExecutionMetadata,
  type StructuredOutputSpec,
} from '@/lib/grading/engine'
import {
  buildPikaTestBatchSystemPrompt,
  buildPikaTestBatchUserPrompt,
  buildPikaTestOpenResponsePrompt,
  buildPikaTestReferencePrompt,
  buildPikaTestSingleUserPrompt,
  getPikaTestPromptVersion,
  parsePikaTestBatchGradeOutput,
  parsePikaTestReferenceOutput,
  parsePikaTestSingleGradeOutput,
  PIKA_TEST_BATCH_GRADE_OUTPUT,
  PIKA_TEST_OPEN_RESPONSE_POLICY_VERSION,
  PIKA_TEST_OPEN_RESPONSE_PROFILE_VERSION,
  PIKA_TEST_OPEN_RESPONSE_RUBRIC_VERSION,
  PIKA_TEST_REFERENCE_OUTPUT,
  PIKA_TEST_SINGLE_GRADE_OUTPUT,
  resolvePikaTestPromptGuideline,
} from '@/lib/grading/profiles/pika-test-open-response'
import { createOpenAiResponsesProvider } from '@/lib/grading/providers/openai-responses'
import { GradingProviderError } from '@/lib/grading/providers/types'

const DEFAULT_MODEL = 'gpt-5-nano'
const MAX_REFERENCE_ANSWERS = 3
const TEST_AI_REASONING_EFFORT = 'minimal'
const TEST_AI_REQUEST_TIMEOUT_MS = 25_000

export type TestOpenResponsePromptProfile = 'manual' | 'bulk'
type ReferenceAnswerSource = 'teacher_key' | 'provided' | 'generated'

export type TestAiErrorKind =
  | 'config'
  | 'timeout'
  | 'network'
  | 'rate_limit'
  | 'server'
  | 'bad_response'
  | 'invalid_output'

export class TestAiGradingError extends Error {
  readonly kind: TestAiErrorKind
  readonly retryable: boolean
  readonly statusCode: number | null

  constructor(opts: {
    kind: TestAiErrorKind
    message: string
    retryable: boolean
    statusCode?: number | null
  }) {
    super(opts.message)
    this.name = 'TestAiGradingError'
    this.kind = opts.kind
    this.retryable = opts.retryable
    this.statusCode = opts.statusCode ?? null
  }
}

export function isRetryableTestAiGradingError(error: unknown): error is TestAiGradingError {
  return error instanceof TestAiGradingError && error.retryable
}

export interface TestOpenResponseTelemetryContext {
  feature: 'test_auto_grade' | 'test_ai_suggest'
  requestedStrategy?: string | null
  resolvedStrategy?: string | null
  runId?: string | null
  studentId?: string | null
  attempt?: number | null
}

export interface TestOpenResponsePreparedContext {
  model: string
  maxPoints: number
  grading_basis: TestAiGradingBasis
  reference_answers: string[]
  reference_answers_source: ReferenceAnswerSource
  answerKey: string | null
  sampleSolution: string | null
  scoreBuckets: number[] | null
  promptProfile: TestOpenResponsePromptProfile
  isCodingQuestion: boolean
  sampleSolutionIncluded: boolean
  promptMetrics: AiPromptMetrics
  systemPrompt: string
  userPromptPrefix: string
  sanitizationContext: AiSanitizationContext | null
}

export interface TestOpenResponseReferenceCacheResolution {
  expectedCacheKey: string
  cacheHit: boolean
  referenceAnswers: string[] | null
}

export interface TestOpenResponseSuggestion {
  score: number
  feedback: string
  model: string
  grading_basis: TestAiGradingBasis
  reference_answers: string[]
  provenance: TestGradingProvenance
}

export interface TestOpenResponseReferences {
  reference_answers: string[]
  model: string
}

export interface TestOpenResponseBatchRequest {
  responseId: string
  responseText: string
}

export interface TestOpenResponseBatchSuggestion extends TestOpenResponseSuggestion {
  responseId: string
}

function getOpenAIKey(): string | null {
  const key = process.env.OPENAI_API_KEY
  if (!key) return null
  const trimmed = key.trim()
  return trimmed || null
}

export function getTestOpenResponseGradingModel(): string {
  return process.env.OPENAI_GRADING_MODEL?.trim() || DEFAULT_MODEL
}

function toTestAiGradingError(error: unknown): TestAiGradingError {
  if (error instanceof TestAiGradingError) {
    return error
  }

  if (error instanceof GradingProviderError) {
    return new TestAiGradingError({
      kind: error.kind,
      message: error.message,
      retryable: error.retryable,
      statusCode: error.statusCode,
    })
  }

  if (error instanceof GradingOutputError) {
    return new TestAiGradingError({
      kind: 'invalid_output',
      message: error.message,
      retryable: false,
    })
  }

  if (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  ) {
    return new TestAiGradingError({
      kind: 'timeout',
      message: 'OpenAI grading request timed out',
      retryable: true,
    })
  }

  if (error instanceof Error) {
    return new TestAiGradingError({
      kind: 'bad_response',
      message: error.message,
      retryable: false,
    })
  }

  return new TestAiGradingError({
    kind: 'bad_response',
    message: 'Unknown grading error',
    retryable: false,
  })
}

async function callOpenAIForJson(opts: {
  apiKey: string
  model: string
  systemPrompt: string
  userPrompt: string
  output: StructuredOutputSpec
  parseOutput(outputText: string): unknown
  requestTimeoutMs?: number
}): Promise<{
  parsed: any
  usage: OpenAIResponseUsage
  execution: GradingExecutionMetadata
}> {
  try {
    const result = await executeStructuredOutput({
      provider: createOpenAiResponsesProvider({ apiKey: opts.apiKey }),
      policy: {
        version: PIKA_TEST_OPEN_RESPONSE_POLICY_VERSION,
        model: opts.model,
        requestTimeoutMs: opts.requestTimeoutMs ?? TEST_AI_REQUEST_TIMEOUT_MS,
        reasoningEffort: TEST_AI_REASONING_EFFORT,
      },
      prompt: {
        systemPrompt: opts.systemPrompt,
        userPrompt: opts.userPrompt,
      },
      output: opts.output,
      parseOutput: opts.parseOutput,
    })
    return {
      parsed: result.output,
      usage: result.execution.tokenUsage,
      execution: result.execution,
    }
  } catch (error) {
    throw toTestAiGradingError(error)
  }
}

function buildTestGradingProvenance(input: {
  execution: GradingExecutionMetadata
  promptProfile: TestOpenResponsePromptProfile
  operation: 'single' | 'batch'
  batchSize: number
}): TestGradingProvenance {
  return testGradingProvenanceSchema.parse({
    schemaVersion: 'test-grading-provenance-v1',
    gradingRequestId: randomUUID(),
    provider: input.execution.provider,
    model: input.execution.model,
    policyVersion: input.execution.policyVersion,
    promptVersion: getPikaTestPromptVersion(input.promptProfile),
    gradingProfileVersion: PIKA_TEST_OPEN_RESPONSE_PROFILE_VERSION,
    rubricVersion: PIKA_TEST_OPEN_RESPONSE_RUBRIC_VERSION,
    operation: input.operation,
    batchSize: input.batchSize,
    providerRequestCount: input.execution.providerRequestCount,
    tokenUsage: input.execution.tokenUsage,
  })
}

function normalizeAnswerKey(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  return trimmed
}

function normalizeSampleSolution(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  return trimmed
}

function normalizeReferenceAnswers(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new Error('AI grading references must be an array')
  }

  const normalized = raw
    .map((value) => (typeof value === 'string' ? sanitizeAiOutputText(value.trim()) : ''))
    .filter((value) => value.length > 0)

  if (normalized.length === 0) {
    throw new Error('AI grading references are empty')
  }

  const deduped: string[] = []
  for (const answer of normalized) {
    if (!deduped.includes(answer)) deduped.push(answer)
    if (deduped.length >= MAX_REFERENCE_ANSWERS) break
  }

  return deduped
}

function sanitizeReferenceAnswers(
  raw: unknown,
  sanitizationContext: AiSanitizationContext | null,
): string[] {
  if (!Array.isArray(raw)) {
    return normalizeReferenceAnswers(raw)
  }

  const sanitizeOptions = sanitizationContext ?? undefined
  return normalizeReferenceAnswers(
    raw.map((value) => (typeof value === 'string' ? sanitizeAiText(value, sanitizeOptions) : value)),
  )
}

function normalizeScoreBuckets(raw: unknown, maxPoints: number): number[] | null {
  if (!Array.isArray(raw)) return null

  const deduped: number[] = []
  for (const value of raw) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) continue
    const normalized = Math.max(0, Math.min(maxPoints, Math.round(parsed * 100) / 100))
    if (!deduped.includes(normalized)) {
      deduped.push(normalized)
    }
  }

  if (deduped.length === 0) return null
  deduped.sort((a, b) => a - b)
  return deduped
}

function scoreToNearestBucket(score: number, buckets: number[]): number {
  let nearest = buckets[0]
  let minDistance = Math.abs(score - nearest)

  for (const bucket of buckets) {
    const distance = Math.abs(score - bucket)
    if (distance < minDistance || (distance === minDistance && bucket > nearest)) {
      nearest = bucket
      minDistance = distance
    }
  }

  return nearest
}

function getCacheStatus(prepared: TestOpenResponsePreparedContext): 'hit' | 'miss' | 'not_applicable' {
  if (prepared.grading_basis !== 'generated_reference') return 'not_applicable'
  return prepared.reference_answers_source === 'provided' ? 'hit' : 'miss'
}

function logTestPromptTelemetry(input: {
  telemetryContext: TestOpenResponseTelemetryContext
  prepared: TestOpenResponsePreparedContext
  promptMetrics: AiPromptMetrics
  usage: OpenAIResponseUsage
  responseCount: number
  operation: 'reference_generation' | 'single_grade' | 'batch_grade'
}) {
  logAiPromptTelemetry({
    feature: input.telemetryContext.feature,
    operation: input.operation,
    model: input.prepared.model,
    promptProfile: input.prepared.promptProfile,
    runId: input.telemetryContext.runId ?? null,
    studentId: input.telemetryContext.studentId ?? null,
    attempt: input.telemetryContext.attempt ?? null,
    requestedStrategy: input.telemetryContext.requestedStrategy ?? null,
    resolvedStrategy: input.telemetryContext.resolvedStrategy ?? null,
    questionType: input.prepared.isCodingQuestion ? 'coding' : 'non-coding',
    responseCount: input.responseCount,
    cacheStatus:
      input.operation === 'reference_generation'
        ? 'miss'
        : getCacheStatus(input.prepared),
    sampleSolutionIncluded: input.prepared.sampleSolutionIncluded,
    systemChars: input.promptMetrics.systemChars,
    userChars: input.promptMetrics.userChars,
    promptChars: input.promptMetrics.totalChars,
    estimatedInputTokens: input.promptMetrics.estimatedInputTokens,
    actualInputTokens: input.usage.inputTokens,
    actualOutputTokens: input.usage.outputTokens,
    actualTotalTokens: input.usage.totalTokens,
  })
}

export function normalizeTestOpenResponseReferenceAnswers(raw: unknown): string[] {
  return normalizeReferenceAnswers(raw)
}

export function buildTestOpenResponseReferenceCacheKey(input: {
  testTitle: string
  questionText: string
  maxPoints: number
  model: string
  isCodingQuestion?: boolean
}): string {
  const payload = JSON.stringify({
    test_title: input.testTitle.trim(),
    question_text: input.questionText.trim(),
    max_points: Math.max(0, input.maxPoints),
    model: input.model.trim(),
    is_coding_question: input.isCodingQuestion === true,
  })

  return createHash('sha256').update(payload).digest('hex')
}

export function resolveReusableTestOpenResponseReferenceAnswers(input: {
  testTitle: string
  questionText: string
  maxPoints: number
  model: string
  isCodingQuestion?: boolean
  cacheKey?: string | null
  cacheAnswers?: unknown
  cacheModel?: string | null
}): TestOpenResponseReferenceCacheResolution {
  const expectedCacheKey = buildTestOpenResponseReferenceCacheKey({
    testTitle: input.testTitle,
    questionText: input.questionText,
    maxPoints: input.maxPoints,
    model: input.model,
    isCodingQuestion: input.isCodingQuestion,
  })

  const normalizedCacheModel = typeof input.cacheModel === 'string' ? input.cacheModel.trim() : ''
  if (input.cacheKey !== expectedCacheKey || normalizedCacheModel !== input.model.trim()) {
    return { expectedCacheKey, cacheHit: false, referenceAnswers: null }
  }

  try {
    return {
      expectedCacheKey,
      cacheHit: true,
      referenceAnswers: normalizeReferenceAnswers(input.cacheAnswers),
    }
  } catch {
    return { expectedCacheKey, cacheHit: false, referenceAnswers: null }
  }
}

async function generateReferenceAnswers(opts: {
  apiKey: string
  model: string
  testTitle: string
  questionText: string
  maxPoints: number
  isCodingQuestion: boolean
  promptProfile: TestOpenResponsePromptProfile
  telemetryContext: TestOpenResponseTelemetryContext
  requestTimeoutMs?: number
  sanitizationContext?: AiSanitizationContext | null
}): Promise<string[]> {
  const sanitizeOptions = opts.sanitizationContext ?? undefined
  const { systemPrompt, userPrompt } = buildPikaTestReferencePrompt({
    testTitle: sanitizeAiText(opts.testTitle, sanitizeOptions),
    questionText: sanitizeAiText(opts.questionText, sanitizeOptions),
    maxPoints: opts.maxPoints,
    isCodingQuestion: opts.isCodingQuestion,
  })

  const promptMetrics = estimatePromptMetrics(systemPrompt, userPrompt)
  const { parsed, usage } = await callOpenAIForJson({
    apiKey: opts.apiKey,
    model: opts.model,
    systemPrompt,
    userPrompt,
    output: PIKA_TEST_REFERENCE_OUTPUT,
    parseOutput: parsePikaTestReferenceOutput,
    requestTimeoutMs: opts.requestTimeoutMs,
  })

  const referenceAnswers = normalizeReferenceAnswers(parsed?.reference_answers)
  const previewContext = buildTestOpenResponsePreparedContext({
    model: opts.model,
    testTitle: opts.testTitle,
    questionText: opts.questionText,
    maxPoints: opts.maxPoints,
    referenceAnswers,
    referenceAnswersSource: 'generated',
    responseMonospace: opts.isCodingQuestion,
    promptProfile: opts.promptProfile,
    sanitizationContext: opts.sanitizationContext,
  })

  logTestPromptTelemetry({
    telemetryContext: opts.telemetryContext,
    prepared: previewContext,
    promptMetrics,
    usage,
    responseCount: 0,
    operation: 'reference_generation',
  })

  return referenceAnswers
}

export function buildTestOpenResponsePreparedContext(input: {
  model?: string | null
  testTitle: string
  questionText: string
  maxPoints: number
  answerKey?: string | null
  sampleSolution?: string | null
  referenceAnswers?: string[] | null
  referenceAnswersSource?: ReferenceAnswerSource
  responseMonospace?: boolean
  scoreBuckets?: number[] | null
  promptGuidelineOverride?: string | null
  promptProfile?: TestOpenResponsePromptProfile
  sanitizationContext?: AiSanitizationContext | null
}): TestOpenResponsePreparedContext {
  const model = input.model?.trim() || getTestOpenResponseGradingModel()
  const maxPoints = Math.max(0, input.maxPoints)
  const promptProfile = input.promptProfile ?? 'manual'
  const isCodingQuestion = input.responseMonospace === true
  const sanitizationContext = input.sanitizationContext ?? null
  const sanitizeOptions = sanitizationContext ?? undefined
  const testTitle = sanitizeAiText(input.testTitle, sanitizeOptions)
  const questionText = sanitizeAiText(input.questionText, sanitizeOptions)
  const promptGuideline = resolvePikaTestPromptGuideline({
    override: input.promptGuidelineOverride
      ? sanitizeAiText(input.promptGuidelineOverride, sanitizeOptions)
      : input.promptGuidelineOverride,
    isCodingQuestion,
    promptProfile,
  })
  const scoreBuckets = normalizeScoreBuckets(input.scoreBuckets, maxPoints)
  const answerKey = normalizeAnswerKey(
    input.answerKey ? sanitizeAiText(input.answerKey, sanitizeOptions) : input.answerKey,
  )
  const sampleSolution = normalizeSampleSolution(
    input.sampleSolution ? sanitizeAiText(input.sampleSolution, sanitizeOptions) : input.sampleSolution,
  )
  const normalizedReferenceAnswers =
    input.referenceAnswers != null
      ? sanitizeReferenceAnswers(input.referenceAnswers, sanitizationContext)
      : []

  const gradingBasis: TestAiGradingBasis = answerKey ? 'teacher_key' : 'generated_reference'
  if (gradingBasis === 'generated_reference' && normalizedReferenceAnswers.length === 0) {
    throw new Error('AI grading references are empty')
  }

  const referenceAnswerSource: ReferenceAnswerSource =
    gradingBasis === 'teacher_key'
      ? 'teacher_key'
      : (input.referenceAnswersSource ?? 'provided')

  const sampleSolutionIncluded =
    promptProfile === 'bulk'
      ? answerKey == null && sampleSolution != null
      : sampleSolution != null

  const { systemPrompt, userPromptPrefix } = buildPikaTestOpenResponsePrompt({
    testTitle,
    questionText,
    maxPoints,
    promptGuideline,
    promptProfile,
    isCodingQuestion,
    gradingBasis,
    answerKey,
    referenceAnswers: normalizedReferenceAnswers,
    sampleSolution,
    sampleSolutionIncluded,
    scoreBuckets,
  })

  return {
    model,
    maxPoints,
    grading_basis: gradingBasis,
    reference_answers: gradingBasis === 'teacher_key' ? [] : normalizedReferenceAnswers,
    reference_answers_source: referenceAnswerSource,
    answerKey,
    sampleSolution,
    scoreBuckets,
    promptProfile,
    isCodingQuestion,
    sampleSolutionIncluded,
    promptMetrics: estimatePromptMetrics(systemPrompt, userPromptPrefix),
    systemPrompt,
    userPromptPrefix,
    sanitizationContext,
  }
}

export function buildTestOpenResponseSingleUserPrompt(
  prepared: TestOpenResponsePreparedContext,
  responseText: string
): string {
  return buildPikaTestSingleUserPrompt(
    prepared.userPromptPrefix,
    sanitizeAiText(responseText, prepared.sanitizationContext ?? undefined),
  )
}

export function buildTestOpenResponseBatchSystemPrompt(
  prepared: TestOpenResponsePreparedContext
): string {
  return buildPikaTestBatchSystemPrompt(prepared.systemPrompt)
}

export function buildTestOpenResponseBatchUserPrompt(
  prepared: TestOpenResponsePreparedContext,
  responses: TestOpenResponseBatchRequest[]
): string {
  return buildPikaTestBatchUserPrompt(
    prepared.userPromptPrefix,
    responses.map((response) => ({
      responseId: sanitizeAiText(response.responseId),
      responseText: sanitizeAiText(
        response.responseText,
        prepared.sanitizationContext ?? undefined,
      ),
    })),
  )
}

export async function generateTestOpenResponseReferences(input: {
  testTitle: string
  questionText: string
  maxPoints: number
  responseMonospace?: boolean
}): Promise<TestOpenResponseReferences> {
  const apiKey = getOpenAIKey()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  const model = getTestOpenResponseGradingModel()
  const maxPoints = Math.max(0, input.maxPoints)
  const referenceAnswers = await generateReferenceAnswers({
    apiKey,
    model,
    testTitle: input.testTitle,
    questionText: input.questionText,
    maxPoints,
    isCodingQuestion: input.responseMonospace === true,
    promptProfile: 'manual',
    telemetryContext: {
      feature: 'test_ai_suggest',
      requestedStrategy: 'manual',
      resolvedStrategy: 'reference_generation',
    },
  })

  return {
    reference_answers: referenceAnswers,
    model,
  }
}

export async function prepareTestOpenResponseGradingContext(input: {
  testTitle: string
  questionText: string
  maxPoints: number
  answerKey?: string | null
  sampleSolution?: string | null
  referenceAnswers?: string[] | null
  responseMonospace?: boolean
  scoreBuckets?: number[] | null
  promptGuidelineOverride?: string | null
  promptProfile?: TestOpenResponsePromptProfile
  telemetryContext?: TestOpenResponseTelemetryContext
  requestTimeoutMs?: number
  sanitizationContext?: AiSanitizationContext | null
}): Promise<TestOpenResponsePreparedContext> {
  const model = getTestOpenResponseGradingModel()
  const maxPoints = Math.max(0, input.maxPoints)
  const promptProfile = input.promptProfile ?? 'manual'
  const sanitizeOptions = input.sanitizationContext ?? undefined
  const answerKey = normalizeAnswerKey(
    input.answerKey ? sanitizeAiText(input.answerKey, sanitizeOptions) : input.answerKey,
  )
  const sampleSolution = normalizeSampleSolution(
    input.sampleSolution ? sanitizeAiText(input.sampleSolution, sanitizeOptions) : input.sampleSolution,
  )
  const providedReferenceAnswers = !answerKey && input.referenceAnswers != null
    ? sanitizeReferenceAnswers(input.referenceAnswers, input.sanitizationContext ?? null)
    : null

  if (answerKey) {
    return buildTestOpenResponsePreparedContext({
      model,
      testTitle: input.testTitle,
      questionText: input.questionText,
      maxPoints,
      answerKey,
      sampleSolution,
      responseMonospace: input.responseMonospace,
      scoreBuckets: input.scoreBuckets,
      promptGuidelineOverride: input.promptGuidelineOverride,
      promptProfile,
      sanitizationContext: input.sanitizationContext,
    })
  }

  if (providedReferenceAnswers) {
    return buildTestOpenResponsePreparedContext({
      model,
      testTitle: input.testTitle,
      questionText: input.questionText,
      maxPoints,
      sampleSolution,
      referenceAnswers: providedReferenceAnswers,
      referenceAnswersSource: 'provided',
      responseMonospace: input.responseMonospace,
      scoreBuckets: input.scoreBuckets,
      promptGuidelineOverride: input.promptGuidelineOverride,
      promptProfile,
      sanitizationContext: input.sanitizationContext,
    })
  }

  const apiKey = getOpenAIKey()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  const referenceAnswers = await generateReferenceAnswers({
    apiKey,
    model,
    testTitle: input.testTitle,
    questionText: input.questionText,
    maxPoints,
    isCodingQuestion: input.responseMonospace === true,
    promptProfile,
    telemetryContext: input.telemetryContext ?? {
      feature: 'test_ai_suggest',
      requestedStrategy: promptProfile === 'bulk' ? 'balanced' : 'manual',
      resolvedStrategy: 'reference_generation',
    },
    requestTimeoutMs: input.requestTimeoutMs,
    sanitizationContext: input.sanitizationContext,
  })

  return buildTestOpenResponsePreparedContext({
    model,
    testTitle: input.testTitle,
    questionText: input.questionText,
    maxPoints,
    sampleSolution,
    referenceAnswers,
    referenceAnswersSource: 'generated',
    responseMonospace: input.responseMonospace,
    scoreBuckets: input.scoreBuckets,
    promptGuidelineOverride: input.promptGuidelineOverride,
    promptProfile,
    sanitizationContext: input.sanitizationContext,
  })
}

function normalizeSuggestedScore(
  rawScore: number,
  maxPoints: number,
  scoreBuckets: number[] | null
): number {
  const clampedScore = Math.min(maxPoints, Math.max(0, rawScore))
  const roundedScore = scoreBuckets && scoreBuckets.length > 0
    ? scoreToNearestBucket(clampedScore, scoreBuckets)
    : Math.round(clampedScore)
  const integerMaxScore = Math.max(0, Math.floor(maxPoints))
  return scoreBuckets && scoreBuckets.length > 0
    ? roundedScore
    : Math.min(integerMaxScore, Math.max(0, roundedScore))
}

export async function suggestTestOpenResponseGradeWithContext(
  prepared: TestOpenResponsePreparedContext,
  responseText: string,
  telemetryContext?: TestOpenResponseTelemetryContext,
  requestTimeoutMs?: number,
): Promise<TestOpenResponseSuggestion> {
  const apiKey = getOpenAIKey()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  const userPrompt = buildTestOpenResponseSingleUserPrompt(prepared, responseText)
  const promptMetrics = estimatePromptMetrics(prepared.systemPrompt, userPrompt)
  const { parsed, usage, execution } = await callOpenAIForJson({
    apiKey,
    model: prepared.model,
    systemPrompt: prepared.systemPrompt,
    userPrompt,
    output: PIKA_TEST_SINGLE_GRADE_OUTPUT,
    parseOutput: parsePikaTestSingleGradeOutput,
    requestTimeoutMs,
  })

  if (telemetryContext) {
    logTestPromptTelemetry({
      telemetryContext,
      prepared,
      promptMetrics,
      usage,
      responseCount: 1,
      operation: 'single_grade',
    })
  }

  const rawScore = Number(parsed?.score)
  if (!Number.isFinite(rawScore)) {
    throw new Error('AI grade suggestion did not include a numeric score')
  }
  const score = normalizeSuggestedScore(rawScore, prepared.maxPoints, prepared.scoreBuckets)

  const feedback = sanitizeAiOutputText(String(parsed?.feedback || '').trim())
  if (!feedback) {
    throw new Error('AI grade suggestion did not include feedback')
  }

  return {
    score,
    feedback,
    model: prepared.model,
    grading_basis: prepared.grading_basis,
    reference_answers: prepared.reference_answers,
    provenance: buildTestGradingProvenance({
      execution,
      promptProfile: prepared.promptProfile,
      operation: 'single',
      batchSize: 1,
    }),
  }
}

export async function suggestTestOpenResponseGradesBatchWithContext(
  prepared: TestOpenResponsePreparedContext,
  responses: TestOpenResponseBatchRequest[],
  telemetryContext?: TestOpenResponseTelemetryContext,
  requestTimeoutMs?: number,
): Promise<TestOpenResponseBatchSuggestion[]> {
  const apiKey = getOpenAIKey()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }
  if (responses.length === 0) return []

  const providerRequests = createProviderRefMap(
    responses.map((response) => ({
      localId: response.responseId,
      responseText: response.responseText,
    })),
    'response',
  )
  const providerRefToLocalId = mapProviderRefToLocalId(providerRequests)
  const systemPrompt = buildTestOpenResponseBatchSystemPrompt(prepared)
  const userPrompt = buildTestOpenResponseBatchUserPrompt(
    prepared,
    providerRequests.map((response) => ({
      responseId: response.providerRef,
      responseText: response.responseText,
    })),
  )
  const promptMetrics = estimatePromptMetrics(systemPrompt, userPrompt)
  const { parsed, usage, execution } = await callOpenAIForJson({
    apiKey,
    model: prepared.model,
    systemPrompt,
    userPrompt,
    output: PIKA_TEST_BATCH_GRADE_OUTPUT,
    parseOutput: parsePikaTestBatchGradeOutput,
    requestTimeoutMs,
  })

  if (telemetryContext) {
    logTestPromptTelemetry({
      telemetryContext,
      prepared,
      promptMetrics,
      usage,
      responseCount: responses.length,
      operation: 'batch_grade',
    })
  }

  if (!Array.isArray(parsed?.results)) {
    throw new Error('AI batch grade suggestion did not include results')
  }

  const resultsById = new Map<string, { score: number; feedback: string }>()
  for (const row of parsed.results) {
    const responseId = typeof row?.response_id === 'string' ? row.response_id.trim() : ''
    const rawScore = Number(row?.score)
    const feedback = typeof row?.feedback === 'string' ? row.feedback.trim() : ''

    if (!responseId || !Number.isFinite(rawScore) || !feedback) {
      throw new Error('AI batch grade suggestion returned an invalid result row')
    }

    const localResponseId = providerRefToLocalId.get(responseId)
    if (!localResponseId) {
      throw new Error(`AI batch grade suggestion returned unknown response ${responseId}`)
    }
    if (resultsById.has(localResponseId)) {
      throw new Error(`AI batch grade suggestion returned duplicate response ${responseId}`)
    }

    resultsById.set(localResponseId, {
      score: normalizeSuggestedScore(rawScore, prepared.maxPoints, prepared.scoreBuckets),
      feedback: sanitizeAiOutputText(feedback),
    })
  }

  const suggestions: TestOpenResponseBatchSuggestion[] = []
  const provenance = buildTestGradingProvenance({
    execution,
    promptProfile: prepared.promptProfile,
    operation: 'batch',
    batchSize: responses.length,
  })
  for (const response of responses) {
    const result = resultsById.get(response.responseId)
    if (!result) {
      continue
    }

    suggestions.push({
      responseId: response.responseId,
      score: result.score,
      feedback: result.feedback,
      model: prepared.model,
      grading_basis: prepared.grading_basis,
      reference_answers: prepared.reference_answers,
      provenance,
    })
  }

  return suggestions
}

export async function suggestTestOpenResponseGrade(input: {
  testTitle: string
  questionText: string
  responseText: string
  maxPoints: number
  answerKey?: string | null
  sampleSolution?: string | null
  referenceAnswers?: string[] | null
  responseMonospace?: boolean
  scoreBuckets?: number[] | null
  promptGuidelineOverride?: string | null
  promptProfile?: TestOpenResponsePromptProfile
  telemetryContext?: TestOpenResponseTelemetryContext
  requestTimeoutMs?: number
  sanitizationContext?: AiSanitizationContext | null
}): Promise<TestOpenResponseSuggestion> {
  const prepared = await prepareTestOpenResponseGradingContext(input)
  return suggestTestOpenResponseGradeWithContext(
    prepared,
    input.responseText,
    input.telemetryContext,
    input.requestTimeoutMs,
  )
}

export async function suggestTestOpenResponseGradesBatch(input: {
  testTitle: string
  questionText: string
  maxPoints: number
  answerKey?: string | null
  sampleSolution?: string | null
  referenceAnswers?: string[] | null
  responseMonospace?: boolean
  scoreBuckets?: number[] | null
  promptGuidelineOverride?: string | null
  promptProfile?: TestOpenResponsePromptProfile
  telemetryContext?: TestOpenResponseTelemetryContext
  responses: TestOpenResponseBatchRequest[]
  requestTimeoutMs?: number
  sanitizationContext?: AiSanitizationContext | null
}): Promise<TestOpenResponseBatchSuggestion[]> {
  const prepared = await prepareTestOpenResponseGradingContext(input)
  return suggestTestOpenResponseGradesBatchWithContext(
    prepared,
    input.responses,
    input.telemetryContext,
    input.requestTimeoutMs,
  )
}
