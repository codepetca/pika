import { z } from 'zod'

const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm')

export const teacherAttendancePolicyQuerySchema = z.object({
  classroom_id: z.string().uuid(),
}).strict()

export const teacherAttendancePolicyUpdateSchema = z.object({
  classroom_id: z.string().uuid(),
  opens_local: localTimeSchema,
  closes_local: localTimeSchema,
  close_day_offset: z.union([z.literal(0), z.literal(1)]),
  enabled: z.boolean(),
  expected_revision: z.number().int().safe().positive().nullable(),
}).strict().superRefine((value, context) => {
  if (value.close_day_offset === 0 && value.opens_local >= value.closes_local) {
    context.addIssue({
      code: 'custom',
      path: ['closes_local'],
      message: 'Closing time must be after opening time',
    })
  }
})
