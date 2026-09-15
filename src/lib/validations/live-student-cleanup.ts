import { z } from 'zod'

export const liveStudentCleanupParamsSchema = z.object({ id: z.string().uuid(), studentId: z.string().uuid() })
export const liveStudentCleanupQuerySchema = z.object({
  operation_id: z.string().uuid(), generation_id: z.string().uuid(),
}).strict()
export const liveStudentCleanupRequestSchema = liveStudentCleanupQuerySchema.extend({
  action: z.enum(['reserve', 'advance']),
  confirmation: z.literal('PURGE LIVE CLASSROOM DATA'),
}).strict()

export const liveCleanupTargetSchema = z.object({
  student_id: z.string().uuid(), generation_id: z.string().uuid(), email: z.string(), name: z.string(),
})
export type LiveCleanupTarget = z.infer<typeof liveCleanupTargetSchema>

export const liveCleanupStatusSchema = z.object({
  operation_id: z.string().uuid(), status: z.enum(['provider_pending', 'completed']),
  pal: z.enum(['not_started', 'pending', 'completed']),
  bara: z.enum(['not_started', 'deleting', 'blocked', 'deleted']),
  cleanup_completed: z.boolean(),
  local_status: z.enum(['not_started', 'inventoried', 'deleting', 'local_completed']).optional(),
  blockers: z.array(z.string()).optional(),
  errors: z.array(z.object({ stage: z.enum(['pal', 'bara']), retryable: z.boolean() })).optional(),
}).strict().refine(value => value.cleanup_completed === (value.status === 'completed')
  && (!value.cleanup_completed || (value.pal === 'completed' && value.bara === 'deleted'
    && value.local_status === 'local_completed' && !value.blockers?.length)), 'Unverified completion')
export type LiveCleanupStatus = z.infer<typeof liveCleanupStatusSchema>
export const liveCleanupDiscoverySchema = z.object({
  generation_id: z.string().uuid(), enabled: z.boolean(), operation: liveCleanupStatusSchema.nullable(),
}).strict()
