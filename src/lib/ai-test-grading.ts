import { createHash } from 'node:crypto'
import type { TestAiGradingBasis } from '@/types'

const DEFAULT_MODEL = 'gpt-5-nano'
const MAX_REFERENCE_ANSWERS = 3

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

  const payload = await res.json()
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

export function normalizeTestOpenResponseReferenceAnswers(raw: unknown): string[] {
  return normalizeReferenceAnswers(raw)
}

export function buildTestOpenResponseReferenceCacheKey(input: {
  questionText: string
  maxPoints: number
  model: string
  isCodingQuestion?: boolean
}): string {
  const payload = JSON.stringify({
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

export async function suggestTestOpenResponseGrade(input: {
  testTitle: string
  questionText: string
  responseText: string
  maxPoints: number
  answerKey?: string | null
  referenceAnswers?: string[] | null
  responseMonospace?: boolean
}): Promise<TestOpenResponseSuggestion> {
  const apiKey = getOpenAIKey()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  const model = getTestOpenResponseGradingModel()
  const maxPoints = Math.max(0, input.maxPoints)
  const isCodingQuestion = input.responseMonospace === true
  const answerKey = normalizeAnswerKey(input.answerKey)
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

  const codingRubric = isCodingQuestion
    ? `
- This is a coding response. Prioritize algorithmic correctness and logical reasoning over minor syntax/runtime mistakes.
- If the approach is logically sound and clearly communicated but has minor implementation issues, award high partial credit (typically 80-95% of max points).
- Penalize poor communication/readability: missing indentation, unclear variable or method names, and hard-to-follow structure should reduce marks.
- If language is unspecified, infer likely language from prompt/context/response. If still ambiguous, evaluate logic language-agnostically and do not penalize language choice alone.
- Avoid nitpicking minor stylistic preferences when clarity and logic are strong.`
    : ''

  const systemPrompt = `You grade open-response test answers.
Return ONLY valid JSON with this shape:
{"score": number, "feedback": "string"}

Rules:
- score must be between 0 and ${maxPoints}
- use at most 2 decimal places
- feedback should be 2-4 sentences with one strength and one concrete improvement
- grade for correctness and completeness, not just writing style${codingRubric}`

  const gradingContext =
    gradingBasis === 'teacher_key'
      ? `Teacher answer key:
${answerKey}`
      : `Reference answers:
${referenceAnswers.map((answer, index) => `${index + 1}. ${answer}`).join('\n')}

Students may use different correct wording. Award credit for equivalent ideas.`

  const parsed = await callOpenAIForJson({
    apiKey,
    model,
    systemPrompt,
    userPrompt: `Test: ${input.testTitle}
Question:
${input.questionText}

${gradingContext}

Student response:
${input.responseText}`,
    parseErrorMessage: 'Failed to parse AI grade suggestion',
  })

  const rawScore = Number(parsed?.score)
  if (!Number.isFinite(rawScore)) {
    throw new Error('AI grade suggestion did not include a numeric score')
  }
  const clampedScore = Math.min(maxPoints, Math.max(0, rawScore))
  const score = Math.round(clampedScore * 100) / 100

  const feedback = String(parsed?.feedback || '').trim()
  if (!feedback) {
    throw new Error('AI grade suggestion did not include feedback')
  }

  return {
    score,
    feedback,
    model,
    grading_basis: gradingBasis,
    reference_answers: referenceAnswers,
  }
}
