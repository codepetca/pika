import { z } from 'zod'

export const courseBlueprintPurgeOperationStatusSchema = z.enum([
  'inventorying',
  'deleting_objects',
  'finalizing',
  'completed',
  'failed',
])

export const courseBlueprintPurgeImpactSchema = z.object({
  course_blueprint_id: z.string().uuid(),
  course_blueprint_title: z.string().min(1),
  source_revision: z.number().int().positive(),
  authority_mode: z.enum(['pika', 'repository']),
  planned_site_published: z.boolean(),
  planned_site_slug: z.string().min(1).nullable(),
  inventory_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  relational_row_count: z.number().int().positive(),
  linked_classroom_count: z.number().int().nonnegative(),
  managed_file_count: z.number().int().nonnegative(),
  managed_file_bytes: z.number().int().nonnegative(),
  missing_file_count: z.number().int().nonnegative(),
  resource_counts: z.record(z.string(), z.number().int().nonnegative()),
  storage_counts: z.record(z.string(), z.number().int().nonnegative()),
  conflicting_operation: z.string().min(1).nullable(),
  deletion_available: z.boolean(),
  unavailable_reason: z.string().min(1).nullable(),
}).strict()

export const courseBlueprintPurgeStartRequestSchema = z.object({
  operation_id: z.string().uuid(),
  confirmation: z.string().trim().min(1).max(500),
  expected_source_revision: z.number().int().positive(),
  expected_inventory_sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

export const courseBlueprintPurgeStatusSchema = z.object({
  operation_id: z.string().uuid(),
  course_blueprint_id: z.string().uuid(),
  status: courseBlueprintPurgeOperationStatusSchema,
  retryable: z.boolean().nullable(),
  error_code: z.string().nullable(),
  attempt_count: z.number().int().positive(),
  resource_counts: z.record(z.string(), z.number().int().nonnegative()),
  storage_object_counts: z.record(z.string(), z.number().int().nonnegative()),
  completed_at: z.string().datetime({ offset: true }).nullable(),
}).strict()

export type CourseBlueprintPurgeImpact = z.infer<typeof courseBlueprintPurgeImpactSchema>
export type CourseBlueprintPurgeStatus = z.infer<typeof courseBlueprintPurgeStatusSchema>
