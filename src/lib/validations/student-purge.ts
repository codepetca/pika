import { z } from 'zod'

export const studentPurgeOperationStatusSchema = z.enum([
  'inventorying',
  'deleting_objects',
  'finalizing',
  'completed',
  'failed',
])

export const studentPurgeImpactSchema = z.object({
  classroom_id: z.string().uuid(),
  classroom_title: z.string().min(1),
  student_id: z.string().uuid(),
  student_email: z.string().email(),
  source_revision: z.number().int().positive(),
  storage_inventory_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  relational_inventory_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  relational_row_count: z.number().int().nonnegative(),
  managed_file_count: z.number().int().nonnegative(),
  managed_file_bytes: z.number().int().nonnegative(),
  archive_count: z.number().int().nonnegative(),
  gradex_extract_count: z.number().int().nonnegative(),
  resource_counts: z.record(z.string(), z.number().int().nonnegative()),
  storage_counts: z.record(z.string(), z.number().int().nonnegative()),
  conflicting_operation: z.string().min(1).nullable(),
  deletion_available: z.boolean(),
  unavailable_reason: z.string().min(1).nullable(),
}).strict()

export const studentPurgeStartRequestSchema = z.object({
  operation_id: z.string().uuid(),
  confirmation: z.string().trim().min(1).max(320),
  expected_source_revision: z.number().int().positive(),
  expected_storage_inventory_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  expected_relational_inventory_sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

export const studentPurgeStatusSchema = z.object({
  operation_id: z.string().uuid(),
  classroom_id: z.string().uuid(),
  status: studentPurgeOperationStatusSchema,
  retryable: z.boolean().nullable(),
  error_code: z.string().nullable(),
  attempt_count: z.number().int().positive(),
  resource_counts: z.record(z.string(), z.number().int().nonnegative()),
  storage_object_counts: z.record(z.string(), z.number().int().nonnegative()),
  completed_at: z.string().datetime({ offset: true }).nullable(),
}).strict()

export type StudentPurgeImpact = z.infer<typeof studentPurgeImpactSchema>
export type StudentPurgeStatus = z.infer<typeof studentPurgeStatusSchema>
