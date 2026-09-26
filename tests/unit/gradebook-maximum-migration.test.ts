import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const sql = readFileSync('supabase/migrations/210_gradebook_maximum_overrides.sql', 'utf8')
describe('maximum override migration boundaries', () => {
  it('stores state on owned resources and grants RPC access to service_role only', () => {
    for (const table of ['assignments','tests','gradebook_items']) expect(sql).toContain(`alter table public.${table}`)
    expect(sql).toContain('for update')
    expect(sql).toContain('maximum_changed_refresh')
    expect(sql).toContain('archived_at is not null')
    expect(sql).toContain('from public,anon,authenticated')
    expect(sql).toContain('to service_role')
  })
})
