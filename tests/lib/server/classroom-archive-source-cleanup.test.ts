import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLASSROOM_ARCHIVE_SOURCE_CLEANUP_MAX_CLAIMS,
  isClassroomArchiveSourceCleanupEnabled,
  isClassroomArchiveSourceCleanupTriggerEnabled,
  resolveClassroomArchiveSourceCleanupLeaseToken,
  resolveClassroomArchiveSourceCleanupOperationId,
  runClassroomArchiveSourceCleanup,
} from '@/lib/server/classroom-archive-source-cleanup'

const LEASE_TOKEN = '10000000-0000-4000-8000-000000000001'
const OPERATION_ID = '20000000-0000-4000-8000-000000000001'
const ARCHIVE_ID = '30000000-0000-4000-8000-000000000001'
const CLASSROOM_ID = '40000000-0000-4000-8000-000000000001'
const PATH = 'teacher/classroom/submission.txt'
const PATH_TWO = 'teacher/classroom/submission-two.txt'
const SOURCE_BYTES = Buffer.from('verified source bytes')
const SOURCE_SHA256 = createHash('sha256').update(SOURCE_BYTES).digest('hex')

type Claim = {
  operation_id: string
  archive_id: string
  classroom_id: string
  storage_bucket: string
  storage_path: string
  expected_sha256: string
  expected_byte_size: number
  attempt_count: number
}

function claim(
  operationId = OPERATION_ID,
  path = PATH,
  overrides: Partial<Claim> = {},
): Claim {
  return {
    operation_id: operationId,
    archive_id: ARCHIVE_ID,
    classroom_id: CLASSROOM_ID,
    storage_bucket: 'assignment-artifacts',
    storage_path: path,
    expected_sha256: SOURCE_SHA256,
    expected_byte_size: SOURCE_BYTES.byteLength,
    attempt_count: 1,
    ...overrides,
  }
}

function createSupabaseMock(options: {
  claims?: Claim[]
  claimError?: { code?: string; message?: string }
  verificationError?: { code?: string; message?: string }
  verificationResult?: Record<string, unknown>
  completeResult?: boolean
  failResult?: boolean
  renewResult?: boolean
  initiallyMissing?: string[]
  objectBytes?: Record<string, Uint8Array>
  removeErrorPaths?: string[]
  retainedPaths?: string[]
  readErrorPaths?: string[]
  noSuchBucketPaths?: string[]
  useLocalNotFoundShape?: boolean
  bucketLookupError?: boolean
  existenceProbeErrorPaths?: string[]
  unwrappedBadRequestPaths?: string[]
} = {}) {
  const claims = options.claims ?? [claim()]
  const calls: string[] = []
  const objects = new Map<string, Uint8Array>()
  for (const item of claims) {
    objects.set(item.storage_path, options.objectBytes?.[item.storage_path] ?? SOURCE_BYTES)
  }
  for (const path of options.initiallyMissing ?? []) objects.delete(path)

  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push(`rpc:${name}`)
    if (name === 'verify_and_reserve_classroom_archive_source_objects') {
      return options.verificationError
        ? { data: null, error: options.verificationError }
        : {
            data: options.verificationResult ?? {
              ok: true,
              status: 200,
              operation_id: OPERATION_ID,
              verified: claims.length,
              preserved: 0,
              replayed: false,
            },
            error: null,
          }
    }
    if (name === 'get_classroom_archive_source_object_presence') {
      const path = String(args.p_storage_path)
      if (options.existenceProbeErrorPaths?.includes(path)) {
        return { data: null, error: { status: 503, message: 'Presence lookup failed' } }
      }
      return {
        data: {
          bucket_exists: !(options.bucketLookupError || options.noSuchBucketPaths?.includes(path)),
          object_exists: objects.has(path),
        },
        error: null,
      }
    }
    if (name === 'claim_due_classroom_archive_source_object_cleanup_v2') {
      return options.claimError
        ? { data: null, error: options.claimError }
        : { data: claims, error: null }
    }
    if (name === 'complete_classroom_archive_source_object_cleanup') {
      return { data: options.completeResult ?? true, error: null }
    }
    if (name === 'renew_classroom_archive_source_object_cleanup_lease') {
      return { data: options.renewResult ?? true, error: null }
    }
    if (name === 'fail_classroom_archive_source_object_cleanup') {
      return { data: options.failResult ?? true, error: null }
    }
    throw new Error(`Unexpected RPC: ${name} ${JSON.stringify(args)}`)
  })

  const download = vi.fn(async (path: string) => {
    calls.push(`download:${path}`)
    if (options.noSuchBucketPaths?.includes(path)) {
      return {
        data: null,
        error: { status: 404, statusCode: 'NoSuchBucket', message: 'Bucket missing' },
      }
    }
    if (options.readErrorPaths?.includes(path)) {
      return {
        data: null,
        error: { status: 503, statusCode: 'SlowDown', message: 'Try again' },
      }
    }
    if (options.unwrappedBadRequestPaths?.includes(path)) {
      return {
        data: null,
        error: { status: 400, statusCode: '400', message: 'Bad request' },
      }
    }
    const bytes = objects.get(path)
    if (bytes) {
      return {
        data: {
          arrayBuffer: async () => Uint8Array.from(bytes).buffer,
        } as Blob,
        error: null,
      }
    }
    return {
      data: null,
      error: options.useLocalNotFoundShape
        ? {
            name: 'StorageUnknownError',
            message: 'Object not found',
            originalError: { status: 400, statusText: 'Bad Request' },
          }
        : { status: 404, statusCode: 'NoSuchKey', message: 'Object missing' },
    }
  })

  const remove = vi.fn(async (paths: string[]) => {
    const path = paths[0]
    calls.push(`remove:${path}`)
    if (!options.retainedPaths?.includes(path)) objects.delete(path)
    if (options.removeErrorPaths?.includes(path)) {
      return { data: null, error: { status: 503, statusCode: 'SlowDown' } }
    }
    return { data: [{ name: path }], error: null }
  })
  const exists = vi.fn(async (path: string) => {
    if (options.existenceProbeErrorPaths?.includes(path)) {
      throw new Error('Existence probe failed')
    }
    return {
      data: objects.has(path),
      error: objects.has(path) ? null : { name: 'StorageUnknownError' },
    }
  })
  const storageFrom = vi.fn(() => ({ download, exists, remove }))
  const getBucket = vi.fn(async () => options.bucketLookupError || options.noSuchBucketPaths?.length
    ? { data: null, error: { status: 404, statusCode: 'NoSuchBucket' } }
    : { data: { id: 'assignment-artifacts' }, error: null })

  return {
    calls,
    client: { rpc, storage: { from: storageFrom, getBucket } } as any,
    download,
    exists,
    getBucket,
    objects,
    remove,
    rpc,
    storageFrom,
  }
}

function run(
  mock: ReturnType<typeof createSupabaseMock>,
  overrides: { limit?: number; leaseSeconds?: number } = {},
) {
  return runClassroomArchiveSourceCleanup({
    supabase: mock.client,
    leaseToken: LEASE_TOKEN,
    operationId: OPERATION_ID,
    limit: overrides.limit,
    leaseSeconds: overrides.leaseSeconds,
  })
}

describe('classroom archive source-object cleanup', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('CLASSROOM_ARCHIVE_SOURCE_CLEANUP_ENABLED', 'true')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  it('requires an explicit server gate before claiming or touching storage', async () => {
    vi.stubEnv('CLASSROOM_ARCHIVE_SOURCE_CLEANUP_ENABLED', 'false')
    vi.stubEnv('CLASSROOM_ARCHIVE_SOURCE_CLEANUP_TRIGGER_ENABLED', 'false')
    const mock = createSupabaseMock()

    expect(isClassroomArchiveSourceCleanupEnabled()).toBe(false)
    expect(isClassroomArchiveSourceCleanupTriggerEnabled()).toBe(false)
    vi.stubEnv('CLASSROOM_ARCHIVE_SOURCE_CLEANUP_TRIGGER_ENABLED', ' TRUE ')
    expect(isClassroomArchiveSourceCleanupTriggerEnabled()).toBe(true)
    expect(resolveClassroomArchiveSourceCleanupLeaseToken(LEASE_TOKEN)).toBe(LEASE_TOKEN)
    expect(resolveClassroomArchiveSourceCleanupLeaseToken()).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    )
    expect(() => resolveClassroomArchiveSourceCleanupLeaseToken('not-a-uuid')).toThrow()
    expect(resolveClassroomArchiveSourceCleanupOperationId(OPERATION_ID)).toBe(OPERATION_ID)
    expect(() => resolveClassroomArchiveSourceCleanupOperationId('not-a-uuid')).toThrow()
    const result = await run(mock)

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'classroom_archive_source_cleanup_not_enabled',
    }))
    expect(mock.rpc).not.toHaveBeenCalled()
    expect(mock.storageFrom).not.toHaveBeenCalled()
  })

  it('verifies exact bytes before removal and authoritative absence before completion', async () => {
    const mock = createSupabaseMock()
    const result = await run(mock)

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      claimed: 1,
      deleted: 1,
      failed: 0,
    }))
    expect(mock.rpc).toHaveBeenNthCalledWith(
      1,
      'verify_and_reserve_classroom_archive_source_objects',
      {
        p_operation_id: OPERATION_ID,
        p_limit: CLASSROOM_ARCHIVE_SOURCE_CLEANUP_MAX_CLAIMS,
      },
    )
    expect(mock.rpc).toHaveBeenNthCalledWith(
      2,
      'claim_due_classroom_archive_source_object_cleanup_v2',
      {
        p_lease_token: LEASE_TOKEN,
        p_operation_id: OPERATION_ID,
        p_limit: CLASSROOM_ARCHIVE_SOURCE_CLEANUP_MAX_CLAIMS,
        p_lease_seconds: 300,
      },
    )
    expect(mock.calls).toEqual([
      'rpc:verify_and_reserve_classroom_archive_source_objects',
      'rpc:claim_due_classroom_archive_source_object_cleanup_v2',
      `download:${PATH}`,
      'rpc:renew_classroom_archive_source_object_cleanup_lease',
      `remove:${PATH}`,
      `download:${PATH}`,
      'rpc:complete_classroom_archive_source_object_cleanup',
    ])
    expect(mock.rpc).toHaveBeenLastCalledWith(
      'complete_classroom_archive_source_object_cleanup',
      {
        p_operation_id: OPERATION_ID,
        p_storage_bucket: 'assignment-artifacts',
        p_storage_path: PATH,
        p_lease_token: LEASE_TOKEN,
      },
    )
  })

  it('completes without removal when the exact object is already absent', async () => {
    const mock = createSupabaseMock({ initiallyMissing: [PATH] })
    const result = await run(mock)

    expect(result).toEqual(expect.objectContaining({ deleted: 1, failed: 0 }))
    expect(mock.remove).not.toHaveBeenCalled()
    expect(mock.rpc).toHaveBeenCalledWith(
      'complete_classroom_archive_source_object_cleanup',
      expect.objectContaining({ p_storage_path: PATH }),
    )
  })

  it('confirms wrapped Storage 400 absence with an exact database presence lookup', async () => {
    const mock = createSupabaseMock({ useLocalNotFoundShape: true })
    const result = await run(mock)

    expect(result).toEqual(expect.objectContaining({ deleted: 1, failed: 0 }))
    expect(mock.rpc).toHaveBeenCalledWith(
      'get_classroom_archive_source_object_presence',
      {
        p_storage_bucket: 'assignment-artifacts',
        p_storage_path: PATH,
      },
    )
  })

  it('does not trust a wrapped Storage 400 when the exact existence probe fails', async () => {
    const mock = createSupabaseMock({
      useLocalNotFoundShape: true,
      existenceProbeErrorPaths: [PATH],
    })
    const result = await run(mock)

    expect(result).toEqual(expect.objectContaining({ deleted: 0, failed: 1 }))
    expect(mock.rpc).toHaveBeenCalledWith(
      'fail_classroom_archive_source_object_cleanup',
      expect.objectContaining({ p_storage_path: PATH }),
    )
    expect(mock.rpc).not.toHaveBeenCalledWith(
      'complete_classroom_archive_source_object_cleanup',
      expect.anything(),
    )
  })

  it('does not treat an unwrapped generic 400 as object absence', async () => {
    const mock = createSupabaseMock({ unwrappedBadRequestPaths: [PATH] })
    const result = await run(mock)

    expect(result.ok && result.results[0]).toEqual(expect.objectContaining({
      status: 'failed',
      error_code: 'archive_source_object_read_failed',
    }))
    expect(mock.rpc).toHaveBeenCalledWith(
      'get_classroom_archive_source_object_presence',
      expect.objectContaining({ p_storage_path: PATH }),
    )
    expect(mock.rpc).not.toHaveBeenCalledWith(
      'complete_classroom_archive_source_object_cleanup',
      expect.anything(),
    )
  })

  it('does not treat a generic 404 as object absence when the bucket cannot be confirmed', async () => {
    const mock = createSupabaseMock({
      initiallyMissing: [PATH],
      useLocalNotFoundShape: true,
      bucketLookupError: true,
    })
    const result = await run(mock)

    expect(result.ok && result.results[0]).toEqual(expect.objectContaining({
      status: 'failed',
      error_code: 'archive_source_object_read_failed',
    }))
    expect(mock.rpc).not.toHaveBeenCalledWith(
      'complete_classroom_archive_source_object_cleanup',
      expect.anything(),
    )
  })

  it.each([
    ['byte count', Buffer.from('short'), 'archive_source_object_mismatch'],
    ['checksum', Buffer.from('verified source bytez'), 'archive_source_object_mismatch'],
  ])('does not remove an object with a mismatched %s', async (_label, bytes, errorCode) => {
    const mock = createSupabaseMock({ objectBytes: { [PATH]: bytes } })
    const result = await run(mock)

    expect(result.ok && result.results[0]).toEqual(expect.objectContaining({
      status: 'failed',
      error_code: errorCode,
      retry_recorded: true,
    }))
    expect(mock.remove).not.toHaveBeenCalled()
    expect(mock.rpc).not.toHaveBeenCalledWith(
      'complete_classroom_archive_source_object_cleanup',
      expect.anything(),
    )
  })

  it('does not confuse a missing bucket or uncertain read with object absence', async () => {
    for (const options of [
      { noSuchBucketPaths: [PATH] },
      { readErrorPaths: [PATH] },
    ]) {
      const mock = createSupabaseMock(options)
      const result = await run(mock)

      expect(result.ok && result.results[0]).toEqual(expect.objectContaining({
        status: 'failed',
        error_code: 'archive_source_object_read_failed',
      }))
      expect(mock.remove).not.toHaveBeenCalled()
    }
  })

  it('accepts authoritative absence even when removal returned an error', async () => {
    const mock = createSupabaseMock({ removeErrorPaths: [PATH] })
    const result = await run(mock)

    expect(result).toEqual(expect.objectContaining({ deleted: 1, failed: 0 }))
  })

  it('records a retry when read-back still finds the object', async () => {
    const mock = createSupabaseMock({ retainedPaths: [PATH] })
    const result = await run(mock)

    expect(result.ok && result.results[0]).toEqual(expect.objectContaining({
      status: 'failed',
      error_code: 'archive_source_object_delete_unconfirmed',
      retry_recorded: true,
    }))
    expect(mock.rpc).not.toHaveBeenCalledWith(
      'complete_classroom_archive_source_object_cleanup',
      expect.anything(),
    )
  })

  it('does not mutate the ledger after stale lease completion is rejected', async () => {
    const mock = createSupabaseMock({ completeResult: false })
    const result = await run(mock)

    expect(result.ok && result.results[0]).toEqual(expect.objectContaining({
      status: 'failed',
      error_code: 'archive_source_cleanup_completion_rejected',
      retry_recorded: false,
    }))
    expect(mock.rpc).not.toHaveBeenCalledWith(
      'fail_classroom_archive_source_object_cleanup',
      expect.anything(),
    )
  })

  it('does not remove an object when its lease cannot be renewed immediately before deletion', async () => {
    const mock = createSupabaseMock({ renewResult: false })
    const result = await run(mock)

    expect(result.ok && result.results[0]).toEqual(expect.objectContaining({
      status: 'failed',
      error_code: 'archive_source_cleanup_lease_renewal_failed',
      retry_recorded: true,
    }))
    expect(mock.remove).not.toHaveBeenCalled()
  })

  it('contains one failed object and continues independent claims', async () => {
    const mock = createSupabaseMock({
      claims: [claim(), claim(OPERATION_ID, PATH_TWO)],
      objectBytes: { [PATH]: Buffer.from('wrong') },
    })
    const result = await run(mock, { limit: 2 })

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      claimed: 2,
      deleted: 1,
      failed: 1,
    }))
    expect(mock.remove).toHaveBeenCalledWith([PATH_TWO])
  })

  it('rejects malformed, duplicate, and oversized claim contracts before storage', async () => {
    const malformed = createSupabaseMock({
      claims: [claim(OPERATION_ID, '../outside')],
    })
    const duplicate = createSupabaseMock({ claims: [claim(), claim()] })
    const oversized = createSupabaseMock({
      claims: [claim(), claim(OPERATION_ID, PATH_TWO)],
    })
    const unsupportedBucket = createSupabaseMock({
      claims: [claim(OPERATION_ID, PATH, { storage_bucket: 'submission-images' })],
    })

    for (const [mock, overrides] of [
      [malformed, {}],
      [duplicate, { limit: 2 }],
      [oversized, { limit: 1 }],
      [unsupportedBucket, {}],
    ] as const) {
      const result = await run(mock, overrides)
      expect(result).toEqual(expect.objectContaining({
        ok: false,
        error_code: 'archive_source_cleanup_claim_contract_invalid',
      }))
      expect(mock.storageFrom).not.toHaveBeenCalled()
    }
  })

  it('maps a missing ownership fence to migration 096 and validates runtime bounds', async () => {
    const mock = createSupabaseMock({
      verificationError: {
        code: 'PGRST202',
        message: 'verify_and_reserve_classroom_archive_source_objects was not found',
      },
    })
    const result = await run(mock)

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'classroom_archive_source_ownership_fence_migration_required',
      error: 'Classroom archive source cleanup requires migration 096',
    }))
    await expect(run(createSupabaseMock(), { limit: 0 })).rejects.toThrow()
    await expect(run(createSupabaseMock(), { leaseSeconds: 29 })).rejects.toThrow()
  })

  it('does not claim or touch storage when ownership verification rejects the operation', async () => {
    const mock = createSupabaseMock({
      verificationResult: {
        ok: false,
        status: 409,
        operation_id: OPERATION_ID,
        error_code: 'classroom_archive_source_object_still_referenced',
        error: 'Source path is still referenced',
      },
    })

    const result = await run(mock)

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      status: 409,
      error_code: 'classroom_archive_source_object_still_referenced',
      retryable: false,
    }))
    expect(mock.rpc).toHaveBeenCalledTimes(1)
    expect(mock.storageFrom).not.toHaveBeenCalled()
  })

  it('keeps paths, checksums, and classroom identity out of results and metrics', async () => {
    const mock = createSupabaseMock({ objectBytes: { [PATH]: Buffer.from('wrong') } })
    const result = await run(mock)
    const exposed = JSON.stringify({
      result,
      logs: vi.mocked(console.info).mock.calls,
    })

    expect(exposed).not.toContain(PATH)
    expect(exposed).not.toContain(SOURCE_SHA256)
    expect(exposed).not.toContain(CLASSROOM_ID)
    expect(result.ok && result.results[0]).toHaveProperty('object_ref')
  })
})
