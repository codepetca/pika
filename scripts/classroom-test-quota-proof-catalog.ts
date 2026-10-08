import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

// Externally reviewed schema addition, never inferred from the fixture being checked.
const quotaMigration = '253_classroom_test_tier_caps.sql'
const quotaMigrationSha256 = '076bb9775a6959ecfc1012a652205968fda74b601daaad3ba6ef0e8f9975cc09'
const quotaTable = 'private.classroom_test_quota_settings'

export function classroomTestQuotaProofCatalog(
  canonicalTables: readonly string[],
  migrations: readonly { name: string; sql: string; sha256: string }[],
): readonly string[] {
  assert(canonicalTables.length > 0 && canonicalTables.length <= 1024)
  assert(canonicalTables.every(name => /^(public|private|storage)\.[a-z_0-9]+$/.test(name)))
  assert.equal(new Set(canonicalTables).size, canonicalTables.length)
  const additions = migrations.filter(migration => migration.name === quotaMigration)
  assert.equal(additions.length, 1, 'Reviewed quota migration absent or duplicated')
  assert.equal(additions[0].sha256, quotaMigrationSha256)
  assert.equal(createHash('sha256').update(additions[0].sql).digest('hex'), quotaMigrationSha256)
  const expected = [...new Set([...canonicalTables, quotaTable])].sort()
  assert(expected.length <= 1024)
  return Object.freeze(expected)
}
