import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { missingStorageObjectEvidence } from '@/lib/server/storage-object-evidence'
import {
  managedStorageObjectSchema,
  type ManagedStorageObject,
} from '@/lib/server/managed-storage'

type SupabaseLike = any

export function isManagedStorageCleanupEnabled(): boolean {
  return process.env.MANAGED_STORAGE_CLEANUP_ENABLED
    ?.trim()
    .toLowerCase() === 'true'
}

async function failClaim(
  supabase: SupabaseLike,
  object: ManagedStorageObject,
  errorCode: string,
): Promise<boolean> {
  const result = await supabase.rpc('fail_managed_storage_cleanup', {
    p_object_id: object.id,
    p_lease_token: object.lease_token,
    p_error_code: errorCode,
  })
  return !result.error && result.data === true
}

async function processClaim(
  supabase: SupabaseLike,
  object: ManagedStorageObject,
): Promise<'deleted' | 'failed' | 'retry_recording_failed'> {
  try {
    const removal = await supabase.storage
      .from(object.storage_bucket)
      .remove([object.storage_path])
    if (removal.error && !missingStorageObjectEvidence(removal.error)) {
      return await failClaim(
        supabase,
        object,
        'managed_storage_delete_failed',
      )
        ? 'failed'
        : 'retry_recording_failed'
    }

    const completion = await supabase.rpc('complete_managed_storage_cleanup', {
      p_object_id: object.id,
      p_lease_token: object.lease_token,
    })
    if (!completion.error && completion.data === true) return 'deleted'
    return await failClaim(
      supabase,
      object,
      'managed_storage_absence_not_verified',
    )
      ? 'failed'
      : 'retry_recording_failed'
  } catch {
    return await failClaim(
      supabase,
      object,
      'managed_storage_cleanup_request_failed',
    )
      ? 'failed'
      : 'retry_recording_failed'
  }
}

export async function runManagedStorageCleanup(input: {
  supabase: SupabaseLike
  limit?: number
  leaseSeconds?: number
}): Promise<{
  claimed: number
  deleted: number
  failed: number
  retry_recording_failed: number
}> {
  if (!isManagedStorageCleanupEnabled()) {
    return { claimed: 0, deleted: 0, failed: 0, retry_recording_failed: 0 }
  }

  const leaseToken = randomUUID()
  const claim = await input.supabase.rpc('claim_managed_storage_cleanup', {
    p_lease_token: leaseToken,
    p_limit: input.limit ?? 10,
    p_lease_seconds: input.leaseSeconds ?? 120,
  })
  if (claim.error) {
    throw new Error('managed_storage_cleanup_claim_failed')
  }
  const objects = z.array(managedStorageObjectSchema).max(10).parse(claim.data || [])
  const result = {
    claimed: objects.length,
    deleted: 0,
    failed: 0,
    retry_recording_failed: 0,
  }
  for (const object of objects) {
    const status = await processClaim(input.supabase, object)
    result[status] += 1
  }
  return result
}
