import { createHash } from 'node:crypto'
import { z } from 'zod'
import { LEGACY_QUIZ_ARCHIVE_V1_RESOURCES } from '@/lib/contracts/classroom-archive-resources'
import { canonicalJsonStringify } from '@/lib/server/classroom-archive-canonical'
import {
  LEGACY_QUIZ_RETIRED_SOURCE_CONTRACT,
  LEGACY_QUIZ_SOURCE_ACTOR_COLUMNS,
  RETIRED_ASSESSMENT_CHECKSUM_ALGORITHM,
  retiredAssessmentPayloadChecksum,
  retiredAssessmentRecordActorSchema,
  retiredAssessmentRecordSchema,
  validateRetiredAssessmentEnvelopeGraph,
  type RetiredAssessmentRecord,
  type RetiredAssessmentRecordActor,
} from '@/lib/server/classroom-retired-assessment-contract'

const uuidSchema = z.string().uuid()
const sourceResourceSchema = z.enum([
  ...LEGACY_QUIZ_ARCHIVE_V1_RESOURCES,
  'assessment_drafts',
])
type SourceResource = z.infer<typeof sourceResourceSchema>

export {
  LEGACY_QUIZ_RETIRED_SOURCE_CONTRACT,
  RETIRED_ASSESSMENT_CHECKSUM_ALGORITHM,
  retiredAssessmentRecordActorSchema,
  retiredAssessmentRecordSchema,
}
export type { RetiredAssessmentRecord, RetiredAssessmentRecordActor }

type JsonObject = Record<string, unknown>

export type AdaptedLegacyQuizArchiveResources = {
  resources: Record<string, JsonObject[]>
  records: RetiredAssessmentRecord[]
  actors: RetiredAssessmentRecordActor[]
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function compareStable(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function deterministicUuid(value: string): string {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20)}`
}

function optionalTimestamp(row: JsonObject, key: 'created_at' | 'updated_at'): string | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  return z.string().datetime({ offset: true }).parse(value)
}

function parentIdentity(
  resource: SourceResource,
  row: JsonObject,
): {
  parent_source_resource: SourceResource | null
  parent_source_row_id: string | null
} {
  if (resource === 'quiz_questions' || resource === 'quiz_student_scores') {
    return {
      parent_source_resource: 'quizzes',
      parent_source_row_id: uuidSchema.parse(row.quiz_id),
    }
  }
  if (resource === 'quiz_responses') {
    return {
      parent_source_resource: 'quiz_questions',
      parent_source_row_id: uuidSchema.parse(row.question_id),
    }
  }
  if (resource === 'assessment_drafts') {
    return {
      parent_source_resource: 'quizzes',
      parent_source_row_id: uuidSchema.parse(row.assessment_id),
    }
  }
  return {
    parent_source_resource: null,
    parent_source_row_id: null,
  }
}

function sourceRows(
  resources: Record<string, JsonObject[]>,
): Array<{
  resource: SourceResource
  row: JsonObject
}> {
  const rows = LEGACY_QUIZ_ARCHIVE_V1_RESOURCES.flatMap((resource) =>
    (resources[resource] || []).map((row) => ({ resource, row })),
  )
  return [
    ...rows,
    ...(resources.assessment_drafts || [])
      .filter((row) => row.assessment_type === 'quiz')
      .map((row) => ({ resource: 'assessment_drafts' as const, row })),
  ]
}

function validateRelationships(
  classroomId: string,
  rows: ReturnType<typeof sourceRows>,
) {
  const sourceIds = new Map<string, Set<string>>()
  for (const { resource, row } of rows) {
    const rowId = uuidSchema.parse(row.id)
    const ids = sourceIds.get(resource) || new Set<string>()
    if (ids.has(rowId)) {
      throw new Error(`Duplicate retired Quiz source identity: ${resource}/${rowId}`)
    }
    ids.add(rowId)
    sourceIds.set(resource, ids)
    if (
      (resource === 'quizzes' || resource === 'assessment_drafts') &&
      uuidSchema.parse(row.classroom_id) !== classroomId
    ) {
      throw new Error(`Retired Quiz source row belongs to another classroom: ${resource}/${rowId}`)
    }
  }

  for (const { resource, row } of rows) {
    const parent = parentIdentity(resource, row)
    if (
      parent.parent_source_resource &&
      parent.parent_source_row_id &&
      !sourceIds.get(parent.parent_source_resource)?.has(parent.parent_source_row_id)
    ) {
      throw new Error(
        `Retired Quiz source parent is missing: ${resource}/${String(row.id)}`,
      )
    }
    if (
      resource === 'quiz_responses' &&
      uuidSchema.parse(row.quiz_id) !==
        rows.find((candidate) =>
          candidate.resource === 'quiz_questions' &&
          candidate.row.id === parent.parent_source_row_id,
        )?.row.quiz_id
    ) {
      throw new Error(`Retired Quiz response has inconsistent quiz identity: ${String(row.id)}`)
    }
  }
}

export function adaptLegacyQuizArchiveResources(args: {
  classroomId: string
  resources: Record<string, JsonObject[]>
  actors: readonly { id: string }[]
}): AdaptedLegacyQuizArchiveResources {
  const classroomId = uuidSchema.parse(args.classroomId)
  const clonedResources = cloneJson(args.resources)
  const archiveActorIds = args.actors.map((actor) => uuidSchema.parse(actor.id))
  const existing = validateRetiredAssessmentEnvelopeGraph({
    classroomId,
    records: clonedResources.classroom_retired_assessment_records || [],
    recordActors: clonedResources.classroom_retired_assessment_record_actors || [],
    archiveActorIds,
  })
  const rows = sourceRows(clonedResources)
  validateRelationships(classroomId, rows)

  const convertedRecords = rows.map(({ resource, row }) => {
    const sourceRowId = uuidSchema.parse(row.id)
    const payload = cloneJson(row)
    const parent = parentIdentity(resource, row)
    return retiredAssessmentRecordSchema.parse({
      id: deterministicUuid(
        `${LEGACY_QUIZ_RETIRED_SOURCE_CONTRACT}\0` +
        `${classroomId}\0${resource}\0${sourceRowId}`,
      ),
      classroom_id: classroomId,
      source_contract: LEGACY_QUIZ_RETIRED_SOURCE_CONTRACT,
      source_contract_version: 1,
      source_resource: resource,
      source_row_id: sourceRowId,
      ...parent,
      payload,
      payload_sha256: retiredAssessmentPayloadChecksum(payload),
      checksum_algorithm: RETIRED_ASSESSMENT_CHECKSUM_ALGORITHM,
      source_created_at: optionalTimestamp(row, 'created_at'),
      source_updated_at: optionalTimestamp(row, 'updated_at'),
    })
  }).sort((left, right) =>
    compareStable(left.source_resource, right.source_resource) ||
    compareStable(left.source_row_id, right.source_row_id),
  )

  const convertedActors = convertedRecords.flatMap((record) =>
    LEGACY_QUIZ_SOURCE_ACTOR_COLUMNS[
      record.source_resource as SourceResource
    ].flatMap((sourceColumn) => {
      const actorId = record.payload[sourceColumn]
      if (actorId === null || actorId === undefined) return []
      const parsedActorId = uuidSchema.parse(actorId)
      return [retiredAssessmentRecordActorSchema.parse({
        id: deterministicUuid(`${record.id}\0${sourceColumn}\0${parsedActorId}`),
        record_id: record.id,
        actor_id: parsedActorId,
        source_column: sourceColumn,
      })]
    }),
  ).sort((left, right) => compareStable(left.id, right.id))

  const recordsById = new Map(existing.records.map((record) => [record.id, record]))
  for (const record of convertedRecords) {
    const prior = recordsById.get(record.id)
    if (prior && canonicalJsonStringify(prior) !== canonicalJsonStringify(record)) {
      throw new Error(`Retired assessment record identity collision: ${record.id}`)
    }
    recordsById.set(record.id, record)
  }
  const actorsById = new Map(existing.recordActors.map((actor) => [actor.id, actor]))
  for (const actor of convertedActors) {
    const prior = actorsById.get(actor.id)
    if (prior && canonicalJsonStringify(prior) !== canonicalJsonStringify(actor)) {
      throw new Error(`Retired assessment actor identity collision: ${actor.id}`)
    }
    actorsById.set(actor.id, actor)
  }
  const records = [...recordsById.values()].sort((left, right) =>
    compareStable(left.source_contract, right.source_contract) ||
    left.source_contract_version - right.source_contract_version ||
    compareStable(left.source_resource, right.source_resource) ||
    compareStable(left.source_row_id, right.source_row_id),
  )
  const actors = [...actorsById.values()].sort((left, right) =>
    compareStable(left.id, right.id),
  )
  validateRetiredAssessmentEnvelopeGraph({
    classroomId,
    records,
    recordActors: actors,
    archiveActorIds,
  })

  for (const resource of LEGACY_QUIZ_ARCHIVE_V1_RESOURCES) {
    delete clonedResources[resource]
  }
  clonedResources.assessment_drafts = (clonedResources.assessment_drafts || [])
    .filter((row) => row.assessment_type !== 'quiz')
  clonedResources.classroom_retired_assessment_records = records
  clonedResources.classroom_retired_assessment_record_actors = actors

  return {
    resources: clonedResources,
    records,
    actors,
  }
}
