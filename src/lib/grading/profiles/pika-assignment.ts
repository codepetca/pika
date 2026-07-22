import { z } from 'zod'
import type { GradingProfile } from '@/lib/grading/profiles/types'

export const PIKA_ASSIGNMENT_GRADING_PROFILE_VERSION = 'pika-assignment-v1'
export const PIKA_ASSIGNMENT_PROMPT_VERSION = 'pika-assignment-prompt-v1'
export const PIKA_ASSIGNMENT_RUBRIC_VERSION = 'pika-essay-ctw-v1'
export const PIKA_ASSIGNMENT_POLICY_VERSION = 'pika-grading-policy-v1'

export interface PikaAssignmentGradingInput {
  assignmentTitle: string
  instructions: string
  submission: string
}

const assignmentOutputSchema = z.object({
  score_completion: z.number().int().min(0).max(10),
  score_thinking: z.number().int().min(0).max(10),
  score_workflow: z.number().int().min(0).max(10),
  feedback: z.string().min(1),
}).strict()

type AssignmentOutput = z.infer<typeof assignmentOutputSchema>

const assignmentJsonSchema = {
  type: 'object',
  properties: {
    score_completion: { type: 'integer', minimum: 0, maximum: 10 },
    score_thinking: { type: 'integer', minimum: 0, maximum: 10 },
    score_workflow: { type: 'integer', minimum: 0, maximum: 10 },
    feedback: { type: 'string', minLength: 1 },
  },
  required: ['score_completion', 'score_thinking', 'score_workflow', 'feedback'],
  additionalProperties: false,
} as const

export const PIKA_ASSIGNMENT_GRADING_PROFILE: GradingProfile<
  PikaAssignmentGradingInput,
  AssignmentOutput
> = {
  id: 'pika-assignment',
  version: PIKA_ASSIGNMENT_GRADING_PROFILE_VERSION,
  promptVersion: PIKA_ASSIGNMENT_PROMPT_VERSION,
  rubric: {
    version: PIKA_ASSIGNMENT_RUBRIC_VERSION,
    criteria: [
      {
        id: 'completion',
        label: 'Completion',
        description: 'Did the student complete all parts of the assignment?',
        kind: 'content',
        scale: { min: 0, max: 10 },
        weight: 1,
      },
      {
        id: 'thinking',
        label: 'Thinking',
        description: 'Does the work show depth of thought, analysis, or understanding?',
        kind: 'thinking',
        scale: { min: 0, max: 10 },
        weight: 1,
      },
      {
        id: 'workflow',
        label: 'Workflow',
        description: 'Is the work organized, clear, and well-presented?',
        kind: 'workflow',
        scale: { min: 0, max: 10 },
        weight: 1,
      },
    ],
  },
  output: {
    schemaName: 'assignment_grade',
    jsonSchema: assignmentJsonSchema,
    initialMaxOutputTokens: 220,
    fallbackMaxOutputTokens: 420,
  },
  buildPrompt(input) {
    return {
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
      userPrompt: `Assignment: ${input.assignmentTitle}
Instructions: ${input.instructions}

Student Work:
${input.submission}`,
    }
  },
  parseOutput(outputText) {
    const codeBlock = outputText.match(/```(?:json)?\s*([\s\S]*?)```/)
    const jsonText = codeBlock ? codeBlock[1].trim() : outputText
    return assignmentOutputSchema.parse(JSON.parse(jsonText))
  },
  normalizeOutput(output) {
    return {
      criteria: [
        { criterionId: 'completion', score: output.score_completion },
        { criterionId: 'thinking', score: output.score_thinking },
        { criterionId: 'workflow', score: output.score_workflow },
      ],
      feedback: { student: output.feedback, teacherNotes: null },
    }
  },
}
