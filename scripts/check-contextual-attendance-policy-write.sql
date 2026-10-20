-- SOURCE ONLY: exact isolated target authorization required; ON_ERROR_STOP.
-- All fixture data, temporary helpers and automatic provisioning roll back.
begin;
create function pg_temp.attendance_write_graph(p_policy_classes uuid[] default '{}'::uuid[])
returns jsonb language plpgsql security invoker set search_path='' as $body$
declare v_table record; v_rows jsonb; v_graph jsonb:='{}'::jsonb; v_where text;
begin
  for v_table in select n.nspname,c.relname from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relkind in ('r','p')
    order by n.nspname,c.relname loop
    v_where:=case when v_table.nspname='public' and v_table.relname='attendance_window_policies'
      then ' where not (classroom_id = any($1))' else '' end;
    execute pg_catalog.format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb) from %I.%I r%s',
      v_table.nspname,v_table.relname,v_where) into v_rows using p_policy_classes;
    v_graph:=v_graph || pg_catalog.jsonb_build_object(v_table.nspname||'.'||v_table.relname,v_rows);
  end loop;
  return v_graph;
end;
$body$;
create temporary table attendance_write_original on commit drop as select pg_temp.attendance_write_graph() as graph;

create function pg_temp.expect_attendance_write(p_actor uuid,p_class uuid,p_mode text,p_policy jsonb,
  p_expected_state text default null,p_canary_actor uuid default null,p_canary_class uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $body$
declare v_result jsonb; v_state text; v_before jsonb; v_after jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(p) order by p.classroom_id),'[]'::jsonb) into v_before from public.attendance_window_policies p;
  begin
    v_result:=public.save_attendance_policy_for_owner_v1(p_actor,p_class,p_mode,p_policy,p_canary_actor,p_canary_class);
  exception when others then get stacked diagnostics v_state=returned_sqlstate;
  end;
  if v_state is distinct from p_expected_state then raise exception 'Attendance write SQLSTATE mismatch'; end if;
  if p_expected_state is not null then
    select coalesce(jsonb_agg(to_jsonb(p) order by p.classroom_id),'[]'::jsonb) into v_after from public.attendance_window_policies p;
    if v_after is distinct from v_before then raise exception 'Rejected write changed policy rows'; end if;
  elsif v_result->>'actor_id' is distinct from p_actor::text or v_result->>'classroom_id' is distinct from p_class::text
    or v_result->>'scope_mode' is distinct from p_mode or v_result->'policy'->>'classroom_id' is distinct from p_class::text
    or (v_result->'policy'->>'revision')::bigint is distinct from coalesce((p_policy->>'expected_revision')::bigint,0)+1 then
    raise exception 'Attendance write result binding mismatch';
  end if;
  return v_result;
end;
$body$;
-- PostgreSQL GRANT requires the actual temporary namespace, not pg_temp alias.
do $temp_acl$ declare v_schema name; begin
  select nspname into strict v_schema from pg_catalog.pg_namespace where oid=pg_catalog.pg_my_temp_schema();
  if v_schema !~ '^pg_temp_[0-9]+$' then raise exception 'Temporary namespace differs'; end if;
  execute pg_catalog.format('grant usage on schema %I to service_role',v_schema);
end; $temp_acl$;
revoke all on function pg_temp.attendance_write_graph(uuid[]) from public,anon,authenticated,service_role;
revoke all on function pg_temp.expect_attendance_write(uuid,uuid,text,jsonb,text,uuid,uuid) from public,anon,authenticated;
grant execute on function pg_temp.expect_attendance_write(uuid,uuid,text,jsonb,text,uuid,uuid) to service_role;

do $catalog$ declare v_proc oid:='public.save_attendance_policy_for_owner_v1(uuid,uuid,text,jsonb,uuid,uuid)'::regprocedure; begin
  if pg_catalog.has_function_privilege('anon',v_proc,'execute')
    or pg_catalog.has_function_privilege('authenticated',v_proc,'execute')
    or not pg_catalog.has_function_privilege('service_role',v_proc,'execute')
    or not exists(select 1 from pg_catalog.pg_proc where oid=v_proc and prosecdef
      and 'search_path=""'=any(proconfig) and 'lock_timeout=1s'=any(proconfig) and 'statement_timeout=8s'=any(proconfig)) then
    raise exception 'Attendance write catalog differs';
  end if;
end; $catalog$;
savepoint fixture;
insert into public.users(id,email,role) values
 ('e1000000-0000-4000-8000-000000000001','attendance-write-teacher@example.invalid','teacher'),
 ('e1000000-0000-4000-8000-000000000002','attendance-write-student-owner@example.invalid','student'),
 ('e1000000-0000-4000-8000-000000000003','attendance-write-member@example.invalid','teacher');
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Policy write A','AWRA26'),
 ('e2000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000002','Policy write B','AWRB26'),
 ('e2000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000001','Attendance-free fence','AWRC26');
insert into public.classroom_enrollments(classroom_id,student_id) values
 ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001'),
 ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000003');
-- Pre-existing synthetic grants only.132's administrative grant flow still
--requires the teacher label; this does not certify that flow for student owners.
insert into public.attendance_teacher_entitlements(teacher_id,status,valid_from,revision,source) values
 ('e1000000-0000-4000-8000-000000000001','active',now()-interval '1 day',1,'synthetic-test');
set local role service_role;
do $unentitled_canary$ begin
  perform pg_temp.expect_attendance_write('e1000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000002',
    'exact_canary','{"session_starts_local":"08:45","session_ends_local":"10:15","session_end_day_offset":0,"entry_opens_minutes_before":10,"present_grace_minutes":5,"entry_closes_minutes_before_end":10,"absent_minutes_before_end":0,"enabled":true,"expected_revision":null}',
    'PT404','e1000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000002');
end; $unentitled_canary$;
reset role;
insert into public.attendance_teacher_entitlements(teacher_id,status,valid_from,revision,source) values
 ('e1000000-0000-4000-8000-000000000002','active',now()-interval '1 day',1,'synthetic-test');
create temporary table attendance_write_complement on commit drop as select pg_temp.attendance_write_graph(array[
 'e2000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002']::uuid[]) as graph;

set local role service_role;
do $write_matrix$
declare a uuid:='e1000000-0000-4000-8000-000000000001'; b uuid:='e1000000-0000-4000-8000-000000000002';
 c uuid:='e2000000-0000-4000-8000-000000000001'; d uuid:='e2000000-0000-4000-8000-000000000002';
 p jsonb:='{"session_starts_local":"08:45","session_ends_local":"10:15","session_end_day_offset":0,"entry_opens_minutes_before":10,"present_grace_minutes":5,"entry_closes_minutes_before_end":10,"absent_minutes_before_end":0,"enabled":true,"expected_revision":null}';
begin
  perform pg_temp.expect_attendance_write(a,c,'teacher_entitlements',p); -- owner self-enrollment wins
  perform pg_temp.expect_attendance_write(b,d,'exact_canary',p,null,b,d); -- pre-existing grant, either account label
  perform pg_temp.expect_attendance_write(a,c,'teacher_entitlements',p||'{"expected_revision":1,"present_grace_minutes":6}');
  perform pg_temp.expect_attendance_write(a,c,'teacher_entitlements',p||'{"expected_revision":2,"present_grace_minutes":6}'); -- unchanged body still increments once
  perform pg_temp.expect_attendance_write(a,c,'teacher_entitlements',p||'{"expected_revision":1}','PT409'); -- stale
  perform pg_temp.expect_attendance_write(a,c,'teacher_entitlements',p,'PT409'); -- missing update revision
  perform pg_temp.expect_attendance_write(a,'e2000000-0000-4000-8000-000000000003','teacher_entitlements',p||'{"expected_revision":1}','PT409'); -- missing row
  perform pg_temp.expect_attendance_write(a,c,'teacher_entitlements',p||'{"expected_revision":3,"session_ends_local":"08:40"}','PT400');
  perform pg_temp.expect_attendance_write(a,c,'teacher_entitlements',p||'{"expected_revision":3,"entry_opens_minutes_before":121}','PT400');
  perform pg_temp.expect_attendance_write(a,c,'teacher_entitlements',p||'{"expected_revision":3,"extra":true}','PT400');
  perform pg_temp.expect_attendance_write('e1000000-0000-4000-8000-000000000003',c,'teacher_entitlements',p,'PT403'); -- current teacher-valued member
  perform pg_temp.expect_attendance_write(a,d,'teacher_entitlements',p,'PT403'); -- cross-class
  perform pg_temp.expect_attendance_write(a,c,'exact_canary',p,'PT404',b,c);
  perform pg_temp.expect_attendance_write(a,c,'exact_canary',p,'PT404',a,d);
  perform pg_temp.expect_attendance_write(a,c,'invalid',p,'PT400');
end; $write_matrix$;
reset role;
do $complement$ begin
  if pg_temp.attendance_write_graph(array['e2000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002']::uuid[])
    is distinct from (select graph from pg_temp.attendance_write_complement) then
    raise exception 'Policy write changed nonpolicy graph';
  end if;
end; $complement$;

-- Reuse an exact current revision in every denial. No denied call may mutate it.
create function pg_temp.denied_attendance_write(p_state text,p_mode text default 'teacher_entitlements')
returns void language plpgsql security invoker set search_path='' as $body$ begin
  perform pg_temp.expect_attendance_write('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',p_mode,
    '{"session_starts_local":"08:45","session_ends_local":"10:15","session_end_day_offset":0,"entry_opens_minutes_before":10,"present_grace_minutes":6,"entry_closes_minutes_before_end":10,"absent_minutes_before_end":0,"enabled":true,"expected_revision":3}',
    p_state,'e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001');
end; $body$;
revoke all on function pg_temp.denied_attendance_write(text,text) from public,anon,authenticated;
grant execute on function pg_temp.denied_attendance_write(text,text) to service_role;
savepoint stale_owner;
update public.classrooms set teacher_id='e1000000-0000-4000-8000-000000000002' where id='e2000000-0000-4000-8000-000000000001';
set local role service_role;
do $deny$ begin perform pg_temp.denied_attendance_write('PT403'); end; $deny$;
reset role;
rollback to stale_owner;
savepoint archived;
update public.classrooms set archived_at=now() where id='e2000000-0000-4000-8000-000000000001';
set local role service_role;
do $deny$ begin perform pg_temp.denied_attendance_write('PT403'); end; $deny$;
reset role;
rollback to archived;
savepoint entitlement;
update public.attendance_teacher_entitlements set valid_from=now()-interval '2 days',valid_until=now()-interval '1 day' where teacher_id='e1000000-0000-4000-8000-000000000001';
set local role service_role;
do $deny$ begin perform pg_temp.denied_attendance_write('PT404'); perform pg_temp.denied_attendance_write('PT404','exact_canary'); end; $deny$;
reset role;
update public.attendance_teacher_entitlements set valid_until=null,status='revoked' where teacher_id='e1000000-0000-4000-8000-000000000001';
set local role service_role;
do $deny$ begin perform pg_temp.denied_attendance_write('PT404'); end; $deny$;
reset role;
rollback to entitlement;
savepoint roster;
insert into public.attendance_roster_mappings(classroom_id,integration_state) values ('e2000000-0000-4000-8000-000000000001','deactivating');
set local role service_role;
do $deny$ begin perform pg_temp.denied_attendance_write('PT404'); perform pg_temp.denied_attendance_write('PT404','exact_canary'); end; $deny$;
reset role;
update public.attendance_roster_mappings set integration_state='inactive' where classroom_id='e2000000-0000-4000-8000-000000000001';
set local role service_role;
do $deny$ begin perform pg_temp.denied_attendance_write('PT404'); end; $deny$;
reset role;
rollback to roster;
set local role service_role;
do $maintenance$ declare k text; begin
  foreach k in array array['pika.classroom_archive_restore','pika.classroom_archive_compaction','pika.identity_mapping',
    'pika.classroom_purge_finalize','pika.course_blueprint_purge_finalize','pika.student_purge_finalize'] loop
    perform set_config(k,'on',true); perform pg_temp.denied_attendance_write('PT503'); perform set_config(k,'off',true);
  end loop;
end; $maintenance$;
reset role;
savepoint hot_fence;
-- Class C has no attendance state, respecting127's decommission prerequisite.
insert into public.classroom_purge_operations(id,teacher_id,classroom_id,request_sha256,source_revision,impact_summary) values
 ('e3000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000003',repeat('a',64),1,'{}');
insert into public.classroom_purge_fences(classroom_id,operation_id,teacher_id) values
 ('e2000000-0000-4000-8000-000000000003','e3000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001');
set local role service_role;
do $hot$ begin perform pg_temp.expect_attendance_write('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000003','teacher_entitlements',
 '{"session_starts_local":"08:45","session_ends_local":"10:15","session_end_day_offset":0,"entry_opens_minutes_before":10,"present_grace_minutes":5,"entry_closes_minutes_before_end":10,"absent_minutes_before_end":0,"enabled":true,"expected_revision":null}','PT503'); end; $hot$;
reset role;
rollback to hot_fence;
insert into public.attendance_decommission_operations(id,classroom_id,teacher_id,installation_ref,roster_ref,actor_principal_ref) values
 ('e4000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','synthetic','roster_synthetic','principal_synthetic');
set local role service_role;
do $deny$ begin perform pg_temp.denied_attendance_write('PT503'); end; $deny$;
reset role;
rollback to fixture;
do $whole_rollback$ begin
  if pg_temp.attendance_write_graph() is distinct from (select graph from pg_temp.attendance_write_original) then
    raise exception 'Attendance write fixture whole-row rollback differs';
  end if;
end; $whole_rollback$;
rollback;
select pg_catalog.json_build_object('version',1,'scope','attendance-policy-write-rollback-contract-v1','outcome','passed','stage','complete','sqlstate',null);
