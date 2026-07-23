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

type RetiredAssessmentSourceResourceContract = {
  payloadIdentityField: string
  parent: {
    sourceResource: string
    payloadForeignKey: string
    parentPayloadMatches?: readonly {
      payloadField: string
      parentPayloadField: string
    }[]
  } | null
  classroomIdField: string | null
  actorColumns: readonly string[]
  requiredPayloadValues?: Readonly<Record<string, unknown>>
}

const LEGACY_QUIZ_SOURCE_RESOURCE_CONTRACTS = {
  quizzes: {
    payloadIdentityField: 'id',
    parent: null,
    classroomIdField: 'classroom_id',
    actorColumns: ['created_by'],
  },
  quiz_questions: {
    payloadIdentityField: 'id',
    parent: {
      sourceResource: 'quizzes',
      payloadForeignKey: 'quiz_id',
    },
    classroomIdField: null,
    actorColumns: [],
  },
  quiz_responses: {
    payloadIdentityField: 'id',
    parent: {
      sourceResource: 'quiz_questions',
      payloadForeignKey: 'question_id',
      parentPayloadMatches: [{
        payloadField: 'quiz_id',
        parentPayloadField: 'quiz_id',
      }],
    },
    classroomIdField: null,
    actorColumns: ['student_id'],
  },
  quiz_student_scores: {
    payloadIdentityField: 'id',
    parent: {
      sourceResource: 'quizzes',
      payloadForeignKey: 'quiz_id',
    },
    classroomIdField: null,
    actorColumns: ['student_id'],
  },
  assessment_drafts: {
    payloadIdentityField: 'id',
    parent: {
      sourceResource: 'quizzes',
      payloadForeignKey: 'assessment_id',
    },
    classroomIdField: 'classroom_id',
    actorColumns: ['created_by', 'updated_by'],
    requiredPayloadValues: {
      assessment_type: 'quiz',
    },
  },
} as const satisfies Record<string, RetiredAssessmentSourceResourceContract>

export const LEGACY_QUIZ_SOURCE_ACTOR_COLUMNS = {
  quizzes: LEGACY_QUIZ_SOURCE_RESOURCE_CONTRACTS.quizzes.actorColumns,
  quiz_questions: LEGACY_QUIZ_SOURCE_RESOURCE_CONTRACTS.quiz_questions.actorColumns,
  quiz_responses: LEGACY_QUIZ_SOURCE_RESOURCE_CONTRACTS.quiz_responses.actorColumns,
  quiz_student_scores:
    LEGACY_QUIZ_SOURCE_RESOURCE_CONTRACTS.quiz_student_scores.actorColumns,
  assessment_drafts:
    LEGACY_QUIZ_SOURCE_RESOURCE_CONTRACTS.assessment_drafts.actorColumns,
} as const

function sourceContractRegistryKey(args: {
  sourceContract: string
  sourceContractVersion: number
  sourceResource: string
}): string {
  return [
    args.sourceContract,
    args.sourceContractVersion,
    args.sourceResource,
  ].join('\0')
}

const RETIRED_ASSESSMENT_SOURCE_CONTRACT_REGISTRY = new Map<
  string,
  RetiredAssessmentSourceResourceContract
>(
  Object.entries(LEGACY_QUIZ_SOURCE_RESOURCE_CONTRACTS).map(
    ([sourceResource, contract]) => [
      sourceContractRegistryKey({
        sourceContract: LEGACY_QUIZ_RETIRED_SOURCE_CONTRACT,
        sourceContractVersion: 1,
        sourceResource,
      }),
      contract,
    ],
  ),
)

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

function normalizeSensitiveKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

function isForbiddenCredentialKey(key: string): boolean {
  const normalized = normalizeSensitiveKey(key)
  return (
    normalized === 'password' ||
    normalized.endsWith('_password') ||
    normalized === 'password_hash' ||
    normalized === 'encrypted_password' ||
    normalized === 'private_key' ||
    normalized.endsWith('_private_key') ||
    normalized === 'api_key' ||
    normalized.endsWith('_api_key') ||
    normalized === 'token' ||
    normalized.endsWith('_token') ||
    normalized === 'secret' ||
    normalized.endsWith('_secret') ||
    normalized === 'secret_key' ||
    normalized.endsWith('_secret_key')
  )
}

function assertNoCredentialFields(value: unknown, path: string) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoCredentialFields(item, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenCredentialKey(key)) {
      throw new Error(`Retired assessment payload contains forbidden credential field: ${path}.${key}`)
    }
    assertNoCredentialFields(item, `${path}.${key}`)
  }
}

export function retiredAssessmentPayloadChecksum(payload: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJsonStringify(payload)).digest('hex')
}

function sourceIdentity(record: RetiredAssessmentRecord): string {
  return sourceContractRegistryKey({
    sourceContract: record.source_contract,
    sourceContractVersion: record.source_contract_version,
    sourceResource: record.source_resource,
  }) + `\0${record.source_row_id}`
}

function sourceResourceContract(
  record: RetiredAssessmentRecord,
): RetiredAssessmentSourceResourceContract {
  const contract = RETIRED_ASSESSMENT_SOURCE_CONTRACT_REGISTRY.get(
    sourceContractRegistryKey({
      sourceContract: record.source_contract,
      sourceContractVersion: record.source_contract_version,
      sourceResource: record.source_resource,
    }),
  )
  if (!contract) {
    throw new Error(
      `Unsupported retired assessment source contract: ` +
      `${record.source_contract}@${record.source_contract_version}/${record.source_resource}`,
    )
  }
  return contract
}

function payloadUuid(record: RetiredAssessmentRecord, field: string): string {
  const result = uuidSchema.safeParse(record.payload[field])
  if (!result.success) {
    throw new Error(
      `Retired assessment payload UUID is invalid: ${record.id}/${field}`,
    )
  }
  return result.data
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
    const contract = sourceResourceContract(record)
    if (payloadUuid(record, contract.payloadIdentityField) !== record.source_row_id) {
      throw new Error(
        `Retired assessment payload identity does not match its envelope: ${record.id}`,
      )
    }
    if (
      contract.classroomIdField &&
      payloadUuid(record, contract.classroomIdField) !== classroomId
    ) {
      throw new Error(
        `Retired assessment payload belongs to another classroom: ${record.id}`,
      )
    }
    for (const [field, expectedValue] of Object.entries(
      contract.requiredPayloadValues || {},
    )) {
      if (record.payload[field] !== expectedValue) {
        throw new Error(
          `Retired assessment payload contract value is invalid: ${record.id}/${field}`,
        )
      }
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
    const contract = sourceResourceContract(record)
    if (!contract.parent) {
      if (record.parent_source_resource || record.parent_source_row_id) {
        throw new Error(`Retired assessment root must not have a parent: ${record.id}`)
      }
      continue
    }
    if (!record.parent_source_resource || !record.parent_source_row_id) {
      throw new Error(`Retired assessment required parent is missing: ${record.id}`)
    }
    if (record.parent_source_resource !== contract.parent.sourceResource) {
      throw new Error(
        `Retired assessment parent resource is invalid: ${record.id}`,
      )
    }
    if (
      payloadUuid(record, contract.parent.payloadForeignKey) !==
      record.parent_source_row_id
    ) {
      throw new Error(
        `Retired assessment parent foreign key does not match its envelope: ${record.id}`,
      )
    }
    const parentIdentity = [
      record.source_contract,
      record.source_contract_version,
      record.parent_source_resource,
      record.parent_source_row_id,
    ].join('\0')
    const parent = recordsBySource.get(parentIdentity)
    if (!parent) {
      throw new Error(`Retired assessment parent is missing: ${record.id}`)
    }
    for (const match of contract.parent.parentPayloadMatches || []) {
      if (
        payloadUuid(record, match.payloadField) !==
        payloadUuid(parent, match.parentPayloadField)
      ) {
        throw new Error(
          `Retired assessment parent payload relationship is invalid: ${record.id}/${match.payloadField}`,
        )
      }
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
    const contract = sourceResourceContract(record)
    if (!contract.actorColumns.includes(actor.source_column)) {
      throw new Error(`Retired Quiz actor source column is invalid: ${actor.id}`)
    }
    if (record.payload[actor.source_column] !== actor.actor_id) {
      throw new Error(`Retired Quiz actor does not match its payload: ${actor.id}`)
    }
  }

  for (const record of records) {
    const contract = sourceResourceContract(record)
    for (const sourceColumn of contract.actorColumns) {
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
