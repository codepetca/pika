import type { GradingProfile } from '@/lib/grading/profiles/types'
import {
  assignmentJsonSchema,
  assignmentOutputSchema,
  PIKA_ASSIGNMENT_GRADING_PROFILE,
  PIKA_ASSIGNMENT_RUBRIC_VERSION,
  type AssignmentOutput,
} from '@/lib/grading/profiles/pika-assignment'
import {
  formatAssignmentAnchorsForPrompt,
  type AssignmentGradingAnchors,
} from '@/lib/grading/profiles/pika-assignment-anchors'

export const PIKA_ASSIGNMENT_ANCHORED_PROFILE_VERSION = 'pika-assignment-anchored-v1'
export const PIKA_ASSIGNMENT_ANCHORED_PROMPT_VERSION = 'pika-assignment-anchored-prompt-v1'

export interface PikaAssignmentAnchoredGradingInput {
  assignmentTitle: string
  instructions: string
  submission: string
  anchors: AssignmentGradingAnchors
}

/**
 * Same rubric, same output contract, and the same normalized result as the
 * unanchored profile. Only the prompt and the version identifiers differ, so a
 * persisted grade records whether anchors were in play without any change to
 * the provenance schema.
 */
export const PIKA_ASSIGNMENT_ANCHORED_GRADING_PROFILE: GradingProfile<
  PikaAssignmentAnchoredGradingInput,
  AssignmentOutput
> = {
  id: 'pika-assignment-anchored',
  version: PIKA_ASSIGNMENT_ANCHORED_PROFILE_VERSION,
  promptVersion: PIKA_ASSIGNMENT_ANCHORED_PROMPT_VERSION,
  rubric: {
    version: PIKA_ASSIGNMENT_RUBRIC_VERSION,
    criteria: PIKA_ASSIGNMENT_GRADING_PROFILE.rubric.criteria,
  },
  output: {
    schemaName: 'assignment_grade',
    jsonSchema: assignmentJsonSchema,
    initialMaxOutputTokens: 800,
    fallbackMaxOutputTokens: 1600,
  },
  buildPrompt(input) {
    return {
      systemPrompt: `You are an assignment grader. Grade the student's work using this rubric:

- **Completion** (0–10): Did the student complete all parts of the assignment?
- **Thinking** (0–10): Does the work show depth of thought, analysis, or understanding?
- **Workflow** (0–10): Is the work organized, clear, and well-presented?
- Treat attached artifacts (links, repositories, images) as part of the student's submission. Do not say a required site or artifact is missing if it appears in the "Attached Artifacts" section.

Score anchors for this assignment. Pick the band whose description matches the work, then choose a score inside that band:

${formatAssignmentAnchorsForPrompt(input.anchors)}

Anchor rules:
- The anchors describe qualities, not one correct answer. A different but valid approach that meets the 9-10 description still scores 9-10.
- Do not default to the top band. If the work matches 4-6, score it 4-6.
- Grade only what the submission actually shows.

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
    return PIKA_ASSIGNMENT_GRADING_PROFILE.normalizeOutput(output)
  },
}
