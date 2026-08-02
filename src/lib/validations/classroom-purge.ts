import { z } from 'zod'

export const classroomPurgeOperationStatusSchema = z.enum([
  'inventorying',
  'deleting_objects',
  'finalizing',
  'completed',
  'failed',
])

export const classroomPurgeImpactSchema = z.object({
  classroom_id: z.string().uuid(),
  classroom_title: z.string().min(1),
  source_revision: z.number().int().positive(),
  storage_inventory_version: z.number().int().positive(),
  storage_inventory_sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  relational_row_count: z.number().int().positive(),
  student_count: z.number().int().nonnegative(),
  managed_file_count: z.number().int().nonnegative(),
  managed_file_bytes: z.number().int().nonnegative(),
  missing_file_count: z.number().int().nonnegative(),
  archive_count: z.number().int().nonnegative(),
  gradex_extract_count: z.number().int().nonnegative(),
  resource_counts: z.record(z.string(), z.number().int().nonnegative()),
  storage_counts: z.record(z.string(), z.number().int().nonnegative()),
  conflicting_operation: z.string().min(1).nullable(),
  ownership_coverage_status: z.enum(['pending', 'verified', 'blocked']),
  deletion_available: z.boolean(),
  unavailable_reason: z.string().min(1).nullable(),
}).strict()

export const classroomPurgeStartRequestSchema = z.object({
  operation_id: z.string().uuid(),
  confirmation: z.string().trim().min(1).max(500),
  expected_source_revision: z.number().int().positive(),
  expected_storage_inventory_version: z.number().int().positive(),
  expected_storage_inventory_sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

export const classroomPurgeTickRequestSchema = z.object({
  operation_id: z.string().uuid(),
}).strict()

export const classroomPurgeStatusSchema = z.object({
  operation_id: z.string().uuid(),
  classroom_id: z.string().uuid(),
  status: classroomPurgeOperationStatusSchema,
  retryable: z.boolean().nullable(),
  error_code: z.string().nullable(),
  attempt_count: z.number().int().positive(),
  resource_counts: z.record(z.string(), z.number().int().nonnegative()),
  storage_object_counts: z.record(z.string(), z.number().int().nonnegative()),
  completed_at: z.string().datetime({ offset: true }).nullable(),
}).strict()

export type ClassroomPurgeImpact = z.infer<typeof classroomPurgeImpactSchema>
export type ClassroomPurgeStatus = z.infer<typeof classroomPurgeStatusSchema>
