import { describe, expect, it, vi } from 'vitest'
import {
  adoptProvisionalAssignmentArtifactStorageCleanup,
  createProvisionalAssignmentArtifactStorageCleanup,
  removeQueuedAssignmentArtifactStoragePath,
  runAssignmentArtifactStorageCleanup,
} from '@/lib/server/assignment-artifact-storage-cleanup'

function makeSupabase(opts: {
  storageErrors?: Array<unknown>
  claimed?: Array<Record<string, unknown>>
  completionData?: boolean
  completionError?: unknown
  referencedStoragePaths?: string[]
}) {
  const claimed = [...(opts.claimed ?? [])]
  const remove = vi.fn(async () => ({
    error: opts.storageErrors?.shift() ?? null,
  }))
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'claim_assignment_artifact_storage_cleanup') {
      const next = claimed.shift()
      return { data: next ? [next] : [], error: null }
    }
    if (name === 'claim_assignment_artifact_storage_cleanup_path') {
      return {
        data: [{
          id: '10000000-0000-4000-8000-000000000099',
          storage_path: args?.p_storage_path,
          lease_token: args?.p_lease_token,
        }],
        error: null,
      }
    }
    if (name === 'complete_assignment_artifact_storage_cleanup') {
      return { data: opts.completionData ?? true, error: opts.completionError ?? null }
    }
    if (name === 'fail_assignment_artifact_storage_cleanup') {
      return { data: true, error: null }
    }
    throw new Error(`Unexpected RPC ${name}`)
  })
  return {
    remove,
    rpc,
    from: vi.fn((table: string) => {
      if (table !== 'assignment_submission_artifacts') {
        throw new Error(`Unexpected table ${table}`)
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn((_column: string, storagePath: string) => ({
            maybeSingle: vi.fn(async () => ({
              data: opts.referencedStoragePaths?.includes(storagePath) ? { id: 'artifact-1' } : null,
              error: null,
            })),
          })),
        })),
      }
    }),
    storage: { from: vi.fn(() => ({ remove })) },
  }
}

describe('assignment artifact Storage cleanup', () => {
  it('creates delayed provisional evidence and adopts that exact record', async () => {
    const cleanup = {
      id: '10000000-0000-4000-8000-000000000001',
      storage_path: 'student/assignment/image.png',
    }
    const single = vi.fn(async () => ({ data: cleanup, error: null }))
    const insert = vi.fn(() => ({
      select: vi.fn(() => ({ single })),
    }))
    const maybeSingle = vi.fn(async () => ({ data: { id: cleanup.id }, error: null }))
    const selectDeleted = vi.fn(() => ({ maybeSingle }))
    const eqStatus = vi.fn(() => ({ select: selectDeleted }))
    const eqPath = vi.fn(() => ({ eq: eqStatus }))
    const deleteRow = vi.fn(() => ({
      eq: vi.fn(() => ({ eq: eqPath })),
    }))
    const supabase = {
      from: vi.fn(() => ({ insert, delete: deleteRow })),
    }
    const now = new Date('2026-07-16T12:00:00.000Z')

    const provisional = await createProvisionalAssignmentArtifactStorageCleanup({
      supabase,
      storagePath: cleanup.storage_path,
      now,
    })

    expect(provisional).toEqual(cleanup)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      storage_path: cleanup.storage_path,
      status: 'pending',
      next_attempt_at: '2026-07-16T12:15:00.000Z',
    }))
    await expect(adoptProvisionalAssignmentArtifactStorageCleanup({
      supabase,
      cleanup,
    })).resolves.toBe(true)
    expect(deleteRow).toHaveBeenCalled()
  })

  it('removes an exact queued path and completes its durable evidence', async () => {
    const supabase = makeSupabase({})

    await expect(removeQueuedAssignmentArtifactStoragePath({
      supabase,
      storagePath: 'student/assignment/image.png',
    })).resolves.toEqual({ completed: true })

    expect(supabase.remove).toHaveBeenCalledWith(['student/assignment/image.png'])
    expect(supabase.rpc).toHaveBeenCalledWith(
      'complete_assignment_artifact_storage_cleanup',
      expect.objectContaining({ p_cleanup_id: '10000000-0000-4000-8000-000000000099' })
    )
  })

  it('keeps a shared Storage object while completing obsolete cleanup evidence', async () => {
    const storagePath = 'student/assignment/shared.png'
    const supabase = makeSupabase({ referencedStoragePaths: [storagePath] })

    await expect(removeQueuedAssignmentArtifactStoragePath({
      supabase,
      storagePath,
    })).resolves.toEqual({ completed: true })

    expect(supabase.remove).not.toHaveBeenCalled()
    expect(supabase.rpc).toHaveBeenCalledWith(
      'complete_assignment_artifact_storage_cleanup',
      expect.objectContaining({ p_cleanup_id: '10000000-0000-4000-8000-000000000099' })
    )
  })

  it('leaves durable evidence pending when immediate Storage removal fails', async () => {
    const supabase = makeSupabase({ storageErrors: [{ message: 'unavailable' }] })

    await expect(removeQueuedAssignmentArtifactStoragePath({
      supabase,
      storagePath: 'student/assignment/image.png',
    })).resolves.toEqual({ completed: false })

    expect(supabase.rpc).toHaveBeenCalledWith(
      'fail_assignment_artifact_storage_cleanup',
      expect.objectContaining({ p_cleanup_id: '10000000-0000-4000-8000-000000000099' })
    )
  })

  it('reports immediate cleanup as pending when durable completion is not recorded', async () => {
    const supabase = makeSupabase({ completionData: false })

    await expect(removeQueuedAssignmentArtifactStoragePath({
      supabase,
      storagePath: 'student/assignment/image.png',
    })).resolves.toEqual({ completed: false })
  })

  it('completes successful claims and releases failed claims for retry', async () => {
    const supabase = makeSupabase({
      storageErrors: [null, { message: 'temporary failure' }],
      claimed: [
        {
          id: '10000000-0000-4000-8000-000000000001',
          storage_path: 'student/assignment/one.png',
          lease_token: '10000000-0000-4000-8000-000000000010',
        },
        {
          id: '10000000-0000-4000-8000-000000000002',
          storage_path: 'student/assignment/two.png',
          lease_token: '10000000-0000-4000-8000-000000000010',
        },
      ],
    })

    await expect(runAssignmentArtifactStorageCleanup({ supabase, limit: 2 })).resolves.toEqual({
      claimAttempts: 2,
      claimFailures: 0,
      claimed: 2,
      completed: 1,
      failed: 1,
    })
    expect(supabase.rpc).toHaveBeenCalledWith(
      'complete_assignment_artifact_storage_cleanup',
      expect.objectContaining({ p_cleanup_id: '10000000-0000-4000-8000-000000000001' })
    )
    expect(supabase.rpc).toHaveBeenCalledWith(
      'fail_assignment_artifact_storage_cleanup',
      expect.objectContaining({ p_cleanup_id: '10000000-0000-4000-8000-000000000002' })
    )
  })

  it('releases a claim after Storage rejects and continues the remaining batch', async () => {
    const supabase = makeSupabase({
      claimed: [
        {
          id: '10000000-0000-4000-8000-000000000001',
          storage_path: 'student/assignment/one.png',
          lease_token: '10000000-0000-4000-8000-000000000010',
        },
        {
          id: '10000000-0000-4000-8000-000000000002',
          storage_path: 'student/assignment/two.png',
          lease_token: '10000000-0000-4000-8000-000000000010',
        },
      ],
    })
    supabase.remove
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ error: null })

    await expect(runAssignmentArtifactStorageCleanup({ supabase, limit: 2 })).resolves.toEqual({
      claimAttempts: 2,
      claimFailures: 0,
      claimed: 2,
      completed: 1,
      failed: 1,
    })
    expect(supabase.rpc).toHaveBeenCalledWith(
      'fail_assignment_artifact_storage_cleanup',
      expect.objectContaining({ p_cleanup_id: '10000000-0000-4000-8000-000000000001' })
    )
    expect(supabase.rpc).toHaveBeenCalledWith(
      'complete_assignment_artifact_storage_cleanup',
      expect.objectContaining({ p_cleanup_id: '10000000-0000-4000-8000-000000000002' })
    )
  })

  it('does not count a cleanup complete when the lease completion returns false', async () => {
    const supabase = makeSupabase({
      completionData: false,
      claimed: [{
        id: '10000000-0000-4000-8000-000000000001',
        storage_path: 'student/assignment/one.png',
        lease_token: '10000000-0000-4000-8000-000000000010',
      }],
    })

    await expect(runAssignmentArtifactStorageCleanup({ supabase, limit: 1 })).resolves.toEqual({
      claimAttempts: 1,
      claimFailures: 0,
      claimed: 1,
      completed: 0,
      failed: 1,
    })
    expect(supabase.rpc).toHaveBeenCalledWith(
      'fail_assignment_artifact_storage_cleanup',
      expect.objectContaining({ p_cleanup_id: '10000000-0000-4000-8000-000000000001' })
    )
  })

  it('continues after completion and failure-recording RPC promises reject', async () => {
    const supabase = makeSupabase({
      claimed: [
        {
          id: '10000000-0000-4000-8000-000000000001',
          storage_path: 'student/assignment/one.png',
          lease_token: '10000000-0000-4000-8000-000000000010',
        },
        {
          id: '10000000-0000-4000-8000-000000000002',
          storage_path: 'student/assignment/two.png',
          lease_token: '10000000-0000-4000-8000-000000000011',
        },
      ],
    })
    const baseRpc = supabase.rpc.getMockImplementation()!
    supabase.rpc.mockImplementation(async (name: string, args: unknown) => {
      if (name === 'complete_assignment_artifact_storage_cleanup'
        && (args as any).p_cleanup_id.endsWith('0001')) {
        throw new Error('completion transport failed')
      }
      if (name === 'fail_assignment_artifact_storage_cleanup'
        && (args as any).p_cleanup_id.endsWith('0001')) {
        throw new Error('failure transport failed')
      }
      return baseRpc(name, args)
    })

    await expect(runAssignmentArtifactStorageCleanup({ supabase, limit: 2 })).resolves.toEqual({
      claimAttempts: 2,
      claimFailures: 0,
      claimed: 2,
      completed: 1,
      failed: 1,
    })
    expect(supabase.rpc).toHaveBeenCalledWith(
      'complete_assignment_artifact_storage_cleanup',
      expect.objectContaining({ p_cleanup_id: '10000000-0000-4000-8000-000000000002' })
    )
  })

  it('bounds claim attempts, exposes a transport rejection, and continues independent claims', async () => {
    const supabase = makeSupabase({
      claimed: [{
        id: '10000000-0000-4000-8000-000000000001',
        storage_path: 'student/assignment/one.png',
        lease_token: '10000000-0000-4000-8000-000000000010',
      }],
    })
    const baseRpc = supabase.rpc.getMockImplementation()!
    let rejected = false
    supabase.rpc.mockImplementation(async (name: string, args: unknown) => {
      if (name === 'claim_assignment_artifact_storage_cleanup' && !rejected) {
        rejected = true
        throw new Error('claim transport rejected')
      }
      return baseRpc(name, args)
    })

    await expect(runAssignmentArtifactStorageCleanup({ supabase, limit: 2 })).resolves.toEqual({
      claimAttempts: 2,
      claimFailures: 1,
      claimed: 1,
      completed: 1,
      failed: 1,
    })
    expect(supabase.rpc.mock.calls.filter(([name]) => (
      name === 'claim_assignment_artifact_storage_cleanup'
    ))).toHaveLength(2)
  })

  it('adopts a delayed cleanup whose uploaded path is now committed', async () => {
    const storagePath = 'student/assignment/committed.png'
    const supabase = makeSupabase({
      referencedStoragePaths: [storagePath],
      claimed: [{
        id: '10000000-0000-4000-8000-000000000001',
        storage_path: storagePath,
        lease_token: '10000000-0000-4000-8000-000000000010',
      }],
    })

    await expect(runAssignmentArtifactStorageCleanup({ supabase, limit: 1 })).resolves.toEqual({
      claimAttempts: 1,
      claimFailures: 0,
      claimed: 1,
      completed: 1,
      failed: 0,
    })
    expect(supabase.remove).not.toHaveBeenCalled()
    expect(supabase.rpc).toHaveBeenCalledWith(
      'complete_assignment_artifact_storage_cleanup',
      expect.objectContaining({ p_cleanup_id: '10000000-0000-4000-8000-000000000001' })
    )
  })
})
