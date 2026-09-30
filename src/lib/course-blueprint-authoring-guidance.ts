import { z } from 'zod'

const guidanceMarkdownSchema = z.string().max(20_000)
// Keep this edge-character set identical to resolve_classroom_guided_rules_v1.
export function trimCourseBlueprintGuidanceEdgeWhitespace(value: string): string {
  return value.replace(/^[ \t\n\r\f]+|[ \t\n\r\f]+$/g, '')
}
const uuidV4Schema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  'A UUIDv4 is required',
)

export const courseBlueprintUnitExceptionSchema = z.object({
  id: uuidV4Schema,
  unit_label: z.string().transform(trimCourseBlueprintGuidanceEdgeWhitespace)
    .pipe(z.string().min(1).max(160)),
  assignment_guidance_markdown: guidanceMarkdownSchema,
  test_guidance_markdown: guidanceMarkdownSchema,
}).strict()

export const courseBlueprintAuthoringGuidanceSchema = z.object({
  course_expectations_markdown: guidanceMarkdownSchema,
  assignment_guidance_markdown: guidanceMarkdownSchema,
  test_guidance_markdown: guidanceMarkdownSchema,
  unit_exceptions: z.array(courseBlueprintUnitExceptionSchema).max(100),
}).strict().superRefine((guidance, ctx) => {
  const ids = new Set<string>()
  for (const [index, unit] of guidance.unit_exceptions.entries()) {
    const id = unit.id.toLowerCase()
    if (ids.has(id)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Unit exception IDs must be unique',
        path: ['unit_exceptions', index, 'id'],
      })
    }
    ids.add(id)
  }
})

export type CourseBlueprintAuthoringGuidance = z.infer<typeof courseBlueprintAuthoringGuidanceSchema>

export const EMPTY_COURSE_BLUEPRINT_AUTHORING_GUIDANCE: CourseBlueprintAuthoringGuidance = {
  course_expectations_markdown: '',
  assignment_guidance_markdown: '',
  test_guidance_markdown: '',
  unit_exceptions: [],
}

// Pre-migration and older imported Blueprints have no guidance yet. A present,
// malformed value fails closed rather than silently dropping teacher rules.
export function normalizeCourseBlueprintAuthoringGuidance(
  value: unknown,
): CourseBlueprintAuthoringGuidance {
  return courseBlueprintAuthoringGuidanceSchema.parse(
    value == null ? EMPTY_COURSE_BLUEPRINT_AUTHORING_GUIDANCE : value,
  )
}
