import { gzipSync } from 'node:zlib'
import { CLASSROOM_ARCHIVE_V2_RESOURCES } from '@/lib/contracts/classroom-archive-resources'
import {
  canonicalJsonStringify,
  contentChecksum,
  encodeTar,
  sha256Bytes,
} from '@/lib/server/classroom-archive-format'

export const V2_ARCHIVE_ID = '71000000-0000-4000-8000-000000000001'
export const V2_CLASSROOM_ID = '71000000-0000-4000-8000-000000000002'
export const V2_TEACHER_ID = '71000000-0000-4000-8000-000000000003'
export const V2_STUDENT_ID = '71000000-0000-4000-8000-000000000004'

type JsonObject = Record<string, unknown>

function encodeRows(rows: JsonObject[], primaryKey: readonly string[]): Buffer {
  if (rows.length === 0) return Buffer.alloc(0)
  const ordered = [...rows].sort((left, right) => {
    const leftKey = canonicalJsonStringify(primaryKey.map((column) => left[column]))
    const rightKey = canonicalJsonStringify(primaryKey.map((column) => right[column]))
    return Buffer.compare(Buffer.from(leftKey), Buffer.from(rightKey))
  })
  return Buffer.from(`${ordered.map(canonicalJsonStringify).join('\n')}\n`, 'utf8')
}

export function buildClassroomArchiveV2Fixture(options: {
  resources?: Record<string, JsonObject[]>
  actors?: JsonObject[]
} = {}) {
  const resources = Object.fromEntries(
    CLASSROOM_ARCHIVE_V2_RESOURCES.map((resource) => [resource.table, [] as JsonObject[]]),
  )
  resources.classrooms = [{
    id: V2_CLASSROOM_ID,
    teacher_id: V2_TEACHER_ID,
    title: 'Archive v2 fixture',
  }]
  Object.assign(resources, options.resources)
  const actors = options.actors || [
    {
      id: V2_TEACHER_ID,
      email: 'teacher@example.test',
      role: 'teacher',
      profile: null,
    },
    {
      id: V2_STUDENT_ID,
      email: 'student@example.test',
      role: 'student',
      profile: null,
    },
  ]
  const entries: Array<{ path: string; bytes: Buffer }> = []
  const descriptors = CLASSROOM_ARCHIVE_V2_RESOURCES.map((resource) => {
    const path = `data/${resource.table}.ndjson`
    const bytes = encodeRows(resources[resource.table] || [], resource.primary_key)
    entries.push({ path, bytes })
    return {
      table: resource.table,
      path,
      row_count: resources[resource.table]?.length || 0,
      byte_size: bytes.byteLength,
      sha256: sha256Bytes(bytes),
    }
  })
  const actorBytes = encodeRows(actors, ['id'])
  const actorDescriptor = {
    path: 'actors.ndjson',
    row_count: actors.length,
    byte_size: actorBytes.byteLength,
    sha256: sha256Bytes(actorBytes),
  }
  entries.push({ path: actorDescriptor.path, bytes: actorBytes })
  const manifest = {
    format: 'pika.classroom-archive',
    version: 2,
    archive_id: V2_ARCHIVE_ID,
    classroom_id: V2_CLASSROOM_ID,
    teacher_id: V2_TEACHER_ID,
    created_at: '2026-07-23T12:00:00.000Z',
    source: {
      schema_migration: '082_verified_classroom_archive_exports',
      app_commit: 'abcdef1',
    },
    compression: 'tar+gzip',
    privacy_policy_version: 1,
    retention: { mode: 'teacher_managed', delete_after: null },
    content_sha256: contentChecksum([...descriptors, actorDescriptor]),
    resources: descriptors,
    actors: actorDescriptor,
    storage_objects: [],
  }
  const manifestBytes = Buffer.from(`${canonicalJsonStringify(manifest)}\n`, 'utf8')
  const archive = gzipSync(encodeTar([
    { path: 'manifest.json', bytes: manifestBytes },
    ...entries.sort((left, right) =>
      Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)),
    ),
  ]), { level: 9 })

  return { archive, manifest, resources, actors }
}
