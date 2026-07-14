import { config } from 'dotenv'
import {
  assertInventorySourceObjectsPresent,
  createSupabaseClassroomArchiveInventoryReader,
  inventoryArchivedClassrooms,
  verifySupabaseInventoryTarget,
} from '@/lib/server/classroom-archive-inventory'
import { createTargetBoundFetch } from '@/lib/server/supabase-target'
import { getServiceRoleClient } from '@/lib/supabase'

config({ path: process.env.ENV_FILE || '.env.local' })

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

function formatKnownBytes(bytes: number | null): string {
  return bytes === null ? 'unknown' : formatBytes(bytes)
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  const expectedProjectRef = readArgument('--expected-project-ref') ||
    process.env.CLASSROOM_ARCHIVE_INVENTORY_EXPECTED_PROJECT_REF
  if (!supabaseUrl || !secretKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required')
  }
  if (!expectedProjectRef) {
    throw new Error('--expected-project-ref is required')
  }
  const verifiedOrigin = verifySupabaseInventoryTarget(supabaseUrl, expectedProjectRef)
  process.env.NEXT_PUBLIC_SUPABASE_URL = verifiedOrigin
  const targetBoundFetch = createTargetBoundFetch(verifiedOrigin)
  const reader = createSupabaseClassroomArchiveInventoryReader({
    supabase: getServiceRoleClient({ fetch: targetBoundFetch }),
    supabaseUrl: verifiedOrigin,
    secretKey,
  })
  const inventory = await inventoryArchivedClassrooms(reader)
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`)
    assertInventorySourceObjectsPresent(inventory)
    return
  } else {
    process.stdout.write('Classroom archive production inventory completed.\n')
    process.stdout.write(
      `Schema: ${inventory.schema.archive_resource_count} archive resources, ` +
      `${inventory.schema.gradex_resource_count} Gradex resources, ` +
      'PostgREST schema audit passed; direct database catalog audit remains required.\n',
    )
    for (const classroom of inventory.archived_hot) {
      process.stdout.write(
        `${classroom.label}: ${classroom.relational_row_count} rows, ` +
        `${formatBytes(classroom.serialized_relational_bytes)} serialized relational data, ` +
        `${classroom.storage_object_count} referenced objects / ` +
        `${formatBytes(classroom.storage_metadata_bytes)}, ` +
        `${formatKnownBytes(classroom.estimated_uncompressed_archive_bytes)} total uncompressed input, ` +
        `${classroom.missing_storage_object_count} missing, ` +
        `all source objects present=${classroom.source_objects_present}.\n`,
      )
    }
    process.stdout.write(
      `Totals: ${inventory.totals.archived_hot_count} hot archives, ` +
      `${inventory.totals.relational_row_count} rows, ` +
      `${formatBytes(inventory.totals.serialized_relational_bytes)} serialized relational data, ` +
      `${inventory.totals.storage_object_count} referenced objects / ` +
      `${formatBytes(inventory.totals.storage_metadata_bytes)}, ` +
      `${formatKnownBytes(inventory.totals.estimated_uncompressed_archive_bytes)} total uncompressed input, ` +
      `${inventory.totals.missing_storage_object_count} missing source objects.\n`,
    )
    process.stdout.write(
      `Existing archive state: ${inventory.operations.verified_archives} verified archives, ` +
      `${inventory.operations.cold_tombstones} cold tombstones, ` +
      `${inventory.operations.archive_operations} operations, ` +
      `${inventory.operations.gradex_extracts} Gradex extracts, ` +
      `${inventory.operations.source_cleanup_rows} source-cleanup rows.\n`,
    )
  }
  assertInventorySourceObjectsPresent(inventory)
  process.stdout.write('Classroom archive production inventory passed.\n')
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown inventory failure'
  process.stderr.write(`Classroom archive production inventory failed: ${message}\n`)
  process.exitCode = 1
})
