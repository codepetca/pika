import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const sql = readFileSync('supabase/migrations/333_contextual_test_member_session_read.sql', 'utf8')
const body = sql.split('as $function$')[1].split('$function$;')[0]
describe('contextual session read SQL source invariants', () => {
  it('uses one stable snapshot and does not acquire row/advisory locks or mutate data', () => {
    expect(sql).toContain('language sql stable security definer')
    const statements = body.replace(/--[^\n]*/g, '')
    expect(statements.match(/;/g)).toHaveLength(1)
    expect(statements).not.toMatch(/\b(insert|update|delete|perform|execute)\b|pg_(?:try_)?advisory|for\s+(?:share|key\s+share|update)/i)
  })
  it('binds current own relationship and all inherited lifecycle fences', () => {
    for (const required of ['p.teacher_id = p_actor_id', 'p.archived_at is not null', "p.feature_visibility->'tests'",
      'e.student_id = p_actor_id', 't.student_id = p_actor_id', 'r.student_id = p_actor_id', 's.student_id = p_actor_id',
      'p.blueprint_archived_at is not null', 'public.classroom_purge_fences', 'public.cold_classroom_purge_fences',
      'public.attendance_decommission_operations', 'private.student_provider_cleanup_bindings', "operation.status <> 'completed'",
      "pika.identity_mapping", 'pika.classroom_purge_finalize', 'pika.course_blueprint_purge_finalize', 'pika.student_purge_finalize'])
      expect(body).toContain(required)
    expect(body).not.toMatch(/\.role\s*=/)
    expect(body).toMatch(/when exists\(select 1 from public\.classroom_purge_fences[\s\S]*?public\.attendance_decommission_operations[\s\S]*?then 'unavailable'/)
  })
  it('projects only compact status and preserves existing contextual response predicate', () => {
    expect(body).toContain('r.selected_option is not null')
    expect(body).toContain("pg_catalog.btrim(coalesce(r.response_text,''))")
    expect(body).not.toMatch(/jsonb_build_object\([^;]*(?:'responses'|'documents'|'question_text'|'score'|'feedback')/)
    expect(sql).toContain('from public, anon, authenticated;')
    expect(sql).toContain('to service_role;')
    expect(sql).toContain("set search_path = ''")
    expect(sql).toContain("set statement_timeout = '8s'")
    expect(body).toContain("least(p_deadline, b.started_at + interval '8 seconds')")
  })
  it('provides a rollback matrix against original contextual session behavior', () => {
    const contracts = readFileSync('scripts/check-contextual-test-session-read.sql', 'utf8')
    expect(contracts).toContain("public.test_learner_workflow_v1(actor,tid,cid,'session'")
    expect(contracts).toContain('count_cases <> 144')
    expect(contracts).toContain("fresh->'projection' is distinct from jsonb_build_object")
    expect(contracts).toContain('rollback;')
  })
})
