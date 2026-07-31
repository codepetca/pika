import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runManagedStorageCleanup } from '@/lib/server/managed-storage-cleanup'

const OBJECT_ID = '10000000-0000-4000-8000-000000000001'
const LEASE_TOKEN = '20000000-0000-4000-8000-000000000002'
const NOW = '2026-07-31T12:00:00.000Z'

const claimedObject = {
  id: OBJECT_ID,
  storage_bucket: 'submission-images',
  storage_path: 'classrooms/class-1/students/student-1/image.png',
  classroom_id: '30000000-0000-4000-8000-000000000003',
  course_blueprint_id: null,
  purpose: 'student_inline_image',
  status: 'cleanup_processing',
  created_by_user_id: null,
  data_subject_user_id: null,
  resource_type: 'assignment_doc',
  resource_id: null,
  content_type: 'image/png',
  byte_size: 12,
  content_sha256: null,
  upload_expires_at: null,
  attempt_count: 1,
  next_attempt_at: NOW,
  lease_token: LEASE_TOKEN,
  lease_expires_at: '2026-07-31T12:02:00.000Z',
  last_error_code: null,
  created_at: NOW,
  ready_at: null,
  updated_at: NOW,
}

function createClient(options: {
  removalError?: { message: string } | null
  completion?: boolean
  failureRecorded?: boolean
} = {}) {
  const remove = vi.fn(async () => ({ error: options.removalError ?? null }))
  const rpc = vi.fn(async (name: string) => {
    if (name === 'claim_managed_storage_cleanup') {
      return { data: [claimedObject], error: null }
    }
    if (name === 'complete_managed_storage_cleanup') {
      return { data: options.completion ?? true, error: null }
    }
    if (name === 'fail_managed_storage_cleanup') {
      return { data: options.failureRecorded ?? true, error: null }
    }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  return {
    client: {
      rpc,
      storage: { from: vi.fn(() => ({ remove })) },
    },
    remove,
    rpc,
  }
}

describe('managed storage cleanup worker', () => {
  beforeEach(() => {
    process.env.MANAGED_STORAGE_CLEANUP_ENABLED = 'true'
  })

  afterEach(() => {
    delete process.env.MANAGED_STORAGE_CLEANUP_ENABLED
  })

  it('stays inert until the operator explicitly enables the worker', async () => {
    delete process.env.MANAGED_STORAGE_CLEANUP_ENABLED
    const rpc = vi.fn()

    await expect(runManagedStorageCleanup({ supabase: { rpc } })).resolves.toEqual({
      claimed: 0,
      deleted: 0,
      failed: 0,
      retry_recording_failed: 0,
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('deletes only the exact leased path and lets the database verify absence', async () => {
    const { client, remove, rpc } = createClient()

    await expect(runManagedStorageCleanup({
      supabase: client,
      limit: 1,
      leaseSeconds: 60,
    })).resolves.toEqual({
      claimed: 1,
      deleted: 1,
      failed: 0,
      retry_recording_failed: 0,
    })
    expect(remove).toHaveBeenCalledWith([claimedObject.storage_path])
    expect(rpc).toHaveBeenCalledWith(
      'complete_managed_storage_cleanup',
      expect.objectContaining({
        p_object_id: OBJECT_ID,
        p_lease_token: LEASE_TOKEN,
      }),
    )
  })

  it('records retry evidence after a storage failure without completing the lease', async () => {
    const { client, rpc } = createClient({ removalError: { message: 'storage unavailable' } })

    await expect(runManagedStorageCleanup({ supabase: client })).resolves.toEqual({
      claimed: 1,
      deleted: 0,
      failed: 1,
      retry_recording_failed: 0,
    })
    expect(rpc).not.toHaveBeenCalledWith(
      'complete_managed_storage_cleanup',
      expect.anything(),
    )
    expect(rpc).toHaveBeenCalledWith(
      'fail_managed_storage_cleanup',
      expect.objectContaining({ p_error_code: 'managed_storage_delete_failed' }),
    )
  })

  it('reports when even durable retry recording fails after an unverified completion', async () => {
    const { client, rpc } = createClient({ completion: false, failureRecorded: false })

    await expect(runManagedStorageCleanup({ supabase: client })).resolves.toEqual({
      claimed: 1,
      deleted: 0,
      failed: 0,
      retry_recording_failed: 1,
    })
    expect(rpc).toHaveBeenCalledWith(
      'fail_managed_storage_cleanup',
      expect.objectContaining({ p_error_code: 'managed_storage_absence_not_verified' }),
    )
  })
})
