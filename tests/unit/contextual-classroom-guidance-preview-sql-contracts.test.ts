import {readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'
const migration='supabase/migrations/279_contextual_classroom_guidance_preview.sql'
const contract='scripts/check-contextual-classroom-guidance-preview.sql'
const source=()=>readFileSync(migration,'utf8')
const body=()=>source().split('as $function$')[1]?.split('$function$')[0].replace(/--[^\n]*/g,'')??''
describe('dual-owner guidance preview SQL source contracts (not PostgreSQL execution)',()=>{
  it('defines exactly one required two-UUID stable service-only invoker read',()=>{
    const sql=source()
    expect(sql.match(/create function /gi)).toHaveLength(1)
    for(const token of ['preview_classroom_authoring_guidance_for_owner_v1(p_actor_id uuid,p_classroom_id uuid)',
      'language plpgsql stable security invoker',"set search_path = ''","set lock_timeout = '1s'","set statement_timeout = '8s'",
      'owner to postgres','from public,anon,authenticated','to service_role'])expect(sql).toContain(token)
    expect(body()).not.toMatch(/\b(insert|update|delete|truncate|set_config|pg_try_advisory|pg_advisory|for\s+share|for\s+update|limit)\b/i)
    expect(sql).not.toMatch(/security definer|grant (select|insert|update|delete)|with grant option/i)
  })
  it('authorizes class and Blueprint identities before private guidance, versions and fences',()=>{
    const sql=body(),classAuth=sql.indexOf('v_classroom.teacher_id is distinct from p_actor_id'),bpAuth=sql.indexOf('v_blueprint.teacher_id is distinct from p_actor_id')
    expect(classAuth).toBeGreaterThan(0);expect(bpAuth).toBeGreaterThan(classAuth)
    expect(sql.indexOf('v_classroom.archived_at is not null')).toBeGreaterThan(classAuth)
    expect(sql.indexOf('v_classroom.source_blueprint_id is null')).toBeLessThan(bpAuth)
    for(const token of ['is_classroom_archive_maintenance_mode','from public.course_blueprint_versions','b.authoring_guidance'])expect(sql.indexOf(token)).toBeGreaterThan(bpAuth)
    expect(sql).toContain('select b.id,b.teacher_id');expect(sql).not.toMatch(/role\s*=\s*'teacher'|attendance_|entitlement|principal|guard_.*purge_lifecycle/i)
  })
  it('reads all established maintenance and related purge fences without acquiring lifecycle locks',()=>{
    const sql=body()
    for(const token of ['classroom_purge_fences','cold_classroom_purge_fences','course_blueprint_purge_fences',
      'pika.identity_mapping','pika.classroom_purge_finalize','pika.course_blueprint_purge_finalize','pika.student_purge_finalize',
      "is_classroom_archive_maintenance_mode('restore')","is_classroom_archive_maintenance_mode('compaction')"])expect(sql).toContain(token)
    expect(sql).not.toMatch(/\block\b|\bperform\b|pg_.*advisory/i)
  })
  it('binds both selected Version parents and returns only the finite private preview wire',()=>{
    const sql=source()
    for(const token of ['v.course_blueprint_id = v_classroom.source_blueprint_id',
      'coalesce(v_classroom.authoring_guidance_version_id,v_classroom.source_blueprint_version_id)',
      "'classroom'","'blueprint'","'versions'","'content'","'current_guidance',v_guidance.snapshot_json->'authoring_guidance'","'guidance',v_live.authoring_guidance",
      "'course_blueprint_id',v_content.course_blueprint_id","'course_blueprint_id',v_guidance.course_blueprint_id"] )expect(sql).toContain(token)
    expect(body()).not.toMatch(/course_blueprint_(assignments|assessments|materials|surveys|lesson_templates)|latest_version|authoring_guidance_revisions|jsonb_array_elements|\bchanged\b|jsonb_build_object\([^;]*'snapshot_json'/i)
  })
  it('bounds distinct UTF8 snapshots plus live guidance and final wire, with safe numeric metadata',()=>{
    const sql=source()
    for(const token of ['8388608','9007199254740991','v_guidance.id is distinct from v_content.id',
      "pg_catalog.convert_to(v_content.snapshot_json::text,'UTF8')","pg_catalog.convert_to(coalesce(v_live.authoring_guidance,'null'::jsonb)::text,'UTF8')",
      'v_guidance.version_number < 1','v_live.content_revision < 1',"pg_catalog.jsonb_typeof(v_content.snapshot_json) is distinct from 'object'",
      "pg_catalog.jsonb_typeof(v_guidance.snapshot_json) is distinct from 'object'"])expect(sql).toContain(token)
    expect(sql).not.toMatch(/10000|\b(trim|btrim|ltrim|rtrim)\s*\(/i)
  })
  it('retains exact finite missing/ownership/archive/unlinked and sanitized operational errors',()=>{
    const sql=source()
    for(const token of ['PT400','PT403','PT404','PT409','PT503'])expect(sql).toContain(`errcode = '${token}'`)
    for(const name of ['invalid_argument','classroom_missing','blueprint_missing','forbidden','archived','unlinked','fenced','unavailable','invalid','too_large'])expect(sql).toContain(`class_guidance_preview_${name}`)
    expect(sql).not.toMatch(/raise notice|raise warning|sqlerrm/i)
  })
  it('prepares genuine service-role catalog, authorization, fresh state and complete rollback cases',()=>{
    const sql=readFileSync(contract,'utf8')
    for(const token of ["current_user<>'service_role'",'public.preview_classroom_authoring_guidance_for_owner_v1','pg_catalog.aclexplode',
      'pg_catalog.has_column_privilege','pg_catalog.has_table_privilege','pg_catalog.pg_my_temp_schema()',
      'preview_full_graph','Preview read changed complete public/private graph','rollback to fixture','automatic Free/Pal/full graph rollback differs',
      'savepoint archived','savepoint stale_owner','savepoint blueprint_owner','savepoint adopted','savepoint rebind','savepoint draft_change',
      'savepoint hot_fence','savepoint blueprint_fence','savepoint snapshot_limit','savepoint wire_limit'])expect(sql).toContain(token)
    expect(sql).not.toMatch(/disable trigger|session_replication_role|grant usage on schema pg_temp to service_role|update public\.course_blueprint_versions/i)
    expect(sql).toMatch(/rollback;\s*select pg_catalog.json_build_object[\s\S]*'classroom-guidance-preview-rollback-contract-v1'/)
  })
})
