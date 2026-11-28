import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateDisposableBillingReplayMigrations } from '../../scripts/lifecycle-services-reviewed-migrations'

/** Offline positive fixture for the closed historical source contract. This
 * deliberately does not admit its prefix selection to any native runner. */
export function historicalReviewed332(inventory: readonly { name: string; sql: string; sha256: string }[]) {
  const prefix = inventory.slice(0, 332)
  assert.equal(prefix.length, 332)
  assert.equal(prefix.at(-1)?.name, '332_allow_started_test_title_corrections.sql')
  validateDisposableBillingReplayMigrations(prefix)
  return prefix
}

/** Only the source preflight runs here; no shell runner/database is executed. */
export function createHistorical332PreflightRepository(repository: string,
  inventory: Parameters<typeof historicalReviewed332>[0]) {
  const prefix = historicalReviewed332(inventory)
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pika-reviewed332-offline-')))
  try {
    const destination = join(root, 'supabase', 'migrations')
    mkdirSync(destination, { recursive: true })
    for (const migration of prefix) copyFileSync(join(repository, 'supabase/migrations', migration.name), join(destination, migration.name))
    symlinkSync(join(repository, 'scripts'), join(root, 'scripts'), 'dir')
    // The extracted real tsx preflight imports application helpers using the
    // repository's @/* paths. Keep that source resolution identical offline.
    symlinkSync(join(repository, 'tsconfig.json'), join(root, 'tsconfig.json'), 'file')
    symlinkSync(join(repository, 'src'), join(root, 'src'), 'dir')
    return { repository: root, dispose: () => rmSync(root, { recursive: true, force: true }) }
  } catch (error) {
    rmSync(root, { recursive: true, force: true })
    throw error
  }
}
