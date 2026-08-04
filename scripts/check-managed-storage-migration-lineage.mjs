import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationDir = new URL('../supabase/migrations/', import.meta.url)
const expected = new Map([
  ['115_hot_archived_classroom_purge.sql', '0189e443073cf69c8dbfa5b36bf8952a302e43ba342ad364ad7b7216d5bdda32'],
  ['116_hot_archived_classroom_purge_trigger_reconciliation.sql', '8c9e99cca42caa09b0feb9f3b5d62bba62302cbb7ec87374f539ab34f4308b30'],
])
const required = ['117_managed_storage_ownership_foundation.sql']

for (const [filename, expectedSha256] of expected) {
  const bytes = readFileSync(new URL(filename, migrationDir))
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== expectedSha256) {
    throw new Error(`${filename} does not match deployed production history`)
  }
}

const files = readdirSync(migrationDir).filter((file) => /^11[5-9]_/.test(file)).sort()
for (const filename of required) {
  if (!files.includes(filename)) throw new Error(`Missing required migration ${filename}`)
}
if (files.some((file) => /^11[7-9]_/.test(file) && file !== required[0])) {
  throw new Error('Managed-storage ownership must remain one forward migration 117')
}

const foundation = readFileSync(new URL(required[0], migrationDir), 'utf8')
if (/create\s+(?:or\s+replace\s+)?function\s+public\.[a-z0-9_]*purge/i.test(foundation)) {
  throw new Error('Ownership enforcement must not define purge orchestration')
}
if (!/mode\s*=\s*'enforced'/i.test(foundation)) {
  throw new Error('Migration 117 must contain explicit database enforcement activation')
}

console.log(`Managed-storage lineage verified: ${join('115', '116', '117')}`)
