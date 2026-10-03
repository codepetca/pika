import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/235_contextual_roster_owner_writes.sql', 'utf8')
const body = (name: string) => sql.split(`create function ${name}`)[1]?.split('$function$;')[0] ?? ''
describe('roster owner write migration source contract (database proof is separate)', () => {
  it.each(['upsert_classroom_roster_for_owner_v1(uuid,uuid,jsonb,text)', 'update_classroom_roster_counselor_for_owner_v1(uuid,uuid,uuid,text,text)'])('grants only service-role %s', signature => {
    expect(sql).toContain(`revoke all on function public.${signature} from public,anon,authenticated;`)
    expect(sql).toContain(`grant execute on function public.${signature} to service_role;`)
  })
  it.each(['upsert_classroom_roster_for_owner_v1', 'update_classroom_roster_counselor_for_owner_v1'])('catches retrying SQLSTATEs inside %s', name => {
    const rpc = body(`public.${name}`)
    expect(rpc).toContain("security definer set search_path = ''")
    expect(rpc).toContain("exception when sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03' or sqlstate '55000'")
    expect(rpc).toContain("raise exception using errcode='PT409'")
    expect(rpc).toContain('private.lock_roster_owner_context_v1(')
    expect(rpc).toContain('v_enrollment_snapshot is distinct from')
    expect(rpc).toContain('private.valid_roster_owner_write_row_v1(v_row)')
  })
  it('orders class/user/identity/pair/row/revision locks and contains no blocking advisory acquisition', () => {
    const context = body('private.lock_roster_owner_context_v1')
    const seams = ['private.try_lock_classroom_membership_change(p_classroom_id)', 'public.guard_classroom_purge_lifecycle', 'for update nowait',
      'public.users u', 'for share nowait', 'pg_catalog.array_agg(distinct candidate.student_id',
      'private.try_lock_classroom_membership_change(p_classroom_id,v_id)', 'public.student_purge_fences',
      'order by r.id for update nowait', 'public.classroom_archive_revisions']
    let offset = -1
    for (const seam of seams) { const next = context.indexOf(seam, offset + 1); expect(next, seam).toBeGreaterThan(offset); offset = next }
    expect(sql).not.toContain('pg_advisory_xact_lock(')
    expect(context).not.toMatch(/\.role\s*=/)
  })
  it('retains installed guards and immutable migrations', () => {
    expect(sql).not.toContain('create or replace')
    expect(sql).not.toMatch(/(?:drop|disable)\s+trigger|set_config|create\s+table|delete from|blueprint_source_revision/i)
  })
  it('lets a stable binding win when another enrolled account now owns the historical email', () => {
    const context = body('private.lock_roster_owner_context_v1')
    expect(context).toContain('and not exists(select 1 from public.classroom_roster_student_bindings b where b.roster_id=v_roster.id)')
    expect(context).toContain("v_class.archived_at is not null then raise exception using errcode='42501'")
    expect(context).toContain('pg_catalog.lower(private.material_owner_write_title_v1(u.email))')
    expect(context).toContain('Roster binding changed')
  })
  it('preview returns before DML, with exact value comparison', () => {
    const upsert = body('public.upsert_classroom_roster_for_owner_v1')
    expect(upsert.indexOf("'needs_confirmation',true")).toBeLessThan(upsert.indexOf('insert into public.classroom_roster('))
    expect(upsert).toContain("v_values is distinct from v_item-'email'")
    expect(upsert).toContain("'update_count',pg_catalog.jsonb_array_length(v_changes)")
  })
  it('updates only approved fields and checks full history and late triggers', () => {
    expect(sql).toContain("pg_catalog.to_jsonb(v_row) is distinct from pg_catalog.to_jsonb(v_returned)")
    expect(sql).toContain('Roster binding history changed')
    expect(sql).toContain('Roster persisted set changed')
    expect(sql).toContain("update public.classroom_roster set counselor_email=p_counselor_email")
    expect(sql).toContain('count(*) = 16')
    expect(sql).toContain('private.valid_material_owner_write_timestamp_v1((p_row).updated_at)')
  })
  it('bounds rows and normalized duplicate emails before acquiring locks', () => {
    const upsert = body('public.upsert_classroom_roster_for_owner_v1')
    expect(upsert.indexOf('not between 1 and 1000')).toBeLessThan(upsert.indexOf('private.lock_roster_owner_context_v1('))
    expect(upsert).toContain('count(distinct email)')
    expect(upsert).toContain('Duplicate roster emails')
    expect(sql).toContain('between 1 and 320')
    expect(sql).toContain('and 500')
    expect(sql).toContain('<= 128')
  })
})
