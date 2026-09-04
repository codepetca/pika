import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/157_gradebook_score_overrides.sql',
  'utf8',
)

describe('migration 157 Gradebook score override lifecycle', () => {
  it('uses stable archive keys and the exact classroom/student enrollment pair', () => {
    expect(migration).toContain('id uuid primary key default gen_random_uuid()')
    expect(migration).toContain('unique (classroom_id, student_id, assessment_type, assessment_id)')
    expect(migration).toContain('references public.classroom_enrollments (classroom_id, student_id)')
    expect(migration).toContain('deferrable initially deferred')
  })

  it('registers archive actors, restore order, revision tracking, and purge fencing', () => {
    expect(migration.match(/'gradebook_score_overrides'/g)?.length).toBeGreaterThanOrEqual(3)
    expect(migration).toContain("array['student_id', 'created_by']")
    expect(migration).toContain("array['classrooms', 'classroom_enrollments']")
    expect(migration).toContain('create trigger car_gradebook_score_overrides')
    expect(migration).toContain('create trigger classroom_purge_fence_gradebook_score_overrides')
  })

  it('includes overrides in student purge and ordinary roster removal', () => {
    expect(migration).toContain('student_purge_inventory_resources_without_gradebook_overrides_v157')
    expect(migration).toContain('student_purge_guard_gradebook_score_overrides')
    expect(migration).toContain('remove_classroom_roster_entries_without_gradebook_overrides_v157')
    expect(migration).toContain("'deleted_gradebook_score_overrides'")
  })

  it('keeps browser roles outside the table and destructive helpers', () => {
    expect(migration).toContain('alter table public.gradebook_score_overrides enable row level security')
    expect(migration).toContain('revoke all on table public.gradebook_score_overrides from anon, authenticated')
    expect(migration).toContain('revoke all on function public.remove_classroom_roster_entries_without_gradebook_overrides_v157(uuid, uuid[])')
  })
})
