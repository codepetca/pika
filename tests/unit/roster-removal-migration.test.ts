import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readMigration() {
  return readFileSync(resolve(process.cwd(), 'supabase/migrations/071_atomic_roster_bulk_removal.sql'), 'utf8')
}

describe('atomic roster removal migration', () => {
  it('keeps the roster removal RPC behind the service-role API boundary', () => {
    const migration = readMigration()

    expect(migration).toContain('create or replace function public.remove_classroom_roster_entries_atomic')
    expect(migration).toContain(
      'revoke all on function public.remove_classroom_roster_entries_atomic(uuid, uuid[]) from public, anon, authenticated;',
    )
    expect(migration).toContain(
      'grant execute on function public.remove_classroom_roster_entries_atomic(uuid, uuid[]) to service_role;',
    )
  })

  it('locks and validates roster rows before deleting classroom-scoped student data', () => {
    const migration = readMigration()

    expect(migration).toContain('for update of roster')
    expect(migration).toContain('One or more roster entries not found in classroom')
    expect(migration).toContain('delete from public.entries')
    expect(migration).toContain('delete from public.assignment_docs')
    expect(migration).toContain('delete from public.classroom_enrollments')
    expect(migration).toContain('delete from public.classroom_roster')
  })
})
