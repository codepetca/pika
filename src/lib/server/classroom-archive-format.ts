import { createHash } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import {
  CLASSROOM_ARCHIVE_CONTRACTS,
  CLASSROOM_ARCHIVE_CURRENT_EXPORT_VERSION,
  classroomArchiveActorSnapshotSchema,
  classroomArchiveManifestV1Schema,
  parseClassroomArchiveManifest,
  type ClassroomArchiveManifest,
  type ClassroomArchiveManifestV1,
} from '@/lib/contracts/classroom-artifacts'
import {
  canonicalizeJson,
  canonicalJsonStringify,
  compareCanonicalStrings,
  sha256Bytes,
} from '@/lib/server/classroom-archive-canonical'
import { validateRetiredAssessmentEnvelopeGraph } from '@/lib/server/classroom-retired-assessment-contract'

export {
  canonicalizeJson,
  canonicalJsonStringify,
  sha256Bytes,
} from '@/lib/server/classroom-archive-canonical'

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

// The original v1 writer used host-locale ordering; verification retains that recovery adapter.
function compareLegacyV1Strings(left: string, right: string): number {
  return left.localeCompare(right)
}

export type BuiltClassroomArchiveBundle = {
  archive: Uint8Array
  artifactSha256: string
  uncompressedByteSize: number
  manifest: ClassroomArchiveManifestV1
}

export type VerifiedClassroomArchiveBundle =
  | {
      ok: true
      manifest: ClassroomArchiveManifest
      files: Map<string, Buffer>
    }
  | { ok: false; error: string }

export type DecodedClassroomArchiveData = {
  resources: Record<string, Record<string, unknown>[]>
  actors: Array<ReturnType<typeof classroomArchiveActorSnapshotSchema.parse>>
}

function legacyV1CanonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(legacyV1CanonicalizeJson)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as JsonObject)
      .sort(([left], [right]) => compareLegacyV1Strings(left, right))
      .map(([key, item]) => [key, legacyV1CanonicalizeJson(item)]),
  )
}

function legacyV1CanonicalJsonStringify(value: unknown): string {
  return JSON.stringify(legacyV1CanonicalizeJson(value))
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function canonicalPrimaryKey(
  row: unknown,
  columns: readonly string[],
  table: string,
): string {
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

function encodeNdjson(rows: unknown[], primaryKey: readonly string[], table: string): Buffer {
  const orderedRows = [...rows].sort((left, right) =>
    compareCanonicalStrings(
      canonicalPrimaryKey(left, primaryKey, table),
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
    return compareCanonicalStrings(leftId, rightId)
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

function contentChecksumWith(
  files: Array<{ path: string; byte_size: number; sha256: string }>,
  compare: (left: string, right: string) => number,
  stringify: (value: unknown) => string,
): string {
  const canonicalDescriptors = [...files]
    .sort((left, right) => compare(left.path, right.path))
    .map((file) => ({
      path: file.path,
      byte_size: file.byte_size,
      sha256: file.sha256,
    }))
  return createHash('sha256')
    .update(stringify(canonicalDescriptors))
    .digest('hex')
}

export function contentChecksum(
  files: Array<{ path: string; byte_size: number; sha256: string }>,
): string {
  return contentChecksumWith(files, compareCanonicalStrings, canonicalJsonStringify)
}

function legacyV1ContentChecksum(
  files: Array<{ path: string; byte_size: number; sha256: string }>,
): string {
  return contentChecksumWith(
    files,
    compareLegacyV1Strings,
    legacyV1CanonicalJsonStringify,
  )
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

export function encodeTar(entries: Array<{ path: string; bytes: Uint8Array }>): Buffer {
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

export function parseTar(input: Uint8Array): Map<string, Buffer> {
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

export function parseAndValidateNdjson(
  bytes: Buffer,
  validate?: (value: unknown) => void,
  options: { allowLegacyV1Canonicalization?: boolean } = {},
): unknown[] {
  if (bytes.byteLength === 0) return []
  const text = textDecoder.decode(bytes)
  if (!text.endsWith('\n')) throw new Error('NDJSON resource must end with a newline')
  const lines = text.slice(0, -1).split('\n')
  return lines.map((line) => {
    const value = JSON.parse(line)
    const canonical = canonicalJsonStringify(value) === line
    const legacyV1Canonical = options.allowLegacyV1Canonicalization === true &&
      legacyV1CanonicalJsonStringify(value) === line
    if (!canonical && !legacyV1Canonical) {
      throw new Error('NDJSON resource is not canonically serialized')
    }
    validate?.(value)
    return value
  })
}

function countAndValidateNdjson(
  bytes: Buffer,
  validate: ((value: unknown) => void) | undefined,
  allowLegacyV1Canonicalization: boolean,
): number {
  return parseAndValidateNdjson(bytes, validate, {
    allowLegacyV1Canonicalization,
  }).length
}

export function buildClassroomArchiveBundle(
  input: BuildClassroomArchiveBundleInput,
): BuiltClassroomArchiveBundle {
  const contract = CLASSROOM_ARCHIVE_CONTRACTS[CLASSROOM_ARCHIVE_CURRENT_EXPORT_VERSION]
  const expectedTables = new Set<string>(
    contract.resources.map((resource) => resource.table),
  )
  for (const table of expectedTables) {
    if (!Array.isArray(input.resources[table])) {
      throw new Error(`Missing classroom archive resource: ${table}`)
    }
  }
  for (const table of Object.keys(input.resources)) {
    if (!expectedTables.has(table)) throw new Error(`Unexpected classroom archive resource: ${table}`)
  }

  const entries: Array<{ path: string; bytes: Uint8Array }> = []
  const resources = contract.resources.map((resource) => {
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
    .sort((left, right) => compareCanonicalStrings(
      `${left.bucket}/${left.sourcePath}`,
      `${right.bucket}/${right.sourcePath}`,
    ))
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

  const manifest = classroomArchiveManifestV1Schema.parse({
    format: 'pika.classroom-archive',
    version: CLASSROOM_ARCHIVE_CURRENT_EXPORT_VERSION,
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
    ...entries.sort((left, right) => compareCanonicalStrings(left.path, right.path)),
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

    const manifest = parseClassroomArchiveManifest(
      JSON.parse(textDecoder.decode(manifestBytes)),
    )
    const allowLegacyV1Canonicalization = manifest.version === 1
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
      if (
        countAndValidateNdjson(
          bytes,
          undefined,
          allowLegacyV1Canonicalization,
        ) !== resource.row_count
      ) {
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
      allowLegacyV1Canonicalization,
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

    const contentDescriptors = [
      ...manifest.resources,
      manifest.actors,
      ...manifest.storage_objects.map((object) => ({
        path: object.archive_path,
        byte_size: object.byte_size,
        sha256: object.sha256,
      })),
    ]
    const contentChecksumMatches =
      contentChecksum(contentDescriptors) === manifest.content_sha256 ||
      (
        manifest.version === 1 &&
        legacyV1ContentChecksum(contentDescriptors) === manifest.content_sha256
      )
    if (!contentChecksumMatches) {
      return { ok: false, error: 'Archive content checksum mismatch' }
    }
    const verified = { ok: true as const, manifest, files }
    const decoded = decodeClassroomArchiveData(verified)
    if (manifest.version === 2) {
      validateRetiredAssessmentEnvelopeGraph({
        classroomId: manifest.classroom_id,
        records: decoded.resources.classroom_retired_assessment_records || [],
        recordActors:
          decoded.resources.classroom_retired_assessment_record_actors || [],
        archiveActorIds: decoded.actors.map((actor) => actor.id),
      })
    }
    return verified
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Invalid classroom archive',
    }
  }
}

export function decodeClassroomArchiveData(
  verified: Extract<VerifiedClassroomArchiveBundle, { ok: true }>,
): DecodedClassroomArchiveData {
  const resources: Record<string, Record<string, unknown>[]> = {}
  const contract = CLASSROOM_ARCHIVE_CONTRACTS[verified.manifest.version]
  const allowLegacyV1Canonicalization = verified.manifest.version === 1

  for (const resource of contract.resources) {
    const descriptor = verified.manifest.resources.find((item) => item.table === resource.table)
    const bytes = descriptor ? verified.files.get(descriptor.path) : undefined
    if (!descriptor || !bytes) throw new Error(`Archive resource is missing: ${resource.table}`)
    const rows = parseAndValidateNdjson(bytes, undefined, {
      allowLegacyV1Canonicalization,
    })
    const parsedRows = rows.map((row) => {
      if (!isJsonObject(row)) {
        throw new Error(`Classroom archive row for ${resource.table} must be an object`)
      }
      return row
    })
    const keys = parsedRows.map((row) =>
      canonicalPrimaryKey(row, resource.primary_key, resource.table),
    )
    if (new Set(keys).size !== keys.length) {
      throw new Error(`Classroom archive resource has duplicate primary keys: ${resource.table}`)
    }
    const currentOrderValid = keys.every((key, index) => (
      index === 0 || compareCanonicalStrings(keys[index - 1], key) < 0
    ))
    const legacyOrderValid = keys.every((key, index) => (
      index === 0 || compareLegacyV1Strings(keys[index - 1], key) < 0
    ))
    if (
      !currentOrderValid &&
      !(allowLegacyV1Canonicalization && legacyOrderValid)
    ) {
      throw new Error(`Classroom archive resource is not in primary-key order: ${resource.table}`)
    }
    resources[resource.table] = parsedRows
  }

  const actorBytes = verified.files.get(verified.manifest.actors.path)
  if (!actorBytes) throw new Error('Actor snapshots are missing')
  const actors = parseAndValidateNdjson(
    actorBytes,
    (value) => classroomArchiveActorSnapshotSchema.parse(value),
    { allowLegacyV1Canonicalization },
  ).map((value) => classroomArchiveActorSnapshotSchema.parse(value))
  const actorIds = actors.map((actor) => actor.id)
  if (new Set(actorIds).size !== actorIds.length) {
    throw new Error('Classroom archive has duplicate actor snapshots')
  }
  const currentActorOrderValid = actorIds.every((id, index) => (
    index === 0 || compareCanonicalStrings(actorIds[index - 1], id) < 0
  ))
  const legacyActorOrderValid = actorIds.every((id, index) => (
    index === 0 || compareLegacyV1Strings(actorIds[index - 1], id) < 0
  ))
  if (
    !currentActorOrderValid &&
    !(allowLegacyV1Canonicalization && legacyActorOrderValid)
  ) {
    throw new Error('Classroom archive actor snapshots are not in actor-id order')
  }

  return { resources, actors }
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

  return [...references.values()].sort((left, right) => compareCanonicalStrings(
    `${left.bucket}/${left.path}`,
    `${right.bucket}/${right.path}`,
  ))
}
