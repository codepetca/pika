import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/157_gradebook_score_overrides.sql',
  'utf8',
)
const archiveDatabaseCheck = readFileSync(
  'scripts/check-classroom-archive-database.sh',
  'utf8',
)
const archiveV2DatabaseCheck = readFileSync(
  'scripts/check-classroom-archive-v2-database.sh',
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
    expect(archiveDatabaseCheck).toContain("to_regclass('public.gradebook_score_overrides')")
    expect(archiveDatabaseCheck).toContain("table_name = 'gradebook_score_overrides'")
    expect(archiveV2DatabaseCheck).toContain("v_expected_v2_resource_count := 40")
    expect(archiveV2DatabaseCheck).toContain("to_regclass('public.gradebook_score_overrides') is null")
    expect(archiveV2DatabaseCheck).toMatch(/where format_version = 2\s+\) <> v_expected_v2_resource_count/)
    expect(archiveV2DatabaseCheck).toContain("table_name = 'gradebook_score_overrides'")
  })

  it('includes overrides in student purge and ordinary roster removal', () => {
    expect(migration).toContain('student_purge_inventory_resources_pre_v157')
    expect(migration).toContain('alter function public.student_purge_inventory_resources_pre_v157(uuid, uuid)\n  set schema private')
    expect(migration).toContain('student_purge_guard_gradebook_score_overrides')
    expect(migration).toContain('remove_classroom_roster_entries_pre_v157')
    expect(migration).toContain('alter function public.remove_classroom_roster_entries_pre_v157(uuid, uuid[])\n  set schema private')
    expect(migration).toContain("'deleted_gradebook_score_overrides'")
    expect(migration).toMatch(/create function public\.remove_classroom_roster_entries_atomic\([\s\S]*?language plpgsql\s+security definer\s+set search_path = ''/)
  })

  it('cleans up deleted assignment and test overrides without disturbing exact purge ordering', () => {
    expect(migration).toContain('create function public.delete_gradebook_overrides_for_assessment()')
    expect(migration).toMatch(/delete from public\.gradebook_score_overrides as override[\s\S]*?override\.assessment_type = tg_argv\[0\][\s\S]*?override\.assessment_id = old\.id/)
    expect(migration).toContain("execute function public.delete_gradebook_overrides_for_assessment('assignment')")
    expect(migration).toContain("execute function public.delete_gradebook_overrides_for_assessment('test')")
    expect(migration).toContain("current_setting('pika.classroom_purge_finalize', true) = 'on'")
    expect(migration).toContain("is_classroom_archive_maintenance_mode('compaction')")
    expect(migration).toContain('revoke all on function public.delete_gradebook_overrides_for_assessment()')
  })

  it('keeps browser roles outside the table and destructive helpers', () => {
    expect(migration).toContain('alter table public.gradebook_score_overrides enable row level security')
    expect(migration).toContain('revoke all on table public.gradebook_score_overrides from anon, authenticated')
    expect(migration).toContain('revoke all on function private.remove_classroom_roster_entries_pre_v157(uuid, uuid[])')
  })
})
