import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  classroomArchiveRestorePreflightSchema,
  isClassroomArchiveRestoreReady,
  type ClassroomArchiveRestorePreflight,
} from '@/lib/contracts/classroom-artifacts'
import {
  CLASSROOM_RELATIONAL_RESOURCES,
  getClassroomResourceOrder,
} from '@/lib/contracts/classroom-data'
import {
  decodeClassroomArchiveData,
  discoverClassroomStorageReferences,
  type VerifiedClassroomArchiveBundle,
} from '@/lib/server/classroom-archive-format'

export const CLASSROOM_ARCHIVE_RESTORE_TARGET_MIGRATION =
  '083_resumable_classroom_archive_restore' as const

const managedUrlPattern = /https?:\/\/[^\s<>"'`]+/gi
const uuidSchema = z.string().uuid()
const currentActorSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  role: z.enum(['student', 'teacher']),
}).strict()

type JsonObject = Record<string, unknown>
type CurrentActor = z.infer<typeof currentActorSchema>
type VerifiedBundle = Extract<VerifiedClassroomArchiveBundle, { ok: true }>

export type ClassroomArchiveRestoreStorageObject = {
  bucket: 'assignment-artifacts' | 'submission-images' | 'test-documents'
  sourcePath: string
  restorePath: string
  archivePath: string
  contentType: string | null
  sha256: string
  bytes: Uint8Array
}

export type ClassroomArchiveRestorePlan = {
  archiveId: string
  classroomId: string
  teacherId: string
  sourceSchemaMigration: string
  targetSchemaMigration: typeof CLASSROOM_ARCHIVE_RESTORE_TARGET_MIGRATION
  adapterChain: string[]
  resources: Record<string, JsonObject[]>
  actors: CurrentActor[]
  storageObjects: ClassroomArchiveRestoreStorageObject[]
  preflight: ClassroomArchiveRestorePreflight
}

type RestoreAdapter = {
  id: string
  source: string
  target: string
  adapt: (resources: Record<string, JsonObject[]>) => Record<string, JsonObject[]>
}

const RESTORE_ADAPTERS: RestoreAdapter[] = [
  {
    id: 'classroom-archive-v1-082-to-083',
    source: '082_verified_classroom_archive_exports',
    target: CLASSROOM_ARCHIVE_RESTORE_TARGET_MIGRATION,
    adapt: cloneResources,
  },
]

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function cloneResources(resources: Record<string, JsonObject[]>): Record<string, JsonObject[]> {
  return Object.fromEntries(
    Object.entries(resources).map(([table, rows]) => [table, cloneJsonValue(rows)]),
  )
}

function resolveAdapterChain(
  source: string,
  target: string,
): { ids: string[]; adapt: RestoreAdapter['adapt'] } {
  if (source === target) return { ids: [], adapt: cloneResources }
  const adapter = RESTORE_ADAPTERS.find((candidate) =>
    candidate.source === source && candidate.target === target,
  )
  if (!adapter) {
    throw new Error(`No classroom archive restore adapter from ${source} to ${target}`)
  }
  return { ids: [adapter.id], adapt: adapter.adapt }
}

export function classroomArchiveRestoreObjectPath(args: {
  classroomId: string
  operationId: string
  sha256: string
  sourcePath: string
  contentType: string | null
}): string {
  const objectIdentity = createHash('sha256')
    .update(`${args.sourcePath}\0${args.contentType ?? '<null>'}`)
    .digest('hex')
  return `restores/${uuidSchema.parse(args.classroomId)}/${uuidSchema.parse(args.operationId)}/${objectIdentity}-${args.sha256}`
}

function encodeStoragePath(path: string): string {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/')
}

function parseManagedUrl(
  candidate: string,
  supabaseOrigin: string,
): { bucket: string; path: string; suffix: string } | null {
  const stripped = candidate.replace(/[),.;:!?]+$/, '')
  const suffix = candidate.slice(stripped.length)
  try {
    const url = new URL(stripped)
    if (url.origin !== supabaseOrigin) return null
    const match = url.pathname.match(
      /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/,
    )
    if (!match) return null
    return {
      bucket: decodeURIComponent(match[1]),
      path: decodeURIComponent(match[2]),
      suffix,
    }
  } catch {
    return null
  }
}

function rewriteManagedUrls(
  value: string,
  supabaseOrigin: string,
  restoredPaths: Map<string, string>,
): string {
  return value.replace(managedUrlPattern, (candidate) => {
    const parsed = parseManagedUrl(candidate, supabaseOrigin)
    if (!parsed) return candidate
    const restoredPath = restoredPaths.get(`${parsed.bucket}\0${parsed.path}`)
    if (!restoredPath) return candidate
    return `${supabaseOrigin}/storage/v1/object/public/${encodeURIComponent(parsed.bucket)}/${encodeStoragePath(restoredPath)}${parsed.suffix}`
  })
}

function rewriteResourceValue(args: {
  value: unknown
  table: string
  key?: string
  inTestDocuments?: boolean
  supabaseOrigin: string
  restoredPaths: Map<string, string>
}): unknown {
  const { value, table, key, inTestDocuments, supabaseOrigin, restoredPaths } = args
  if (typeof value === 'string') {
    if (table === 'assignment_submission_artifacts' && key === 'storage_path') {
      return restoredPaths.get(`assignment-artifacts\0${value}`) || value
    }
    if (table === 'tests' && inTestDocuments && key === 'snapshot_path') {
      return restoredPaths.get(`test-documents\0${value}`) || value
    }
    return rewriteManagedUrls(value, supabaseOrigin, restoredPaths)
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteResourceValue({
      ...args,
      value: item,
    }))
  }
  if (!isJsonObject(value)) return value

  return Object.fromEntries(Object.entries(value).map(([childKey, item]) => [
    childKey,
    rewriteResourceValue({
      ...args,
      value: item,
      key: childKey,
      inTestDocuments: inTestDocuments || (table === 'tests' && childKey === 'documents'),
    }),
  ]))
}

function validateActorReferences(
  resources: Record<string, JsonObject[]>,
  archivedActorIds: Set<string>,
) {
  for (const resource of CLASSROOM_RELATIONAL_RESOURCES) {
    for (const row of resources[resource.table] || []) {
      for (const column of resource.actor_columns) {
        const actorId = row[column]
        if (actorId === null || actorId === undefined) continue
        if (typeof actorId !== 'string' || !archivedActorIds.has(actorId)) {
          throw new Error(
            `Archive actor snapshot is missing ${resource.table}.${column}=${String(actorId)}`,
          )
        }
      }
    }
  }
}

export function buildClassroomArchiveRestorePlan(args: {
  verified: VerifiedBundle
  artifactChecksumVerified: boolean
  operationId: string
  currentActors: CurrentActor[]
  supabaseUrl: string
}): ClassroomArchiveRestorePlan {
  if (!args.artifactChecksumVerified) {
    throw new Error('Classroom archive artifact checksum was not verified')
  }
  const operationId = uuidSchema.parse(args.operationId)
  const manifest = args.verified.manifest
  const origin = new URL(args.supabaseUrl).origin
  const decoded = decodeClassroomArchiveData(args.verified)
  const adapters = resolveAdapterChain(
    manifest.source.schema_migration,
    CLASSROOM_ARCHIVE_RESTORE_TARGET_MIGRATION,
  )
  const resources = adapters.adapt(decoded.resources)
  const classroomRows = resources.classrooms || []
  if (
    classroomRows.length !== 1 ||
    classroomRows[0].id !== manifest.classroom_id ||
    classroomRows[0].teacher_id !== manifest.teacher_id
  ) {
    throw new Error('Archive classroom root does not match the manifest identity')
  }

  const archivedActors = decoded.actors.map((actor) => currentActorSchema.parse({
    id: actor.id,
    email: actor.email,
    role: actor.role,
  }))
  const archivedActorIds = new Set(archivedActors.map((actor) => actor.id))
  validateActorReferences(resources, archivedActorIds)

  const referencedStorage = discoverClassroomStorageReferences(decoded.resources, args.supabaseUrl)
    .map((reference) => `${reference.bucket}\0${reference.path}`)
    .sort()
  const archivedStorage = manifest.storage_objects
    .map((object) => `${object.bucket}\0${object.source_path}`)
    .sort()
  if (
    referencedStorage.length !== archivedStorage.length ||
    referencedStorage.some((reference, index) => reference !== archivedStorage[index])
  ) {
    throw new Error('Archive storage objects do not exactly match classroom references')
  }

  const currentActorsById = new Map(
    args.currentActors.map((actor) => {
      const parsed = currentActorSchema.parse(actor)
      return [parsed.id, parsed]
    }),
  )
  const unresolvedActorIds = archivedActors.flatMap((actor) => {
    const current = currentActorsById.get(actor.id)
    return current?.role === actor.role ? [] : [actor.id]
  })

  const storageObjects = manifest.storage_objects.map((object) => {
    const bytes = args.verified.files.get(object.archive_path)
    if (!bytes) throw new Error(`Archive storage object is missing: ${object.archive_path}`)
    return {
      bucket: object.bucket,
      sourcePath: object.source_path,
      restorePath: classroomArchiveRestoreObjectPath({
        classroomId: manifest.classroom_id,
        operationId,
        sha256: object.sha256,
        sourcePath: object.source_path,
        contentType: object.content_type,
      }),
      archivePath: object.archive_path,
      contentType: object.content_type,
      sha256: object.sha256,
      bytes,
    }
  })
  const restoredPaths = new Map(
    storageObjects.map((object) => [
      `${object.bucket}\0${object.sourcePath}`,
      object.restorePath,
    ]),
  )
  const rewrittenResources = Object.fromEntries(
    Object.entries(resources).map(([table, rows]) => [
      table,
      rows.map((row) => rewriteResourceValue({
        value: row,
        table,
        supabaseOrigin: origin,
        restoredPaths,
      }) as JsonObject),
    ]),
  )

  const preflight = classroomArchiveRestorePreflightSchema.parse({
    archive_id: manifest.archive_id,
    target_schema_migration: CLASSROOM_ARCHIVE_RESTORE_TARGET_MIGRATION,
    archive_checksum_verified: args.artifactChecksumVerified,
    manifest_verified: true,
    resource_checksums_verified: true,
    resource_counts_verified: true,
    storage_objects_verified: true,
    actor_snapshots_verified: unresolvedActorIds.length === 0,
    schema_adapter_available: true,
    unresolved_actor_ids: unresolvedActorIds,
    adapter_chain: adapters.ids,
  })
  if (!isClassroomArchiveRestoreReady(preflight)) {
    throw new Error(`Archive restore has unresolved actors: ${unresolvedActorIds.join(',')}`)
  }

  const orderedResources = Object.fromEntries(
    getClassroomResourceOrder('restore').map((table) => [table, rewrittenResources[table] || []]),
  )
  return {
    archiveId: manifest.archive_id,
    classroomId: manifest.classroom_id,
    teacherId: manifest.teacher_id,
    sourceSchemaMigration: manifest.source.schema_migration,
    targetSchemaMigration: CLASSROOM_ARCHIVE_RESTORE_TARGET_MIGRATION,
    adapterChain: adapters.ids,
    resources: orderedResources,
    actors: archivedActors,
    storageObjects,
    preflight,
  }
}
