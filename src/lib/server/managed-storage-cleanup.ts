import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { missingStorageObjectEvidence } from '@/lib/server/storage-object-evidence'

const cleanupObjectSchema = z.object({
  id: z.string().uuid(),
  storage_bucket: z.enum([
    'assignment-artifacts',
    'submission-images',
    'test-documents',
    'classroom-archives',
    'gradex-analytics-extracts',
  ]),
  storage_path: z.string().min(1),
  lease_token: z.string().uuid(),
}).passthrough()

type SupabaseLike = any

export function isManagedStorageCleanupEnabled(): boolean {
  return process.env.MANAGED_STORAGE_CLEANUP_ENABLED?.trim().toLowerCase() === 'true'
}

export async function runManagedStorageCleanup(input: {
  supabase: SupabaseLike
  limit?: number
  leaseSeconds?: number
}) {
  if (!isManagedStorageCleanupEnabled()) {
    return { claimed: 0, deleted: 0, failed: 0 }
  }
  const limit = z.number().int().min(1).max(25).parse(input.limit ?? 10)
  const leaseSeconds = z.number().int().min(15).max(300).parse(input.leaseSeconds ?? 120)
  const leaseToken = randomUUID()
  const claim = await input.supabase.rpc('claim_managed_storage_cleanup', {
    p_lease_token: leaseToken,
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
  })
  if (claim.error) throw new Error('managed_storage_cleanup_claim_failed')
  const objects = z.array(cleanupObjectSchema).parse(claim.data || [])
  const result = { claimed: objects.length, deleted: 0, failed: 0 }

  for (const object of objects) {
    try {
      const removal = await input.supabase.storage
        .from(object.storage_bucket)
        .remove([object.storage_path])
      if (removal.error && !missingStorageObjectEvidence(removal.error)) {
        throw new Error('managed_storage_delete_failed')
      }
      const completed = await input.supabase.rpc('complete_managed_storage_cleanup', {
        p_object_id: object.id,
        p_lease_token: object.lease_token,
      })
      if (completed.error || completed.data !== true) {
        throw new Error('managed_storage_absence_not_committed')
      }
      result.deleted += 1
    } catch (error) {
      result.failed += 1
      await input.supabase.rpc('fail_managed_storage_cleanup', {
        p_object_id: object.id,
        p_lease_token: object.lease_token,
        p_error_code: error instanceof Error ? error.message : 'managed_storage_cleanup_failed',
      })
    }
  }
  return result
}
