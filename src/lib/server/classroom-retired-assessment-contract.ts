import { z } from 'zod'

const uuidSchema = z.string().uuid()
const jsonObjectSchema = z.record(z.string(), z.unknown())

export const retiredAssessmentRecordSchema = z.object({
  id: uuidSchema,
  classroom_id: uuidSchema,
  source_contract: z.string().min(1).max(160),
  source_contract_version: z.number().int().positive(),
  source_resource: z.string().min(1).max(160),
  source_row_id: uuidSchema,
  parent_source_resource: z.string().min(1).max(160).nullable(),
  parent_source_row_id: uuidSchema.nullable(),
  payload: jsonObjectSchema,
  payload_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  checksum_algorithm: z.string().min(1).max(80),
  source_created_at: z.string().datetime({ offset: true }).nullable(),
  source_updated_at: z.string().datetime({ offset: true }).nullable(),
}).strict()

export const retiredAssessmentRecordActorSchema = z.object({
  id: uuidSchema,
  record_id: uuidSchema,
  actor_id: uuidSchema,
  source_column: z.string().min(1),
}).strict()

export type RetiredAssessmentRecord = z.infer<typeof retiredAssessmentRecordSchema>
export type RetiredAssessmentRecordActor = z.infer<
  typeof retiredAssessmentRecordActorSchema
>

/**
 * The generic envelope tables remain in archive-v2 for schema stability, but
 * no retired assessment contract is currently supported or produced.
 */
export function validateRetiredAssessmentEnvelopeGraph(args: {
  classroomId: string
  records: unknown[]
  recordActors: unknown[]
  archiveActorIds: readonly string[]
}): {
  records: RetiredAssessmentRecord[]
  recordActors: RetiredAssessmentRecordActor[]
} {
  uuidSchema.parse(args.classroomId)
  args.archiveActorIds.forEach((actorId) => uuidSchema.parse(actorId))
  if (args.records.length > 0 || args.recordActors.length > 0) {
    throw new Error('Retired assessment envelopes are no longer supported')
  }
  return { records: [], recordActors: [] }
}
