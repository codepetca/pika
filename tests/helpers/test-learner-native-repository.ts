import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Offline inputs for the deliberately fixed 001–257 learner profile.
 * Copies real source bytes; this never runs a database or widens native admission. */
export function createOfflineTestLearnerRepository(repository: string) {
  const migrations = join(repository, 'supabase', 'migrations')
  const names = readdirSync(migrations)
    .filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name) && Number(name.slice(0, 3)) <= 257)
    .sort()
  assert.deepEqual(names.map(name => Number(name.slice(0, 3))), Array.from({ length: 257 }, (_, index) => index + 1))
  assert.equal(names.at(-1), '257_contextual_test_learner_workflow.sql')
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pika-learner-native-offline-')))
  try {
    const destination = join(root, 'supabase', 'migrations')
    mkdirSync(destination, { recursive: true })
    for (const name of names) copyFileSync(join(migrations, name), join(destination, name))
  } catch (error) {
    rmSync(root, { recursive: true, force: true })
    throw error
  }
  return { repository: root, dispose: () => rmSync(root, { recursive: true, force: true }) }
}
