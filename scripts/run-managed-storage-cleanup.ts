import { config as loadEnvironment } from 'dotenv'
import { z } from 'zod'
import { runManagedStorageCleanup } from '@/lib/server/managed-storage-cleanup'
import { getServiceRoleClient } from '@/lib/supabase'

loadEnvironment({ path: process.env.ENV_FILE || '.env.local' })

const target = process.env.MANAGED_STORAGE_TARGET || 'UNSET'
const acknowledgement = `MANAGED STORAGE CLEANUP ${target}`
if (process.env.MANAGED_STORAGE_OPERATOR_ACKNOWLEDGEMENT !== acknowledgement) {
  throw new Error(`Mutation acknowledgement must equal: ${acknowledgement}`)
}
if (process.env.MANAGED_STORAGE_CLEANUP_ENABLED?.trim().toLowerCase() !== 'true') {
  throw new Error('MANAGED_STORAGE_CLEANUP_ENABLED must be true')
}

const limit = z.coerce.number().int().min(1).max(25)
  .parse(process.env.MANAGED_STORAGE_CLEANUP_LIMIT || '10')
const leaseSeconds = z.coerce.number().int().min(15).max(300)
  .parse(process.env.MANAGED_STORAGE_CLEANUP_LEASE_SECONDS || '120')

runManagedStorageCleanup({
  supabase: getServiceRoleClient(),
  limit,
  leaseSeconds,
}).then((result) => {
  console.log(JSON.stringify(result))
}).catch((error) => {
  console.error(error instanceof Error ? error.message : 'managed_storage_cleanup_failed')
  process.exitCode = 1
})
