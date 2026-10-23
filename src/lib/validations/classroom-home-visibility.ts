import { z } from 'zod'

export const classroomHomeVisibilityUuidSchema = z.string().uuid().transform(value => value.toLowerCase())

/** The actor comes exclusively from server authentication, never the request. */
export const classroomHomeVisibilitySchema = z.object({
  enrollmentId: classroomHomeVisibilityUuidSchema,
  hidden: z.boolean(),
}).strict()

export type ClassroomHomeVisibilityInput = z.infer<typeof classroomHomeVisibilitySchema>
