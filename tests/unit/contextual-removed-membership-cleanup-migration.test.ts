import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CONTEXTUAL_REMOVED_MEMBERSHIP_CLEANUP_REVIEWED_MIGRATION, validateContextualRemovedMembershipCleanupReviewedMigration } from '../../scripts/contextual-removed-membership-cleanup-reviewed-migration'

const sql = readFileSync('supabase/migrations/288_contextual_removed_membership_cleanup.sql', 'utf8')
const predecessor = readFileSync('supabase/migrations/239_retained_roster_group_cleanup_compatibility.sql', 'utf8')
const digest = (bytes: string) => createHash('sha256').update(bytes).digest('hex')
function routine(source: string, name: string) {
  const start = source.indexOf(`create or replace function ${name}(`)
  expect(start).toBeGreaterThan(-1)
  return source.slice(start, source.indexOf('\n$$;', start) + 4)
}
const normalize = (source: string) => source.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()

describe('contextual removed membership cleanup288 source-only contract', () => {
  it('seals the exact forward migration without modifying the historical policy', () => {
    expect(() => validateContextualRemovedMembershipCleanupReviewedMigration({
      name: CONTEXTUAL_REMOVED_MEMBERSHIP_CLEANUP_REVIEWED_MIGRATION.name, sql, sha256: digest(sql),
    })).not.toThrow()
    expect(sql).not.toMatch(/create\s+table|alter\s+table|drop\s+index|update\s+private\.student_provider_cleanup_settings/i)
    expect(sql).not.toContain('create or replace function public.reserve_student_provider_cleanup')
    expect(readFileSync('supabase/migrations/171_student_provider_cleanup_prerequisite.sql', 'utf8'))
      .toContain("or not exists(select 1 from public.users where id=p_student_id and role='student')")
  })
  it.each(['name', 'digest', 'bytes', 'self-hashed-bytes'])('rejects altered %s, including self-hashed SQL', defect => {
    const changed = { name: CONTEXTUAL_REMOVED_MEMBERSHIP_CLEANUP_REVIEWED_MIGRATION.name, sql, sha256: digest(sql) }
    if (defect === 'name') changed.name = '289_unknown.sql'
    if (defect === 'digest') changed.sha256 = 'f'.repeat(64)
    if (defect === 'bytes' || defect === 'self-hashed-bytes') changed.sql += '\n'
    if (defect === 'self-hashed-bytes') changed.sha256 = digest(changed.sql)
    expect(() => validateContextualRemovedMembershipCleanupReviewedMigration(changed)).toThrow()
  })
  it('changes only subject role selection in the exact current live reservation', () => {
    const previous = routine(predecessor, 'private.reserve_live_student_cleanup')
      .replace("\n    or not exists(select 1 from public.users where id=p_student_id and role='student') then", ' then')
    const current = routine(sql, 'private.reserve_live_student_cleanup')
    expect(normalize(current)).toBe(normalize(previous))
    for (const proof of ['private.retained_roster_cleanup_group', "v_generation.state<>'removed'", 'v_generation.scope_digest<>v_scope',
      "v_existing.status<>'completed'", "v_binding.pal_schema_version is distinct from 2", "v_settings.eligible_after",
      "student_provider_mapping_unverified", "2,'pika-live-v1'", 'public.guard_classroom_purge_lifecycle']) {
      expect(current).toContain(proof)
    }
    expect(sql).toContain('from public,anon,authenticated,service_role;')
  })
  it('changes only actual-enrollment role selection in the existing OLD/NEW resource fence', () => {
    const previous = routine(predecessor, 'public.reject_student_resource_change_during_purge')
      .replace("join public.users student on student.id = enrollment.student_id and student.role = 'student'",
        'join public.users student on student.id = enrollment.student_id')
    expect(normalize(routine(sql, 'public.reject_student_resource_change_during_purge'))).toBe(normalize(previous))
    expect(sql).toContain('else array[to_jsonb(old), to_jsonb(new)]')
    expect(sql).toContain('binding.roster_id =')
    expect(sql).toContain('private.removed_academic_delete_allowed')
  })
  it('keeps historical live cases and authors real mixed-label automatic lifecycle evidence', () => {
    const fixture = readFileSync('scripts/check-live-student-cleanup-database.sql', 'utf8')
    expect(fixture).toContain('Strict receipt completed live operation')
    expect(fixture).toContain('Old payload reopened after rejoin')
    expect(fixture).toContain("activated_at=coalesce(activated_at,now()-interval '1 second')")
    for (const token of ["array['student','teacher']", 'remove_classroom_students_for_owner_v1', 'claim_removed_student_cleanup_job',
      "'live_reserve'", 'record_student_provider_cleanup_receipt', "'inventory'", "'claim'", "'live_complete'",
      'release_removed_student_cleanup_job', 'fresh_generation', 'before_peer', 'before_other', 'owner_before', 'member_before',
      'Live288 current owner accepted', 'Live288 missing Bara', 'Live288 substituted receipt', 'Live288 ignored revoked academic']) {
      expect(fixture).toContain(token)
    }
    expect(fixture.trim()).toMatch(/rollback;$/)
  })
  it('authors genuine unbound teacher-member OLD/NEW email-fallback fencing without trusted deletion', () => {
    const fixture = readFileSync('scripts/check-live-student-cleanup-database.sql', 'utf8')
    const start = fixture.indexOf("if member_label='teacher' then")
    const end = fixture.indexOf('kick_before:=', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const proof = fixture.slice(start, end)
    for (const token of ['insert into public.classroom_roster', 'classroom_roster_student_bindings',
      'public.classroom_enrollments', 'private.try_lock_classroom_membership_change(other_class,member_id)',
      'public.student_purge_lock(other_class,member_id)', 'public.guard_classroom_purge_lifecycle(other_class)',
      'insert into public.student_purge_operations', 'insert into public.student_purge_fences',
      "private.removed_academic_delete_allowed('classroom_roster',fallback_before)",
      'private.removed_academic_mutations', "update public.classroom_roster set first_name='Must be fenced288'",
      'delete from public.classroom_roster where id=fallback_roster', "sqlerrm<>'student_purge_active'",
      'before_peer is distinct from', 'before_other is distinct from', 'rollback_live288_fallback_fence',
      'fallback subtransaction did not restore exact fence-free state']) expect(proof).toContain(token)
    expect(proof).not.toContain('set_config(')
    expect(proof).not.toContain('disable trigger')
    expect(proof).not.toContain('pg_temp.')
    expect(proof).not.toContain('where roster_id=')
  })
})
