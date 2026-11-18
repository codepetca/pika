import { z } from 'zod'

const identifierSchema = z.string().uuid().transform(value => value.toLowerCase())
export const assignmentBulkSchema = z.object({
  classroom_id: identifierSchema,
  assignments: z.array(z.object({
    id: identifierSchema.optional(),
    title: z.string().trim().min(1).max(500),
    due_at: z.string().datetime({ offset: true }),
    instructions: z.string().max(100_000).optional().default(''),
    is_draft: z.boolean().optional(),
    position: z.number().int().nonnegative().optional(),
  }).superRefine((assignment, context) => {
    if (assignment.id && assignment.is_draft === undefined) {
      context.addIssue({ code: 'custom', path: ['is_draft'], message: 'Existing assignments require draft status' })
    }
  })).max(50),
})
