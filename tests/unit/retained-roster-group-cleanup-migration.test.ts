import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const migration = join(process.cwd(), 'supabase/migrations/239_retained_roster_group_cleanup_compatibility.sql')
const sql = existsSync(migration) ? readFileSync(migration, 'utf8') : ''
it('uses valid PostgreSQL dollar quote boundaries in every replaced function', () => {
  // Lexical protection only; installed PostgreSQL replay remains a separate gate.
  expect(sql).not.toMatch(/\bas\s+\$(?:\r?\n|\s*$)/im)
  expect(sql).not.toMatch(/^\$;$/m)
})
it('keeps singleton removal closed while preparing group consumers', () => {
  expect(sql).toContain('private.retained_roster_cleanup_group')
  expect(sql).not.toMatch(/drop\s+index|remove_classroom_students_for_owner_v1|disable\s+trigger/i)
})
it('reauthorizes coherent identities before all destructive or external stages', () => {
  for (const name of ['private.authorize_removed_academic_cleanup', 'private.reserve_live_student_cleanup',
    'public.authorize_student_provider_cleanup', 'private.complete_live_student_cleanup'])
    expect(sql).toContain('function ' + name + '(')
  expect(sql).toContain("message='retained_roster_cleanup_group_invalid'")
  expect(sql).toContain('binding.student_id is distinct from p_student_id')
  expect(sql).toContain('p_student_id=p_teacher_id')
  expect(sql).toContain("generation.state is distinct from 'removed'")
})
it('requires exact snapshots and absence for roster, bindings, mapping and completion', () => {
  expect(sql).toContain('retained_roster_ids uuid[]')
  expect(sql).toContain('retained_binding_roster_ids uuid[]')
  expect(sql).toContain('v_count<>cardinality(v_roster_ids)')
  expect(sql).toContain('roster_id=any(v_binding_ids)')
  expect(sql).toContain('v_count<>1')
  expect(sql).toContain("message='student_live_completion_changed'")
  expect(sql).toContain("message='student_live_fence_changed'")
})
it('fences both retained identities and binding writes without caller-controlled bypass', () => {
  expect(sql).toContain('before insert or update or delete on public.classroom_roster_student_bindings')
  expect(sql).toContain("v_row->>'removed_student_id'")
  const guard = sql.slice(sql.indexOf('create function private.guard_retained_roster_cleanup_identity'), sql.indexOf('-- Preserve173'))
  expect(guard).not.toContain('pika.student_purge_finalize')
  expect(guard).toContain('student_purge_fences')
})
it('kicks once only for an actually inserted ready generation and retains eligibility', () => {
  expect(sql).toContain('get diagnostics v_inserted=row_count')
  expect(sql).toContain('if v_ready and v_inserted=1 then')
  expect(sql).toContain('new.removed_at<v_settings.eligible_after')
  expect(sql).toContain('on conflict(generation_id) do nothing')
})
it('defines owner-authorized complete group pages with narrow service-only execution', () => {
  expect(sql).toContain('function public.discover_retained_student_cleanup_groups(')
  expect(sql).toContain('teacher_id=p_teacher_id')
  expect(sql).toContain('limit 101')
  expect(sql).toContain("'target_count'")
  expect(sql).toContain("'after_student_id'")
  expect(sql).toContain("'snapshot_sha256'")
  expect(sql).toContain("message='retained_roster_cleanup_discovery_changed'")
  expect(sql).toContain('to service_role')
  expect(sql).not.toMatch(/grant[^;]*(?:to public|to anon|to authenticated)/i)
})
it('provides an explicitly rollback-scoped proof restoring singleton DDL and generation guards', () => {
  const proof = readFileSync(join(process.cwd(), 'scripts/check-retained-roster-group-cleanup-database.sql'), 'utf8')
  expect(proof).toContain('drop index public.classroom_roster_one_removed_membership_per_student')
  expect(proof).toContain('rollback;')
  expect(proof).not.toMatch(/^commit;/m)
  expect(proof).toContain('baseline.rows is distinct from pg_temp.group_cleanup_fingerprint()')
  expect(proof).toContain('baseline.singleton_index is distinct from pg_get_indexdef')
  expect(proof).toContain('generate_series(1,101)')
  expect(proof).toContain('private.register_pal_membership(learner.generation,pages.classroom,learner.student,\'removed\')')
  expect(proof).toContain('Synthetic retained page generations differ')
  expect(proof).toContain('Academic cleanup must be disabled before proof')
  expect(proof).toContain('baseline.membership_contract is distinct from pg_temp.group_cleanup_membership_contract()')
  expect(proof).toContain('baseline.kick_callback is distinct from pg_get_functiondef')
  expect(proof).toContain('Group removal must insert one generation job and attempt one callback')
  expect(proof).toContain('101st retained group omitted or repeated')
  expect(proof).toContain('Empty terminal page differs')
  expect(proof).toContain('Owner changed between pages accepted')
  expect(proof).toContain('Unknown continuation cursor accepted')
  for (const fault of ['suppress_second_roster', 'substitute_roster', 'suppress_binding', 'late_binding', 'late_retained_roster'])
    expect(proof).toContain(fault)
  for (const fenceCase of ['Binding OLD identity bypass accepted', 'Binding NEW identity bypass accepted',
    'Roster OLD identity bypass accepted', 'Roster NEW identity bypass accepted'])
    expect(proof).toContain(fenceCase)
  expect(proof).not.toMatch(/disable trigger|drop trigger.*guard_pal|net\.http|delete from storage/i)
})
it('prints only exact fixed proof receipts, never captured SQL fixture payloads', () => {
  const wrapper = readFileSync(join(process.cwd(), 'scripts/check-retained-roster-group-cleanup-database.sh'), 'utf8')
  expect(wrapper).toContain('GROUP_CLEANUP_OUTPUT="$(docker exec')
  expect(wrapper).toContain("grep -Fxq 'PASS retained roster group cleanup SQL and exact rollback teardown'")
  expect(wrapper).not.toMatch(/echo[^\n]*\$GROUP_CLEANUP_OUTPUT|printf[^\n]*\$GROUP_CLEANUP_OUTPUT/)
})
