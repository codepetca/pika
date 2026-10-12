import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const sql = readFileSync('supabase/migrations/261_contextual_test_owner_unpublish.sql', 'utf8')
const legacy = readFileSync('supabase/migrations/255_return_test_to_draft_atomic.sql', 'utf8')
const body = (source: string) => source.split('as $function$\n')[1].split('\n$function$;')[0]
describe('contextual unpublish mechanical legacy parity', () => {
  it('keeps all260 operation bodies and configuration mechanically unchanged', () => {
    const original = readFileSync('supabase/migrations/260_contextual_test_owner_recovery.sql', 'utf8')
    const current = sql.slice(sql.indexOf('create or replace function public.test_owner_workflow_v1'))
      .replace('  v_unpublish_draft_version integer;\n', '')
      .replace(/  -- Match255 archive-before-actor\/Test order only for the delegated unpublish core\.\n  if p_operation = 'unpublish' then\n[\s\S]*?\n  end if;\n/, '')
      .replace(/  elsif p_operation = 'unpublish' then\n[\s\S]*?(?=  elsif p_operation = 'results' then)/, '')
      .replace(/    or \(p_operation = 'unpublish' and \(pg_catalog\.to_jsonb\(v_after\)[\s\S]*?v_inner->'test' is distinct from pg_catalog\.to_jsonb\(v_after\)\)\)\n/, '')
      .replaceAll(",'unpublish'", '')
    expect(current).toBe(original.slice(original.indexOf('create or replace function public.test_owner_workflow_v1')))
  })
  it('retains every legacy business check and write, with only a private role policy', () => {
    expect(body(sql).replace("  if p_require_teacher is null then\n    raise exception using errcode = 'PT400', message = 'test_unpublish_invalid_input';\n  end if;\n", '').replace("(not p_require_teacher or role = 'teacher')", "role = 'teacher'")).toBe(body(legacy))
  })
  it('keeps the policy knob private and both public boundaries service-only', () => {
    expect(sql).toContain('security invoker')
    expect(sql).toContain('alter function private.return_test_to_draft_core_v1(uuid,uuid,boolean) owner to postgres;')
    expect(sql).toContain('revoke all on function private.return_test_to_draft_core_v1(uuid,uuid,boolean) from public, anon, authenticated, service_role;')
    expect(sql).toContain('private.return_test_to_draft_core_v1(p_teacher_id,p_test_id,true)')
    expect(sql).toContain('private.return_test_to_draft_core_v1(p_actor_id,p_test_id,false)')
    expect(sql).not.toContain('grant execute on function private.return_test_to_draft_core_v1')
  })
  it('locks archive revision before actor and Test, only for unpublish', () => {
    const owner = sql.slice(sql.indexOf('create or replace function public.test_owner_workflow_v1'))
    const lock = owner.indexOf("if p_operation = 'unpublish' then\n    perform 1 from public.classroom_archive_revisions")
    expect(lock).toBeGreaterThan(owner.indexOf('public.guard_classroom_purge_lifecycle'))
    expect(lock).toBeLessThan(owner.indexOf('perform 1 from public.users'))
    expect(owner.indexOf('p_expected_test is distinct')).toBeLessThan(owner.indexOf('private.return_test_to_draft_core_v1'))
    expect(owner).toContain("v_inner->'test' is distinct from pg_catalog.to_jsonb(v_after)")
    expect(owner).toContain("pg_catalog.to_jsonb(v_after) - array['status','updated_at']")
    expect(owner).toContain("v_test.status = 'draft' and v_after is distinct from v_test")
    expect(owner).toContain("v_inner->'draft_version' is distinct from pg_catalog.to_jsonb(v_unpublish_draft_version)")
    expect(owner).not.toMatch(/when insufficient_privilege then\s+if p_operation in \([^\n]*'unpublish'/)
  })
})
