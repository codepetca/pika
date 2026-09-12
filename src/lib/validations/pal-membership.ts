import { z } from 'zod'

export const membershipPalReadRequestSchema = z.object({
  classroomId: z.string().uuid(),
}).strict()

export const membershipPalResolutionSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('disabled') }).strict(),
  z.object({ status: z.literal('forbidden') }).strict(),
  z.object({
    status: z.literal('active'),
    learner_id: z.string().regex(/^pika-membership-v1-[0-9a-f]{32}$/),
  }).strict(),
])
