import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runClassroomArchiveObjectCleanup } from '@/lib/server/classroom-archive-object-cleanup'

const OPERATION_ID = '00000000-0000-4000-8000-000000000001'
const LEASE_TOKEN = '00000000-0000-4000-8000-000000000002'
const STORAGE_PATH = `restores/00000000-0000-4000-8000-000000000003/${OPERATION_ID}/${'a'.repeat(64)}-${'b'.repeat(64)}`

function createMock(options: { renew?: boolean; storagePath?: string } = {}) {
  const remove = vi.fn(async () => ({ data: [], error: null }))
  const download = vi.fn(async () => ({
    data: null,
    error: { code: 'NoSuchKey', status: 404 },
  }))
  const rpc = vi.fn(async (name: string) => {
    if (name === 'claim_due_classroom_archive_object_upload_cleanup') {
      return {
        data: [{
          operation_id: OPERATION_ID,
          storage_bucket: 'assignment-artifacts',
          storage_path: options.storagePath ?? STORAGE_PATH,
          attempt_count: 1,
        }],
        error: null,
      }
    }
    if (name === 'renew_classroom_archive_object_upload_cleanup_lease') {
      return { data: options.renew !== false, error: null }
    }
    return { data: true, error: null }
  })
  return {
    client: {
      rpc,
      storage: {
        from: vi.fn(() => ({ remove, download })),
        getBucket: vi.fn(async () => ({
          data: { id: 'assignment-artifacts' },
          error: null,
        })),
      },
    } as any,
    rpc,
    remove,
    download,
  }
}

describe('classroom archive object cleanup', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubEnv('CLASSROOM_ARCHIVE_OBJECT_CLEANUP_ENABLED', 'true')
  })

  it('deletes and verifies an exact leased orphan before completing its ledger row', async () => {
    const mock = createMock()
    const result = await runClassroomArchiveObjectCleanup({
      supabase: mock.client,
      leaseToken: LEASE_TOKEN,
    })

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      claimed: 1,
      deleted: 1,
      failed: 0,
    }))
    expect(mock.remove).toHaveBeenCalledWith([STORAGE_PATH])
    expect(mock.rpc.mock.calls.map(([name]) => name)).toEqual([
      'claim_due_classroom_archive_object_upload_cleanup',
      'renew_classroom_archive_object_upload_cleanup_lease',
      'complete_classroom_archive_object_upload_cleanup',
    ])
    expect(JSON.stringify(result)).not.toContain(STORAGE_PATH)
  })

  it('does not touch storage after losing the database lease', async () => {
    const mock = createMock({ renew: false })
    const result = await runClassroomArchiveObjectCleanup({
      supabase: mock.client,
      leaseToken: LEASE_TOKEN,
    })

    expect(result).toEqual(expect.objectContaining({ ok: true, deleted: 0, failed: 1 }))
    expect(mock.remove).not.toHaveBeenCalled()
    expect(mock.download).not.toHaveBeenCalled()
  })

  it('rejects a claimed path that is not bound to the operation', async () => {
    const mock = createMock({ storagePath: 'unscoped/object' })
    const result = await runClassroomArchiveObjectCleanup({
      supabase: mock.client,
      leaseToken: LEASE_TOKEN,
    })

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'archive_object_cleanup_claim_contract_invalid',
    }))
    expect(mock.remove).not.toHaveBeenCalled()
  })
})
