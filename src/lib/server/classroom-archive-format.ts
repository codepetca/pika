import { createHash } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import {
  classroomArchiveManifestSchema,
  classroomArchiveActorSnapshotSchema,
  type ClassroomArchiveManifest,
} from '@/lib/contracts/classroom-artifacts'
import { CLASSROOM_RELATIONAL_RESOURCES } from '@/lib/contracts/classroom-data'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: true })
const TAR_BLOCK_SIZE = 512
const MAX_UNCOMPRESSED_ARCHIVE_BYTES = 512 * 1024 * 1024
const MANAGED_SOURCE_BUCKETS: ReadonlySet<ManagedSourceBucket> = new Set([
  'assignment-artifacts',
  'submission-images',
  'test-documents',
])
const EMBEDDED_CONTENT_BUCKETS: ReadonlySet<ManagedSourceBucket> = new Set([
  'submission-images',
])
const TEST_DOCUMENT_BUCKETS: ReadonlySet<ManagedSourceBucket> = new Set([
  'test-documents',
])
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi

type JsonObject = Record<string, unknown>
type ManagedSourceBucket = 'assignment-artifacts' | 'submission-images' | 'test-documents'

export type ClassroomStorageReference = {
  bucket: ManagedSourceBucket
  path: string
}

export type ClassroomArchiveStorageObject = {
  bucket: ManagedSourceBucket
  sourcePath: string
  contentType: string | null
  bytes: Uint8Array
}

type ArchiveRetention =
  | { mode: 'teacher_managed'; delete_after: null }
  | { mode: 'scheduled'; delete_after: string }

type BuildClassroomArchiveBundleInput = {
  archiveId: string
  classroomId: string
  teacherId: string
  createdAt: string
  source: {
    schemaMigration: string
    appCommit: string
  }
  retention: ArchiveRetention
  resources: Record<string, unknown[]>
  actors: unknown[]
  storageObjects: ClassroomArchiveStorageObject[]
}

export type BuiltClassroomArchiveBundle = {
  archive: Uint8Array
  artifactSha256: string
  uncompressedByteSize: number
  manifest: ClassroomArchiveManifest
}

export type VerifiedClassroomArchiveBundle =
  | {
      ok: true
      manifest: ClassroomArchiveManifest
      files: Map<string, Buffer>
    }
  | { ok: false; error: string }

export function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as JsonObject)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalizeJson(item)]),
  )
}

export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value))
}

export function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function canonicalPrimaryKey(row: unknown, columns: string[], table: string): string {
  if (!isJsonObject(row)) {
    throw new Error(`Classroom archive row for ${table} must be an object`)
  }

  const tuple = columns.map((column) => {
    const value = row[column]
    if (value === undefined || value === null) {
      throw new Error(`Classroom archive row for ${table} is missing primary key ${column}`)
    }
    return value
  })
  return canonicalJsonStringify(tuple)
}

function encodeNdjson(rows: unknown[], primaryKey: string[], table: string): Buffer {
  const orderedRows = [...rows].sort((left, right) =>
    canonicalPrimaryKey(left, primaryKey, table).localeCompare(
      canonicalPrimaryKey(right, primaryKey, table),
    ),
  )
  if (orderedRows.length === 0) return Buffer.alloc(0)
  return Buffer.from(`${orderedRows.map(canonicalJsonStringify).join('\n')}\n`, 'utf8')
}

function encodeActors(actors: unknown[]): Buffer {
  const parsedActors = actors.map((actor) => classroomArchiveActorSnapshotSchema.parse(actor))
  const orderedActors = [...parsedActors].sort((left, right) => {
    const leftId = isJsonObject(left) && typeof left.id === 'string' ? left.id : ''
    const rightId = isJsonObject(right) && typeof right.id === 'string' ? right.id : ''
    if (!leftId || !rightId) throw new Error('Classroom archive actors require an id')
    return leftId.localeCompare(rightId)
  })
  if (orderedActors.length === 0) return Buffer.alloc(0)
  return Buffer.from(`${orderedActors.map(canonicalJsonStringify).join('\n')}\n`, 'utf8')
}

function isCanonicalRelativePath(value: string): boolean {
  const segments = value.split('/')
  return (
    value.length > 0 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  )
}

function normalizeRelativePath(value: string): string | null {
  const trimmed = value.trim().replace(/^\/+/, '')
  return isCanonicalRelativePath(trimmed) ? trimmed : null
}

function archiveObjectPath(bucket: ManagedSourceBucket, sourcePath: string): string {
  const sourceHash = createHash('sha256').update(`${bucket}\0${sourcePath}`).digest('hex')
  return `objects/${bucket}/${sourceHash}`
}

function contentChecksum(
  files: Array<{ path: string; byte_size: number; sha256: string }>,
): string {
  const canonicalDescriptors = [...files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => ({
      path: file.path,
      byte_size: file.byte_size,
      sha256: file.sha256,
    }))
  return createHash('sha256')
    .update(canonicalJsonStringify(canonicalDescriptors))
    .digest('hex')
}

function writeTarString(target: Uint8Array, offset: number, length: number, value: string) {
  const encoded = textEncoder.encode(value)
  if (encoded.length > length) throw new Error(`Tar field exceeds ${length} bytes`)
  target.set(encoded, offset)
}

function writeTarOctal(target: Uint8Array, offset: number, length: number, value: number) {
  const octal = Math.max(0, value).toString(8)
  if (octal.length > length - 1) throw new Error('Tar numeric field is too large')
  writeTarString(target, offset, length - 1, octal.padStart(length - 1, '0'))
  target[offset + length - 1] = 0
}

function splitTarPath(path: string): { name: string; prefix: string } {
  if (textEncoder.encode(path).length <= 100) return { name: path, prefix: '' }

  for (let index = path.lastIndexOf('/'); index > 0; index = path.lastIndexOf('/', index - 1)) {
    const prefix = path.slice(0, index)
    const name = path.slice(index + 1)
    if (textEncoder.encode(prefix).length <= 155 && textEncoder.encode(name).length <= 100) {
      return { name, prefix }
    }
  }
  throw new Error(`Archive path is too long for ustar: ${path}`)
}

function buildTarHeader(path: string, size: number): Uint8Array {
  if (!isCanonicalRelativePath(path)) throw new Error(`Invalid archive path: ${path}`)
  const { name, prefix } = splitTarPath(path)
  const header = new Uint8Array(TAR_BLOCK_SIZE)
  writeTarString(header, 0, 100, name)
  writeTarOctal(header, 100, 8, 0o600)
  writeTarOctal(header, 108, 8, 0)
  writeTarOctal(header, 116, 8, 0)
  writeTarOctal(header, 124, 12, size)
  writeTarOctal(header, 136, 12, 0)
  header.fill(32, 148, 156)
  header[156] = '0'.charCodeAt(0)
  writeTarString(header, 257, 6, 'ustar')
  writeTarString(header, 263, 2, '00')
  if (prefix) writeTarString(header, 345, 155, prefix)

  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  writeTarString(header, 148, 6, checksum.toString(8).padStart(6, '0'))
  header[154] = 0
  header[155] = 32
  return header
}

function encodeTar(entries: Array<{ path: string; bytes: Uint8Array }>): Buffer {
  const seen = new Set<string>()
  const parts: Uint8Array[] = []

  for (const entry of entries) {
    if (seen.has(entry.path)) throw new Error(`Duplicate archive path: ${entry.path}`)
    seen.add(entry.path)
    parts.push(buildTarHeader(entry.path, entry.bytes.byteLength))
    parts.push(entry.bytes)
    const padding = (TAR_BLOCK_SIZE - (entry.bytes.byteLength % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE
    if (padding > 0) parts.push(new Uint8Array(padding))
  }
  parts.push(new Uint8Array(TAR_BLOCK_SIZE * 2))
  return Buffer.concat(parts.map((part) => Buffer.from(part)))
}

function parseTarString(source: Uint8Array, offset: number, length: number): string {
  const raw = source.slice(offset, offset + length)
  const end = raw.findIndex((byte) => byte === 0)
  return textDecoder.decode(end >= 0 ? raw.slice(0, end) : raw).trim()
}

function parseTarOctal(source: Uint8Array, offset: number, length: number): number {
  const raw = parseTarString(source, offset, length).replace(/\0/g, '').trim()
  if (!raw) return 0
  if (!/^[0-7]+$/.test(raw)) throw new Error('Invalid tar numeric field')
  return Number.parseInt(raw, 8)
}

function parseTar(input: Uint8Array): Map<string, Buffer> {
  const files = new Map<string, Buffer>()
  let offset = 0

  while (offset + TAR_BLOCK_SIZE <= input.byteLength) {
    const header = input.slice(offset, offset + TAR_BLOCK_SIZE)
    if (header.every((byte) => byte === 0)) break

    const expectedChecksum = parseTarOctal(header, 148, 8)
    const checksumHeader = Uint8Array.from(header)
    checksumHeader.fill(32, 148, 156)
    const actualChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0)
    if (actualChecksum !== expectedChecksum) throw new Error('Invalid tar header checksum')

    const type = header[156]
    if (type !== 0 && type !== '0'.charCodeAt(0)) throw new Error('Unsupported tar entry type')
    const name = parseTarString(header, 0, 100)
    const prefix = parseTarString(header, 345, 155)
    const path = prefix ? `${prefix}/${name}` : name
    if (!isCanonicalRelativePath(path)) throw new Error('Invalid tar entry path')
    if (files.has(path)) throw new Error('Duplicate tar entry path')

    const size = parseTarOctal(header, 124, 12)
    const contentStart = offset + TAR_BLOCK_SIZE
    const contentEnd = contentStart + size
    if (contentEnd > input.byteLength) throw new Error('Truncated tar entry')
    files.set(path, Buffer.from(input.slice(contentStart, contentEnd)))
    offset = contentStart + Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE
  }
  return files
}

function countAndValidateNdjson(bytes: Buffer, validate?: (value: unknown) => void): number {
  if (bytes.byteLength === 0) return 0
  const text = textDecoder.decode(bytes)
  if (!text.endsWith('\n')) throw new Error('NDJSON resource must end with a newline')
  const lines = text.slice(0, -1).split('\n')
  for (const line of lines) {
    const value = JSON.parse(line)
    validate?.(value)
  }
  return lines.length
}

export function buildClassroomArchiveBundle(
  input: BuildClassroomArchiveBundleInput,
): BuiltClassroomArchiveBundle {
  const expectedTables = new Set(CLASSROOM_RELATIONAL_RESOURCES.map((resource) => resource.table))
  for (const table of expectedTables) {
    if (!Array.isArray(input.resources[table])) {
      throw new Error(`Missing classroom archive resource: ${table}`)
    }
  }
  for (const table of Object.keys(input.resources)) {
    if (!expectedTables.has(table)) throw new Error(`Unexpected classroom archive resource: ${table}`)
  }

  const entries: Array<{ path: string; bytes: Uint8Array }> = []
  const resources = CLASSROOM_RELATIONAL_RESOURCES.map((resource) => {
    const path = `data/${resource.table}.ndjson`
    const bytes = encodeNdjson(
      input.resources[resource.table] || [],
      resource.primary_key,
      resource.table,
    )
    entries.push({ path, bytes })
    return {
      table: resource.table,
      path,
      row_count: input.resources[resource.table]?.length || 0,
      byte_size: bytes.byteLength,
      sha256: sha256Bytes(bytes),
    }
  })

  const actorBytes = encodeActors(input.actors)
  const actors = {
    path: 'actors.ndjson',
    row_count: input.actors.length,
    byte_size: actorBytes.byteLength,
    sha256: sha256Bytes(actorBytes),
  }
  entries.push({ path: actors.path, bytes: actorBytes })

  const storageObjects = [...input.storageObjects]
    .sort((left, right) => `${left.bucket}/${left.sourcePath}`.localeCompare(`${right.bucket}/${right.sourcePath}`))
    .map((object) => {
      const sourcePath = normalizeRelativePath(object.sourcePath)
      if (!sourcePath) throw new Error(`Invalid source storage path: ${object.sourcePath}`)
      const archivePath = archiveObjectPath(object.bucket, sourcePath)
      entries.push({ path: archivePath, bytes: object.bytes })
      return {
        bucket: object.bucket,
        source_path: sourcePath,
        archive_path: archivePath,
        byte_size: object.bytes.byteLength,
        sha256: sha256Bytes(object.bytes),
        content_type: object.contentType || null,
      }
    })

  const duplicateStoragePaths = new Set<string>()
  for (const object of storageObjects) {
    const key = `${object.bucket}/${object.source_path}`
    if (duplicateStoragePaths.has(key)) throw new Error(`Duplicate source storage object: ${key}`)
    duplicateStoragePaths.add(key)
  }

  const manifest = classroomArchiveManifestSchema.parse({
    format: 'pika.classroom-archive',
    version: 1,
    archive_id: input.archiveId,
    classroom_id: input.classroomId,
    teacher_id: input.teacherId,
    created_at: input.createdAt,
    source: {
      schema_migration: input.source.schemaMigration,
      app_commit: input.source.appCommit,
    },
    compression: 'tar+gzip',
    privacy_policy_version: 1,
    retention: input.retention,
    content_sha256: contentChecksum([
      ...resources,
      actors,
      ...storageObjects.map((object) => ({
        path: object.archive_path,
        byte_size: object.byte_size,
        sha256: object.sha256,
      })),
    ]),
    resources,
    actors,
    storage_objects: storageObjects,
  })

  const manifestBytes = Buffer.from(`${canonicalJsonStringify(manifest)}\n`, 'utf8')
  const tar = encodeTar([
    { path: 'manifest.json', bytes: manifestBytes },
    ...entries.sort((left, right) => left.path.localeCompare(right.path)),
  ])
  const archive = gzipSync(tar, { level: 9 })
  return {
    archive,
    artifactSha256: sha256Bytes(archive),
    uncompressedByteSize: tar.byteLength,
    manifest,
  }
}

export function verifyClassroomArchiveBundle(
  input: Uint8Array,
  options: { compressed?: boolean } = {},
): VerifiedClassroomArchiveBundle {
  try {
    const tar = options.compressed === false
      ? Buffer.from(input)
      : gunzipSync(input, { maxOutputLength: MAX_UNCOMPRESSED_ARCHIVE_BYTES })
    const files = parseTar(tar)
    const manifestBytes = files.get('manifest.json')
    if (!manifestBytes) return { ok: false, error: 'Archive manifest is missing' }

    const manifest = classroomArchiveManifestSchema.parse(
      JSON.parse(textDecoder.decode(manifestBytes)),
    )
    const expectedPaths = new Set<string>([
      'manifest.json',
      ...manifest.resources.map((resource) => resource.path),
      manifest.actors.path,
      ...manifest.storage_objects.map((object) => object.archive_path),
    ])
    if (files.size !== expectedPaths.size || [...files.keys()].some((path) => !expectedPaths.has(path))) {
      return { ok: false, error: 'Archive contains unexpected or duplicate files' }
    }

    for (const resource of manifest.resources) {
      const bytes = files.get(resource.path)
      if (!bytes) return { ok: false, error: 'Archive resource is missing' }
      if (bytes.byteLength !== resource.byte_size) {
        return { ok: false, error: 'Archive resource byte count mismatch' }
      }
      if (sha256Bytes(bytes) !== resource.sha256) {
        return { ok: false, error: 'Archive resource checksum mismatch' }
      }
      if (countAndValidateNdjson(bytes) !== resource.row_count) {
        return { ok: false, error: 'Archive resource row count mismatch' }
      }
    }

    const actorBytes = files.get(manifest.actors.path)
    if (!actorBytes) return { ok: false, error: 'Actor snapshots are missing' }
    if (actorBytes.byteLength !== manifest.actors.byte_size) {
      return { ok: false, error: 'Actor snapshot byte count mismatch' }
    }
    if (sha256Bytes(actorBytes) !== manifest.actors.sha256) {
      return { ok: false, error: 'Actor snapshot checksum mismatch' }
    }
    if (countAndValidateNdjson(
      actorBytes,
      (actor) => classroomArchiveActorSnapshotSchema.parse(actor),
    ) !== manifest.actors.row_count) {
      return { ok: false, error: 'Actor snapshot row count mismatch' }
    }

    for (const object of manifest.storage_objects) {
      const bytes = files.get(object.archive_path)
      if (!bytes) return { ok: false, error: 'Storage object is missing' }
      if (bytes.byteLength !== object.byte_size) {
        return { ok: false, error: 'Storage object byte count mismatch' }
      }
      if (sha256Bytes(bytes) !== object.sha256) {
        return { ok: false, error: 'Storage object checksum mismatch' }
      }
    }

    const actualContentChecksum = contentChecksum([
      ...manifest.resources,
      manifest.actors,
      ...manifest.storage_objects.map((object) => ({
        path: object.archive_path,
        byte_size: object.byte_size,
        sha256: object.sha256,
      })),
    ])
    if (actualContentChecksum !== manifest.content_sha256) {
      return { ok: false, error: 'Archive content checksum mismatch' }
    }
    return { ok: true, manifest, files }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Invalid classroom archive',
    }
  }
}

function parseManagedStorageUrl(
  candidate: string,
  supabaseOrigin: string,
  allowedBuckets: ReadonlySet<ManagedSourceBucket>,
): ClassroomStorageReference | null {
  try {
    const url = new URL(candidate.replace(/[),.;:!?]+$/, ''))
    if (url.origin !== supabaseOrigin) return null
    const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/)
    if (!match) return null
    const bucket = decodeURIComponent(match[1])
    const managedBucket = bucket as ManagedSourceBucket
    if (!MANAGED_SOURCE_BUCKETS.has(managedBucket) || !allowedBuckets.has(managedBucket)) {
      return null
    }
    const path = normalizeRelativePath(decodeURIComponent(match[2]))
    if (!path) return null
    return { bucket: managedBucket, path }
  } catch {
    return null
  }
}

function collectManagedUrls(
  value: unknown,
  supabaseOrigin: string,
  push: (reference: ClassroomStorageReference) => void,
  allowedBuckets: ReadonlySet<ManagedSourceBucket>,
  allowTestSnapshotPaths: boolean,
  key?: string,
) {
  if (typeof value === 'string') {
    if (allowTestSnapshotPaths && key === 'snapshot_path') {
      const path = normalizeRelativePath(value)
      if (path) push({ bucket: 'test-documents', path })
    }
    for (const candidate of value.match(URL_PATTERN) || []) {
      const reference = parseManagedStorageUrl(candidate, supabaseOrigin, allowedBuckets)
      if (reference) push(reference)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectManagedUrls(item, supabaseOrigin, push, allowedBuckets, allowTestSnapshotPaths)
    }
    return
  }
  if (isJsonObject(value)) {
    for (const [childKey, item] of Object.entries(value)) {
      collectManagedUrls(
        item,
        supabaseOrigin,
        push,
        allowedBuckets,
        allowTestSnapshotPaths,
        childKey,
      )
    }
  }
}

export function discoverClassroomStorageReferences(
  resources: Record<string, unknown[]>,
  supabaseUrl: string,
): ClassroomStorageReference[] {
  const origin = new URL(supabaseUrl).origin
  const references = new Map<string, ClassroomStorageReference>()
  const push = (reference: ClassroomStorageReference) => {
    references.set(`${reference.bucket}\0${reference.path}`, reference)
  }

  for (const row of resources.assignment_submission_artifacts || []) {
    if (!isJsonObject(row) || typeof row.storage_path !== 'string') continue
    const path = normalizeRelativePath(row.storage_path)
    if (path) push({ bucket: 'assignment-artifacts', path })
  }
  for (const [table, rows] of Object.entries(resources)) {
    for (const row of rows) {
      if (table === 'tests' && isJsonObject(row)) {
        const { documents: _documents, ...testWithoutDocuments } = row
        collectManagedUrls(
          testWithoutDocuments,
          origin,
          push,
          EMBEDDED_CONTENT_BUCKETS,
          false,
        )
      } else {
        collectManagedUrls(row, origin, push, EMBEDDED_CONTENT_BUCKETS, false)
      }
    }
  }
  for (const test of resources.tests || []) {
    if (!isJsonObject(test)) continue
    collectManagedUrls(test.documents, origin, push, TEST_DOCUMENT_BUCKETS, true)
  }

  return [...references.values()].sort((left, right) =>
    `${left.bucket}/${left.path}`.localeCompare(`${right.bucket}/${right.path}`),
  )
}
