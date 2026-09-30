import { z } from 'zod'

export const classroomGuidanceAdoptionSchema = z.object({
  blueprint_id: z.string().uuid(),
  expected_content_version_id: z.string().uuid(),
  expected_guidance_version_id: z.string().uuid(),
  expected_draft_revision: z.number().int().positive(),
}).strict()
export type ClassroomGuidanceAdoptionInput = z.infer<typeof classroomGuidanceAdoptionSchema>
