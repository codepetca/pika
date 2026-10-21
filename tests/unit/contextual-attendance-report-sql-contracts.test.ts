import {readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'
const migration='supabase/migrations/276_contextual_attendance_owner_report_read.sql'
describe('owner report source contracts (not PostgreSQL execution)',()=>{
  it('is one two-argument bounded service-only stable invoker snapshot',()=>{
    const sql=readFileSync(migration,'utf8'),body=sql.split('as $function$')[1].split('$function$')[0].replace(/--[^\n]*/g,'')
    expect(sql.match(/create function /gi)).toHaveLength(1);expect(sql).toContain('p_actor_id uuid,p_classroom_id uuid')
    for(const token of ['language sql stable security invoker',"set search_path = ''","set lock_timeout = '1s'","set statement_timeout = '8s'",'pg_catalog.statement_timestamp()','8388608'])expect(sql).toContain(token)
    expect(body).not.toMatch(/\b(insert|update|delete|truncate|set_config|limit)\b/i)
    expect(sql).toContain('from public,anon,authenticated');expect(sql).toContain('to service_role')
    expect(sql).not.toMatch(/grant\s+(select|insert|update|delete)/i)
  })
  it('keeps ownership before data, full current roster, complete ordered days/entries and lifecycle fences',()=>{
    const sql=readFileSync(migration,'utf8')
    expect(sql.indexOf('c.teacher_id is distinct from p_actor_id')).toBeLessThan(sql.indexOf('is_classroom_archive_maintenance_mode'))
    for(const token of ["d.status = 'ok' and e.classroom_id = p_classroom_id","coalesce(p.first_name,'')","coalesce(p.last_name,'')",'order by c.date','order by e.id','exists(select 1 from roster r where r.id = e.student_id)',
      'cold_classroom_purge_fences','classroom_purge_fences','pika.identity_mapping','pika.student_purge_finalize','pika.course_blueprint_purge_finalize'])expect(sql).toContain(token)
    expect(sql).not.toMatch(/archived_at is not null|role\s*=\s*'teacher'/i)
  })
  it('does not introduce Bara entitlement, runtime, principal or decommission dependencies',()=>{
    const sql=readFileSync(migration,'utf8'),adapter=readFileSync('src/lib/server/contextual-attendance-report.ts','utf8')
    for(const source of [sql,adapter])expect(source).not.toMatch(/attendance_teacher_entitlements|attendance_decommission_operations|attendance_principal|process\.env|bara-attendance|scope_mode|canary/i)
    expect(adapter).toContain('computeAttendanceRecords(students,days,entries,formatDateInToronto(new Date(snapshot.observed_at)))')
    expect(adapter).toContain('AbortSignal.timeout(10_000)')
  })
  it('contains genuine service RPC, >1000 boundaries, strict catalog/ACL and full fixture/read rollback source',()=>{
    const sql=readFileSync('scripts/check-contextual-attendance-report.sql','utf8'),prior=readFileSync('supabase/migrations/127_bara_attendance_event_inbox.sql','utf8')
    expect(prior).toContain('attendance_classroom_decommission_required')
    for(const token of ['public.read_attendance_report_for_owner_v1',"current_user<>'service_role'",'generate_series(50,1050)','generate_series(0,1000)','<>1004','<>1001','pg_catalog.pg_my_temp_schema()','pg_catalog.aclexplode',
      'Report read changed complete public/private graph','rollback to fixture','automatic Free/Pal/full graph rollback differs','savepoint archived','savepoint stale_owner','savepoint revoked','savepoint decommission','savepoint hot_fence'])expect(sql).toContain(token)
    expect(sql).not.toContain('grant usage on schema pg_temp to service_role')
    expect(sql).toMatch(/rollback;\s*select pg_catalog.json_build_object[\s\S]*'attendance-report-rollback-contract-v1'/)
  })
})
