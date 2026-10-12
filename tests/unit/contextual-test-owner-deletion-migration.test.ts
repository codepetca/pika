import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const path = 'supabase/migrations/262_contextual_test_owner_delete.sql'
const sql = existsSync(path) ? readFileSync(path, 'utf8') : ''
const prior = readFileSync('supabase/migrations/261_contextual_test_owner_unpublish.sql', 'utf8')
const owner = (source: string) => source.slice(source.indexOf('create or replace function public.test_owner_workflow_v1'))
describe('whole-Test delete additive source contracts (not native proof)', () => {
  it('adds exactly one legacy delegate without changing094 or redefining it', () => {
    expect(sql.match(/public\.delete_test_atomic\(p_test_id,p_actor_id\)/g)).toHaveLength(1)
    expect(sql).not.toContain('create or replace function public.delete_test_atomic')
    const deletion = sql.slice(sql.indexOf("  elsif p_operation = 'delete' then"), sql.indexOf("  elsif p_operation = 'unpublish' then"))
    expect(deletion).not.toMatch(/delete from public\.|assessment_drafts|queued|running|storage\.objects|require_teacher/)
    expect(sql).toContain("  elsif p_operation in ('unsubmit-plan','unsubmit','delete-single','delete-bulk') then")
    expect(sql).not.toContain("  elsif p_operation in ('unsubmit-plan','unsubmit','delete-single','delete-bulk','delete') then")
  })
  it('mechanically preserves every261 normal operation and footer', () => {
    const restored = owner(sql).replaceAll(",'delete'", '')
      .replace(/  elsif p_operation = 'delete' then\n[\s\S]*?(?=  elsif p_operation = 'unpublish' then)/, '')
      .replace(/  -- Deletion acknowledges the captured source and absence; normal operations retain their surviving-row footer\.\n  if p_operation = 'delete' then\n[\s\S]*?\n  end if;\n(?=  select \* into v_after)/, '')
    expect(restored).toBe(owner(prior))
  })
  it('keeps exact initial authority/CAS fences and lock order', () => {
    const start = owner(sql).slice(0, owner(sql).indexOf("  if p_operation = 'inspect' then"))
    expect(start.replaceAll(",'delete'", '')).toBe(owner(prior).slice(0, owner(prior).indexOf("  if p_operation = 'inspect' then")))
    expect(start).toContain("'delete-bulk','unpublish','delete') and p_expected_test is distinct from pg_catalog.to_jsonb(v_test)")
  })
  it('requires strict legacy result, all-ID absence and bound captured-source acknowledgement', () => {
    expect(sql).toContain("v_inner - array['deleted','responses_count'] <> '{}'::jsonb")
    expect(sql).toContain("v_inner->'deleted' is distinct from 'true'::jsonb")
    expect(sql).toContain("pg_catalog.jsonb_typeof(v_inner->'responses_count') is distinct from 'number'")
    expect(sql).toContain("(v_inner->>'responses_count')::numeric > 2147483647")
    expect(sql.match(/exists\(select 1 from public\.tests where id = p_test_id\)/g)).toHaveLength(2)
    expect(sql).toContain("'operation',p_operation,'test',pg_catalog.to_jsonb(v_test),'result',v_result,'test_absent',true")
    expect(sql).toContain('and archived_at is null')
    expect(sql).toContain('public.guard_classroom_purge_lifecycle(v_classroom_id)')
  })
  it('retains seven arguments, finite deadline, empty search path and service-only ACL', () => {
    expect(sql).toContain("set search_path = ''"); expect(sql).toContain("if pg_catalog.clock_timestamp() >= v_phase_deadline then")
    expect(sql).toContain('revoke all on function public.test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamptz) from public, anon, authenticated;')
    expect(sql).toContain('grant execute on function public.test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamptz) to service_role;')
  })
})
