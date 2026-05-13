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
    const surveyMigration = readMigration('supabase/migrations/068_surveys_classwork.sql')

    for (const functionName of [
      'reorder_classwork_items',
      'reorder_assignments_preserve_materials',
    ]) {
      const migrationText =
        functionName === 'reorder_classwork_items' ? `${migration}\n${surveyMigration}` : migration

      expect(migrationText).toContain(
        `revoke all on function public.${functionName}(uuid, jsonb) from public, anon, authenticated;`,
      )
      expect(migrationText).toContain(
        `grant execute on function public.${functionName}(uuid, jsonb) to service_role;`,
      )
    }
  })

  it('includes surveys in mixed classwork ordering', () => {
    const migration = readMigration('supabase/migrations/068_surveys_classwork.sql')

    expect(migration).toContain("item_type not in ('assignment', 'material', 'survey')")
    expect(migration).toContain("select 'survey'::text as item_type")
    expect(migration).toContain('update public.surveys survey')
  })
})
