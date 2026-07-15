import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/098_classroom_archive_compaction_timeout.sql',
  ),
  'utf8',
)

describe('classroom archive compaction timeout migration', () => {
  it('extends only the atomic compaction finalizer to the REST API maximum', () => {
    expect(migration).toContain(
      'alter function public.complete_classroom_archive_compaction(',
    )
    expect(migration).toContain("set statement_timeout = '60s'")
    expect(migration).not.toMatch(/alter\s+(?:database|role)/i)
    expect(migration.match(/set statement_timeout/g)).toHaveLength(1)
  })
})
