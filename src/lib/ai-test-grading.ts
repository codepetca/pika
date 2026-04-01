import { createHash } from 'node:crypto'
import type { TestAiGradingBasis } from '@/types'
import {
  DEFAULT_TEST_AI_PROMPT_GUIDELINE,
  GRADE_11CS_JAVA_CODEHS_PROMPT_GUIDELINE,
} from '@/lib/test-ai-prompt-guideline'

const DEFAULT_MODEL = 'gpt-5-nano'
const MAX_REFERENCE_ANSWERS = 3

function summarizeResponseBody(bodyText: string): string {
  const normalized = bodyText.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= 240) return normalized
  return `${normalized.slice(0, 237)}...`
}

function buildInvalidJsonErrorMessage(res: Response, bodyText: string): string {
  const contentType = res.headers.get('content-type')?.trim() || 'unknown content-type'
  const summary = summarizeResponseBody(bodyText)
  return summary
    ? `OpenAI returned invalid JSON (status ${res.status}, ${contentType}): ${summary}`
    : `OpenAI returned invalid JSON (status ${res.status}, ${contentType})`
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

function extractOutputText(payload: any): string | null {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  const output = payload?.output
  if (!Array.isArray(output)) return null

  for (const item of output) {
    const content = item?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block?.type === 'output_text' && typeof block?.text === 'string' && block.text.trim()) {
        return block.text.trim()
      }
    }
  }

  return null
}

function parseJsonFromOutputText(outputText: string, parseErrorMessage: string): any {
  let jsonText = outputText
  const codeBlockMatch = outputText.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    jsonText = codeBlockMatch[1].trim()
  }

  try {
    return JSON.parse(jsonText)
  } catch {
    throw new Error(parseErrorMessage)
  }
}

async function callOpenAIForJson(opts: {
  apiKey: string
  model: string
  systemPrompt: string
  userPrompt: string
  parseErrorMessage: string
}) {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: opts.systemPrompt }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: opts.userPrompt }],
        },
      ],
    }),
  })

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    throw new Error(`OpenAI request failed (${res.status}): ${bodyText}`)
  }

  const fallbackBodyTextPromise = typeof res.clone === 'function'
    ? res.clone().text().catch(() => '')
    : Promise.resolve('')

  let payload: any
  try {
    payload = await res.json()
  } catch {
    const bodyText = await fallbackBodyTextPromise
    throw new Error(buildInvalidJsonErrorMessage(res, bodyText))
  }

  const outputText = extractOutputText(payload)
  if (!outputText) {
    throw new Error('OpenAI response missing output text')
  }

  return parseJsonFromOutputText(outputText, opts.parseErrorMessage)
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
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
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

function getCodingReadabilityDeductionCap(maxPoints: number): number {
  return Math.max(0, Math.floor(maxPoints * 0.2))
}

function getDefaultPromptGuideline(isCodingQuestion: boolean): string {
  return isCodingQuestion
    ? GRADE_11CS_JAVA_CODEHS_PROMPT_GUIDELINE
    : DEFAULT_TEST_AI_PROMPT_GUIDELINE
}

function resolvePromptGuideline(
  raw: string | null | undefined,
  isCodingQuestion: boolean
): string {
  const baseGuideline = getDefaultPromptGuideline(isCodingQuestion)
  if (raw == null) return sanitizePromptGuidelineForJsonOutput(baseGuideline)

  const sanitizedExtraGuideline = sanitizePromptGuidelineForJsonOutput(raw)
  if (!sanitizedExtraGuideline) {
    return sanitizePromptGuidelineForJsonOutput(baseGuideline)
  }

  return `${sanitizePromptGuidelineForJsonOutput(baseGuideline)}

Additional teacher instructions:
${sanitizedExtraGuideline}`
}

function sanitizePromptGuidelineForJsonOutput(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''

  return trimmed.replace(/\n*Output format[\s\S]*$/i, '').trim()
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

async function generateReferenceAnswers(opts: {
  apiKey: string
  model: string
  testTitle: string
  questionText: string
  maxPoints: number
  isCodingQuestion: boolean
}): Promise<string[]> {
  const codingGuidance = opts.isCodingQuestion
    ? `
- Treat this as a coding question. Provide reference answers as clear code-oriented solution outlines, including algorithm steps and expected structure.
- For Java/CodeHS contexts, include platform helper APIs when appropriate (for example: ConsoleProgram, readInt/readLine, println, Randomizer).
- If the language is not explicitly stated, infer likely language from the question/response context; if uncertain, keep references language-agnostic and focus on logic.`
    : ''

  const parsed = await callOpenAIForJson({
    apiKey: opts.apiKey,
    model: opts.model,
    systemPrompt: `You generate reference answers for grading open-response test questions.
Return ONLY valid JSON:
{"reference_answers":["answer 1","answer 2"]}

Rules:
- Provide 1-${MAX_REFERENCE_ANSWERS} concise, high-quality reference answers.
- Each answer should describe acceptable content, not just keywords.
- Do not include markdown code fences.${codingGuidance}`,
    userPrompt: `Test: ${opts.testTitle}
Question:
${opts.questionText}

Max points: ${opts.maxPoints}`,
    parseErrorMessage: 'Failed to parse AI reference answers',
  })

  return normalizeReferenceAnswers(parsed?.reference_answers)
}

export interface TestOpenResponseSuggestion {
  score: number
  feedback: string
  model: string
  grading_basis: TestAiGradingBasis
  reference_answers: string[]
}

export interface TestOpenResponseReferences {
  reference_answers: string[]
  model: string
}

export interface TestOpenResponsePreparedContext {
  model: string
  maxPoints: number
  grading_basis: TestAiGradingBasis
  reference_answers: string[]
  answerKey: string | null
  sampleSolution: string | null
  scoreBuckets: number[] | null
  systemPrompt: string
  userPromptPrefix: string
}

export interface TestOpenResponseBatchRequest {
  responseId: string
  responseText: string
}

export interface TestOpenResponseBatchSuggestion extends TestOpenResponseSuggestion {
  responseId: string
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
}): Promise<TestOpenResponsePreparedContext> {
  const apiKey = getOpenAIKey()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  const model = getTestOpenResponseGradingModel()
  const maxPoints = Math.max(0, input.maxPoints)
  const isCodingQuestion = input.responseMonospace === true
  const promptGuideline = resolvePromptGuideline(input.promptGuidelineOverride, isCodingQuestion)
  const scoreBuckets = normalizeScoreBuckets(input.scoreBuckets, maxPoints)
  const answerKey = normalizeAnswerKey(input.answerKey)
  const sampleSolution = normalizeSampleSolution(input.sampleSolution)
  const providedReferenceAnswers = !answerKey && input.referenceAnswers != null
    ? normalizeReferenceAnswers(input.referenceAnswers)
    : null

  const gradingBasis: TestAiGradingBasis = answerKey ? 'teacher_key' : 'generated_reference'
  const referenceAnswers =
    gradingBasis === 'generated_reference'
      ? (providedReferenceAnswers ?? await generateReferenceAnswers({
          apiKey,
          model,
          testTitle: input.testTitle,
          questionText: input.questionText,
          maxPoints,
          isCodingQuestion,
        }))
      : []

  const readabilityDeductionCap = getCodingReadabilityDeductionCap(maxPoints)
  const readabilityDeductionGuidance =
    readabilityDeductionCap > 0
      ? `- You may apply one readability/style deduction only after scoring correctness and required structure first.
- Forgive one small formatting/style issue.
- Apply the readability deduction only when formatting materially hurts readability, such as two or more minor formatting issues or one major formatting issue.
- Minor issues include slightly uneven spacing, one missed indent level, or small brace-placement inconsistencies.
- Major issues include most code written on one line, indentation missing across nested blocks, or formatting that makes control flow hard to follow.
- Never stack style deductions per infraction; apply at most one readability deduction total.
- Cap any readability/style deduction at ${readabilityDeductionCap} point${readabilityDeductionCap === 1 ? '' : 's'} for this question.
- If readability is still acceptable overall, do not deduct for style.`
      : `- Because this question is worth ${maxPoints} point${maxPoints === 1 ? '' : 's'}, do not apply a separate readability/style deduction here; keep grading focused on correctness and required structure.`

  const codingRubric = isCodingQuestion
    ? `
- This is a coding response. Prioritize algorithmic correctness and logical reasoning over minor syntax/runtime mistakes.
- If the approach is logically sound and clearly communicated but has minor implementation issues, award high partial credit (typically 80-95% of max points).
- Formatting/readability can affect the score only through the capped readability deduction below.
- For Java/CodeHS classroom contexts, treat platform helper APIs (for example: ConsoleProgram, readInt/readLine, println, Randomizer) as valid and do not penalize solely for using them.
- If language is unspecified, infer likely language from prompt/context/response. If still ambiguous, evaluate logic language-agnostically and do not penalize language choice alone.
- Avoid nitpicking minor stylistic preferences when clarity and logic are strong.
${readabilityDeductionGuidance}`
    : ''

  const promptGuidelineContext = promptGuideline
    ? `Teacher grading guideline:
${promptGuideline}`
    : 'Teacher grading guideline: none provided.'

  const systemPrompt = `You grade open-response test answers.
Return ONLY valid JSON with this shape:
{"score": number, "feedback": "string"}

Rules:
- score must be between 0 and ${maxPoints}
- grade for correctness and completeness, not just writing style
- if the score is less than ${maxPoints}, feedback should include one concrete improvement needed for full marks

${promptGuidelineContext}${codingRubric}`

  const gradingContext =
    gradingBasis === 'teacher_key'
      ? `Teacher answer key:
${answerKey}`
      : `Reference answers:
${referenceAnswers.map((answer, index) => `${index + 1}. ${answer}`).join('\n')}

Students may use different correct wording. Award credit for equivalent ideas.`

  const sampleSolutionContext = sampleSolution
    ? `

Sample solution (one valid approach, not a required exact match):
${sampleSolution}`
    : ''

  const scoreBucketContext = scoreBuckets && scoreBuckets.length > 0
    ? `Score buckets: ${scoreBuckets.join(', ')}
Choose the nearest bucket for the score.`
    : 'No explicit score buckets were provided.'

  return {
    model,
    maxPoints,
    grading_basis: gradingBasis,
    reference_answers: referenceAnswers,
    answerKey,
    sampleSolution,
    scoreBuckets,
    systemPrompt,
    userPromptPrefix: `Test: ${input.testTitle}
Question:
${input.questionText}

${gradingContext}
${sampleSolutionContext}

${scoreBucketContext}`,
  }
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
  responseText: string
): Promise<TestOpenResponseSuggestion> {
  const apiKey = getOpenAIKey()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  const parsed = await callOpenAIForJson({
    apiKey,
    model: prepared.model,
    systemPrompt: prepared.systemPrompt,
    userPrompt: `${prepared.userPromptPrefix}

Student response:
${responseText}`,
    parseErrorMessage: 'Failed to parse AI grade suggestion',
  })

  const rawScore = Number(parsed?.score)
  if (!Number.isFinite(rawScore)) {
    throw new Error('AI grade suggestion did not include a numeric score')
  }
  const score = normalizeSuggestedScore(rawScore, prepared.maxPoints, prepared.scoreBuckets)

  const feedback = String(parsed?.feedback || '').trim()
  if (!feedback) {
    throw new Error('AI grade suggestion did not include feedback')
  }

  return {
    score,
    feedback,
    model: prepared.model,
    grading_basis: prepared.grading_basis,
    reference_answers: prepared.reference_answers,
  }
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
}): Promise<TestOpenResponseSuggestion> {
  const prepared = await prepareTestOpenResponseGradingContext(input)
  return suggestTestOpenResponseGradeWithContext(prepared, input.responseText)
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
  responses: TestOpenResponseBatchRequest[]
}): Promise<TestOpenResponseBatchSuggestion[]> {
  const apiKey = getOpenAIKey()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  const prepared = await prepareTestOpenResponseGradingContext(input)
  if (input.responses.length === 0) return []

  const parsed = await callOpenAIForJson({
    apiKey,
    model: prepared.model,
    systemPrompt: `${prepared.systemPrompt}

Grade each response independently. Do not compare students against each other.
Return ONLY valid JSON with this shape:
{"results":[{"response_id":"string","score":number,"feedback":"string"}]}`,
    userPrompt: `${prepared.userPromptPrefix}

Student responses:
${input.responses
  .map(
    (response, index) =>
      `${index + 1}. response_id=${response.responseId}
${response.responseText}`
  )
  .join('\n\n')}`,
    parseErrorMessage: 'Failed to parse AI batch grade suggestions',
  })

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

    resultsById.set(responseId, {
      score: normalizeSuggestedScore(rawScore, prepared.maxPoints, prepared.scoreBuckets),
      feedback,
    })
  }

  return input.responses.map((response) => {
    const result = resultsById.get(response.responseId)
    if (!result) {
      throw new Error(`AI batch grade suggestion omitted response ${response.responseId}`)
    }

    return {
      responseId: response.responseId,
      score: result.score,
      feedback: result.feedback,
      model: prepared.model,
      grading_basis: prepared.grading_basis,
      reference_answers: prepared.reference_answers,
    }
  })
}
