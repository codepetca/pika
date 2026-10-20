import {readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'

const migration='supabase/migrations/278_contextual_classroom_authoring_guidance_read.sql'
const contract='scripts/check-contextual-classroom-authoring-guidance.sql'
const source=()=>readFileSync(migration,'utf8')
const body=()=>source().split('as $function$')[1]?.split('$function$')[0].replace(/--[^\n]*/g,'')??''
describe('classroom owner frozen guidance SQL source contracts (not PostgreSQL execution)',()=>{
  it('defines only the required two-UUID bounded stable invoker RPC',()=>{
    const sql=source()
    expect(sql.match(/create function /gi)).toHaveLength(1)
    for(const token of ['read_classroom_authoring_guidance_for_owner_v1(p_actor_id uuid,p_classroom_id uuid)',
      'language plpgsql stable security invoker',"set search_path = ''","set lock_timeout = '1s'","set statement_timeout = '8s'",
      'owner to postgres','from public,anon,authenticated','to service_role'])expect(sql).toContain(token)
    expect(body()).not.toMatch(/\b(insert|update|delete|truncate|set_config|pg_try_advisory|pg_advisory|for\s+share|for\s+update|limit)\b/i)
  })
  it('authorizes current classroom ownership before fences, lineage, or private versions, retaining archives',()=>{
    const sql=body()
    expect(sql.indexOf('v_classroom.teacher_id is distinct from p_actor_id')).toBeGreaterThan(0)
    expect(sql.indexOf('v_classroom.teacher_id is distinct from p_actor_id')).toBeLessThan(sql.indexOf('is_classroom_archive_maintenance_mode'))
    expect(sql.indexOf('v_classroom.teacher_id is distinct from p_actor_id')).toBeLessThan(sql.indexOf('from public.course_blueprint_versions'))
    expect(sql).not.toMatch(/archived_at|role\s*=\s*'teacher'|from public\.course_blueprints\b|attendance_|entitlement|principal|guard_.*purge_lifecycle/i)
  })
  it('checks exact read-side lifecycle fences and adds only the missing Blueprint fence column privilege',()=>{
    const sql=source()
    for(const token of ['classroom_purge_fences','cold_classroom_purge_fences','course_blueprint_purge_fences',
      'pika.identity_mapping','pika.classroom_purge_finalize','pika.course_blueprint_purge_finalize','pika.student_purge_finalize',
      "is_classroom_archive_maintenance_mode('restore')","is_classroom_archive_maintenance_mode('compaction')"] )expect(sql).toContain(token)
    expect(sql.match(/grant select[^;]*;/gi)).toEqual(['grant select (course_blueprint_id) on public.course_blueprint_purge_fences to service_role;'])
    expect(sql).not.toMatch(/with grant option|grant (insert|update|delete)|security definer/i)
  })
  it('binds immutable structural/adopted parents, distinguishes partial lineage and returns only the permitted projection',()=>{
    const sql=source()
    for(const token of ['source_blueprint_id is null or v_classroom.source_blueprint_version_id is null',
      'coalesce(v_classroom.authoring_guidance_version_id,v_classroom.source_blueprint_version_id)',
      'v_content.course_blueprint_id is distinct from v_classroom.source_blueprint_id',
      'v_guidance.course_blueprint_id is distinct from v_classroom.source_blueprint_id',
      "'version_parents'","'content',v_content.course_blueprint_id","'guidance',v_guidance.course_blueprint_id",
      "v_guidance.snapshot_json->'authoring_guidance'","'content_version_id'","'source_blueprint_version_id'",
      "'assignment_titles'","'test_titles'",'with ordinality','order by ordinal'])expect(sql).toContain(token)
    expect(body()).not.toMatch(/jsonb_build_object\([^;]*'snapshot_json'|jsonb_build_object\([^;]*'answers'/i)
  })
  it('enforces complete operational byte/work bounds before title expansion and safe numeric metadata',()=>{
    const sql=source()
    for(const token of ['8388608','10000','9007199254740991','v_guidance.id is distinct from v_content.id',
      "pg_catalog.convert_to(v_content.snapshot_json::text,'UTF8')",'v_snapshot_bytes > 8388608',
      'v_content.version_number < 1','v_guidance.version_number < 1','v_guidance.source_draft_revision < 0',
      "pg_catalog.jsonb_typeof(item->'title') = 'string'","item->>'title' <> ''"])expect(sql).toContain(token)
    expect(sql.indexOf('v_snapshot_bytes > 8388608')).toBeLessThan(sql.indexOf('pg_catalog.jsonb_array_elements'))
    expect(sql.indexOf('v_title_items > 10000')).toBeLessThan(sql.indexOf('pg_catalog.jsonb_array_elements'))
    expect(sql).not.toMatch(/\b(trim|btrim|ltrim|rtrim)\s*\(/i)
  })
  it('has only finite privacy-safe error contracts, including explicit missing and nonowner outcomes',()=>{
    const sql=source()
    expect([...sql.matchAll(/errcode = '(PT\d+)'/g)].map(m=>m[1])).toEqual(expect.arrayContaining(['PT400','PT404','PT403','PT503']))
    for(const name of ['invalid_argument','missing','forbidden','fenced','unavailable','invalid','too_large'])expect(sql).toContain(`class_authoring_guidance_${name}`)
    expect(sql).not.toMatch(/raise notice|raise warning|sqlerrm/i)
  })
  it('uses actual service-role reads, catalog/column ACL assertions and real complete500/200 title fixtures',()=>{
    const sql=readFileSync(contract,'utf8')
    for(const token of ["current_user<>'service_role'",'public.read_classroom_authoring_guidance_for_owner_v1','pg_catalog.aclexplode',
      'pg_catalog.has_column_privilege','pg_catalog.has_table_privilege','pg_catalog.pg_my_temp_schema()',
      'generate_series(1,500)','generate_series(1,200)','guidance_full_graph','Guidance read changed complete public/private graph',
      'rollback to fixture','automatic Free/Pal/full graph rollback differs','savepoint archived','savepoint stale_owner','savepoint adopted',
      'savepoint hot_fence','savepoint blueprint_fence','savepoint title_work_limit','savepoint snapshot_limit'])expect(sql).toContain(token)
    expect(sql).not.toMatch(/disable trigger|session_replication_role|grant usage on schema pg_temp to service_role|update public\.course_blueprint_versions/i)
    expect(sql).toMatch(/rollback;\s*select pg_catalog.json_build_object[\s\S]*'classroom-authoring-guidance-rollback-contract-v1'/)
  })
})
