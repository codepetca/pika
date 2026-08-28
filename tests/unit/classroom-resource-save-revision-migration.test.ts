import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/136_classroom_resource_save_revision.sql'),
  'utf8',
)

describe('classroom resource save revision migration', () => {
  it('rejects an older autosave or unload beacon before it can overwrite newer content', () => {
    expect(migration).toContain('add column save_revision bigint not null default 0')
    expect(migration).toContain('if new.save_revision < old.save_revision then')
    expect(migration).toContain('return null;')
    expect(migration).toContain('before update on public.classroom_resources')
  })
})
