import { z } from 'zod'
import { classroomArchiveRestoreVerificationSchema } from '@/lib/contracts/classroom-lifecycle'

const uuid = z.string().uuid().refine(value => value === value.toLowerCase())
const revision = z.number().int().nonnegative().safe()
const counts = z.record(z.string(), z.number().int().nonnegative().safe()).refine(value => value.classrooms === 1)
const version = z.union([z.literal(1), z.literal(2)])

export const contextualColdRestoreRequestIdentitySchema = z.object({
  actorId: z.string().uuid().transform(value => value.toLowerCase()),
  classroomId: z.string().uuid().transform(value => value.toLowerCase()),
  archiveId: z.string().uuid().transform(value => value.toLowerCase()),
  operationId: z.string().uuid().transform(value => value.toLowerCase()),
}).strict()

export const contextualColdRestoreReadEnvelopeSchema = z.unknown().refine(value => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && Object.hasOwn(value, 'data') && Object.hasOwn(value, 'error')
)).pipe(z.object({
  data: z.unknown().refine(value => value !== undefined), error: z.null(), count: z.number().int().nullable().optional(),
  status: z.number().int().min(200).max(299).optional(), statusText: z.string().optional(),
}).strict().refine(value => value.count === undefined || value.count === null || value.count === (value.data === null ? 0 : 1)))

export const contextualColdRestoreIdentitySchema = z.object({
  id: uuid, teacher_id: uuid, classroom_id: uuid, archive_id: uuid.nullable(), operation_type: z.string().min(1),
}).strict()
export const contextualColdRestoreOperationSchema = contextualColdRestoreIdentitySchema.extend({
  archive_id: uuid, operation_type: z.literal('restore'), status: z.literal('completed'),
  source_revision: revision, resource_counts: counts, source_resource_counts: counts,
  verification: classroomArchiveRestoreVerificationSchema, completed_at: z.string().datetime({ offset: true }),
  source_contract_version: version, archive_format_version: version, restore_contract_version: z.literal(2),
}).strict()
export const contextualColdRestoreArchiveSchema = z.object({
  id: uuid, teacher_id: uuid, classroom_id: uuid, source_revision: revision, format_version: version, resource_counts: counts,
}).strict()
export const contextualColdRestoreResultSchema = z.union([
  z.object({
    ok: z.literal(false), status: z.number().int().min(400).max(599), operation_id: uuid,
    error_code: z.string().min(1), error: z.string().min(1), retryable: z.boolean(),
    database_size_bytes: z.number().int().nonnegative().safe().optional(),
    required_headroom_bytes: z.number().int().nonnegative().safe().optional(),
  }).strict(),
  z.object({
    ok: z.literal(true), status: z.union([z.literal(200), z.literal(201)]), operation_id: uuid, archive_id: uuid,
    replayed: z.boolean(), resource_counts: counts, verification: classroomArchiveRestoreVerificationSchema,
  }).strict(),
])
