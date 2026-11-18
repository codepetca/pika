import { z } from 'zod'

const targetSchema = z.enum(['analyze', 'overview', 'outline', 'resources', 'assignments', 'tests', 'lesson-plans', 'materials', 'surveys', 'grading'])
export type BlueprintCopilotTarget = z.infer<typeof targetSchema>

const analysisSchema = z.object({
  missing: z.array(z.string()),
  suggestions: z.array(z.string()),
  counts: z.object({
    assignments: z.number().int().nonnegative(),
    tests: z.number().int().nonnegative(),
    lesson_templates: z.number().int().nonnegative(),
    materials: z.number().int().nonnegative(),
    surveys: z.number().int().nonnegative(),
  }),
})
export type BlueprintCopilotAnalysis = z.infer<typeof analysisSchema>

const guidanceSchema = z.object({
  target: z.enum(['assignments', 'tests']),
  blueprint_revision: z.number().int().nonnegative(),
  unit_exception_id: z.string().nullable(),
  unit_label: z.string().nullable(),
  rules_markdown: z.string(),
  trial: z.boolean(),
})
const suggestionSchema = z.object({
  target: targetSchema,
  content: z.string(),
  analysis: analysisSchema.optional(),
  guidance: guidanceSchema.optional(),
  original_content_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  draft_provenance_token: z.string().min(1).optional(),
})

/** Validate the actual target-specific server contract before rendering or applying it. */
export function parseCourseBlueprintCopilotResponse(payload: unknown, requestedTarget: BlueprintCopilotTarget) {
  const parsed = z.object({ suggestion: suggestionSchema }).safeParse(payload)
  if (!parsed.success) throw new Error('The drafting response was invalid. Please try again.')
  const suggestion = parsed.data.suggestion
  const guided = requestedTarget === 'assignments' || requestedTarget === 'tests'
  if (suggestion.target !== requestedTarget
    || (guided && (!suggestion.guidance || suggestion.guidance.target !== requestedTarget
      || !suggestion.original_content_sha256 || !suggestion.draft_provenance_token))
    || (!guided && !suggestion.analysis)) {
    throw new Error('The drafting response was invalid. Please try again.')
  }
  return suggestion
}
