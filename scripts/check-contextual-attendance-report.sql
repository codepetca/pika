-- SOURCE ONLY until separately authorized isolated execution. No PostgreSQL claim.
begin;
create function pg_temp.attendance_report_graph() returns jsonb language plpgsql security invoker set search_path='' as $body$
declare t record; rows jsonb; graph jsonb:='{}'::jsonb;
begin
  for t in select n.nspname,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relkind in ('r','p') order by n.nspname,c.relname loop
    execute pg_catalog.format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb) from %I.%I r',t.nspname,t.relname) into rows;
    graph:=graph||pg_catalog.jsonb_build_object(t.nspname||'.'||t.relname,rows);
  end loop;
  return graph;
end; $body$;
revoke all on function pg_temp.attendance_report_graph() from public,anon,authenticated,service_role;
create temporary table attendance_report_original on commit drop as select pg_temp.attendance_report_graph() as graph;
create temporary table attendance_report_before_read on commit drop as select pg_temp.attendance_report_graph() as graph;
create function pg_temp.expect_attendance_report(actor uuid,classroom uuid,expected_status text) returns jsonb
language plpgsql security invoker set search_path='' as $body$
declare result jsonb;
begin
  if current_user<>'service_role' then raise exception 'Report contract did not exercise service role';end if;
  result:=public.read_attendance_report_for_owner_v1(actor,classroom);
  if result is null or result->>'actor_id' is distinct from actor::text or result->>'classroom_id' is distinct from classroom::text
    or result->>'status' is distinct from expected_status or (result->>'observed_at')::timestamptz is distinct from statement_timestamp()
    or (select array_agg(key order by key) from jsonb_object_keys(result) key) is distinct from
      array['actor_id','class_days','classroom_id','entries','observed_at','status','students']::text[]
    or (expected_status<>'ok' and (result->'students'<>'[]'::jsonb or result->'class_days'<>'[]'::jsonb or result->'entries'<>'[]'::jsonb))
    then raise exception 'Owner report snapshot binding/schema/disclosure differs';end if;
  if exists(select 1 from jsonb_array_elements(result->'students') r where
      (select array_agg(key order by key) from jsonb_object_keys(r) key) is distinct from array['email','first_name','id','last_name']::text[])
    or exists(select 1 from jsonb_array_elements(result->'class_days') r where r->>'classroom_id'<>classroom::text or
      (select array_agg(key order by key) from jsonb_object_keys(r) key) is distinct from array['classroom_id','date','is_class_day']::text[])
    or exists(select 1 from jsonb_array_elements(result->'entries') r where r->>'classroom_id'<>classroom::text or
      not exists(select 1 from jsonb_array_elements(result->'students') s where s->>'id'=r->>'student_id') or
      (select array_agg(key order by key) from jsonb_object_keys(r) key) is distinct from array['classroom_id','date','id','student_id','text']::text[])
    then raise exception 'Owner report nested binding/schema differs';end if;
  return result;
end; $body$;
do $temp_acl$ declare ns name;begin
  select nspname into strict ns from pg_catalog.pg_namespace where oid=pg_catalog.pg_my_temp_schema();
  if ns !~ '^pg_temp_[0-9]+$' then raise exception 'Unexpected temporary schema';end if;
  execute pg_catalog.format('grant usage on schema %I to service_role',ns);
end; $temp_acl$;
revoke all on function pg_temp.expect_attendance_report(uuid,uuid,text) from public,anon,authenticated;
grant execute on function pg_temp.expect_attendance_report(uuid,uuid,text) to service_role;
create function pg_temp.assert_attendance_report_unchanged() returns void language plpgsql security invoker set search_path='' as $body$
begin
  if pg_temp.attendance_report_graph() is distinct from (select graph from pg_temp.attendance_report_before_read)
    then raise exception 'Report read changed complete public/private graph';end if;
end; $body$;
revoke all on function pg_temp.assert_attendance_report_unchanged() from public,anon,authenticated,service_role;
do $catalog$ declare p pg_catalog.pg_proc%rowtype;begin
  select * into strict p from pg_catalog.pg_proc where oid='public.read_attendance_report_for_owner_v1(uuid,uuid)'::regprocedure;
  if p.provolatile<>'s' or p.prosecdef or p.prokind<>'f' or p.proretset or p.proisstrict or p.proleakproof
    or (select lanname from pg_catalog.pg_language where oid=p.prolang)<>'sql'
    or pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' or p.prorettype<>'jsonb'::regtype
    or p.pronargs<>2 or p.pronargdefaults<>0 or p.proargnames is distinct from array['p_actor_id','p_classroom_id']::text[]
    or p.proconfig is null or cardinality(p.proconfig)<>3 or not ('search_path=""'=any(p.proconfig) and 'lock_timeout=1s'=any(p.proconfig) and 'statement_timeout=8s'=any(p.proconfig))
    or pg_catalog.has_function_privilege('anon',p.oid,'execute') or pg_catalog.has_function_privilege('authenticated',p.oid,'execute')
    or not pg_catalog.has_function_privilege('service_role',p.oid,'execute')
    or exists(select 1 from pg_catalog.aclexplode(p.proacl) a where a.grantee not in (p.proowner,'service_role'::regrole::oid) or a.privilege_type<>'EXECUTE' or a.is_grantable)
    then raise exception 'Owner report RPC catalog/ACL differs';end if;
end; $catalog$;
savepoint fixture;
insert into public.users(id,email,role) values
 ('e1000000-0000-4000-8000-000000000001','report_teacher@example.invalid','teacher'),
 ('e1000000-0000-4000-8000-000000000002','report_student_owner@example.invalid','student'),
 ('e1000000-0000-4000-8000-000000000003','report_member@example.invalid','teacher'),
 ('e1000000-0000-4000-8000-000000000004','report_removed@example.invalid','student');
insert into public.users(id,email,role)
 select ('e1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'report_bulk_'||n||'@example.invalid','student' from generate_series(50,1050) n;
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Report A','AREPTA'),
 ('e2000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000002','Report B','AREPTB'),
 ('e2000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000001','Attendance-free purge class','AREPTC');
insert into public.classroom_enrollments(classroom_id,student_id)
 select 'e2000000-0000-4000-8000-000000000001',id from public.users where id in
 ('e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000003')
 or id in (select ('e1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(50,1050) n);
insert into public.classroom_enrollments(classroom_id,student_id) values
 ('e2000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000002');
insert into public.student_profiles(user_id,first_name,last_name) values('e1000000-0000-4000-8000-000000000001','Report Owner','');
insert into public.class_days(classroom_id,date,is_class_day)
 select 'e2000000-0000-4000-8000-000000000001',date '2020-01-01'+n,n<>1 from generate_series(0,1000) n;
insert into public.entries(classroom_id,student_id,date,text,on_time)
 select 'e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',date '2020-01-01'+n,
 case n when 0 then U&'\2003\FEFF' else 'Qualifying Daily Log' end,true from generate_series(0,1000) n;
-- Retained removed-student and cross-class records are not current-roster rows.
insert into public.entries(classroom_id,student_id,date,text,on_time) values
 ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000004','2020-01-01','Retained history',true),
 ('e2000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000002','2020-01-01','Different classroom',true);
update pg_temp.attendance_report_before_read set graph=pg_temp.attendance_report_graph();
set local role service_role;
do $matrix$ declare a uuid:='e1000000-0000-4000-8000-000000000001';b uuid:='e1000000-0000-4000-8000-000000000002';
 c uuid:='e2000000-0000-4000-8000-000000000001';d uuid:='e2000000-0000-4000-8000-000000000002';v jsonb;r jsonb;begin
 v:=pg_temp.expect_attendance_report(a,c,'ok');
 if jsonb_array_length(v->'students')<>1004 or jsonb_array_length(v->'class_days')<>1001 or jsonb_array_length(v->'entries')<>1001
   or v#>>'{entries,0,id}' is null or not exists(select 1 from jsonb_array_elements(v->'entries') e where e->>'text'=U&'\2003\FEFF')
   then raise exception 'Report complete pagination/content differs';end if;
 if (select jsonb_agg(e->>'id' order by e->>'id') from jsonb_array_elements(v->'entries') e)
    is distinct from (select jsonb_agg(e->>'id' order by n) from jsonb_array_elements(v->'entries') with ordinality x(e,n))
   or (select jsonb_agg(e->>'date' order by e->>'date') from jsonb_array_elements(v->'class_days') e)
    is distinct from (select jsonb_agg(e->>'date' order by n) from jsonb_array_elements(v->'class_days') with ordinality x(e,n))
   then raise exception 'Report day/entry order differs';end if;
 select value into r from jsonb_array_elements(v->'students') where value->>'id'=a::text;
 if r->>'first_name'<>'Report Owner' or r->>'last_name'<>'' then raise exception 'Report profile differs';end if;
 select value into r from jsonb_array_elements(v->'students') where value->>'id'=b::text;
 if r->>'first_name'<>'' or r->>'last_name'<>'' then raise exception 'Report fallback differs';end if;
 perform pg_temp.expect_attendance_report(b,d,'ok');
 perform pg_temp.expect_attendance_report(a,'e2000000-0000-4000-8000-000000000003','ok');
 perform pg_temp.expect_attendance_report(b,c,'forbidden');perform pg_temp.expect_attendance_report(a,d,'forbidden');
 perform pg_temp.expect_attendance_report('e1000000-0000-4000-8000-000000000003',c,'forbidden');
 perform pg_temp.expect_attendance_report('e1000000-0000-4000-8000-000000000004',c,'forbidden');
 perform pg_temp.expect_attendance_report(a,'e2000000-0000-4000-8000-000000000099','forbidden');
end; $matrix$;
reset role;
do $unchanged$ begin perform pg_temp.assert_attendance_report_unchanged();end;$unchanged$;
savepoint archived;
update public.classrooms set archived_at=statement_timestamp() where id='e2000000-0000-4000-8000-000000000001';
update pg_temp.attendance_report_before_read set graph=pg_temp.attendance_report_graph();
set local role service_role;do $read$ begin perform pg_temp.expect_attendance_report('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','ok');end;$read$;reset role;
do $unchanged$ begin perform pg_temp.assert_attendance_report_unchanged();end;$unchanged$;rollback to archived;
savepoint stale_owner;
update public.classrooms set teacher_id='e1000000-0000-4000-8000-000000000002' where id='e2000000-0000-4000-8000-000000000001';
update pg_temp.attendance_report_before_read set graph=pg_temp.attendance_report_graph();
set local role service_role;do $read$ begin perform pg_temp.expect_attendance_report('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','forbidden');end;$read$;reset role;
do $unchanged$ begin perform pg_temp.assert_attendance_report_unchanged();end;$unchanged$;rollback to stale_owner;
-- No grant exists above. Adding then revoking a synthetic grant cannot affect this report.
savepoint revoked;
insert into public.attendance_teacher_entitlements(teacher_id,status,valid_from,revision,source) values
 ('e1000000-0000-4000-8000-000000000001','revoked','2020-01-01',1,'synthetic_test');
update pg_temp.attendance_report_before_read set graph=pg_temp.attendance_report_graph();
set local role service_role;do $read$ begin perform pg_temp.expect_attendance_report('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','ok');end;$read$;reset role;
do $unchanged$ begin perform pg_temp.assert_attendance_report_unchanged();end;$unchanged$;rollback to revoked;
savepoint decommission;
insert into public.attendance_decommission_operations(id,classroom_id,teacher_id,installation_ref,roster_ref,actor_principal_ref) values
 ('e4000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','report_fixture','roster_fixture','principal_fixture');
update pg_temp.attendance_report_before_read set graph=pg_temp.attendance_report_graph();
set local role service_role;do $read$ begin perform pg_temp.expect_attendance_report('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','ok');end;$read$;reset role;
do $unchanged$ begin perform pg_temp.assert_attendance_report_unchanged();end;$unchanged$;rollback to decommission;
update pg_temp.attendance_report_before_read set graph=pg_temp.attendance_report_graph();
set local role service_role;do $maintenance$ declare k text;begin
 foreach k in array array['pika.classroom_archive_restore','pika.classroom_archive_compaction','pika.identity_mapping','pika.classroom_purge_finalize','pika.course_blueprint_purge_finalize','pika.student_purge_finalize'] loop
  perform set_config(k,'on',true);perform pg_temp.expect_attendance_report('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','blocked');perform set_config(k,'off',true);
 end loop;end;$maintenance$;reset role;
do $unchanged$ begin perform pg_temp.assert_attendance_report_unchanged();end;$unchanged$;
savepoint hot_fence;
-- Genuine127 prerequisite: class C contains NO attendance state.
insert into public.classroom_purge_operations(id,teacher_id,classroom_id,request_sha256,source_revision,impact_summary) values
 ('e3000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000003',repeat('a',64),1,'{}');
insert into public.classroom_purge_fences(classroom_id,operation_id,teacher_id) values
 ('e2000000-0000-4000-8000-000000000003','e3000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001');
update pg_temp.attendance_report_before_read set graph=pg_temp.attendance_report_graph();
set local role service_role;do $read$ begin perform pg_temp.expect_attendance_report('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000003','blocked');end;$read$;reset role;
do $unchanged$ begin perform pg_temp.assert_attendance_report_unchanged();end;$unchanged$;rollback to hot_fence;
savepoint oversized;
update public.entries set text=repeat('x',8388608) where classroom_id='e2000000-0000-4000-8000-000000000001'
 and student_id='e1000000-0000-4000-8000-000000000001' and date='2020-01-01';
update pg_temp.attendance_report_before_read set graph=pg_temp.attendance_report_graph();
set local role service_role;do $read$ begin
 if public.read_attendance_report_for_owner_v1('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001') is not null
  then raise exception 'Oversized report silently truncated or disclosed';end if;
end;$read$;reset role;
do $unchanged$ begin perform pg_temp.assert_attendance_report_unchanged();end;$unchanged$;rollback to oversized;
--122 forbids cold fences on hot parents. Source coverage plus absent-parent403
--is not a fabricated cold restore/purge execution or a lifecycle bypass.
rollback to fixture;
do $whole_rollback$ begin if pg_temp.attendance_report_graph() is distinct from (select graph from pg_temp.attendance_report_original)
 then raise exception 'Report fixture automatic Free/Pal/full graph rollback differs';end if;end;$whole_rollback$;
rollback;
select pg_catalog.json_build_object('version',1,'scope','attendance-report-rollback-contract-v1','outcome','passed','stage','complete','sqlstate',null);
