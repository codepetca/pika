import { z } from 'zod'

export const liveStudentCleanupParamsSchema = z.object({ id: z.string().uuid(), studentId: z.string().uuid() })
export const liveStudentCleanupQuerySchema = z.object({
  operation_id: z.string().uuid(), generation_id: z.string().uuid(),
}).strict()
export const liveStudentCleanupRequestSchema = liveStudentCleanupQuerySchema.extend({
  action: z.enum(['reserve', 'advance']),
  confirmation: z.enum(['PURGE LIVE CLASSROOM DATA', 'REMOVE REPOSITORY REPORTS']),
  scope: z.enum(['repolight_only', 'provider_bound']).optional(),
}).strict()

export const liveCleanupTargetSchema = z.object({
  student_id: z.string().uuid(), generation_id: z.string().uuid(), email: z.string(), name: z.string(),
  scope: z.enum(['repolight_only', 'provider_bound']).optional(), report_cleanup_available: z.boolean().optional(),
})
export type LiveCleanupTarget = z.infer<typeof liveCleanupTargetSchema>

const providerCleanupStatusSchema = z.object({
  operation_id: z.string().uuid(), scope: z.literal('provider_bound').optional(), academic_preserved: z.literal(false).optional(),
  status: z.enum(['provider_pending', 'completed']),
  pal: z.enum(['not_started', 'pending', 'completed']),
  bara: z.enum(['not_started', 'deleting', 'blocked', 'deleted']),
  cleanup_completed: z.boolean(),
  repolight_cleanup_pending: z.boolean().optional(),
  local_status: z.enum(['not_started', 'inventoried', 'deleting', 'local_completed']).optional(),
  blockers: z.array(z.string()).optional(),
  errors: z.array(z.object({ stage: z.enum(['pal', 'bara']), retryable: z.boolean() })).optional(),
}).strict().refine(value => value.cleanup_completed === (value.status === 'completed')
  && (!value.cleanup_completed || (value.pal === 'completed' && value.bara === 'deleted'
    && value.local_status === 'local_completed' && !value.blockers?.length)), 'Unverified completion')
const repoLightOnlyStatusSchema = z.object({
  operation_id: z.string().uuid(), scope: z.literal('repolight_only'), academic_preserved: z.literal(true),
  status: z.enum(['provider_pending', 'completed']), pal: z.literal('out_of_scope'), bara: z.literal('out_of_scope'),
  cleanup_completed: z.boolean(), local_status: z.literal('not_started'), repolight_cleanup_pending: z.boolean(),
  blockers: z.array(z.string()), errors: z.array(z.object({ stage: z.enum(['pal', 'bara']), retryable: z.boolean() })).optional(),
}).strict().refine(row => row.cleanup_completed === (row.status === 'completed')
  && row.repolight_cleanup_pending === !row.cleanup_completed && !row.blockers.length, 'Unverified remote cleanup completion')
export const liveCleanupStatusSchema = z.union([providerCleanupStatusSchema, repoLightOnlyStatusSchema])
export type LiveCleanupStatus = z.infer<typeof liveCleanupStatusSchema>
export const liveCleanupDiscoverySchema = z.object({
  generation_id: z.string().uuid(), enabled: z.boolean(), operation: liveCleanupStatusSchema.nullable(),
  scope: z.enum(['repolight_only', 'provider_bound']).optional(),
}).strict()

export const repoLightCleanupTargetsReplySchema = z.object({
  targets: liveCleanupTargetSchema.extend({ scope: z.literal('repolight_only'), report_cleanup_available: z.literal(true) }).array(),
  enabled: z.boolean(), nextStudentId: z.string().uuid().nullable(),
}).strict()
