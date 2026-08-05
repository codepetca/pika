import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ManagedStorageError,
  queueManagedStorageCleanupBestEffort,
  reserveManagedStorageUpload,
  verifyManagedStorageUpload,
} from '@/lib/server/managed-storage'
import { runManagedStorageCleanup } from '@/lib/server/managed-storage-cleanup'

const OBJECT_ID = '10000000-0000-4000-8000-000000000001'
const CLASSROOM_ID = '10000000-0000-4000-8000-000000000002'
const USER_ID = '10000000-0000-4000-8000-000000000003'

describe('managed storage protocol helpers', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('supports the pre-117 compatibility window only when explicitly allowed', async () => {
    const supabase = {
      rpc: vi.fn(async () => ({
        data: null,
        error: { code: 'PGRST202', message: 'begin_managed_storage_upload is missing' },
      })),
    }
    await expect(reserveManagedStorageUpload({
      supabase,
      objectId: OBJECT_ID,
      bucket: 'submission-images',
      path: 'classrooms/example.png',
      classroomId: CLASSROOM_ID,
      purpose: 'student_inline_image',
      createdByUserId: USER_ID,
      allowLegacyCompatibility: true,
    })).resolves.toBeNull()
    await expect(reserveManagedStorageUpload({
      supabase,
      objectId: OBJECT_ID,
      bucket: 'submission-images',
      path: 'classrooms/example.png',
      classroomId: CLASSROOM_ID,
      purpose: 'student_inline_image',
      createdByUserId: USER_ID,
    })).rejects.toMatchObject<Partial<ManagedStorageError>>({
      code: 'managed_storage_migration_required',
    })
  })

  it('keeps reserve and verify as separate durable transitions', async () => {
    const rpc = vi.fn(async (name: string) => ({
      data: {
        id: OBJECT_ID,
        storage_bucket: 'test-documents',
        storage_path: 'classrooms/test.pdf',
        status: name === 'begin_managed_storage_upload' ? 'reserved' : 'verified',
      },
      error: null,
    }))
    const reservation = await reserveManagedStorageUpload({
      supabase: { rpc },
      objectId: OBJECT_ID,
      bucket: 'test-documents',
      path: 'classrooms/test.pdf',
      classroomId: CLASSROOM_ID,
      purpose: 'teacher_test_material',
      createdByUserId: USER_ID,
    })
    expect(reservation?.status).toBe('reserved')
    expect((await verifyManagedStorageUpload({
      supabase: { rpc }, objectId: OBJECT_ID,
    })).status).toBe('verified')
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'begin_managed_storage_upload',
      'verify_managed_storage_upload',
    ])
  })

  it('leaves cleanup disabled by default and retries claimed failures durably', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_managed_storage_cleanup') {
        return {
          data: [{
            id: OBJECT_ID,
            storage_bucket: 'submission-images',
            storage_path: 'classrooms/interrupted.png',
            lease_token: '10000000-0000-4000-8000-000000000004',
          }],
          error: null,
        }
      }
      return { data: true, error: null }
    })
    const storage = {
      from: vi.fn(() => ({
        remove: vi.fn(async () => ({ data: null, error: { message: 'transient' } })),
      })),
    }
    await expect(runManagedStorageCleanup({ supabase: { rpc, storage } }))
      .resolves.toEqual({ claimed: 0, deleted: 0, failed: 0 })
    expect(rpc).not.toHaveBeenCalled()

    vi.stubEnv('MANAGED_STORAGE_CLEANUP_ENABLED', 'true')
    await expect(runManagedStorageCleanup({ supabase: { rpc, storage } }))
      .resolves.toEqual({ claimed: 1, deleted: 0, failed: 1 })
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'claim_managed_storage_cleanup',
      'fail_managed_storage_cleanup',
    ])
  })

  it('treats cleanup queuing as best effort while reservations remain durable', async () => {
    await expect(queueManagedStorageCleanupBestEffort({
      supabase: { rpc: vi.fn(async () => { throw new Error('network') }) },
      objectId: OBJECT_ID,
      errorCode: 'interrupted_upload',
    })).resolves.toBeUndefined()
  })
})
