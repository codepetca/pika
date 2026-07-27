import { describe, expect, it, vi } from 'vitest'
import {
  createProvisionalTestDocumentSnapshotCleanup,
  removeQueuedTestDocumentSnapshotPath,
  runTestDocumentSnapshotStorageCleanup,
} from '@/lib/server/test-document-snapshot-storage-cleanup'

const cleanup = {
  id: '10000000-0000-4000-8000-000000000001',
  lease_token: '10000000-0000-4000-8000-000000000010',
  storage_path: 'link-docs/teacher/test/doc/snapshots/one',
}

function makeSupabase(options: {
  claims?: Array<typeof cleanup>
  referenced?: boolean
  removeError?: { message: string } | null
  complete?: boolean
} = {}) {
  const claims = [...(options.claims ?? [])]
  const remove = vi.fn(async () => ({ error: options.removeError ?? null }))
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'claim_test_document_snapshot_storage_cleanup') {
      const next = claims.shift()
      return { data: next ? [next] : [], error: null }
    }
    if (name === 'claim_test_document_snapshot_storage_cleanup_path') {
      return {
        data: [{ ...cleanup, storage_path: args?.p_storage_path }],
        error: null,
      }
    }
    if (name === 'test_document_snapshot_path_is_referenced') {
      return { data: options.referenced ?? false, error: null }
    }
    if (name === 'complete_test_document_snapshot_storage_cleanup') {
      return { data: options.complete ?? true, error: null }
    }
    if (name === 'fail_test_document_snapshot_storage_cleanup') {
      return { data: true, error: null }
    }
    throw new Error(`Unexpected RPC ${name}`)
  })

  return {
    rpc,
    storage: { from: vi.fn(() => ({ remove })) },
    remove,
  }
}

describe('test document snapshot Storage cleanup', () => {
  it('creates durable delayed evidence before an upload', async () => {
    const single = vi.fn(async () => ({
      data: { id: cleanup.id, storage_path: cleanup.storage_path },
      error: null,
    }))
    const insert = vi.fn(() => ({
      select: vi.fn(() => ({ single })),
    }))
    const supabase = { from: vi.fn(() => ({ insert })) }

    await expect(createProvisionalTestDocumentSnapshotCleanup({
      supabase,
      storagePath: cleanup.storage_path,
    })).resolves.toEqual({
      id: cleanup.id,
      storage_path: cleanup.storage_path,
    })

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      status: 'pending',
      storage_path: cleanup.storage_path,
      next_attempt_at: expect.any(String),
    }))
  })

  it('removes an unreferenced exact path and completes its evidence', async () => {
    const supabase = makeSupabase()

    await expect(removeQueuedTestDocumentSnapshotPath({
      supabase,
      storagePath: cleanup.storage_path,
    })).resolves.toEqual({ completed: true })

    expect(supabase.remove).toHaveBeenCalledWith([cleanup.storage_path])
    expect(supabase.rpc).toHaveBeenCalledWith(
      'complete_test_document_snapshot_storage_cleanup',
      expect.objectContaining({ p_cleanup_id: cleanup.id }),
    )
  })

  it('does not remove a referenced path but completes stale cleanup evidence', async () => {
    const supabase = makeSupabase({ referenced: true })

    await expect(removeQueuedTestDocumentSnapshotPath({
      supabase,
      storagePath: cleanup.storage_path,
    })).resolves.toEqual({ completed: true })

    expect(supabase.remove).not.toHaveBeenCalled()
  })

  it('retains retry evidence when Storage removal fails', async () => {
    const supabase = makeSupabase({ removeError: { message: 'unavailable' } })

    await expect(removeQueuedTestDocumentSnapshotPath({
      supabase,
      storagePath: cleanup.storage_path,
    })).resolves.toEqual({ completed: false })

    expect(supabase.rpc).toHaveBeenCalledWith(
      'fail_test_document_snapshot_storage_cleanup',
      expect.objectContaining({
        p_cleanup_id: cleanup.id,
        p_error: 'unavailable',
      }),
    )
  })

  it('runs a bounded batch and records success and retry outcomes', async () => {
    const second = {
      ...cleanup,
      id: '10000000-0000-4000-8000-000000000002',
      storage_path: 'link-docs/teacher/test/doc/snapshots/two',
    }
    const supabase = makeSupabase({ claims: [cleanup, second] })
    supabase.remove
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'temporary failure' } })

    await expect(runTestDocumentSnapshotStorageCleanup({
      supabase,
      limit: 2,
    })).resolves.toEqual({
      claimAttempts: 2,
      claimFailures: 0,
      claimed: 2,
      completed: 1,
      failed: 1,
    })
  })
})
