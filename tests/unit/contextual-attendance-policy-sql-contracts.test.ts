import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/273_contextual_attendance_owner_policy_read.sql', 'utf8')
const rollback = readFileSync('scripts/check-contextual-attendance-policy.sql', 'utf8')
describe('contextual attendance policy SQL source contract', () => {
  it('has one bounded invoker snapshot and only service execution', () => {
    expect(sql).toContain('language sql stable security invoker')
    expect(sql).toContain("set search_path = ''")
    expect(sql).toContain("set lock_timeout = '1s'")
    expect(sql).toContain("set statement_timeout = '8s'")
    expect(sql.match(/create function/g)).toHaveLength(1)
    expect(sql).toContain('from public, anon, authenticated')
    expect(sql).toContain('grant select (classroom_id) on public.attendance_decommission_operations to service_role')
    expect(sql).not.toMatch(/\b(insert|update|delete|auth\.uid|auth\.role|security definer|select\s+\*)\b/i)
  })
  it('binds current ownership before canary or unchanged entitlements', () => {
    expect(sql.indexOf('c.teacher_id is distinct from p_actor_id')).toBeLessThan(sql.indexOf("when p_scope_mode = 'exact_canary'"))
    expect(sql).toContain('p_canary_actor_id = p_actor_id and p_canary_classroom_id = p_classroom_id')
    expect(sql).toContain('public.get_attendance_classroom_access_v1(p_actor_id, p_classroom_id, pg_catalog.statement_timestamp())')
    expect(sql).not.toMatch(/users|principal_mappings|participant_mappings|outbox|classroom_enrollments|set_config/i)
    for (const fence of ['classroom_purge_fences', 'cold_classroom_purge_fences', 'attendance_decommission_operations',
      "is_classroom_archive_maintenance_mode('restore')", "is_classroom_archive_maintenance_mode('compaction')"] ) expect(sql).toContain(fence)
  })
  it('emits one tiny explicit policy with identity and an all-or-nothing output cap', () => {
    expect(sql).toContain('payload as materialized')
    expect(sql).toContain("octet_length(pg_catalog.convert_to(result::text, 'UTF8')) > 4096")
    expect(sql).toContain('then null else result end from payload')
    expect(sql).toContain("case when decision.status = 'ready' then")
    expect(sql).toContain('p.classroom_id = p_classroom_id')
    expect(sql).not.toMatch(/provider_id|email|password|installation_ref|roster_ref|actor_principal_ref/i)
  })
  it('keeps the rollback helper private and explicitly usable after changing to service_role', () => {
    expect(rollback).toContain("exception when invalid_schema_name then null;")
    expect(rollback).toContain('where oid = pg_catalog.pg_my_temp_schema();')
    expect(rollback).toContain("execute pg_catalog.format('grant usage on schema %I to service_role', v_schema);")
    expect(rollback).toContain('revoke all on function pg_temp.expect_attendance_policy(uuid,uuid,text,text,uuid,uuid) from public, anon, authenticated;')
    expect(rollback).toContain('grant execute on function pg_temp.expect_attendance_policy(uuid,uuid,text,text,uuid,uuid) to service_role;')
    expect(rollback.indexOf("execute pg_catalog.format('grant usage on schema %I to service_role', v_schema)")).toBeLessThan(rollback.indexOf('set local role service_role;'))
    expect(rollback).toContain("raise exception 'Attendance snapshot mismatch';")
    expect(rollback).not.toMatch(/raise exception[^;]*(?:%|v_result)/i)
    expect(rollback).not.toMatch(/disable\s+trigger|session_replication_role/i)
    expect(rollback).toMatch(/reset role;\s*rollback;\s*select pg_catalog.json_build_object\('version',1,'scope','attendance-policy-rollback-contract-v1'/)
  })
  it('states the actual cold-root coverage without fabricating a hot/cold overlap', () => {
    const coldPurge = readFileSync('supabase/migrations/122_cold_archived_classroom_purge.sql', 'utf8')
    expect(coldPurge).toMatch(/if exists \(\s*select 1 from public.classrooms where id = p_classroom_id\s*\)[\s\S]*?classroom_is_hot_archived/)
    expect(sql.indexOf('c.id is null')).toBeLessThan(sql.indexOf('from public.cold_classroom_purge_fences'))
    expect(rollback).toContain('This proves absent-parent denial, not a fabricated hot/cold overlap')
  })
  it('keeps the hot-fence fixture attendance-free under the real127 purge trigger prerequisite (source only)', () => {
    const predecessor = readFileSync('supabase/migrations/127_bara_attendance_event_inbox.sql', 'utf8')
    expect(predecessor).toMatch(/create trigger reject_attendance_classroom_purge_v1\s+before insert on public\.classroom_purge_operations\s+for each row execute function public\.reject_attendance_destructive_operation_v1\(\)/)
    expect(predecessor).toMatch(/elsif tg_table_name = 'classroom_purge_operations'\s+and public\.attendance_classroom_has_state_v1\(new\.classroom_id\) then\s+raise exception using\s+errcode = '55000',\s+message = 'attendance_classroom_decommission_required'/)
    const predicate = predecessor.split('create function public.attendance_classroom_has_state_v1(')[1]
      .split('create function public.reject_attendance_classroom_delete_v1(')[0]
    const attendanceTables = [...predicate.matchAll(/from public\.(\w+) where classroom_id = p_classroom_id/g)].map(row => row[1])
    expect(attendanceTables).toHaveLength(8)
    expect(attendanceTables).toContain('attendance_window_policies')
    expect(attendanceTables).toContain('attendance_roster_mappings')
    const hotClass = 'f2000000-0000-4000-8000-000000000003', owner = 'f1000000-0000-4000-8000-000000000001'
    const inserts = [...rollback.matchAll(/insert into public\.(\w+)\([^;]+?\)\s+values\s+([^;]+);/g)]
    expect(inserts.find(row => row[1] === 'classrooms')?.[2]).toContain(`('${hotClass}','${owner}',`)
    for (const table of attendanceTables) {
      for (const insert of inserts.filter(row => row[1] === table)) expect(insert[2]).not.toContain(hotClass)
    }
    const hotFence = rollback.split('savepoint hot_fence;')[1].split('rollback to hot_fence;')[0]
    expect(hotFence.match(new RegExp(hotClass, 'g'))).toHaveLength(3)
    expect(hotFence).toContain(`pg_temp.expect_attendance_policy('${owner}','${hotClass}','teacher_entitlements','blocked')`)
  })
})
