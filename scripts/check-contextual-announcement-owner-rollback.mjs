#!/usr/bin/env node
// Definition/contract rehearsal only: every function, fixture and audit is
// created inside one transaction and rolled back. This applies no migration.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const container = 'supabase_db_pika'
assert.equal(execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim(), 'pika')
assert.match(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }), /:54322\s*$/m)
const migration = fileURLToPath(new URL('../supabase/migrations/232_contextual_announcement_owner_mutations.sql', import.meta.url))
const definition = readFileSync(migration, 'utf8')
const tag = `announcement_owner_${randomUUID().slice(0, 8)}`
const owner = randomUUID(), teacher = randomUUID(), member = randomUUID()
const classroom = randomUUID(), teacherClassroom = randomUUID()
const quote = value => `'${String(value).replaceAll("'", "''")}'`
const run = input => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
  '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], { input, encoding: 'utf8', timeout: 45_000 }).trim()
const installed = run("select to_regprocedure('public.create_announcement_for_owner_v1(uuid,uuid,text,boolean,timestamptz,text)') is not null;")
assert(['t', 'f'].includes(installed))
const fixture = `
set statement_timeout='30s'; set lock_timeout='4s';
begin;
${installed === 'f' ? definition : ''}
insert into public.users(id,email,role) values
  ('${owner}','${tag}_owner@example.invalid','student'),
  ('${teacher}','${tag}_teacher@example.invalid','teacher'),
  ('${member}','${tag}_member@example.invalid','teacher');
set local role service_role;
select public.set_effective_feature_entitlement_v1(gen_random_uuid(), u, 'classrooms.create',
  'manual', true, clock_timestamp(), null, 2, 'test:announcement-owner', '${tag}',
  coalesce((select revision from public.effective_feature_entitlements where subject_user_id=u and feature_key='classrooms.create'),0))
  from (values ('${owner}'::uuid),('${teacher}'::uuid)) fixture(u);
reset role;
insert into public.classrooms(id,teacher_id,title,class_code) values
  ('${classroom}','${owner}','${tag}_owner','${tag}_o'),
  ('${teacherClassroom}','${teacher}','${tag}_teacher','${tag}_t');
insert into public.classroom_enrollments(classroom_id,student_id) values ('${classroom}','${member}');

do $test$
declare
  v_signature text;
  v_row jsonb;
  v_before jsonb;
  v_id uuid;
  v_schedule timestamptz := clock_timestamp() + interval '1 day';
  v_revision bigint;
  v_operation uuid;
begin
  foreach v_signature in array array[
    'public.create_announcement_for_owner_v1(uuid,uuid,text,boolean,timestamptz,text)',
    'public.update_announcement_for_owner_v1(uuid,uuid,uuid,jsonb)',
    'public.delete_announcement_for_owner_v1(uuid,uuid,uuid)'
  ] loop
    if has_function_privilege('anon',v_signature,'execute')
      or has_function_privilege('authenticated',v_signature,'execute')
      or not has_function_privilege('service_role',v_signature,'execute') then
      raise exception 'Function privilege contract violated';
    end if;
    if not exists(select 1 from pg_proc where oid=to_regprocedure(v_signature)
      and prosecdef and proconfig @> array['search_path=""']::text[]) then
      raise exception 'Function security metadata contract violated';
    end if;
  end loop;

  v_row := public.create_announcement_for_owner_v1('${owner}','${classroom}',
    'Unicode normalized content',true,null,'Draft')->'announcement';
  v_id := (v_row->>'id')::uuid;
  begin perform public.update_announcement_for_owner_v1('${owner}','${classroom}',v_id,
    jsonb_build_object('title',repeat('😀',31)));
    raise exception 'UTF16 title limit not enforced'; exception when sqlstate '22023' then null; end;
  perform public.update_announcement_for_owner_v1('${owner}','${classroom}',v_id,
    jsonb_build_object('title',repeat('😀',30)));
  perform public.update_announcement_for_owner_v1('${owner}','${classroom}',v_id,'{"title":"Draft"}'::jsonb);
  if (select count(*) from jsonb_object_keys(v_row)) <> 10
    or v_row->>'classroom_id' <> '${classroom}' or v_row->>'created_by' <> '${owner}'
    or v_row->>'is_draft' <> 'true' or v_row->'published_at' <> 'null'::jsonb
    or v_row->'scheduled_for' <> 'null'::jsonb then raise exception 'Draft create contract failed'; end if;
  perform public.create_announcement_for_owner_v1('${teacher}','${teacherClassroom}',
    'Teacher-valued owner',false,null,null);
  v_before := v_row;
  v_row := public.update_announcement_for_owner_v1('${owner}','${classroom}',v_id,
    '{"content":"Edited","title":null}'::jsonb)->'announcement';
  if v_row->>'content' <> 'Edited' or v_row->'title' <> 'null'::jsonb
    or v_row->'is_draft' <> v_before->'is_draft' or v_row->'published_at' <> v_before->'published_at'
    or v_row->'created_at' <> v_before->'created_at' then raise exception 'Content/title patch failed'; end if;
  v_row := public.update_announcement_for_owner_v1('${owner}','${classroom}',v_id,
    jsonb_build_object('scheduled_for',v_schedule))->'announcement';
  if v_row->>'is_draft' <> 'false' or (v_row->>'scheduled_for')::timestamptz <> v_schedule
    or v_row->'published_at' <> v_row->'scheduled_for' then raise exception 'Schedule patch failed'; end if;
  v_before := v_row;
  select revision into v_revision from public.classroom_archive_revisions where classroom_id='${classroom}';
  v_row := public.update_announcement_for_owner_v1('${owner}','${classroom}',v_id,
    '{"is_draft":false}'::jsonb)->'announcement';
  if v_row is distinct from v_before or v_revision is distinct from
    (select revision from public.classroom_archive_revisions where classroom_id='${classroom}') then
    raise exception 'Published no-op changed row or revision';
  end if;
  v_row := public.update_announcement_for_owner_v1('${owner}','${classroom}',v_id,
    '{"is_draft":true,"scheduled_for":null}'::jsonb)->'announcement';
  if v_row->>'is_draft' <> 'true' or v_row->'published_at' <> 'null'::jsonb
    or v_row->'scheduled_for' <> 'null'::jsonb then raise exception 'Draft transition failed'; end if;
  v_row := public.update_announcement_for_owner_v1('${owner}','${classroom}',v_id,
    '{"is_draft":false}'::jsonb)->'announcement';
  if v_row->>'is_draft' <> 'false' or v_row->'published_at' = 'null'::jsonb
    or v_row->'scheduled_for' <> 'null'::jsonb then raise exception 'Publish draft failed'; end if;
  v_row := public.update_announcement_for_owner_v1('${owner}','${classroom}',v_id,
    '{"scheduled_for":null}'::jsonb)->'announcement';
  if v_row->>'is_draft' <> 'false' or v_row->'scheduled_for' <> 'null'::jsonb then
    raise exception 'Publish immediately failed'; end if;
  -- A different current owner may edit a historical author's announcement.
  update public.classrooms set teacher_id='${teacher}' where id='${classroom}';
  v_row := public.update_announcement_for_owner_v1('${teacher}','${classroom}',v_id,
    '{"content":"Transferred edit"}'::jsonb)->'announcement';
  if v_row->>'created_by' <> '${owner}' or v_row->'created_at' <> v_before->'created_at' then
    raise exception 'Transfer changed historical authorship'; end if;
  begin perform public.update_announcement_for_owner_v1('${owner}','${classroom}',v_id,'{"title":"denied"}'::jsonb);
    raise exception 'Former owner unexpectedly admitted'; exception when sqlstate '42501' then null; end;
  begin perform public.create_announcement_for_owner_v1('${member}','${classroom}','denied',false,null,null);
    raise exception 'Member unexpectedly admitted'; exception when sqlstate '42501' then null; end;
  begin perform public.update_announcement_for_owner_v1('${teacher}','${teacherClassroom}',v_id,'{"title":"cross-class"}'::jsonb);
    raise exception 'Cross-class resource unexpectedly admitted'; exception when sqlstate 'PT404' then null; end;
  begin perform public.delete_announcement_for_owner_v1('${teacher}',gen_random_uuid(),v_id);
    raise exception 'Missing class unexpectedly admitted'; exception when sqlstate 'P0002' then null; end;
  update public.classrooms set archived_at=clock_timestamp() where id='${classroom}';
  begin perform public.delete_announcement_for_owner_v1('${teacher}','${classroom}',v_id);
    raise exception 'Archived deletion unexpectedly admitted'; exception when sqlstate '42501' then null; end;
  update public.classrooms set archived_at=null where id='${classroom}';
  for v_row in select value from jsonb_array_elements('[{}, {"created_by":"${member}"},
    {"content":null}, {"content":""}, {"title":12}, {"is_draft":null}, {"scheduled_for":12},
    {"scheduled_for":"invalid"}, {"is_draft":true,"scheduled_for":"2099-01-01T00:00:00Z"}]'::jsonb) loop
    begin perform public.update_announcement_for_owner_v1('${teacher}','${classroom}',v_id,v_row);
      raise exception 'Malformed patch unexpectedly admitted'; exception when sqlstate '22023' then null; end;
  end loop;
  insert into public.announcement_reads(announcement_id,user_id) values(v_id,'${member}');
  -- Real lifecycle fences, rolled back inside their own subtransactions. No
  -- global settings/maintenance capabilities are changed for these proofs.
  begin
    v_operation := gen_random_uuid();
    insert into public.classroom_purge_operations(id,teacher_id,classroom_id,classroom_title,
      request_sha256,status,source_revision,impact_summary,retryable,error_code)
      select v_operation,'${teacher}',id,title,repeat('9',64),'failed',1,'{}'::jsonb,true,'database_finalize_failed'
      from public.classrooms where id='${classroom}';
    insert into public.classroom_purge_fences(classroom_id,operation_id,teacher_id)
      values('${classroom}',v_operation,'${teacher}');
    begin perform public.create_announcement_for_owner_v1('${teacher}','${classroom}','fenced',false,null,null);
      raise exception 'Hot-fenced create admitted'; exception when sqlstate 'PT409' then null; end;
    begin perform public.update_announcement_for_owner_v1('${teacher}','${classroom}',v_id,'{"title":"fenced"}'::jsonb);
      raise exception 'Hot-fenced update admitted'; exception when sqlstate 'PT409' then null; end;
    begin perform public.delete_announcement_for_owner_v1('${teacher}','${classroom}',v_id);
      raise exception 'Hot-fenced delete admitted'; exception when sqlstate 'PT409' then null; end;
    raise exception using errcode='ZX001',message='Rollback synthetic hot fence';
  exception when sqlstate 'ZX001' then null; end;
  begin
    insert into public.attendance_decommission_operations(id,classroom_id,teacher_id,
      installation_ref,roster_ref,actor_principal_ref)
      values(gen_random_uuid(),'${classroom}','${teacher}','synthetic-rollback','synthetic-roster','synthetic-principal');
    begin perform public.create_announcement_for_owner_v1('${teacher}','${classroom}','fenced',false,null,null);
      raise exception 'Decommission-fenced create admitted'; exception when sqlstate 'PT409' then null; end;
    begin perform public.update_announcement_for_owner_v1('${teacher}','${classroom}',v_id,'{"title":"fenced"}'::jsonb);
      raise exception 'Decommission-fenced update admitted'; exception when sqlstate 'PT409' then null; end;
    begin perform public.delete_announcement_for_owner_v1('${teacher}','${classroom}',v_id);
      raise exception 'Decommission-fenced delete admitted'; exception when sqlstate 'PT409' then null; end;
    raise exception using errcode='ZX001',message='Rollback synthetic decommission fence';
  exception when sqlstate 'ZX001' then null; end;
  if public.delete_announcement_for_owner_v1('${teacher}','${classroom}',v_id)
    <> jsonb_build_object('deleted',true,'announcement_id',v_id,'classroom_id','${classroom}'::uuid) then
    raise exception 'Delete binding failed'; end if;
  if exists(select 1 from public.announcement_reads where announcement_id=v_id)
    or exists(select 1 from public.announcements where id=v_id) then raise exception 'Receipt cascade failed'; end if;
end;
$test$;
rollback;
select 'PASS definition-only rollback announcement owner/publication/tenancy/security contracts';
`
console.log(run(fixture))
assert.equal(run(`select
  (select count(*) from public.users where id in ('${owner}','${teacher}','${member}'))+
  (select count(*) from public.classrooms where id in ('${classroom}','${teacherClassroom}'))+
  (select count(*) from public.account_plan_audit where subject_user_id in ('${owner}','${teacher}','${member}'))+
  (select count(*) from public.effective_feature_entitlement_audit where subject_user_id in ('${owner}','${teacher}','${member}'));
`), '0')
assert.equal(run("select to_regprocedure('public.create_announcement_for_owner_v1(uuid,uuid,text,boolean,timestamptz,text)') is not null;"), installed)
console.log('PASS zero fixture/audit residue; no schema or migration history applied')
