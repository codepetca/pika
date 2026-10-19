import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/270_contextual_gradebook_workflow.sql'), 'utf8')
describe('contextual Gradebook SQL boundary', () => {
  it('defines only the three frozen public RPCs with service-only ACLs', () => {
    for (const name of ['get_gradebook_for_owner_v1', 'get_gradebook_for_member_v1', 'mutate_gradebook_for_owner_v1']) {
      expect(sql).toContain(`create function public.${name}(`)
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^;]+to service_role`, 'i'))
    }
    expect(sql.match(/security definer set search_path = ''/g)).toHaveLength(3)
    expect(sql).not.toMatch(/auth\.uid\(|users\.role/)
  })
  it('uses current lifecycle, exclusive membership and revision fences', () => {
    expect(sql).toContain('private.try_lock_classroom_membership_change')
    expect(sql).toContain('public.guard_classroom_purge_lifecycle')
    expect(sql).toContain('public.classroom_archive_revisions')
    expect(sql).toContain('for update nowait')
    expect(sql).toContain('private.student_provider_cleanup_bindings')
    expect(sql).toContain('public.student_purge_fences')
  })
  it('bounds explicit source rows before aggregating and delegates grading writes', () => {
    for (const cap of [1001, 21, 50001, 100001, 500001, 201001]) expect(sql).toContain(`limit ${cap}`)
    expect(sql).toContain('as materialized')
    expect(sql).toContain('16777216')
    expect(sql).toContain('20971520')
    expect(sql).toContain('public.replace_gradebook_categories(')
    expect(sql).toContain('public.mutate_gradebook_item(')
    expect(sql).toContain('public.save_gradebook_effective_mark(')
    expect(sql).toContain('public.set_gradebook_maximum_override(')
  })
  it('keeps snapshot caps before guarded array construction and independent completion caps', () => {
    const source = sql.split('create function private.gradebook_source_v1(')[1]?.split('$function$;')[0]
    expect(source).toBeDefined()
    expect(source!.indexOf('limit 500001')).toBeLessThan(source!.indexOf('source_stats as materialized'))
    expect(source!.indexOf('source_guard as materialized')).toBeLessThan(source!.indexOf('case when not invalid then jsonb_build_object('))
    expect(source).toContain('octet_length(field.value#>>\'{}\')>16384')
    expect(source).toContain('having count(*)>500')
    expect(source).toContain('>200000')
    expect(sql.match(/octet_length\(v_result::text\)>20971520/g)).toHaveLength(3)
  })
  it('preserves removed subjects and owns no shared/advisory replacement protocol', () => {
    const context = sql.split('create function private.lock_gradebook_context_v1(')[1]?.split('$function$;')[0]
    expect(context).toContain('item_subjects as materialized')
    expect(context).toContain('override_subjects as materialized')
    expect(context).toContain('union select student_id from item_subjects')
    expect(context).not.toContain('pg_try_advisory_xact_lock_shared')
    expect(context).not.toContain('writer_revision')
    expect(context).toContain('cardinality(v_subjects)>1000')
  })
  it('uses explicit item projections and strict request-target acknowledgements', () => {
    expect(sql).toContain("v_target:=case")
    expect(sql).toContain("'operation',p_action,'target',v_target,'result',v_result")
    expect(sql).toContain("'gradebook_score_scale',v_item->'gradebook_score_scale'")
    expect(sql).not.toContain("'item',to_jsonb(v_item)")
    expect(sql).not.toMatch(/create (?:or replace )?function public\.(?:mutate_gradebook_item|set_gradebook_maximum_override|save_gradebook_effective_mark|replace_gradebook_categories)/)
  })
  it('rolls back a category replacement unless the complete legacy result matches the normalized authorized request', () => {
    const replacement = sql.split("elsif p_action='categories_replace' then")[1]?.split("elsif p_action='override_save' then")[0]
    expect(replacement).toBeDefined()
    expect(replacement).toContain("v_result->'categories' is distinct from v_expected_categories")
    expect(replacement).toContain("errcode='PT409', message='gradebook_categories_changed'")
    expect(replacement).toContain("'classroom_id',p_classroom_id")
    expect(replacement).toContain("'name',btrim(category->>'name')")
    expect(replacement).toContain("'position',(ordinality-1)::integer")
    for (const key of ['id', 'percentage', 'default_assessment_weight', 'is_default']) expect(replacement).toContain(`'${key}',(category->>'${key}')::`)
    expect(replacement!.indexOf('from public.replace_gradebook_categories(')).toBeLessThan(replacement!.indexOf("v_result->'categories' is distinct from v_expected_categories"))
    const contract = readFileSync(resolve(process.cwd(), 'scripts/contextual-gradebook-db-contracts.sql'), 'utf8')
    expect(contract).toContain('Category mismatch changed authorized payload/revision')
    expect(contract).toContain('Category mismatch changed foreign payload/revision')
    expect(contract).toContain('Not a concurrent race proof')
  })
  it('ships a rollback-only synthetic native contract without claiming concurrency', () => {
    const contract = readFileSync(resolve(process.cwd(), 'scripts/contextual-gradebook-db-contracts.sql'), 'utf8')
    expect(contract.trim()).toMatch(/rollback;$/)
    expect(contract).toContain("set local statement_timeout='8s'")
    expect(contract).toContain('Payload/revision changed after failed mutation')
    expect(contract).toContain('Removed subject fence failed')
    expect(contract).toContain('Stale maximum CAS failed')
    expect(contract).toContain('concurrency and SDK proof remain separate')
  })
})
