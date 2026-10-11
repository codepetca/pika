import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const path = 'supabase/migrations/260_contextual_test_owner_recovery.sql'
describe('bounded recovery migration source contract', () => {
  it('adds recovery to the existing seven-argument service-only RPC', () => {
    const sql = readFileSync(path, 'utf8')
    expect(sql).toContain("set statement_timeout = '8s'")
    expect(sql).toContain("set lock_timeout = '1s'")
    for (const operation of ['unsubmit-plan','unsubmit','delete-single','delete-bulk']) expect(sql).toContain(`'${operation}'`)
    expect(sql).toContain('revoke all on function public.test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamptz) from public, anon, authenticated')
  })
  it('fences exact source, current roster, active AI and collections before delegated writers', () => {
    const sql = readFileSync(path, 'utf8')
    expect(sql).toContain('p_expected_test is distinct from pg_catalog.to_jsonb(v_test)')
    expect(sql).toContain('v_expected_attempts is distinct from v_attempts')
    expect(sql).toContain("status in ('queued','running')")
    expect(sql).toContain('student_id <> p_actor_id')
    expect(sql).toContain('limit 10001')
    expect(sql).toContain('public.unsubmit_test_attempts_atomic(p_test_id,v_eligible,p_actor_id)')
    expect(sql).toContain('public.delete_student_test_attempt_atomic(p_test_id,v_ids[1])')
    expect(sql).toContain('public.delete_student_test_attempts_atomic(p_test_id,v_ids)')
  })
  it('contains only history failures after successful unsubmit and retains response drafts', () => {
    const sql = readFileSync(path, 'utf8')
    expect(sql.indexOf('public.unsubmit_test_attempts_atomic(p_test_id,v_eligible,p_actor_id)')).toBeLessThan(sql.indexOf('insert into public.test_attempt_history'))
    expect(sql).toContain("trigger)\n          values")
    expect(sql).toContain("'teacher_unsubmit'")
    expect(sql).toContain('exception when others then v_history_written := 0;')
    expect(sql).not.toMatch(/update public\.test_student_availability|delete from public\.test_questions/)
  })
})
