import { z } from 'zod'

export const classroomLifecycleStateSchema = z.enum([
  'active',
  'archived_hot',
  'archived_cold',
])

export type ClassroomLifecycleState = z.infer<typeof classroomLifecycleStateSchema>

export const classroomArchiveReadBackVerificationSchema = z.object({
  operation_id: z.string().uuid(),
  archive_id: z.string().uuid(),
  artifact_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  verified_at: z.string().datetime({ offset: true }),
  read_back_verified: z.literal(true),
  artifact_checksum_verified: z.literal(true),
  manifest_verified: z.literal(true),
  resource_checksums_verified: z.literal(true),
  resource_counts_verified: z.literal(true),
  storage_objects_verified: z.literal(true),
  actor_snapshots_verified: z.literal(true),
}).strict()

export const classroomArchiveCompactionVerificationSchema =
  classroomArchiveReadBackVerificationSchema.extend({
    source_object_cleanup_staged: z.literal(true),
  }).strict()

export const classroomArchiveRestoreVerificationSchema =
  classroomArchiveReadBackVerificationSchema.extend({
    schema_adapter_verified: z.literal(true),
    actor_references_resolved: z.literal(true),
    restored_resource_counts_verified: z.literal(true),
    restored_storage_objects_verified: z.literal(true),
    referential_integrity_verified: z.literal(true),
  }).strict()

const activeToHotSchema = z.object({
  from: z.literal('active'),
  to: z.literal('archived_hot'),
}).strict()

const hotToActiveSchema = z.object({
  from: z.literal('archived_hot'),
  to: z.literal('active'),
}).strict()

const hotToColdSchema = z.object({
  from: z.literal('archived_hot'),
  to: z.literal('archived_cold'),
  verification: classroomArchiveCompactionVerificationSchema,
}).strict()

const coldToHotSchema = z.object({
  from: z.literal('archived_cold'),
  to: z.literal('archived_hot'),
  verification: classroomArchiveRestoreVerificationSchema,
}).strict()

export const classroomLifecycleTransitionSchema = z.union([
  activeToHotSchema,
  hotToActiveSchema,
  hotToColdSchema,
  coldToHotSchema,
])

export type ClassroomLifecycleTransition = z.infer<typeof classroomLifecycleTransitionSchema>

const allowedTransitionKeys = new Set([
  'active:archived_hot',
  'archived_hot:active',
  'archived_hot:archived_cold',
  'archived_cold:archived_hot',
])

export function isAllowedClassroomLifecycleTransition(
  from: ClassroomLifecycleState,
  to: ClassroomLifecycleState,
): boolean {
  return allowedTransitionKeys.has(`${from}:${to}`)
}
