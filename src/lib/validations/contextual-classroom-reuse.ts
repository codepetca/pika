import { z } from 'zod'

const reuseUuidSchema = z.string().uuid().transform((id) => id.toLowerCase())

export const contextualClassroomReuseParamsSchema = z.object({ id: reuseUuidSchema })
export const contextualClassroomReuseProposalParamsSchema = contextualClassroomReuseParamsSchema.extend({ proposalId: reuseUuidSchema })

export const contextualClassroomReuseProposalBindingSchema = z.object({
  teacher_id: reuseUuidSchema,
  course_blueprint_id: reuseUuidSchema,
  source_classroom_id: reuseUuidSchema,
  target_kind: z.literal('blueprint'),
  source_kind: z.literal('classroom'),
})
