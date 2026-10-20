import { readFileSync } from 'node:fs'
import { describe,expect,it } from 'vitest'
const path='supabase/migrations/275_contextual_attendance_owner_session_read.sql'
describe('owner attendance session source contracts (not PostgreSQL execution)',()=>{
  it('is one service-only bounded stable invoker snapshot with no business writes',()=>{
    const sql=readFileSync(path,'utf8'),body=sql.split('as $function$')[1].split('$function$')[0].replace(/--[^\n]*/g,'')
    expect(sql.match(/create function /gi)).toHaveLength(1)
    expect(sql).toMatch(/language sql stable security invoker/i);expect(sql).toContain("set search_path = ''");expect(sql).toContain("set lock_timeout = '1s'");expect(sql).toContain("set statement_timeout = '8s'")
    expect(body).not.toMatch(/\b(insert|update|delete|truncate|set_config)\b/i)
    expect(sql).toMatch(/revoke all on function[\s\S]*from public, anon, authenticated/)
    expect(sql).not.toMatch(/grant\s+(select|insert|update|delete)/i)
    expect(body).toContain('pg_catalog.statement_timestamp()');expect(body).toContain('get_attendance_classroom_access_v1')
    expect(body).not.toMatch(/users\.role|role = 'teacher'|limit 1000/i)
  })
  it('binds relationship before all data, complete current roster and original read filters',()=>{
    const sql=readFileSync(path,'utf8')
    expect(sql.indexOf("c.teacher_id is distinct from p_actor_id")).toBeLessThan(sql.indexOf("p_runtime_integration not in"))
    expect(sql).toContain("a.status = 'ok' and e.classroom_id = p_classroom_id")
    expect(sql).toContain("coalesce(p.first_name,'')");expect(sql).toContain("coalesce(p.last_name,'')")
    expect(sql).toContain('order by r.enrollment_id');expect(sql).toContain('p_class_date')
    expect(sql).toContain('s.installation_ref = p_installation_ref');expect(sql).toContain('f.installation_ref = p_installation_ref')
    expect(sql).toContain("b.status in ('pending','processing','non_retryable')")
    expect(sql).toContain('8388608');expect(sql).not.toMatch(/\blimit\s+\d+/i)
  })
  it('retains archived/runtime/canary and every maintenance fence without new grants',()=>{
    const sql=readFileSync(path,'utf8')
    expect(sql).toContain("when status <> 'ok' or archived_at is not null then 'disabled'")
    expect(sql).toContain("when p_runtime_integration <> 'ready' then p_runtime_integration")
    for(const token of ['cold_classroom_purge_fences','classroom_purge_fences','attendance_decommission_operations','pika.identity_mapping','pika.student_purge_finalize','pika.course_blueprint_purge_finalize'])expect(sql).toContain(token)
    expect(sql).not.toMatch(/grant\s+(select|insert|update|delete)|set_attendance_teacher_entitlement|13220260823/i)
  })
  it('source-only rollback covers actual service RPC, true127 prerequisite and complete read/fixture preservation',()=>{
    const sql=readFileSync('scripts/check-contextual-attendance-session.sql','utf8'),predecessor=readFileSync('supabase/migrations/127_bara_attendance_event_inbox.sql','utf8')
    expect(predecessor.includes('attendance_classroom_decommission_required')).toBe(true)
    for(const token of ['public.read_attendance_session_for_owner_v1','current_user<>\'service_role\'','generate_series(50,1050)','<>1004','pg_catalog.pg_my_temp_schema()','pg_catalog.aclexplode','rollback to fixture','Session read changed complete graph','automatic Free/Pal/full graph rollback differs'])expect(sql).toContain(token)
    expect(sql).not.toContain('grant usage on schema pg_temp to service_role')
    expect(sql).toContain("'d2000000-0000-4000-8000-000000000003'")
    expect(sql).toMatch(/rollback;\s*select pg_catalog.json_build_object[\s\S]*'attendance-session-rollback-contract-v1'/)
  })
})
