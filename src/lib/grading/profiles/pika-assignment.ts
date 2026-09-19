import { z } from 'zod'
import type { GradingProfile } from '@/lib/grading/profiles/types'

export const PIKA_ASSIGNMENT_GRADING_PROFILE_VERSION = 'pika-assignment-v2'
export const PIKA_ASSIGNMENT_PROMPT_VERSION = 'pika-assignment-prompt-v3'
export const PIKA_ASSIGNMENT_RUBRIC_VERSION = 'pika-essay-ctw-v2'
export const PIKA_ASSIGNMENT_POLICY_VERSION = 'pika-grading-policy-v3'

// Presentation is the only part of Workflow the grader judges; timeliness and
// authenticity come from save history in workflow-process.ts.
export const PIKA_ASSIGNMENT_PRESENTATION_MAX = 4

// The grader is text-only and URLs are redacted, so it can never inspect an
// artifact. Screenshots and links are assumed to be completion evidence.
export const ATTACHED_ARTIFACTS_RULE = `- Images the student placed in their work appear as "[Image attached]" at that position, so text right next to one is usually its caption. Other artifacts (uploaded images, links, repositories) are listed in the "Attached Artifacts" section. You cannot view or open any of them. Treat each one as correct, complete evidence for the part of the assignment it accompanies, and credit it under Completion. Never lower a score because you cannot see an artifact's contents, and do not say a required screenshot, site, or artifact is missing when one is listed.`

export interface PikaAssignmentGradingInput {
  assignmentTitle: string
  instructions: string
  submission: string
}

export const assignmentOutputSchema = z.object({
  score_completion: z.number().int().min(0).max(10),
  score_thinking: z.number().int().min(0).max(10),
  score_workflow: z.number().int().min(0).max(PIKA_ASSIGNMENT_PRESENTATION_MAX),
  feedback: z.string().min(1),
}).strict()

export type AssignmentOutput = z.infer<typeof assignmentOutputSchema>

export const assignmentJsonSchema = {
  type: 'object',
  properties: {
    score_completion: { type: 'integer', minimum: 0, maximum: 10 },
    score_thinking: { type: 'integer', minimum: 0, maximum: 10 },
    score_workflow: { type: 'integer', minimum: 0, maximum: PIKA_ASSIGNMENT_PRESENTATION_MAX },
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
        label: 'Presentation',
        description: 'Is the work clear, easy to read, and organized?',
        kind: 'workflow',
        scale: { min: 0, max: PIKA_ASSIGNMENT_PRESENTATION_MAX },
        weight: 1,
      },
    ],
  },
  output: {
    schemaName: 'assignment_grade',
    jsonSchema: assignmentJsonSchema,
    // DeepSeek counts reasoning against max_tokens, and feedback now lists one
    // line per missed requirement, so the old 800/1600 pair truncated replies
    // on submissions that miss several things.
    initialMaxOutputTokens: 2400,
    fallbackMaxOutputTokens: 4800,
  },
  buildPrompt(input) {
    return {
      systemPrompt: `You are an assignment grader. Grade the student's work against the assignment instructions using these rules.

**Completion** (0–10): start at 10. Each required task is worth an equal share of the 10 points. A task that is missing entirely loses its whole share; a required part missing within a task loses 1 point. A short or implied answer counts as present when its intent is clear, so deduct only when something is actually missing. Never deduct here for depth, quality, grammar, or formatting.

**Thinking** (0–10): start at 10. Subtract 1 if the responses are brief or the analysis the assignment asks for is shallow (once, not per part). Subtract 1 for each required analytical element that is missing entirely, such as a requested comparison. Subtract 2 for each part that is copied, inaccurate, or shows no understanding.

**Presentation** (0–4, reported as score_workflow): is the work clear, easy to read, and organized? Never consider grammar, spelling, or mechanics. Be very lenient: give the full 4 whenever the work is clear, easy to read, and organized, and deduct only when it is disorganized or hard to follow. Do not consider timing, effort, or how the work was produced; those are scored separately.

When you are uncertain between two scores for any criterion, give the higher one.
${ATTACHED_ARTIFACTS_RULE}

Feedback rules — write "feedback" for the student, each item on its own line:
- "Strength:" one sentence.
- One "Missed:" line for each requirement in the instructions the student missed or only partly did, even when it cost no points. Only list something as missed if the instructions actually ask for it. Omit these lines if nothing was missed.
- At most one "Tip:" line with an optional suggestion that was not required but would improve the work.
- "Next Step:" one sentence.
Feedback never changes the scores. A missing formatting detail the instructions ask for, such as a caption under a screenshot, belongs in the feedback and never costs points.`,
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
