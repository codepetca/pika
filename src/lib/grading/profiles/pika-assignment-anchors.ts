import { z } from 'zod'
import type { StructuredOutputSpec } from '@/lib/grading/engine'
import {
  PIKA_ASSIGNMENT_GRADING_PROFILE,
  PIKA_ASSIGNMENT_RUBRIC_VERSION,
} from '@/lib/grading/profiles/pika-assignment'

export const PIKA_ASSIGNMENT_ANCHOR_PROFILE_VERSION = 'pika-assignment-anchors-v1'
export const PIKA_ASSIGNMENT_ANCHOR_PROMPT_VERSION = 'pika-assignment-anchors-prompt-v1'
export const PIKA_ASSIGNMENT_ANCHOR_POLICY_VERSION = 'pika-assignment-anchors-policy-v1'

/**
 * Score bands are fixed in code rather than asked for, so every assignment gets
 * the same ladder and only the descriptors vary. The model cannot invent
 * overlapping or missing ranges.
 */
export const PIKA_ASSIGNMENT_ANCHOR_BANDS = [
  { id: 'band_9_10', min: 9, max: 10, label: '9-10' },
  { id: 'band_7_8', min: 7, max: 8, label: '7-8' },
  { id: 'band_4_6', min: 4, max: 6, label: '4-6' },
  { id: 'band_0_3', min: 0, max: 3, label: '0-3' },
] as const

export type PikaAssignmentAnchorBandId = (typeof PIKA_ASSIGNMENT_ANCHOR_BANDS)[number]['id']

const ANCHOR_CRITERION_IDS = PIKA_ASSIGNMENT_GRADING_PROFILE.rubric.criteria.map(
  (criterion) => criterion.id,
)

const anchorOutputSchema = z.object({
  anchors: z.array(z.object({
    criterion_id: z.string().min(1).max(64),
    band_9_10: z.string().min(1).max(600),
    band_7_8: z.string().min(1).max(600),
    band_4_6: z.string().min(1).max(600),
    band_0_3: z.string().min(1).max(600),
  }).strict()).min(1).max(20),
  notes: z.string().max(600).nullable(),
}).strict()

export type PikaAssignmentAnchorOutput = z.infer<typeof anchorOutputSchema>

const anchorJsonSchema = {
  type: 'object',
  properties: {
    anchors: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        properties: {
          criterion_id: { type: 'string' },
          band_9_10: { type: 'string' },
          band_7_8: { type: 'string' },
          band_4_6: { type: 'string' },
          band_0_3: { type: 'string' },
        },
        required: ['criterion_id', 'band_9_10', 'band_7_8', 'band_4_6', 'band_0_3'],
        additionalProperties: false,
      },
    },
    notes: { type: ['string', 'null'] },
  },
  required: ['anchors', 'notes'],
  additionalProperties: false,
} as const

export const PIKA_ASSIGNMENT_ANCHOR_OUTPUT: StructuredOutputSpec = {
  schemaName: 'assignment_score_anchors',
  jsonSchema: anchorJsonSchema,
  initialMaxOutputTokens: 1600,
  fallbackMaxOutputTokens: 2600,
}

export interface PikaAssignmentAnchorInput {
  assignmentTitle: string
  instructions: string
}

export interface AssignmentAnchorBand {
  bandId: PikaAssignmentAnchorBandId
  minScore: number
  maxScore: number
  descriptor: string
}

export interface AssignmentAnchorCriterion {
  criterionId: string
  label: string
  bands: AssignmentAnchorBand[]
}

export interface AssignmentGradingAnchors {
  schemaVersion: 'assignment-grading-anchors-v1'
  rubricVersion: string
  anchorProfileVersion: string
  criteria: AssignmentAnchorCriterion[]
  notes: string | null
}

export function buildPikaAssignmentAnchorPrompt(
  input: PikaAssignmentAnchorInput,
): { systemPrompt: string; userPrompt: string } {
  const criteriaLines = PIKA_ASSIGNMENT_GRADING_PROFILE.rubric.criteria
    .map((criterion) => `- ${criterion.id} (${criterion.label}): ${criterion.description}`)
    .join('\n')

  return {
    systemPrompt: `You write scoring anchors that a grader will use to mark student work for one specific assignment.

For each criterion below, describe what work in each score band actually looks like FOR THIS ASSIGNMENT:

${criteriaLines}

Bands: 9-10, 7-8, 4-6, 0-3.

Rules:
- Describe observable qualities of the work, not a single correct answer. Students who take a different but valid approach must still be able to reach 9-10.
- Make the bands genuinely distinguishable. A grader must be able to tell a 7 from a 9 by reading your descriptors.
- Be concrete about this assignment's actual requirements. Do not restate the criterion name.
- Each descriptor is one or two sentences.
- Use "notes" to state any assumption you had to make because the instructions were unclear or incomplete, or null if none.
- Return one entry per criterion, using the exact criterion_id values listed above.`,
    userPrompt: `Assignment: ${input.assignmentTitle}
Instructions:
${input.instructions}`,
  }
}

export function parsePikaAssignmentAnchorOutput(outputText: string): PikaAssignmentAnchorOutput {
  const codeBlock = outputText.match(/```(?:json)?\s*([\s\S]*?)```/)
  const jsonText = codeBlock ? codeBlock[1].trim() : outputText
  return anchorOutputSchema.parse(JSON.parse(jsonText))
}

export function normalizePikaAssignmentAnchors(
  output: PikaAssignmentAnchorOutput,
): AssignmentGradingAnchors {
  const byCriterionId = new Map(output.anchors.map((anchor) => [anchor.criterion_id, anchor]))

  const criteria = PIKA_ASSIGNMENT_GRADING_PROFILE.rubric.criteria.map((criterion) => {
    const anchor = byCriterionId.get(criterion.id)
    if (!anchor) {
      throw new Error(`Missing score anchor for criterion: ${criterion.id}`)
    }

    return {
      criterionId: criterion.id,
      label: criterion.label,
      bands: PIKA_ASSIGNMENT_ANCHOR_BANDS.map((band) => ({
        bandId: band.id,
        minScore: band.min,
        maxScore: band.max,
        descriptor: anchor[band.id].trim(),
      })),
    }
  })

  for (const criterion of criteria) {
    for (const band of criterion.bands) {
      if (!band.descriptor) {
        throw new Error(`Empty score anchor descriptor for criterion: ${criterion.criterionId}`)
      }
    }
  }

  const notes = output.notes?.trim()

  return {
    schemaVersion: 'assignment-grading-anchors-v1',
    rubricVersion: PIKA_ASSIGNMENT_RUBRIC_VERSION,
    anchorProfileVersion: PIKA_ASSIGNMENT_ANCHOR_PROFILE_VERSION,
    criteria,
    notes: notes ? notes : null,
  }
}

export function formatAssignmentAnchorsForPrompt(anchors: AssignmentGradingAnchors): string {
  return anchors.criteria
    .map((criterion) => {
      const bands = criterion.bands
        .map((band) => `  - ${band.minScore}-${band.maxScore}: ${band.descriptor}`)
        .join('\n')
      return `${criterion.label} (${criterion.criterionId}):\n${bands}`
    })
    .join('\n\n')
}

export function assignmentAnchorCriterionIds(): string[] {
  return [...ANCHOR_CRITERION_IDS]
}
