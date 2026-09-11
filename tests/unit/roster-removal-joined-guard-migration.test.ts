import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/162_guard_joined_roster_removal.sql',
  'utf8',
)

describe('migration 162 joined roster removal guard', () => {
  it('serializes with classroom joins and rejects enrolled targets before deletion', () => {
    expect(migration).toMatch(/from public\.classrooms[\s\S]*?for update;/)
    expect(migration).toContain('for update of roster')
    expect(migration).toMatch(/from public\.classroom_enrollments[\s\S]*?joined_students_require_comprehensive_removal/)
    expect(migration).toMatch(
      /if exists \([\s\S]*?joined_students_require_comprehensive_removal[\s\S]*?return private\.remove_classroom_roster_entries_pre_v162/,
    )
  })

  it('preserves the previous remover privately and exposes only the guarded wrapper', () => {
    expect(migration).toContain('set schema private')
    expect(migration).toContain('security definer')
    expect(migration).toContain('set search_path = \'\'')
    expect(migration).toContain(
      'revoke all on function private.remove_classroom_roster_entries_pre_v162(uuid, uuid[])',
    )
    expect(migration).toContain(
      'grant execute on function public.remove_classroom_roster_entries_atomic(uuid, uuid[])\n  to service_role;',
    )
  })
})
