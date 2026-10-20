import {readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'
const migration='supabase/migrations/280_contextual_classroom_guidance_adoption.sql'
const rollback='scripts/check-contextual-classroom-guidance-adoption.sql'
const sql=()=>readFileSync(migration,'utf8')
const section=(name:string)=>sql().split('create function '+name)[1]?.split('$function$;')[0]??''
describe('contextual guidance adoption280 SQL source contracts, not PostgreSQL execution',()=>{
 it('parenthesizes CASE expressions inside rollback IF conditions so inner THEN cannot terminate the condition',()=>{
  const s=readFileSync(rollback,'utf8')
  // PL/pgSQL reads IF through the first THEN outside parentheses, not CASE END.
  // These are source regressions; actual PostgreSQL compilation is proved separately.
  expect(s).toContain("p.provolatile<>(case when expected_args=9 then 'v' else 's' end)")
  expect(s).toContain("(before_row->>'latest_version_number')::bigint+(case when new_version then 1 else 0 end)")
  expect(s).toContain("jsonb_array_length(old_graph->'public.course_blueprint_versions')+(case when new_version then 1 else 0 end)")
  expect(s).not.toMatch(/p\.provolatile<>case|\+case when new_version/)
 })
 it('defines only the private projection and two required-argument service entrypoints',()=>{
  const s=sql();expect(s.match(/create function /g)).toHaveLength(3)
  for(const name of ['private.classroom_guidance_adoption_source_v1(p_blueprint_id uuid)','public.read_classroom_guidance_adoption_source_v1(','public.save_and_adopt_classroom_guidance_for_owner_v1('])expect(s).toContain(name)
  expect(s.match(/security definer/g)).toHaveLength(3)
  expect(s.match(/set search_path = ''/g)).toHaveLength(3)
  expect(s.match(/set lock_timeout = '1s'/g)).toHaveLength(3)
  expect(s.match(/set statement_timeout = '8s'/g)).toHaveLength(3)
  expect(s).not.toMatch(/\bdefault\b|grant (select|insert|update|delete|usage)|create table|create schema/i)
  expect(s).toContain('revoke all on function private.classroom_guidance_adoption_source_v1(uuid) from public,anon,authenticated,service_role')
  expect(s.match(/grant execute/g)).toHaveLength(2)
 })
 it('keeps complete lossless five-table source projection private, ordered and preaggregation bounded',()=>{
  const s=section('private.classroom_guidance_adoption_source_v1')
  for(const name of ['assignments','assessments','lesson_templates','materials','surveys']){
   expect(s).toContain('public.course_blueprint_'+name)
   expect(s).toContain("'"+name+"'")
  }
  for(const key of ['submission_requirements_json','default_due_days','default_due_time','track_authenticity','assessment_type','documents','questions_json','authoring_guidance','planned_site_config','gradebook_assignments_weight'])expect(s).toContain(key)
  expect(s).toContain('count(*)');expect(s).toContain('order by r.position,r.id')
  expect(s.indexOf('v_raw_bytes > 8388608')).toBeLessThan(s.indexOf('jsonb_agg'))
  expect(s).toContain("pg_catalog.sha256(pg_catalog.convert_to(v_source::text,'UTF8'))")
  expect(s).not.toMatch(/\blimit\b|for update|pg_.*advisory|normalize|strip.*document|linked_classroom/i)
 })
 it.each(['public.read_classroom_guidance_adoption_source_v1','public.save_and_adopt_classroom_guidance_for_owner_v1'])('authorizes both active current owners before private reads/effects in %s',name=>{
  const s=section(name),a=s.indexOf('v_classroom.teacher_id is distinct from p_actor_id'),b=s.indexOf('v_blueprint.teacher_id is distinct from p_actor_id')
  expect(a).toBeGreaterThan(0);expect(b).toBeGreaterThan(a)
  expect(s.indexOf('private.classroom_guidance_adoption_source_v1')).toBeGreaterThan(b)
  for(const token of ["is_classroom_archive_maintenance_mode('restore')","is_classroom_archive_maintenance_mode('compaction')",'pika.identity_mapping','pika.classroom_purge_finalize','pika.course_blueprint_purge_finalize','pika.student_purge_finalize','cold_classroom_purge_fences','course_blueprint_purge_fences'])expect(s).toContain(token)
  expect(s).not.toMatch(/role\s*=\s*'teacher'|entitlement|attendance_|provider/i)
 })
 it('uses established118/120 operation order before NOWAIT parent rows and rechecks after locks',()=>{
  const s=section('public.save_and_adopt_classroom_guidance_for_owner_v1')
  const ordered=['guard_classroom_purge_lifecycle(p_classroom_id)','guard_course_blueprint_purge_lifecycle(p_blueprint_id)','from public.course_blueprints b where b.id = p_blueprint_id for update nowait','from public.classrooms c where c.id = p_classroom_id for update nowait','private.classroom_guidance_adoption_source_v1']
  for(let n=1;n<ordered.length;n++)expect(s.indexOf(ordered[n])).toBeGreaterThan(s.indexOf(ordered[n-1]))
  expect(s.match(/v_classroom.teacher_id is distinct from p_actor_id/g)).toHaveLength(2)
  expect(s.match(/v_blueprint.teacher_id is distinct from p_actor_id/g)).toHaveLength(2)
 })
 it('binds parents and six expected arguments, raw digest and canonical UTF8 provenance before112',()=>{
  const s=sql()
  for(const token of ['p_expected_content_version_id uuid','p_expected_guidance_version_id uuid','p_expected_draft_revision bigint','p_source_sha256 text','p_snapshot_canonical text','p_snapshot_sha256 text','9007199254740991','v_content.course_blueprint_id','v_guidance.course_blueprint_id','v_snapshot_bytes','v_snapshot::text','v_projection->>\'source_sha256\'','v_snapshot->>\'blueprint_id\'','v_snapshot->>\'draft_revision\''])expect(s).toContain(token)
  const w=section('public.save_and_adopt_classroom_guidance_for_owner_v1')
  expect(w.indexOf('v_projection->>\'source_sha256\'')).toBeLessThan(w.indexOf('public.save_course_blueprint_version_atomic'))
  expect(w).toContain("pg_catalog.jsonb_typeof(v_snapshot->'draft_revision') is distinct from 'number'")
  expect(w).toContain("pg_catalog.jsonb_typeof(v_snapshot->'schema_version') is distinct from 'number'")
  expect(w).not.toMatch(/canonicalize|jsonb_pretty|\bdelete\b|insert into public|update public/)
 })
 it('atomically reuses unchanged112 then222, constants, final pointer and legitimate dedup provenance',()=>{
  const s=section('public.save_and_adopt_classroom_guidance_for_owner_v1')
  expect(s.indexOf('public.adopt_classroom_authoring_guidance_v1')).toBeGreaterThan(s.indexOf('public.save_course_blueprint_version_atomic'))
  for(const token of ["'pika','{}'::jsonb",'v_saved.id','v_saved.snapshot_sha256','v_after.authoring_guidance_version_id','previous_guidance_version_id','guidance_version'])expect(s).toContain(token)
  expect(s).not.toMatch(/v_saved.source_kind\s*(<>|is distinct)|exception[\s\S]*return jsonb_build_object/i)
  expect(s).toContain('when lock_not_available')
  expect(s).toContain('else raise;')
 })
 it('has finite sanitized errors and never suppresses unknown failures into committed JSON',()=>{
  for(const name of ['invalid_argument','classroom_missing','blueprint_missing','forbidden','archived','unlinked','changed','busy','fenced','unavailable','invalid','too_large'])expect(sql()).toContain('class_guidance_adoption_'+name)
  expect(sql()).not.toMatch(/raise notice|raise warning|return.*'ok',false|disable trigger|session_replication_role/i)
 })
 it('prepares actual service-role completeness, rollback atomicity and preservation proofs',()=>{
  const s=readFileSync(rollback,'utf8')
  for(const token of ['pg_my_temp_schema()','current_user<>\'service_role\'','adoption_full_graph','savepoint fixture','1001','source_sha256','savepoint failure_after_save','create trigger adoption_force_failure','savepoint child_parent_move','savepoint other_provenance','savepoint hot_fence','savepoint blueprint_fence','snapshot_limit','source_limit','rollback to fixture','automatic Free/Pal/full graph rollback differs','classroom-guidance-adoption-rollback-contract-v1'])expect(s).toContain(token)
  expect(s).toContain('savepoint snapshot_parsed_over_limit');expect(s).toContain('savepoint snapshot_text_exact_limit')
  expect(s).toContain('savepoint quoted_schema_version');expect(s).toContain('savepoint quoted_draft_revision')
  expect(s).toContain('parsed_bytes<>8388609');expect(s).toContain('Adoption exact source envelope boundary differs')
  expect(s).not.toMatch(/disable trigger|session_replication_role|delete from public.course_blueprint_versions|update public.course_blueprint_versions|grant usage on schema pg_temp to service_role/i)
 })
})
