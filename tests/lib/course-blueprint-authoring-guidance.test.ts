import { describe, expect, it } from 'vitest'
import {
  EMPTY_COURSE_BLUEPRINT_AUTHORING_GUIDANCE,
  courseBlueprintAuthoringGuidanceSchema,
  normalizeCourseBlueprintAuthoringGuidance,
} from '@/lib/course-blueprint-authoring-guidance'

const unit = {
  id: '12345678-1234-4234-8234-123456789abc',
  unit_label: ' Unit 1 ',
  assignment_guidance_markdown: 'Explain your reasoning.',
  test_guidance_markdown: 'Use self-contained prompts.',
}

describe('Blueprint authoring guidance', () => {
  it('supplies the complete empty shape for older Blueprints', () => {
    expect(normalizeCourseBlueprintAuthoringGuidance(null)).toEqual(
      EMPTY_COURSE_BLUEPRINT_AUTHORING_GUIDANCE,
    )
  })

  it('normalizes labels and preserves markdown', () => {
    expect(courseBlueprintAuthoringGuidanceSchema.parse({
      ...EMPTY_COURSE_BLUEPRINT_AUTHORING_GUIDANCE,
      course_expectations_markdown: '  Course rules\n',
      unit_exceptions: [unit],
    })).toEqual({
      ...EMPTY_COURSE_BLUEPRINT_AUTHORING_GUIDANCE,
      course_expectations_markdown: '  Course rules\n',
      unit_exceptions: [{ ...unit, unit_label: 'Unit 1' }],
    })
  })

  it('rejects extra fields, non-v4 IDs, duplicate unit IDs, and malformed stored values', () => {
    const guidance = { ...EMPTY_COURSE_BLUEPRINT_AUTHORING_GUIDANCE, unit_exceptions: [unit] }
    expect(courseBlueprintAuthoringGuidanceSchema.safeParse({ ...guidance, exposed_to_students: true }).success).toBe(false)
    expect(courseBlueprintAuthoringGuidanceSchema.safeParse({
      ...guidance,
      unit_exceptions: [{ ...unit, id: '12345678-1234-1234-8234-123456789abc' }],
    }).success).toBe(false)
    expect(courseBlueprintAuthoringGuidanceSchema.safeParse({
      ...guidance,
      unit_exceptions: [unit, unit],
    }).success).toBe(false)
    expect(() => normalizeCourseBlueprintAuthoringGuidance({})).toThrow()
  })
})
