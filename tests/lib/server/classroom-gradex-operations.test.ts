import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CLASSROOM_RELATIONAL_RESOURCES, GRADEX_RESOURCE_TABLES } from '@/lib/contracts/classroom-data'
import {
  buildClassroomArchiveBundle,
} from '@/lib/server/classroom-archive-format'
import {
  CLASSROOM_GRADEX_EXTRACT_BUCKET,
  createClassroomGradexExtract,
  isClassroomGradexExtractAllowed,
  isClassroomGradexTriggerAllowed,
  resolveClassroomGradexHmacSecret,
} from '@/lib/server/classroom-gradex-operations'
import { buildGradexExtractFromClassroomArchive } from '@/lib/server/classroom-gradex-extract'

const OPERATION_ID = '10000000-0000-4000-8000-000000000001'
const ARCHIVE_ID = '20000000-0000-4000-8000-000000000001'
const CLASSROOM_ID = '30000000-0000-4000-8000-000000000001'
const TEACHER_ID = '40000000-0000-4000-8000-000000000001'
const ARCHIVE_CREATED_AT = '2026-07-13T12:00:00.000Z'
const GENERATED_AT = '2026-07-14T12:00:00.000Z'
const DELETE_AFTER = '2026-08-13T12:00:00.000Z'
const HMAC_SECRET = 'test-only-classroom-gradex-hmac-secret-over-32-bytes'
const ARCHIVE_PATH = `${TEACHER_ID}/${CLASSROOM_ID}/${ARCHIVE_ID}/classroom-v1.tar.gz`
const EXTRACT_PATH = `${TEACHER_ID}/${CLASSROOM_ID}/${OPERATION_ID}/gradex-v2.tar.gz`

function sourceArchive() {
  const resources = Object.fromEntries(
    CLASSROOM_RELATIONAL_RESOURCES.map((resource) => [resource.table, [] as unknown[]]),
  )
  resources.classrooms = [{
    id: CLASSROOM_ID,
    teacher_id: TEACHER_ID,
    title: 'Coordinator fixture',
    archived_at: ARCHIVE_CREATED_AT,
  }]
  return buildClassroomArchiveBundle({
    archiveId: ARCHIVE_ID,
    classroomId: CLASSROOM_ID,
    teacherId: TEACHER_ID,
    createdAt: ARCHIVE_CREATED_AT,
    source: {
      schemaMigration: '082_verified_classroom_archive_exports',
      appCommit: 'deadbee',
    },
    retention: { mode: 'teacher_managed', delete_after: null },
    resources,
    actors: [{
      id: TEACHER_ID,
      email: 'teacher@example.test',
      role: 'teacher',
      profile: null,
    }],
    storageObjects: [],
  })
}

function verificationEvidence() {
  return {
    source_archive_checksum_verified: true,
    source_archive_manifest_verified: true,
    resource_checksums_verified: true,
    resource_counts_verified: true,
    structured_privacy_verified: true,
    pseudonym_relationships_verified: true,
    storage_objects_excluded: true,
    read_back_verified: true,
    artifact_checksum_verified: true,
    direct_identifier_findings: 0,
    verified_at: GENERATED_AT,
  }
}

function createSupabaseMock(options: {
  beginError?: { code?: string; message?: string }
  completeError?: { code?: string; message?: string }
  completedReplay?: boolean
  completionFailure?: boolean
  corruptSource?: boolean
  corruptReadBack?: boolean
  finalizationMismatch?: boolean
  preloadExtract?: boolean
  removeThrows?: boolean
  wrongStoragePath?: boolean
} = {}) {
  const archive = sourceArchive()
  const expectedExtract = buildGradexExtractFromClassroomArchive({
    archive: archive.archive,
    extractId: OPERATION_ID,
    generatedAt: GENERATED_AT,
    deleteAfter: DELETE_AFTER,
    hmacSecret: HMAC_SECRET,
  })
  const stored = new Map<string, Uint8Array>([[
    `classroom-archives/${ARCHIVE_PATH}`,
    options.corruptSource ? Uint8Array.of(1, 2, 3) : archive.archive,
  ]])
  if (options.preloadExtract) {
    stored.set(`${CLASSROOM_GRADEX_EXTRACT_BUCKET}/${EXTRACT_PATH}`, expectedExtract.extract)
  }
  const removed: string[] = []
  const calls: string[] = []

  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push(`rpc:${name}`)
    if (name === 'begin_classroom_gradex_extract') {
      if (options.beginError) return { data: null, error: options.beginError }
      if (options.completedReplay) {
        return {
          data: {
            ok: true,
            status: 200,
            operation_id: OPERATION_ID,
            extract_id: OPERATION_ID,
            operation_status: 'completed',
            replayed: true,
            source_archive_id: ARCHIVE_ID,
            storage_bucket: CLASSROOM_GRADEX_EXTRACT_BUCKET,
            storage_path: EXTRACT_PATH,
            artifact_sha256: expectedExtract.artifactSha256,
            content_sha256: expectedExtract.manifest.content_sha256,
            compressed_byte_size: expectedExtract.extract.byteLength,
            uncompressed_byte_size: expectedExtract.uncompressedByteSize,
            resource_counts: Object.fromEntries(
              expectedExtract.manifest.resources.map((resource) => [resource.table, resource.row_count]),
            ),
            verification: verificationEvidence(),
            generated_at: GENERATED_AT,
            delete_after: DELETE_AFTER,
          },
          error: null,
        }
      }
      return {
        data: {
          ok: true,
          status: 202,
          operation_id: OPERATION_ID,
          extract_id: OPERATION_ID,
          operation_status: 'snapshot_ready',
          replayed: false,
          source_archive_id: ARCHIVE_ID,
          source_archive_sha256: archive.artifactSha256,
          storage_bucket: CLASSROOM_GRADEX_EXTRACT_BUCKET,
          storage_path: options.wrongStoragePath ? 'wrong/path.tar.gz' : EXTRACT_PATH,
          generated_at: GENERATED_AT,
          snapshot_expires_at: '2026-07-15T12:00:00.000Z',
          delete_after: DELETE_AFTER,
        },
        error: null,
      }
    }
    if (name === 'complete_classroom_gradex_extract') {
      if (options.completeError) return { data: null, error: options.completeError }
      if (options.completionFailure) {
        return {
          data: {
            ok: false,
            status: 409,
            operation_id: OPERATION_ID,
            error_code: 'gradex_finalization_conflict',
            error: 'Gradex extract was already finalized with different artifact metadata',
            retryable: false,
          },
          error: null,
        }
      }
      return {
        data: {
          ok: true,
          status: 201,
          operation_id: OPERATION_ID,
          extract_id: OPERATION_ID,
          operation_status: 'completed',
          replayed: false,
          source_archive_id: ARCHIVE_ID,
          storage_bucket: CLASSROOM_GRADEX_EXTRACT_BUCKET,
          storage_path: EXTRACT_PATH,
          artifact_sha256: options.finalizationMismatch ? '9'.repeat(64) : args.p_artifact_sha256,
          content_sha256: args.p_content_sha256,
          compressed_byte_size: args.p_compressed_byte_size,
          uncompressed_byte_size: args.p_uncompressed_byte_size,
          resource_counts: args.p_resource_counts,
          verification: args.p_verification,
          generated_at: GENERATED_AT,
          delete_after: DELETE_AFTER,
        },
        error: null,
      }
    }
    return { data: true, error: null }
  })

  const single = vi.fn(async () => ({
    data: {
      id: ARCHIVE_ID,
      classroom_id: CLASSROOM_ID,
      teacher_id: TEACHER_ID,
      format: 'pika.classroom-archive',
      format_version: 1,
      storage_bucket: 'classroom-archives',
      storage_path: ARCHIVE_PATH,
      artifact_sha256: archive.artifactSha256,
    },
    error: null,
  }))
  const from = vi.fn(() => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      single,
    }
    return query
  })

  const storageFrom = vi.fn((bucket: string) => ({
    download: vi.fn(async (path: string) => {
      calls.push(`download:${bucket}/${path}`)
      const bytes = stored.get(`${bucket}/${path}`)
      if (!bytes) return { data: null, error: { message: 'not found' } }
      const output = options.corruptReadBack && bucket === CLASSROOM_GRADEX_EXTRACT_BUCKET
        ? Uint8Array.of(9, 9, 9)
        : bytes
      return {
        data: {
          type: 'application/gzip',
          arrayBuffer: async () => output.buffer.slice(
            output.byteOffset,
            output.byteOffset + output.byteLength,
          ),
        },
        error: null,
      }
    }),
    upload: vi.fn(async (path: string, bytes: Uint8Array) => {
      calls.push(`upload:${bucket}/${path}`)
      stored.set(`${bucket}/${path}`, Uint8Array.from(bytes))
      return { data: { path }, error: null }
    }),
    remove: vi.fn(async (paths: string[]) => {
      calls.push(`remove:${bucket}`)
      if (options.removeThrows) throw new Error('storage unavailable')
      for (const path of paths) {
        stored.delete(`${bucket}/${path}`)
        removed.push(`${bucket}/${path}`)
      }
      return { data: paths, error: null }
    }),
  }))

  return {
    client: { rpc, from, storage: { from: storageFrom } } as any,
    calls,
    from,
    removed,
    rpc,
    storageFrom,
    stored,
  }
}

function operationArgs(mock: ReturnType<typeof createSupabaseMock>) {
  return {
    supabase: mock.client,
    operationId: OPERATION_ID,
    teacherId: TEACHER_ID,
    classroomId: CLASSROOM_ID,
    sourceArchiveId: ARCHIVE_ID,
    deleteAfter: DELETE_AFTER,
  }
}

describe('classroom Gradex runtime coordinator', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubEnv('CLASSROOM_GRADEX_EXTRACT_ENABLED', 'true')
    vi.stubEnv('CLASSROOM_GRADEX_EXTRACT_TEACHER_IDS', TEACHER_ID)
    vi.stubEnv('CLASSROOM_GRADEX_EXTRACT_HMAC_SECRET', HMAC_SECRET)
  })

  it('requires an explicit enable flag, exact teacher allowlist, and strong HMAC secret', () => {
    vi.stubEnv('CLASSROOM_GRADEX_EXTRACT_ENABLED', 'false')
    expect(isClassroomGradexExtractAllowed(TEACHER_ID)).toBe(false)
    vi.stubEnv('CLASSROOM_GRADEX_EXTRACT_ENABLED', 'true')
    vi.stubEnv(
      'CLASSROOM_GRADEX_EXTRACT_TEACHER_IDS',
      `50000000-0000-4000-8000-000000000001, ${TEACHER_ID}`,
    )
    vi.stubEnv('CLASSROOM_GRADEX_EXTRACT_HMAC_SECRET', HMAC_SECRET)
    expect(isClassroomGradexExtractAllowed(TEACHER_ID)).toBe(true)
    expect(resolveClassroomGradexHmacSecret()).toBe(HMAC_SECRET)

    vi.stubEnv('CLASSROOM_GRADEX_EXTRACT_HMAC_SECRET', 'too-short')
    expect(() => resolveClassroomGradexHmacSecret()).toThrow('at least 32 bytes')
  })

  it('requires a separate trigger flag and exact source archive allowlist', () => {
    vi.stubEnv('CLASSROOM_GRADEX_TRIGGER_ENABLED', 'false')
    vi.stubEnv('CLASSROOM_GRADEX_TRIGGER_ARCHIVE_IDS', ARCHIVE_ID)
    expect(isClassroomGradexTriggerAllowed(ARCHIVE_ID)).toBe(false)

    vi.stubEnv('CLASSROOM_GRADEX_TRIGGER_ENABLED', 'true')
    vi.stubEnv(
      'CLASSROOM_GRADEX_TRIGGER_ARCHIVE_IDS',
      `50000000-0000-4000-8000-000000000001, ${ARCHIVE_ID}`,
    )
    expect(isClassroomGradexTriggerAllowed(ARCHIVE_ID)).toBe(true)
    expect(isClassroomGradexTriggerAllowed('60000000-0000-4000-8000-000000000001')).toBe(false)
  })

  it('does not start an operation when the coordinator gate is disabled', async () => {
    vi.stubEnv('CLASSROOM_GRADEX_EXTRACT_ENABLED', 'false')
    const mock = createSupabaseMock()
    const result = await createClassroomGradexExtract(operationArgs(mock))

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'classroom_gradex_extract_not_enabled',
    }))
    expect(mock.rpc).not.toHaveBeenCalled()
    expect(mock.storageFrom).not.toHaveBeenCalled()
  })

  it('does not start an operation when the server HMAC secret is unavailable', async () => {
    vi.stubEnv('CLASSROOM_GRADEX_EXTRACT_HMAC_SECRET', 'short')
    const mock = createSupabaseMock()
    const result = await createClassroomGradexExtract(operationArgs(mock))

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'classroom_gradex_configuration_unavailable',
    }))
    expect(mock.rpc).not.toHaveBeenCalled()
    expect(mock.storageFrom).not.toHaveBeenCalled()
  })

  it('verifies the source, uploads privately, reads back, verifies, and only then finalizes', async () => {
    const mock = createSupabaseMock()
    const result = await createClassroomGradexExtract(operationArgs(mock))

    if (!result.ok) throw new Error(result.error)
    expect(result.ok).toBe(true)
    expect(result.resource_counts).toEqual(
      Object.fromEntries(GRADEX_RESOURCE_TABLES.map((table) => [table, 0])),
    )
    expect(result.verification).toEqual(expect.objectContaining({
      read_back_verified: true,
      structured_privacy_verified: true,
      direct_identifier_findings: 0,
    }))
    expect(mock.calls.indexOf(`download:${CLASSROOM_GRADEX_EXTRACT_BUCKET}/${EXTRACT_PATH}`))
      .toBeLessThan(mock.calls.indexOf('rpc:complete_classroom_gradex_extract'))
    expect(mock.stored.has(`${CLASSROOM_GRADEX_EXTRACT_BUCKET}/${EXTRACT_PATH}`)).toBe(true)
    expect(mock.rpc).toHaveBeenCalledWith(
      'complete_classroom_gradex_extract',
      expect.objectContaining({
        p_resource_counts: Object.fromEntries(GRADEX_RESOURCE_TABLES.map((table) => [table, 0])),
        p_verification: expect.objectContaining({ read_back_verified: true }),
      }),
    )
  })

  it('returns a completed replay without reading archive or storage data', async () => {
    const mock = createSupabaseMock({ completedReplay: true })
    const result = await createClassroomGradexExtract(operationArgs(mock))

    expect(result).toEqual(expect.objectContaining({ ok: true, replayed: true }))
    expect(mock.from).not.toHaveBeenCalled()
    expect(mock.storageFrom).not.toHaveBeenCalled()
    expect(mock.rpc.mock.calls.map(([name]) => name)).toEqual([
      'begin_classroom_gradex_extract',
    ])
  })

  it('rejects a structurally valid RPC response bound to the wrong storage path', async () => {
    const mock = createSupabaseMock({ wrongStoragePath: true })
    const result = await createClassroomGradexExtract(operationArgs(mock))

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'gradex_rpc_contract_invalid',
      retryable: false,
    }))
    expect(mock.storageFrom).not.toHaveBeenCalled()
  })

  it('binds idempotency to the HMAC key without sending the secret', async () => {
    const first = createSupabaseMock()
    const second = createSupabaseMock()
    const rotatedSecret = 'rotated-test-only-classroom-gradex-hmac-secret-over-32-bytes'

    await createClassroomGradexExtract(operationArgs(first))
    vi.stubEnv('CLASSROOM_GRADEX_EXTRACT_HMAC_SECRET', rotatedSecret)
    await createClassroomGradexExtract(operationArgs(second))

    const firstRequest = first.rpc.mock.calls[0][1].p_request_sha256
    const secondRequest = second.rpc.mock.calls[0][1].p_request_sha256
    expect(firstRequest).toMatch(/^[a-f0-9]{64}$/)
    expect(secondRequest).toMatch(/^[a-f0-9]{64}$/)
    expect(secondRequest).not.toBe(firstRequest)
    expect(JSON.stringify(first.rpc.mock.calls)).not.toContain(HMAC_SECRET)
    expect(JSON.stringify(second.rpc.mock.calls)).not.toContain(rotatedSecret)
  })

  it('reuses a checksum-matching private object without overwriting it', async () => {
    const mock = createSupabaseMock({ preloadExtract: true })
    const result = await createClassroomGradexExtract(operationArgs(mock))

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    expect(mock.calls.some((call) => call.startsWith('upload:'))).toBe(false)
    expect(mock.rpc.mock.calls.map(([name]) => name)).toContain(
      'complete_classroom_gradex_extract',
    )
  })

  it('fails closed before upload when source archive bytes do not match immutable metadata', async () => {
    const mock = createSupabaseMock({ corruptSource: true })
    const result = await createClassroomGradexExtract(operationArgs(mock))

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'gradex_source_archive_checksum_mismatch',
      retryable: false,
    }))
    expect(mock.calls.some((call) => call.startsWith('upload:'))).toBe(false)
    expect(mock.rpc.mock.calls.map(([name]) => name)).toEqual([
      'begin_classroom_gradex_extract',
      'fail_classroom_gradex_extract',
    ])
  })

  it('never finalizes and removes its upload when private read-back bytes differ', async () => {
    const mock = createSupabaseMock({ corruptReadBack: true })
    const result = await createClassroomGradexExtract(operationArgs(mock))

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'gradex_storage_checksum_mismatch',
      retryable: false,
    }))
    expect(mock.rpc.mock.calls.map(([name]) => name)).not.toContain(
      'complete_classroom_gradex_extract',
    )
    expect(mock.removed).toEqual([
      `${CLASSROOM_GRADEX_EXTRACT_BUCKET}/${EXTRACT_PATH}`,
    ])
  })

  it('removes a newly uploaded object when finalization rejects it terminally', async () => {
    const mock = createSupabaseMock({ completionFailure: true })
    const result = await createClassroomGradexExtract(operationArgs(mock))

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'gradex_finalization_conflict',
      retryable: false,
    }))
    expect(mock.removed).toEqual([
      `${CLASSROOM_GRADEX_EXTRACT_BUCKET}/${EXTRACT_PATH}`,
    ])
  })

  it('retains the verified object when committed finalization metadata is inconsistent', async () => {
    const mock = createSupabaseMock({ finalizationMismatch: true })
    const result = await createClassroomGradexExtract(operationArgs(mock))

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'gradex_finalization_contract_mismatch',
      retryable: false,
    }))
    expect(mock.removed).toEqual([])
    expect(mock.stored.has(`${CLASSROOM_GRADEX_EXTRACT_BUCKET}/${EXTRACT_PATH}`)).toBe(true)
  })

  it('preserves the terminal result when orphan cleanup itself fails', async () => {
    const mock = createSupabaseMock({ completionFailure: true, removeThrows: true })
    const result = await createClassroomGradexExtract(operationArgs(mock))

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'gradex_finalization_conflict',
      retryable: false,
    }))
    expect(mock.stored.has(`${CLASSROOM_GRADEX_EXTRACT_BUCKET}/${EXTRACT_PATH}`)).toBe(true)
    expect(console.warn).toHaveBeenCalledWith(
      '[classroom-gradex-cleanup]',
      expect.stringContaining('gradex_orphan_cleanup_failed'),
    )
  })

  it('retains a read-back-verified object when finalization fails transiently', async () => {
    const mock = createSupabaseMock({ completeError: { message: 'temporary database outage' } })
    const result = await createClassroomGradexExtract(operationArgs(mock))

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'gradex_finalize_failed',
      retryable: true,
    }))
    expect(mock.removed).toEqual([])
    expect(mock.stored.has(`${CLASSROOM_GRADEX_EXTRACT_BUCKET}/${EXTRACT_PATH}`)).toBe(true)
  })

  it('maps an unavailable operation RPC to a migration-required failure', async () => {
    const mock = createSupabaseMock({
      beginError: { code: 'PGRST202', message: 'missing function' },
    })
    const result = await createClassroomGradexExtract(operationArgs(mock))

    expect(result).toEqual({
      ok: false,
      status: 503,
      operation_id: OPERATION_ID,
      error_code: 'classroom_gradex_migration_required',
      error: 'Classroom Gradex extracts require migration 084',
      retryable: true,
    })
  })
})
