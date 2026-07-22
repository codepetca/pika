import { z } from 'zod'
import type { StructuredOutputSpec } from '@/lib/grading/engine'
import {
  BULK_GRADE_11CS_JAVA_CODEHS_PROMPT_GUIDELINE,
  BULK_TEST_AI_PROMPT_GUIDELINE,
  DEFAULT_TEST_AI_PROMPT_GUIDELINE,
  GRADE_11CS_JAVA_CODEHS_PROMPT_GUIDELINE,
} from '@/lib/grading/profiles/pika-test-prompt-guidelines'

export const PIKA_TEST_OPEN_RESPONSE_PROFILE_VERSION = 'pika-test-open-response-v1'
export const PIKA_TEST_OPEN_RESPONSE_RUBRIC_VERSION = 'pika-test-open-response-rubric-v1'
export const PIKA_TEST_OPEN_RESPONSE_POLICY_VERSION = 'pika-test-open-response-policy-v1'
export const PIKA_TEST_OPEN_RESPONSE_MANUAL_PROMPT_VERSION =
  'pika-test-open-response-manual-prompt-v1'
export const PIKA_TEST_OPEN_RESPONSE_BULK_PROMPT_VERSION =
  'pika-test-open-response-bulk-prompt-v1'
export const PIKA_TEST_REFERENCE_PROFILE_VERSION = 'pika-test-reference-v1'
export const PIKA_TEST_REFERENCE_PROMPT_VERSION = 'pika-test-reference-prompt-v1'

const referenceOutputSchema = z.object({
  reference_answers: z.array(z.string().min(1)).min(1).max(3),
}).strict()

const singleGradeOutputSchema = z.object({
  score: z.number(),
  feedback: z.string().min(1),
}).strict()

const batchGradeOutputSchema = z.object({
  results: z.array(z.object({
    response_id: z.string().min(1),
    score: z.number(),
    feedback: z.string().min(1),
  }).strict()),
}).strict()

export type PikaTestReferenceOutput = z.infer<typeof referenceOutputSchema>
export type PikaTestSingleGradeOutput = z.infer<typeof singleGradeOutputSchema>
export type PikaTestBatchGradeOutput = z.infer<typeof batchGradeOutputSchema>

const referenceJsonSchema = {
  type: 'object',
  properties: {
    reference_answers: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      minItems: 1,
      maxItems: 3,
    },
  },
  required: ['reference_answers'],
  additionalProperties: false,
} as const

const singleGradeJsonSchema = {
  type: 'object',
  properties: {
    score: { type: 'number' },
    feedback: { type: 'string', minLength: 1 },
  },
  required: ['score', 'feedback'],
  additionalProperties: false,
} as const

const batchGradeJsonSchema = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          response_id: { type: 'string', minLength: 1 },
          score: { type: 'number' },
          feedback: { type: 'string', minLength: 1 },
        },
        required: ['response_id', 'score', 'feedback'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
} as const

export const PIKA_TEST_REFERENCE_OUTPUT: StructuredOutputSpec = {
  schemaName: 'test_reference_answers',
  jsonSchema: referenceJsonSchema,
  initialMaxOutputTokens: 220,
  fallbackMaxOutputTokens: 420,
}

export const PIKA_TEST_SINGLE_GRADE_OUTPUT: StructuredOutputSpec = {
  schemaName: 'test_single_grade',
  jsonSchema: singleGradeJsonSchema,
  initialMaxOutputTokens: 220,
  fallbackMaxOutputTokens: 420,
}

export const PIKA_TEST_BATCH_GRADE_OUTPUT: StructuredOutputSpec = {
  schemaName: 'test_batch_grade',
  jsonSchema: batchGradeJsonSchema,
  initialMaxOutputTokens: 600,
  fallbackMaxOutputTokens: 900,
}

export function getPikaTestPromptVersion(profile: 'manual' | 'bulk'): string {
  return profile === 'bulk'
    ? PIKA_TEST_OPEN_RESPONSE_BULK_PROMPT_VERSION
    : PIKA_TEST_OPEN_RESPONSE_MANUAL_PROMPT_VERSION
}

export function resolvePikaTestPromptGuideline(input: {
  override: string | null | undefined
  isCodingQuestion: boolean
  promptProfile: 'manual' | 'bulk'
}): string {
  const baseGuideline = input.isCodingQuestion
    ? input.promptProfile === 'bulk'
      ? BULK_GRADE_11CS_JAVA_CODEHS_PROMPT_GUIDELINE
      : GRADE_11CS_JAVA_CODEHS_PROMPT_GUIDELINE
    : input.promptProfile === 'bulk'
      ? BULK_TEST_AI_PROMPT_GUIDELINE
      : DEFAULT_TEST_AI_PROMPT_GUIDELINE
  const normalizedBase = stripConflictingOutputFormat(baseGuideline)
  if (input.override == null) return normalizedBase

  const normalizedOverride = stripConflictingOutputFormat(input.override)
  return normalizedOverride
    ? `${normalizedBase}\n\nAdditional teacher instructions:\n${normalizedOverride}`
    : normalizedBase
}

export function buildPikaTestReferencePrompt(input: {
  testTitle: string
  questionText: string
  maxPoints: number
  isCodingQuestion: boolean
}): { systemPrompt: string; userPrompt: string } {
  const codingGuidance = input.isCodingQuestion
    ? `
- Treat this as a coding question. Provide reference answers as clear code-oriented solution outlines, including algorithm steps and expected structure.
- For Java/CodeHS contexts, include platform helper APIs when appropriate (for example: ConsoleProgram, readInt/readLine, println, Randomizer).
- If the language is not explicitly stated, infer likely language from the question/response context; if uncertain, keep references language-agnostic and focus on logic.`
    : ''

  return {
    systemPrompt: `You generate reference answers for grading open-response test questions.
Return ONLY valid JSON:
{"reference_answers":["answer 1","answer 2"]}

Rules:
- Provide 1-3 concise, high-quality reference answers.
- Each answer should describe acceptable content, not just keywords.
- Do not include markdown code fences.${codingGuidance}`,
    userPrompt: `Test: ${input.testTitle}
Question:
${input.questionText}

Max points: ${input.maxPoints}`,
  }
}

export function buildPikaTestOpenResponsePrompt(input: {
  testTitle: string
  questionText: string
  maxPoints: number
  promptGuideline: string
  promptProfile: 'manual' | 'bulk'
  isCodingQuestion: boolean
  gradingBasis: 'teacher_key' | 'generated_reference'
  answerKey: string | null
  referenceAnswers: string[]
  sampleSolution: string | null
  sampleSolutionIncluded: boolean
  scoreBuckets: number[] | null
}): { systemPrompt: string; userPromptPrefix: string } {
  const promptGuidelineContext = input.promptGuideline
    ? `Teacher grading guideline:\n${input.promptGuideline}`
    : 'Teacher grading guideline: none provided.'
  const codingRubric = buildCodingRubric(
    input.isCodingQuestion,
    input.maxPoints,
    input.promptProfile,
  )
  const systemPrompt = `You grade open-response test answers.
Return ONLY valid JSON with this shape:
{"score": number, "feedback": "string"}

Rules:
- score must be between 0 and ${input.maxPoints}
- grade for correctness and completeness, not just writing style
- if the score is less than ${input.maxPoints}, feedback should include one concrete improvement needed for full marks

${promptGuidelineContext}${codingRubric}`
  const gradingContext = input.gradingBasis === 'teacher_key'
    ? `Teacher answer key:\n${input.answerKey}`
    : `Reference answers:\n${input.referenceAnswers
        .map((answer, index) => `${index + 1}. ${answer}`)
        .join('\n')}

Students may use different correct wording. Award credit for equivalent ideas.`
  const sampleSolutionContext = input.sampleSolutionIncluded
    ? `

Sample solution (one valid approach, not a required exact match):
${input.sampleSolution}`
    : ''
  const scoreBucketContext = input.scoreBuckets && input.scoreBuckets.length > 0
    ? `Score buckets: ${input.scoreBuckets.join(', ')}\nChoose the nearest bucket for the score.`
    : 'No explicit score buckets were provided.'

  return {
    systemPrompt,
    userPromptPrefix: `Test: ${input.testTitle}
Question:
${input.questionText}

${gradingContext}
${sampleSolutionContext}

${scoreBucketContext}`,
  }
}

export function buildPikaTestSingleUserPrompt(
  userPromptPrefix: string,
  responseText: string,
): string {
  return `${userPromptPrefix}\n\nStudent response:\n${responseText}`
}

export function buildPikaTestBatchSystemPrompt(systemPrompt: string): string {
  return `${systemPrompt}

Grade each response independently. Do not compare students against each other.
Return ONLY valid JSON with this shape:
{"results":[{"response_id":"string","score":number,"feedback":"string"}]}`
}

export function buildPikaTestBatchUserPrompt(
  userPromptPrefix: string,
  responses: Array<{ responseId: string; responseText: string }>,
): string {
  return `${userPromptPrefix}

Student responses:
${responses
  .map((response, index) => `${index + 1}. response_id=${response.responseId}\n${response.responseText}`)
  .join('\n\n')}`
}

export function parsePikaTestReferenceOutput(outputText: string): PikaTestReferenceOutput {
  return referenceOutputSchema.parse(parseJsonOutput(outputText, 'Failed to parse AI reference answers'))
}

export function parsePikaTestSingleGradeOutput(outputText: string): PikaTestSingleGradeOutput {
  return singleGradeOutputSchema.parse(parseJsonOutput(outputText, 'Failed to parse AI grade suggestion'))
}

export function parsePikaTestBatchGradeOutput(outputText: string): PikaTestBatchGradeOutput {
  return batchGradeOutputSchema.parse(parseJsonOutput(outputText, 'Failed to parse AI batch grade suggestions'))
}

function parseJsonOutput(outputText: string, message: string): unknown {
  const codeBlock = outputText.match(/```(?:json)?\s*([\s\S]*?)```/)
  const jsonText = codeBlock ? codeBlock[1].trim() : outputText
  try {
    return JSON.parse(jsonText)
  } catch (error) {
    throw new Error(message, { cause: error })
  }
}

function stripConflictingOutputFormat(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  return trimmed.replace(/\n*Output format[\s\S]*$/i, '').trim()
}

function buildCodingRubric(
  isCodingQuestion: boolean,
  maxPoints: number,
  promptProfile: 'manual' | 'bulk',
): string {
  if (!isCodingQuestion) return ''
  const readabilityDeductionCap = Math.max(0, Math.floor(maxPoints * 0.2))
  const readabilityGuidance = readabilityDeductionCap <= 0
    ? `- Because this question is worth ${maxPoints} point${maxPoints === 1 ? '' : 's'}, do not apply a separate readability/style deduction here; keep grading focused on correctness and required structure.`
    : promptProfile === 'bulk'
      ? `- Apply at most one readability/style deduction, and only when formatting materially hurts readability.
- Cap any readability/style deduction at ${readabilityDeductionCap} point${readabilityDeductionCap === 1 ? '' : 's'} for this question.
- Do not deduct for minor style issues when the code is still readable.`
      : `- You may apply one readability/style deduction only after scoring correctness and required structure first.
- Forgive one small formatting/style issue.
- Apply the readability deduction only when formatting materially hurts readability, such as two or more minor formatting issues or one major formatting issue.
- Minor issues include slightly uneven spacing, one missed indent level, or small brace-placement inconsistencies.
- Major issues include most code written on one line, indentation missing across nested blocks, or formatting that makes control flow hard to follow.
- Never stack style deductions per infraction; apply at most one readability deduction total.
- Cap any readability/style deduction at ${readabilityDeductionCap} point${readabilityDeductionCap === 1 ? '' : 's'} for this question.
- If readability is still acceptable overall, do not deduct for style.`

  if (promptProfile === 'bulk') {
    return `
- This is a coding response. Prioritize algorithmic correctness and logical reasoning over minor syntax/runtime mistakes.
- Award strong partial credit when the core approach is correct, even if the implementation is rough.
- Treat CodeHS Java helpers (for example: ConsoleProgram, readInt/readLine, println, Randomizer) as valid.
- Accept alternate valid solutions unless the prompt explicitly requires a specific structure.
${readabilityGuidance}`
  }

  return `
- This is a coding response. Prioritize algorithmic correctness and logical reasoning over minor syntax/runtime mistakes.
- If the approach is logically sound and clearly communicated but has minor implementation issues, award high partial credit (typically 80-95% of max points).
- Formatting/readability can affect the score only through the capped readability deduction below.
- For Java/CodeHS classroom contexts, treat platform helper APIs (for example: ConsoleProgram, readInt/readLine, println, Randomizer) as valid and do not penalize solely for using them.
- If language is unspecified, infer likely language from prompt/context/response. If still ambiguous, evaluate logic language-agnostically and do not penalize language choice alone.
- Avoid nitpicking minor stylistic preferences when clarity and logic are strong.
${readabilityGuidance}`
}
