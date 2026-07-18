import { randomUUID } from 'node:crypto'
import { z } from 'zod'

const ASSIGNMENT_ARTIFACTS_BUCKET = 'assignment-artifacts'
const PROVISIONAL_CLEANUP_DELAY_MS = 15 * 60 * 1000
const cleanupRowSchema = z.object({
  id: z.string().uuid(),
  storage_path: z.string().min(1),
  lease_token: z.string().uuid(),
}).passthrough()
const provisionalCleanupSchema = z.object({
  id: z.string().uuid(),
  storage_path: z.string().min(1),
})

type SupabaseLike = any

export type ProvisionalAssignmentArtifactStorageCleanup = z.infer<typeof provisionalCleanupSchema>

export async function assignmentArtifactStoragePathIsReferenced(input: {
  supabase: SupabaseLike
  storagePath: string
}): Promise<boolean | null> {
  try {
    const reference = await input.supabase
      .from('assignment_submission_artifacts')
      .select('id')
      .eq('storage_path', input.storagePath)
      .maybeSingle()
    if (reference.error) {
      console.error('Failed to check assignment artifact Storage references:', {
        path: input.storagePath,
        error: reference.error,
      })
      return null
    }
    return Boolean(reference.data)
  } catch (error) {
    console.error('Failed to check assignment artifact Storage references:', {
      path: input.storagePath,
      error,
    })
    return null
  }
}

export async function createProvisionalAssignmentArtifactStorageCleanup(input: {
  supabase: SupabaseLike
  storagePath: string
  now?: Date
}): Promise<ProvisionalAssignmentArtifactStorageCleanup | null> {
  const nextAttemptAt = new Date(
    (input.now ?? new Date()).getTime() + PROVISIONAL_CLEANUP_DELAY_MS
  ).toISOString()

  try {
    const result = await input.supabase
      .from('assignment_artifact_storage_cleanup')
      .insert({
        storage_path: input.storagePath,
        status: 'pending',
        next_attempt_at: nextAttemptAt,
      })
      .select('id, storage_path')
      .single()
    const parsed = provisionalCleanupSchema.safeParse(result.data)
    if (!result.error && parsed.success) return parsed.data

    console.error('Failed to create provisional assignment artifact Storage cleanup:', {
      path: input.storagePath,
      error: result.error ?? parsed.error,
    })
  } catch (error) {
    console.error('Failed to create provisional assignment artifact Storage cleanup:', {
      path: input.storagePath,
      error,
    })
  }
  return null
}

export async function adoptProvisionalAssignmentArtifactStorageCleanup(input: {
  supabase: SupabaseLike
  cleanup: ProvisionalAssignmentArtifactStorageCleanup
}): Promise<boolean> {
  try {
    const result = await input.supabase
      .from('assignment_artifact_storage_cleanup')
      .delete()
      .eq('id', input.cleanup.id)
      .eq('storage_path', input.cleanup.storage_path)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!result.error && result.data?.id === input.cleanup.id) return true

    console.error('Failed to adopt provisional assignment artifact Storage cleanup:', {
      cleanupId: input.cleanup.id,
      error: result.error,
    })
  } catch (error) {
    console.error('Failed to adopt provisional assignment artifact Storage cleanup:', {
      cleanupId: input.cleanup.id,
      error,
    })
  }
  return false
}

async function releaseAssignmentArtifactStorageCleanupClaim(input: {
  supabase: SupabaseLike
  cleanupId: string
  leaseToken: string
  error: string
}): Promise<void> {
  try {
    await input.supabase.rpc('fail_assignment_artifact_storage_cleanup', {
      p_cleanup_id: input.cleanupId,
      p_lease_token: input.leaseToken,
      p_error: input.error,
    })
  } catch (error) {
    console.error('Failed to release assignment artifact Storage cleanup claim:', {
      cleanupId: input.cleanupId,
      error,
    })
  }
}

export async function removeQueuedAssignmentArtifactStoragePath(input: {
  supabase: SupabaseLike
  storagePath: string
}): Promise<{ completed: boolean }> {
  const leaseToken = randomUUID()
  let claim: any
  try {
    claim = await input.supabase.rpc(
      'claim_assignment_artifact_storage_cleanup_path',
      {
        p_storage_path: input.storagePath,
        p_lease_token: leaseToken,
        p_lease_seconds: 120,
      }
    )
  } catch (error) {
    console.error('Failed to claim queued assignment artifact Storage path:', {
      path: input.storagePath,
      error,
    })
    return { completed: false }
  }
  const parsedClaim = z.array(cleanupRowSchema).max(1).safeParse(claim.data ?? [])
  if (claim.error || !parsedClaim.success || parsedClaim.data.length !== 1) {
    if (claim.error || !parsedClaim.success) {
      console.error('Failed to claim queued assignment artifact Storage path:', {
        path: input.storagePath,
        error: claim.error ?? parsedClaim.error,
      })
    }
    return { completed: false }
  }
  const cleanup = parsedClaim.data[0]

  const isReferenced = await assignmentArtifactStoragePathIsReferenced(input)
  if (isReferenced === null) {
    await releaseAssignmentArtifactStorageCleanupClaim({
      supabase: input.supabase,
      cleanupId: cleanup.id,
      leaseToken: cleanup.lease_token,
      error: 'Artifact reference lookup failed',
    })
    return { completed: false }
  }

  let storageError: { message?: string } | null = null
  if (!isReferenced) {
    try {
      const result = await input.supabase.storage
        .from(ASSIGNMENT_ARTIFACTS_BUCKET)
        .remove([input.storagePath])
      storageError = result.error
    } catch (error) {
      storageError = error instanceof Error ? { message: error.message } : { message: 'Storage request failed' }
    }
  }

  if (storageError) {
    console.error('Failed to remove queued assignment artifact Storage object:', {
      path: input.storagePath,
      error: storageError,
    })
    await releaseAssignmentArtifactStorageCleanupClaim({
      supabase: input.supabase,
      cleanupId: cleanup.id,
      leaseToken: cleanup.lease_token,
      error: storageError.message ?? 'Storage request failed',
    })
    return { completed: false }
  }

  let data: unknown
  let error: unknown
  try {
    const completion = await input.supabase.rpc(
      'complete_assignment_artifact_storage_cleanup',
      { p_cleanup_id: cleanup.id, p_lease_token: cleanup.lease_token }
    )
    data = completion.data
    error = completion.error
  } catch (completionError) {
    error = completionError
  }
  if (error || data !== true) {
    console.error('Failed to complete assignment artifact Storage cleanup evidence:', {
      path: input.storagePath,
      error,
    })
    await releaseAssignmentArtifactStorageCleanupClaim({
      supabase: input.supabase,
      cleanupId: cleanup.id,
      leaseToken: cleanup.lease_token,
      error: 'Failed to record Storage cleanup completion',
    })
    return { completed: false }
  }

  return { completed: true }
}

export async function enqueueAssignmentArtifactStorageCleanupPath(input: {
  supabase: SupabaseLike
  storagePath: string
}): Promise<boolean> {
  try {
    const result = await input.supabase.rpc(
      'enqueue_assignment_artifact_storage_cleanup_path',
      { p_storage_path: input.storagePath }
    )
    if (!result.error && result.data === true) return true
    console.error('Failed to enqueue assignment artifact Storage cleanup:', {
      path: input.storagePath,
      error: result.error,
    })
  } catch (error) {
    console.error('Failed to enqueue assignment artifact Storage cleanup:', {
      path: input.storagePath,
      error,
    })
  }
  return false
}

export async function runAssignmentArtifactStorageCleanup(input: {
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
    let claimResult: any
    try {
      claimResult = await input.supabase.rpc(
        'claim_assignment_artifact_storage_cleanup',
        {
          p_lease_token: leaseToken,
          p_limit: 1,
          p_lease_seconds: input.leaseSeconds ?? 120,
        }
      )
    } catch (error) {
      console.error('Failed to claim assignment artifact Storage cleanup:', error)
      claimFailures += 1
      failed += 1
      continue
    }
    if (claimResult.error) {
      console.error('Failed to claim assignment artifact Storage cleanup:', claimResult.error)
      claimFailures += 1
      failed += 1
      continue
    }

    const parsed = z.array(cleanupRowSchema).max(1).safeParse(claimResult.data ?? [])
    if (!parsed.success) {
      console.error('Invalid assignment artifact cleanup claim result:', parsed.error)
      claimFailures += 1
      failed += 1
      continue
    }
    if (parsed.data.length === 0) break
    const cleanup = parsed.data[0]
    claimed += 1

    let storageError: { message?: string } | null = null
    let completionErrorMessage: string | null = null
    let referencedArtifact: unknown = null
    try {
      const reference = await input.supabase
        .from('assignment_submission_artifacts')
        .select('id')
        .eq('storage_path', cleanup.storage_path)
        .maybeSingle()
      if (reference.error) {
        storageError = { message: reference.error.message ?? 'Artifact reference lookup failed' }
      } else {
        referencedArtifact = reference.data
      }
    } catch (error) {
      storageError = error instanceof Error
        ? { message: error.message }
        : { message: 'Artifact reference lookup failed' }
    }

    if (!storageError && !referencedArtifact) {
      try {
        const result = await input.supabase.storage
          .from(ASSIGNMENT_ARTIFACTS_BUCKET)
          .remove([cleanup.storage_path])
        storageError = result.error
      } catch (error) {
        storageError = error instanceof Error ? { message: error.message } : { message: 'Storage request failed' }
      }
    }

    if (!storageError) {
      let completion: any
      try {
        completion = await input.supabase.rpc(
          'complete_assignment_artifact_storage_cleanup',
          { p_cleanup_id: cleanup.id, p_lease_token: cleanup.lease_token }
        )
      } catch (error) {
        completion = { data: false, error }
      }
      if (!completion?.error && completion?.data === true) {
        completed += 1
        continue
      }
      if (completion?.error) {
        completionErrorMessage = completion.error instanceof Error
          ? completion.error.message
          : completion.error.message ?? 'Completion RPC failed'
        console.error('Failed to record assignment artifact Storage cleanup completion:', {
          cleanupId: cleanup.id,
          error: completion.error,
        })
      }
    }

    failed += 1
    const failureMessage = storageError?.message
      || completionErrorMessage
      || 'Failed to record Storage cleanup completion'
    let failure: any
    try {
      failure = await input.supabase.rpc(
        'fail_assignment_artifact_storage_cleanup',
        {
          p_cleanup_id: cleanup.id,
          p_lease_token: cleanup.lease_token,
          p_error: failureMessage,
        }
      )
    } catch (error) {
      failure = { data: false, error }
    }
    if (failure?.error || failure?.data !== true) {
      console.error('Failed to release assignment artifact cleanup lease:', {
        cleanupId: cleanup.id,
        error: failure?.error,
      })
    }
  }

  return { claimAttempts, claimFailures, claimed, completed, failed }
}
