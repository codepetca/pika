import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLASSROOM_GRADEX_CLEANUP_MAX_CLAIMS,
  isClassroomGradexCleanupEnabled,
  resolveClassroomGradexCleanupLeaseToken,
  runClassroomGradexCleanup,
} from '@/lib/server/classroom-gradex-cleanup'

const LEASE_TOKEN = '10000000-0000-4000-8000-000000000001'
const TEACHER_ID = '20000000-0000-4000-8000-000000000001'
const CLASSROOM_ID = '30000000-0000-4000-8000-000000000001'
const EXTRACT_ID = '40000000-0000-4000-8000-000000000001'
const EXTRACT_TWO_ID = '40000000-0000-4000-8000-000000000002'
const PATH = `${TEACHER_ID}/${CLASSROOM_ID}/${EXTRACT_ID}/gradex-v1.tar.gz`
const PATH_TWO = `${TEACHER_ID}/${CLASSROOM_ID}/${EXTRACT_TWO_ID}/gradex-v1.tar.gz`

type Claim = {
  extract_id: string
  storage_bucket: string
  storage_path: string
  attempt_count: number
}

function claim(extractId = EXTRACT_ID, path = PATH): Claim {
  return {
    extract_id: extractId,
    storage_bucket: 'gradex-analytics-extracts',
    storage_path: path,
    attempt_count: 1,
  }
}

function createSupabaseMock(options: {
  claims?: Claim[]
  claimError?: { code?: string; message?: string }
  completeResult?: boolean
  failResult?: boolean
  initiallyMissing?: string[]
  removeErrorPaths?: string[]
  removeThrowPaths?: string[]
  retainedPaths?: string[]
  verificationErrorPaths?: string[]
  verificationNoSuchBucketPaths?: string[]
  storageFromThrows?: boolean
} = {}) {
  const claims = options.claims ?? [claim()]
  const calls: string[] = []
  const present = new Set(claims.map((item) => item.storage_path))
  for (const path of options.initiallyMissing ?? []) present.delete(path)

  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push(`rpc:${name}`)
    if (name === 'claim_due_classroom_gradex_extract_cleanup') {
      return options.claimError
        ? { data: null, error: options.claimError }
        : { data: claims, error: null }
    }
    if (name === 'complete_classroom_gradex_extract_cleanup') {
      return { data: options.completeResult ?? true, error: null }
    }
    if (name === 'fail_classroom_gradex_extract_cleanup') {
      return { data: options.failResult ?? true, error: null }
    }
    throw new Error(`Unexpected RPC: ${name} ${JSON.stringify(args)}`)
  })

  const remove = vi.fn(async (paths: string[]) => {
    const path = paths[0]
    calls.push(`remove:${path}`)
    if (options.removeThrowPaths?.includes(path)) throw new Error('storage unavailable')
    if (options.removeErrorPaths?.includes(path)) {
      return { data: null, error: { status: 503, statusCode: 'SlowDown' } }
    }
    if (!options.retainedPaths?.includes(path)) present.delete(path)
    return { data: [{ name: path }], error: null }
  })
  const download = vi.fn(async (path: string) => {
    calls.push(`download:${path}`)
    if (options.verificationNoSuchBucketPaths?.includes(path)) {
      return {
        data: null,
        error: { status: 404, statusCode: 'NoSuchBucket', message: 'Bucket not found' },
      }
    }
    if (options.verificationErrorPaths?.includes(path)) {
      return {
        data: null,
        error: { status: 503, statusCode: 'SlowDown', message: 'Try again' },
      }
    }
    if (present.has(path)) return { data: new Blob(['still present']), error: null }
    return {
      data: null,
      error: { status: 404, statusCode: 'NoSuchKey', message: 'Object not found' },
    }
  })
  const storageFrom = vi.fn(() => {
    if (options.storageFromThrows) throw new Error('storage client unavailable')
    return { remove, download }
  })

  return {
    calls,
    client: { rpc, storage: { from: storageFrom } } as any,
    download,
    present,
    remove,
    rpc,
    storageFrom,
  }
}

function run(mock: ReturnType<typeof createSupabaseMock>, overrides: {
  leaseToken?: string
  limit?: number
  leaseSeconds?: number
} = {}) {
  return runClassroomGradexCleanup({
    supabase: mock.client,
    leaseToken: overrides.leaseToken ?? LEASE_TOKEN,
    limit: overrides.limit,
    leaseSeconds: overrides.leaseSeconds,
  })
}

describe('classroom Gradex cleanup coordinator', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('CLASSROOM_GRADEX_CLEANUP_ENABLED', 'true')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  it('requires an explicit server cleanup gate and valid lease token', async () => {
    vi.stubEnv('CLASSROOM_GRADEX_CLEANUP_ENABLED', 'false')
    const mock = createSupabaseMock()
    expect(isClassroomGradexCleanupEnabled()).toBe(false)
    expect(resolveClassroomGradexCleanupLeaseToken(LEASE_TOKEN)).toBe(LEASE_TOKEN)
    expect(() => resolveClassroomGradexCleanupLeaseToken('not-a-uuid')).toThrow()

    const result = await run(mock)
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'classroom_gradex_cleanup_not_enabled',
    }))
    expect(mock.rpc).not.toHaveBeenCalled()
    expect(mock.storageFrom).not.toHaveBeenCalled()
  })

  it('claims a bounded batch, removes each object, verifies absence, then completes the lease', async () => {
    const mock = createSupabaseMock()
    const result = await run(mock)

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      claimed: 1,
      deleted: 1,
      failed: 0,
      retry_recording_failed: 0,
    }))
    expect(mock.rpc).toHaveBeenNthCalledWith(1, 'claim_due_classroom_gradex_extract_cleanup', {
      p_lease_token: LEASE_TOKEN,
      p_limit: CLASSROOM_GRADEX_CLEANUP_MAX_CLAIMS,
      p_lease_seconds: 300,
    })
    expect(mock.calls).toEqual([
      'rpc:claim_due_classroom_gradex_extract_cleanup',
      `remove:${PATH}`,
      `download:${PATH}`,
      'rpc:complete_classroom_gradex_extract_cleanup',
    ])
    expect(mock.rpc).toHaveBeenLastCalledWith(
      'complete_classroom_gradex_extract_cleanup',
      { p_extract_id: EXTRACT_ID, p_lease_token: LEASE_TOKEN },
    )
    expect(result.ok && result.results[0]).not.toHaveProperty('storage_path')
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(PATH)
  })

  it('returns a successful no-op when no cleanup rows are due', async () => {
    const mock = createSupabaseMock({ claims: [] })
    const result = await run(mock)

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      claimed: 0,
      deleted: 0,
      failed: 0,
      results: [],
    }))
    expect(mock.storageFrom).not.toHaveBeenCalled()
  })

  it('completes idempotently when the object is already absent', async () => {
    const mock = createSupabaseMock({
      initiallyMissing: [PATH],
      removeErrorPaths: [PATH],
    })
    const result = await run(mock)

    expect(result).toEqual(expect.objectContaining({ deleted: 1, failed: 0 }))
    expect(mock.rpc).toHaveBeenCalledWith(
      'complete_classroom_gradex_extract_cleanup',
      { p_extract_id: EXTRACT_ID, p_lease_token: LEASE_TOKEN },
    )
  })

  it('records a retry when removal fails and the object remains present', async () => {
    const mock = createSupabaseMock({ removeErrorPaths: [PATH] })
    const result = await run(mock)

    expect(result).toEqual(expect.objectContaining({ deleted: 0, failed: 1 }))
    expect(result.ok && result.results[0]).toEqual(expect.objectContaining({
      status: 'failed',
      error_code: 'gradex_storage_delete_failed',
      retry_recorded: true,
    }))
    expect(mock.rpc).toHaveBeenCalledWith('fail_classroom_gradex_extract_cleanup', {
      p_extract_id: EXTRACT_ID,
      p_lease_token: LEASE_TOKEN,
      p_error_code: 'gradex_storage_delete_failed',
    })
    expect(mock.rpc).not.toHaveBeenCalledWith(
      'complete_classroom_gradex_extract_cleanup',
      expect.anything(),
    )
  })

  it('does not complete when Storage reports success but read-back still finds the object', async () => {
    const mock = createSupabaseMock({ retainedPaths: [PATH] })
    const result = await run(mock)

    expect(result.ok && result.results[0]).toEqual(expect.objectContaining({
      status: 'failed',
      error_code: 'gradex_storage_delete_unconfirmed',
    }))
    expect(mock.rpc).not.toHaveBeenCalledWith(
      'complete_classroom_gradex_extract_cleanup',
      expect.anything(),
    )
  })

  it('does not treat an unknown verification error as proof of absence', async () => {
    const mock = createSupabaseMock({ verificationErrorPaths: [PATH] })
    const result = await run(mock)

    expect(result.ok && result.results[0]).toEqual(expect.objectContaining({
      status: 'failed',
      error_code: 'gradex_storage_delete_verification_failed',
    }))
  })

  it('does not confuse a missing bucket with verified object absence', async () => {
    const mock = createSupabaseMock({ verificationNoSuchBucketPaths: [PATH] })
    const result = await run(mock)

    expect(result.ok && result.results[0]).toEqual(expect.objectContaining({
      status: 'failed',
      error_code: 'gradex_storage_delete_verification_failed',
    }))
    expect(mock.rpc).not.toHaveBeenCalledWith(
      'complete_classroom_gradex_extract_cleanup',
      expect.anything(),
    )
  })

  it('accepts authoritative NoSuchKey after an uncertain remove exception', async () => {
    const mock = createSupabaseMock({
      initiallyMissing: [PATH],
      removeThrowPaths: [PATH],
    })
    const result = await run(mock)

    expect(result).toEqual(expect.objectContaining({ deleted: 1, failed: 0 }))
  })

  it('does not mutate the ledger after a stale or rejected completion', async () => {
    const mock = createSupabaseMock({ completeResult: false })
    const result = await run(mock)

    expect(result.ok && result.results[0]).toEqual(expect.objectContaining({
      status: 'failed',
      error_code: 'gradex_cleanup_completion_rejected',
      retry_recorded: false,
    }))
    expect(mock.rpc).not.toHaveBeenCalledWith(
      'fail_classroom_gradex_extract_cleanup',
      expect.anything(),
    )
  })

  it('surfaces when failure evidence cannot be recorded and leaves completion untouched', async () => {
    const mock = createSupabaseMock({ removeErrorPaths: [PATH], failResult: false })
    const result = await run(mock)

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      failed: 1,
      retry_recording_failed: 1,
    }))
    expect(result.ok && result.results[0]).toEqual(expect.objectContaining({
      retry_recorded: false,
    }))
  })

  it('continues independent claims after one deletion fails', async () => {
    const mock = createSupabaseMock({
      claims: [claim(), claim(EXTRACT_TWO_ID, PATH_TWO)],
      removeErrorPaths: [PATH],
    })
    const result = await run(mock, { limit: 2 })

    expect(result).toEqual(expect.objectContaining({ claimed: 2, deleted: 1, failed: 1 }))
    expect(mock.present.has(PATH)).toBe(true)
    expect(mock.present.has(PATH_TWO)).toBe(false)
  })

  it('contains unexpected client exceptions to each claim', async () => {
    const mock = createSupabaseMock({
      claims: [claim(), claim(EXTRACT_TWO_ID, PATH_TWO)],
      storageFromThrows: true,
    })
    const result = await run(mock, { limit: 2 })

    expect(result).toEqual(expect.objectContaining({ claimed: 2, deleted: 0, failed: 2 }))
    expect(result.ok && result.results).toEqual([
      expect.objectContaining({
        extract_id: EXTRACT_ID,
        error_code: 'gradex_cleanup_unexpected_failure',
        retry_recorded: true,
      }),
      expect.objectContaining({
        extract_id: EXTRACT_TWO_ID,
        error_code: 'gradex_cleanup_unexpected_failure',
        retry_recorded: true,
      }),
    ])
  })

  it('rejects malformed, duplicate, or oversized claim results before storage access', async () => {
    const wrongPath = `${TEACHER_ID}/${CLASSROOM_ID}/${EXTRACT_TWO_ID}/gradex-v1.tar.gz`
    for (const claims of [
      [claim(EXTRACT_ID, wrongPath)],
      [claim(), claim(EXTRACT_ID, PATH)],
      [claim(), claim(EXTRACT_TWO_ID, PATH_TWO)],
    ]) {
      const mock = createSupabaseMock({ claims })
      const result = await run(mock, { limit: claims.length === 2 ? 1 : 10 })
      expect(result).toEqual(expect.objectContaining({
        ok: false,
        error_code: 'gradex_cleanup_claim_contract_invalid',
      }))
      expect(mock.storageFrom).not.toHaveBeenCalled()
    }
  })

  it('maps a missing claim RPC to the required migration without touching storage', async () => {
    const mock = createSupabaseMock({
      claimError: { code: 'PGRST202', message: 'claim_due_classroom_gradex_extract_cleanup missing' },
    })
    const result = await run(mock)

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'classroom_gradex_migration_required',
      retryable: true,
    }))
    expect(mock.storageFrom).not.toHaveBeenCalled()
  })

  it('validates runtime bounds before claiming work', async () => {
    const mock = createSupabaseMock()
    await expect(run(mock, { limit: CLASSROOM_GRADEX_CLEANUP_MAX_CLAIMS + 1 })).rejects.toThrow()
    await expect(run(mock, { leaseSeconds: 29 })).rejects.toThrow()
    expect(mock.rpc).not.toHaveBeenCalled()
  })
})
