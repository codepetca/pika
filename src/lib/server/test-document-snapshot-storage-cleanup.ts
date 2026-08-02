import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { queueManagedStorageCleanupPath } from '@/lib/server/managed-storage'
import { missingStorageObjectEvidence } from '@/lib/server/storage-object-evidence'

const TEST_DOCUMENTS_BUCKET = 'test-documents'
const PROVISIONAL_CLEANUP_DELAY_SECONDS = 15 * 60

const cleanupRowSchema = z.object({
  id: z.string().uuid(),
  lease_token: z.string().uuid(),
  storage_path: z.string().min(1),
}).passthrough()

const provisionalCleanupSchema = z.object({
  id: z.string().uuid(),
  storage_path: z.string().min(1),
})

type SupabaseLike = any

async function requestManagedSnapshotCleanup(
  supabase: SupabaseLike,
  storagePath: string,
): Promise<'absent' | 'delegated' | 'unowned' | 'uncertain'> {
  try {
    const queued = await queueManagedStorageCleanupPath({
      supabase,
      bucket: TEST_DOCUMENTS_BUCKET,
      path: storagePath,
      errorCode: 'test_snapshot_cleanup_requested',
    })
    if (queued) return 'delegated'
  } catch {
    return 'uncertain'
  }
  try {
    const response = await supabase.storage.from(TEST_DOCUMENTS_BUCKET).download(storagePath)
    if (response.data) return 'unowned'
    const evidence = missingStorageObjectEvidence(response.error)
    if (evidence === 'object') return 'absent'
    if (evidence === 'generic') {
      const bucket = await supabase.storage.getBucket(TEST_DOCUMENTS_BUCKET)
      if (!bucket.error && bucket.data?.id === TEST_DOCUMENTS_BUCKET) return 'absent'
    }
  } catch (error) {
    if (missingStorageObjectEvidence(error) === 'object') return 'absent'
  }
  return 'uncertain'
}

export type ProvisionalTestDocumentSnapshotCleanup =
  z.infer<typeof provisionalCleanupSchema>

export async function createProvisionalTestDocumentSnapshotCleanup(input: {
  supabase: SupabaseLike
  storagePath: string
}): Promise<ProvisionalTestDocumentSnapshotCleanup | null> {
  try {
    const result = await input.supabase
      .from('test_document_snapshot_storage_cleanup')
      .insert({
        next_attempt_at: new Date(
          Date.now() + PROVISIONAL_CLEANUP_DELAY_SECONDS * 1000,
        ).toISOString(),
        status: 'pending',
        storage_path: input.storagePath,
      })
      .select('id, storage_path')
      .single()
    const parsed = provisionalCleanupSchema.safeParse(result.data)
    if (!result.error && parsed.success) return parsed.data

    console.error('Failed to create provisional test snapshot cleanup:', {
      path: input.storagePath,
      error: result.error ?? parsed.error,
    })
  } catch (error) {
    console.error('Failed to create provisional test snapshot cleanup:', {
      path: input.storagePath,
      error,
    })
  }
  return null
}

async function snapshotPathIsReferenced(input: {
  supabase: SupabaseLike
  storagePath: string
}): Promise<boolean | null> {
  try {
    const result = await input.supabase.rpc(
      'test_document_snapshot_path_is_referenced',
      { p_storage_path: input.storagePath },
    )
    if (!result.error && typeof result.data === 'boolean') return result.data
    console.error('Failed to check test snapshot references:', {
      path: input.storagePath,
      error: result.error,
    })
  } catch (error) {
    console.error('Failed to check test snapshot references:', {
      path: input.storagePath,
      error,
    })
  }
  return null
}

async function failCleanup(input: {
  supabase: SupabaseLike
  cleanupId: string
  leaseToken: string
  error: string
}): Promise<void> {
  try {
    await input.supabase.rpc(
      'fail_test_document_snapshot_storage_cleanup',
      {
        p_cleanup_id: input.cleanupId,
        p_error: input.error,
        p_lease_token: input.leaseToken,
      },
    )
  } catch (error) {
    console.error('Failed to release test snapshot cleanup claim:', {
      cleanupId: input.cleanupId,
      error,
    })
  }
}

async function processClaim(input: {
  supabase: SupabaseLike
  cleanup: z.infer<typeof cleanupRowSchema>
}): Promise<boolean> {
  const { cleanup, supabase } = input
  const referenced = await snapshotPathIsReferenced({
    supabase,
    storagePath: cleanup.storage_path,
  })
  if (referenced === null) {
    await failCleanup({
      supabase,
      cleanupId: cleanup.id,
      leaseToken: cleanup.lease_token,
      error: 'Snapshot reference lookup failed',
    })
    return false
  }

  if (!referenced) {
    const state = await requestManagedSnapshotCleanup(supabase, cleanup.storage_path)
    if (state !== 'absent' && state !== 'delegated') {
      await failCleanup({
        supabase,
        cleanupId: cleanup.id,
        leaseToken: cleanup.lease_token,
        error: state === 'unowned'
            ? 'Managed Storage owner is missing'
            : 'Storage cleanup state could not be verified',
      })
      return false
    }
  }

  try {
    const completion = await supabase.rpc(
      'complete_test_document_snapshot_storage_cleanup',
      {
        p_cleanup_id: cleanup.id,
        p_lease_token: cleanup.lease_token,
      },
    )
    if (!completion.error && completion.data === true) return true
  } catch (error) {
    console.error('Failed to complete test snapshot cleanup:', {
      cleanupId: cleanup.id,
      error,
    })
  }

  await failCleanup({
    supabase,
    cleanupId: cleanup.id,
    leaseToken: cleanup.lease_token,
    error: 'Failed to record Storage cleanup completion',
  })
  return false
}

export async function removeQueuedTestDocumentSnapshotPath(input: {
  supabase: SupabaseLike
  storagePath: string
}): Promise<{ completed: boolean }> {
  const leaseToken = randomUUID()
  let claim: any
  try {
    claim = await input.supabase.rpc(
      'claim_test_document_snapshot_storage_cleanup_path',
      {
        p_lease_seconds: 120,
        p_lease_token: leaseToken,
        p_storage_path: input.storagePath,
      },
    )
  } catch (error) {
    console.error('Failed to claim queued test snapshot path:', {
      path: input.storagePath,
      error,
    })
    return { completed: false }
  }

  const parsed = z.array(cleanupRowSchema).max(1).safeParse(claim.data ?? [])
  if (claim.error || !parsed.success || parsed.data.length !== 1) {
    if (claim.error || !parsed.success) {
      console.error('Failed to claim queued test snapshot path:', {
        path: input.storagePath,
        error: claim.error ?? parsed.error,
      })
    }
    return { completed: false }
  }

  return {
    completed: await processClaim({
      supabase: input.supabase,
      cleanup: parsed.data[0],
    }),
  }
}

export async function runTestDocumentSnapshotStorageCleanup(input: {
  supabase: SupabaseLike
  limit?: number
  leaseSeconds?: number
}): Promise<{
  claimAttempts: number
  claimFailures: number
  claimed: number
  completed: number
  failed: number
}> {
  const limit = input.limit ?? 50
  let claimAttempts = 0
  let claimFailures = 0
  let claimed = 0
  let completed = 0
  let failed = 0

  while (claimAttempts < limit) {
    claimAttempts += 1
    const leaseToken = randomUUID()
    let claim: any
    try {
      claim = await input.supabase.rpc(
        'claim_test_document_snapshot_storage_cleanup',
        {
          p_lease_seconds: input.leaseSeconds ?? 120,
          p_lease_token: leaseToken,
          p_limit: 1,
        },
      )
    } catch (error) {
      console.error('Failed to claim test snapshot cleanup:', error)
      claimFailures += 1
      failed += 1
      continue
    }

    const parsed = z.array(cleanupRowSchema).max(1).safeParse(claim.data ?? [])
    if (claim.error || !parsed.success) {
      console.error('Failed to claim test snapshot cleanup:', {
        error: claim.error ?? parsed.error,
      })
      claimFailures += 1
      failed += 1
      continue
    }
    if (parsed.data.length === 0) break

    claimed += 1
    if (await processClaim({ supabase: input.supabase, cleanup: parsed.data[0] })) {
      completed += 1
    } else {
      failed += 1
    }
  }

  return { claimAttempts, claimFailures, claimed, completed, failed }
}
