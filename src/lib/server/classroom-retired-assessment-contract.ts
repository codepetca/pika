import { createHash } from 'node:crypto'
import { z } from 'zod'
import { canonicalJsonStringify } from '@/lib/server/classroom-archive-canonical'

const uuidSchema = z.string().uuid()
const jsonObjectSchema = z.record(z.string(), z.unknown())
const sourceContractSchema = z.string().min(1).max(160)
const sourceResourceSchema = z.string().min(1).max(160)

export const LEGACY_QUIZ_RETIRED_SOURCE_CONTRACT =
  'pika.classroom-archive@1/legacy-quiz' as const
export const RETIRED_ASSESSMENT_CHECKSUM_ALGORITHM =
  'sha256-canonical-json-v1' as const
export const LEGACY_QUIZ_SOURCE_ACTOR_COLUMNS = {
  quizzes: ['created_by'],
  quiz_questions: [],
  quiz_responses: ['student_id'],
  quiz_student_scores: ['student_id'],
  assessment_drafts: ['created_by', 'updated_by'],
} as const

export const retiredAssessmentRecordSchema = z.object({
  id: uuidSchema,
  classroom_id: uuidSchema,
  source_contract: sourceContractSchema,
  source_contract_version: z.number().int().positive(),
  source_resource: sourceResourceSchema,
  source_row_id: uuidSchema,
  parent_source_resource: sourceResourceSchema.nullable(),
  parent_source_row_id: uuidSchema.nullable(),
  payload: jsonObjectSchema,
  payload_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  checksum_algorithm: z.literal(RETIRED_ASSESSMENT_CHECKSUM_ALGORITHM),
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

const forbiddenCredentialKeyPattern =
  /^(?:password|password_hash|encrypted_password|access_token|refresh_token|session_secret|api_key|secret_key)$/i

function assertNoCredentialFields(value: unknown, path: string) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoCredentialFields(item, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenCredentialKeyPattern.test(key)) {
      throw new Error(`Retired assessment payload contains forbidden credential field: ${path}.${key}`)
    }
    assertNoCredentialFields(item, `${path}.${key}`)
  }
}

export function retiredAssessmentPayloadChecksum(payload: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJsonStringify(payload)).digest('hex')
}

function sourceIdentity(record: RetiredAssessmentRecord): string {
  return [
    record.source_contract,
    record.source_contract_version,
    record.source_resource,
    record.source_row_id,
  ].join('\0')
}

export function validateRetiredAssessmentEnvelopeGraph(args: {
  classroomId: string
  records: unknown[]
  recordActors: unknown[]
  archiveActorIds: readonly string[]
}): {
  records: RetiredAssessmentRecord[]
  recordActors: RetiredAssessmentRecordActor[]
} {
  const classroomId = uuidSchema.parse(args.classroomId)
  const archiveActorIds = new Set(args.archiveActorIds.map((actorId) => uuidSchema.parse(actorId)))
  const records = args.records.map((record) => retiredAssessmentRecordSchema.parse(record))
  const recordActors = args.recordActors.map((actor) =>
    retiredAssessmentRecordActorSchema.parse(actor),
  )
  const recordsById = new Map<string, RetiredAssessmentRecord>()
  const recordsBySource = new Map<string, RetiredAssessmentRecord>()

  for (const record of records) {
    if (recordsById.has(record.id)) {
      throw new Error(`Duplicate retired assessment record id: ${record.id}`)
    }
    const identity = sourceIdentity(record)
    if (recordsBySource.has(identity)) {
      throw new Error(`Duplicate retired assessment source identity: ${identity}`)
    }
    if (record.classroom_id !== classroomId) {
      throw new Error(`Retired assessment record belongs to another classroom: ${record.id}`)
    }
    if (
      (record.parent_source_resource === null) !==
      (record.parent_source_row_id === null)
    ) {
      throw new Error(`Retired assessment record has incomplete parent identity: ${record.id}`)
    }
    assertNoCredentialFields(record.payload, `record/${record.id}/payload`)
    if (retiredAssessmentPayloadChecksum(record.payload) !== record.payload_sha256) {
      throw new Error(`Retired assessment payload checksum mismatch: ${record.id}`)
    }
    recordsById.set(record.id, record)
    recordsBySource.set(identity, record)
  }

  for (const record of records) {
    if (!record.parent_source_resource || !record.parent_source_row_id) continue
    const parentIdentity = [
      record.source_contract,
      record.source_contract_version,
      record.parent_source_resource,
      record.parent_source_row_id,
    ].join('\0')
    if (!recordsBySource.has(parentIdentity)) {
      throw new Error(`Retired assessment parent is missing: ${record.id}`)
    }
  }

  const actorIds = new Set<string>()
  const logicalActorRefs = new Set<string>()
  for (const actor of recordActors) {
    if (actorIds.has(actor.id)) {
      throw new Error(`Duplicate retired assessment actor id: ${actor.id}`)
    }
    actorIds.add(actor.id)
    const record = recordsById.get(actor.record_id)
    if (!record) {
      throw new Error(`Retired assessment actor record is missing: ${actor.id}`)
    }
    if (!archiveActorIds.has(actor.actor_id)) {
      throw new Error(`Retired assessment actor is missing from archive snapshots: ${actor.actor_id}`)
    }
    const logicalRef = `${actor.record_id}\0${actor.source_column}\0${actor.actor_id}`
    if (logicalActorRefs.has(logicalRef)) {
      throw new Error(`Duplicate retired assessment actor reference: ${actor.id}`)
    }
    logicalActorRefs.add(logicalRef)
    if (record.source_contract === LEGACY_QUIZ_RETIRED_SOURCE_CONTRACT) {
      const columns = LEGACY_QUIZ_SOURCE_ACTOR_COLUMNS[
        record.source_resource as keyof typeof LEGACY_QUIZ_SOURCE_ACTOR_COLUMNS
      ]
      if (!columns || !(columns as readonly string[]).includes(actor.source_column)) {
        throw new Error(`Retired Quiz actor source column is invalid: ${actor.id}`)
      }
      if (record.payload[actor.source_column] !== actor.actor_id) {
        throw new Error(`Retired Quiz actor does not match its payload: ${actor.id}`)
      }
    }
  }

  for (const record of records) {
    if (record.source_contract !== LEGACY_QUIZ_RETIRED_SOURCE_CONTRACT) continue
    const columns = LEGACY_QUIZ_SOURCE_ACTOR_COLUMNS[
      record.source_resource as keyof typeof LEGACY_QUIZ_SOURCE_ACTOR_COLUMNS
    ]
    if (!columns) {
      throw new Error(`Retired Quiz source resource is invalid: ${record.source_resource}`)
    }
    for (const sourceColumn of columns) {
      const actorId = record.payload[sourceColumn]
      if (actorId === null || actorId === undefined) continue
      const parsedActorId = uuidSchema.parse(actorId)
      if (!logicalActorRefs.has(`${record.id}\0${sourceColumn}\0${parsedActorId}`)) {
        throw new Error(
          `Retired Quiz actor reference is missing: ${record.id}/${sourceColumn}`,
        )
      }
    }
  }

  return { records, recordActors }
}
