import { z } from 'zod'
import { classroomArchiveRetentionSchema } from '@/lib/contracts/classroom-artifacts'

export const coldClassroomPurgeImpactSchema = z.object({
  classroom_id: z.string().uuid(),
  archive_id: z.string().uuid(),
  classroom_title: z.string().min(1),
  source_revision: z.number().int().positive(),
  storage_inventory_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  cold_resource_inventory_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  cold_resource_count: z.number().int().positive(),
  student_count: z.number().int().nonnegative(),
  managed_file_count: z.number().int().nonnegative(),
  managed_file_bytes: z.number().int().nonnegative(),
  missing_file_count: z.number().int().nonnegative(),
  non_ready_file_count: z.number().int().nonnegative(),
  unmanaged_reference_count: z.number().int().nonnegative(),
  archive_count: z.number().int().positive(),
  gradex_extract_count: z.number().int().nonnegative(),
  storage_counts: z.record(z.string(), z.number().int().nonnegative()),
  resource_counts: z.record(z.string(), z.number().int().nonnegative()),
  retention: classroomArchiveRetentionSchema,
  conflicting_operation: z.string().min(1).nullable(),
  deletion_available: z.boolean(),
  unavailable_reason: z.string().min(1).nullable(),
}).strict()

export const coldClassroomPurgeStartRequestSchema = z.object({
  operation_id: z.string().uuid(),
  confirmation: z.string().trim().min(1).max(500),
  expected_source_revision: z.number().int().positive(),
  expected_storage_inventory_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  expected_cold_resource_inventory_sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

export type ColdClassroomPurgeImpact = z.infer<typeof coldClassroomPurgeImpactSchema>
