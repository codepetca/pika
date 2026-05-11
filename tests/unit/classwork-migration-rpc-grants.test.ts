import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))

function readMigration(relativePath: string) {
  return readFileSync(resolve(testDir, '../..', relativePath), 'utf8')
}

describe('classwork mixed ordering migration', () => {
  it('keeps reorder RPCs behind the service-role API boundary', () => {
    const migration = readMigration('supabase/migrations/067_classwork_mixed_ordering.sql')

    for (const functionName of [
      'reorder_classwork_items',
      'reorder_assignments_preserve_materials',
    ]) {
      expect(migration).toContain(
        `revoke all on function public.${functionName}(uuid, jsonb) from public, anon, authenticated;`,
      )
      expect(migration).toContain(
        `grant execute on function public.${functionName}(uuid, jsonb) to service_role;`,
      )
    }
  })
})
