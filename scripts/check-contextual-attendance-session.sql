-- SOURCE ONLY. Exact isolated authorization required; ON_ERROR_STOP. No native claim.
begin;
create function pg_temp.attendance_session_graph() returns jsonb language plpgsql security invoker set search_path='' as $body$
declare t record; rows jsonb; graph jsonb:='{}'::jsonb;
begin
  for t in select n.nspname,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relkind in ('r','p') order by n.nspname,c.relname loop
    execute pg_catalog.format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb) from %I.%I r',t.nspname,t.relname) into rows;
    graph:=graph||pg_catalog.jsonb_build_object(t.nspname||'.'||t.relname,rows);
  end loop;
  return graph;
end; $body$;
revoke all on function pg_temp.attendance_session_graph() from public,anon,authenticated,service_role;
create temporary table attendance_session_original on commit drop as select pg_temp.attendance_session_graph() as graph;
create function pg_temp.expect_attendance_session(actor uuid,classroom uuid,mode text,expected_status text,expected_integration text,
  runtime text default 'ready',canary_actor uuid default null,canary_class uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $body$
declare result jsonb;
begin
  if current_user<>'service_role' then raise exception 'Session contract did not exercise service role';end if;
  result:=public.read_attendance_session_for_owner_v1(actor,classroom,'2026-10-20',runtime,mode,'session_fixture',canary_actor,canary_class);
  if result is null or result->>'actor_id' is distinct from actor::text or result->>'classroom_id' is distinct from classroom::text
    or result->>'class_date' is distinct from '2026-10-20' or result->>'runtime_integration' is distinct from runtime
    or result->>'scope_mode' is distinct from mode or result->>'installation_ref' is distinct from 'session_fixture'
    or result->>'status' is distinct from expected_status or result->>'integration' is distinct from expected_integration
    or result->>'observed_at' is null
    or (select array_agg(key order by key) from jsonb_object_keys(result) key) is distinct from
      array['actor_id','class_date','classroom_id','installation_ref','integration','observed_at','rows','runtime_integration','scope_mode','status','students']::text[]
    or (select array_agg(key order by key) from jsonb_object_keys(result->'rows') key) is distinct from
      array['check_ins','occurrence','outbox','overrides','participants','policy','session']::text[]
    then raise exception 'Owner session snapshot binding/schema mismatch';end if;
  if expected_status<>'ok' and result->'students'<>'[]'::jsonb then raise exception 'Denied session exposed roster';end if;
  if expected_integration<>'ready' and result->'rows' is distinct from
    '{"participants":[],"occurrence":null,"policy":null,"session":null,"check_ins":[],"overrides":[],"outbox":[]}'::jsonb
    then raise exception 'Disabled session exposed projection';end if;
  return result;
end; $body$;
do $temp_acl$ declare ns name;begin
  select nspname into strict ns from pg_catalog.pg_namespace where oid=pg_catalog.pg_my_temp_schema();
  if ns !~ '^pg_temp_[0-9]+$' then raise exception 'Unexpected temporary schema';end if;
  execute pg_catalog.format('grant usage on schema %I to service_role',ns);
end; $temp_acl$;
revoke all on function pg_temp.expect_attendance_session(uuid,uuid,text,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function pg_temp.expect_attendance_session(uuid,uuid,text,text,text,text,uuid,uuid) to service_role;
do $catalog$ declare p pg_catalog.pg_proc%rowtype;begin
  select * into strict p from pg_catalog.pg_proc where oid='public.read_attendance_session_for_owner_v1(uuid,uuid,date,text,text,text,uuid,uuid)'::regprocedure;
  if p.provolatile<>'s' or p.prosecdef or p.prokind<>'f' or p.proretset or p.proisstrict or p.proleakproof
    or (select lanname from pg_catalog.pg_language where oid=p.prolang)<>'sql'
    or pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' or p.prorettype<>'jsonb'::regtype
    or p.pronargs<>8 or p.pronargdefaults<>2
    or p.proargnames is distinct from array['p_actor_id','p_classroom_id','p_class_date','p_runtime_integration','p_scope_mode','p_installation_ref','p_canary_actor_id','p_canary_classroom_id']::text[]
    or p.proconfig is null or cardinality(p.proconfig)<>3 or not ('search_path=""'=any(p.proconfig) and 'lock_timeout=1s'=any(p.proconfig) and 'statement_timeout=8s'=any(p.proconfig))
    or pg_catalog.has_function_privilege('anon',p.oid,'execute') or pg_catalog.has_function_privilege('authenticated',p.oid,'execute')
    or not pg_catalog.has_function_privilege('service_role',p.oid,'execute')
    or exists(select 1 from pg_catalog.aclexplode(p.proacl) a where a.grantee not in (p.proowner,'service_role'::regrole::oid) or a.privilege_type<>'EXECUTE' or a.is_grantable)
    then raise exception 'Owner session RPC catalog/ACL differs';end if;
end; $catalog$;
savepoint fixture;
insert into public.users(id,email,role) values
 ('d1000000-0000-4000-8000-000000000001','session_teacher@example.invalid','teacher'),
 ('d1000000-0000-4000-8000-000000000002','session_student_owner@example.invalid','student'),
 ('d1000000-0000-4000-8000-000000000003','session_member@example.invalid','teacher'),
 ('d1000000-0000-4000-8000-000000000004','session_stranger@example.invalid','student');
-- Genuine pagination boundary: 1001 additional memberships, not a 1000-row mock.
insert into public.users(id,email,role)
 select ('d1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'session_bulk_'||n||'@example.invalid','student' from generate_series(50,1050) n;
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','Session A','ASESSA'),
 ('d2000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000002','Session B','ASESSB'),
 ('d2000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000001','Attendance-free purge class','ASESSC');
insert into public.classroom_enrollments(classroom_id,student_id)
 select 'd2000000-0000-4000-8000-000000000001',id from public.users where id in
 ('d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000003')
 or id in (select ('d1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(50,1050) n);
insert into public.classroom_enrollments(classroom_id,student_id) values('d2000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000002');
insert into public.student_profiles(user_id,first_name,last_name) values('d1000000-0000-4000-8000-000000000001','Teacher Owner','');
-- Pre-existing synthetic grants only;132 administrative provisioning remains
-- teacher-label-only. This is not proof of a changed grant flow.
insert into public.attendance_teacher_entitlements(teacher_id,status,valid_from,revision,source) values
 ('d1000000-0000-4000-8000-000000000001','active','2020-01-01',1,'synthetic_test'),
 ('d1000000-0000-4000-8000-000000000002','active','2020-01-01',1,'synthetic_test');
insert into public.attendance_roster_mappings(classroom_id) values('d2000000-0000-4000-8000-000000000001');
insert into public.attendance_occurrence_mappings(classroom_id,class_date,occurrence_ref,opens_at,closes_at,session_starts_at,session_ends_at,present_through_at,absent_at,policy_revision) values
 ('d2000000-0000-4000-8000-000000000001','2026-10-20','occurrence_d2000000000040008000000000000001','2026-10-20T13:00Z','2026-10-20T14:00Z','2026-10-20T13:00Z','2026-10-20T14:10Z','2026-10-20T13:05Z','2026-10-20T14:00Z',1);
insert into public.attendance_window_policies(classroom_id,opens_local,closes_local,enabled) values('d2000000-0000-4000-8000-000000000001','09:00','10:10',false);
insert into public.attendance_session_projection(classroom_id,installation_ref,roster_ref,occurrence_ref,session_revision,status,opens_at,closes_at,last_event_id,last_event_at) values
 ('d2000000-0000-4000-8000-000000000001','session_fixture','roster_fixture','occurrence_d2000000000040008000000000000001',2,'open','2026-10-20T13:00Z','2026-10-20T14:00Z','event_fixture','2026-10-20T13:00Z'),
 ('d2000000-0000-4000-8000-000000000001','different_installation','roster_fixture','occurrence_d2000000000040008000000000000001',9,'closed','2026-10-20T13:00Z','2026-10-20T14:00Z','event_other','2026-10-20T14:00Z');
insert into public.attendance_check_in_facts(classroom_id,student_id,installation_ref,roster_ref,occurrence_ref,participant_ref,check_in_ref,check_in_revision,accepted_at,invalidated_at) values
 ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','session_fixture','roster_fixture','occurrence_d2000000000040008000000000000001','participant_fixture','check_in_active',1,'2026-10-20T13:01Z',null),
 ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','session_fixture','roster_fixture','occurrence_d2000000000040008000000000000001','participant_other','check_in_invalidated',2,'2026-10-20T13:02Z','2026-10-20T13:10Z'),
 ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','different_installation','roster_fixture','occurrence_d2000000000040008000000000000001','participant_fixture','check_in_foreign',1,'2026-10-20T13:03Z',null);
insert into public.attendance_status_overrides(classroom_id,student_id,occurrence_ref,status,active,revision,updated_by) values
 ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','occurrence_d2000000000040008000000000000001','present',true,3,'d1000000-0000-4000-8000-000000000001');
insert into public.attendance_integration_outbox(classroom_id,idempotency_key,message_type,payload,status,lease_expires_at)
 select 'd2000000-0000-4000-8000-000000000001','session_fixture:'||n,'check_in.invalidate',
 jsonb_build_object('schema_version',1,'message_type','check_in.invalidate','idempotency_key','session_fixture:'||n,
 'correlation_ref','correlation_fixture','installation_ref','session_fixture','roster_ref','roster_fixture',
 'occurrence_ref','occurrence_d2000000000040008000000000000001','actor_principal_ref','principal_fixture','actor_display_name','Owner',
 'invalidations',jsonb_build_array(jsonb_build_object('command_ref','command_'||n,'check_in_ref','check_in_active','reason_code','staff_reset'))),
 case n when 1 then 'non_retryable' when 2 then 'pending' else 'processing' end,
 case when n=3 then statement_timestamp()+interval '1 day' else null end from generate_series(1,3) n;
create temporary table attendance_session_before_reads on commit drop as select pg_temp.attendance_session_graph() as graph;
set local role service_role;
do $matrix$ declare a uuid:='d1000000-0000-4000-8000-000000000001';b uuid:='d1000000-0000-4000-8000-000000000002';
 c uuid:='d2000000-0000-4000-8000-000000000001';d uuid:='d2000000-0000-4000-8000-000000000002';v jsonb;r jsonb;begin
 v:=pg_temp.expect_attendance_session(a,c,'teacher_entitlements','ok','ready');
 if jsonb_array_length(v->'students')<>1004 or jsonb_array_length(v#>'{rows,check_ins}')<>2
   or jsonb_array_length(v#>'{rows,outbox}')<>3 or v#>>'{rows,session,session_revision}'<>'2'
   or v#>>'{rows,policy,enabled}'<>'false' or jsonb_array_length(v#>'{rows,overrides}')<>1
   or not exists(select 1 from jsonb_array_elements(v#>'{rows,check_ins}') f where f->>'check_in_ref'='check_in_invalidated' and f->>'invalidated_at' is not null)
   or not exists(select 1 from jsonb_array_elements(v#>'{rows,overrides}') o where o->>'status'='present' and o->>'active'='true' and o->>'revision'='3')
   or (select count(distinct o->>'status') from jsonb_array_elements(v#>'{rows,outbox}') o)<>3
   or exists(select 1 from jsonb_array_elements(v#>'{rows,outbox}') o where o->>'message_type' is distinct from o#>>'{payload,message_type}')
   then raise exception 'Session complete projection/installation filter differs';end if;
 select value into r from jsonb_array_elements(v->'students') where value->>'id'=a::text;
 if r->>'first_name'<>'Teacher Owner' or r->>'last_name'<>'' then raise exception 'Session profile differs';end if;
 select value into r from jsonb_array_elements(v->'students') where value->>'id'=b::text;
 if r->>'first_name'<>'' or r->>'last_name'<>'' then raise exception 'Session missing-profile fallback differs';end if;
 perform pg_temp.expect_attendance_session(b,d,'teacher_entitlements','ok','ready');
 perform pg_temp.expect_attendance_session(a,c,'exact_canary','ok','ready','ready',a,c);
 perform pg_temp.expect_attendance_session(a,c,'exact_canary','ok','disabled','ready',b,c);
 perform pg_temp.expect_attendance_session(a,c,'exact_canary','ok','disabled','ready',a,d);
 perform pg_temp.expect_attendance_session(a,c,'teacher_entitlements','ok','disabled','disabled');
 perform pg_temp.expect_attendance_session(a,c,'teacher_entitlements','ok','not_configured','not_configured');
 perform pg_temp.expect_attendance_session(b,c,'teacher_entitlements','forbidden','disabled');
 perform pg_temp.expect_attendance_session(a,d,'teacher_entitlements','forbidden','disabled');
 perform pg_temp.expect_attendance_session('d1000000-0000-4000-8000-000000000003',c,'teacher_entitlements','forbidden','disabled');
 perform pg_temp.expect_attendance_session('d1000000-0000-4000-8000-000000000004',c,'teacher_entitlements','forbidden','disabled','disabled');
 perform pg_temp.expect_attendance_session(a,'d2000000-0000-4000-8000-000000000099','teacher_entitlements','forbidden','disabled');
 perform pg_temp.expect_attendance_session(a,c,'invalid','blocked','disabled');
end; $matrix$;
reset role;
do $read_only$ begin if pg_temp.attendance_session_graph() is distinct from (select graph from pg_temp.attendance_session_before_reads) then raise exception 'Session read changed complete graph';end if;end; $read_only$;
savepoint archived;
update public.classrooms set archived_at=statement_timestamp() where id='d2000000-0000-4000-8000-000000000001';
update pg_temp.attendance_session_before_reads set graph=pg_temp.attendance_session_graph();
set local role service_role;do $read$ begin perform pg_temp.expect_attendance_session('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','teacher_entitlements','ok','disabled','ready','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001');end;$read$;reset role;
do $unchanged$ begin if pg_temp.attendance_session_graph() is distinct from (select graph from pg_temp.attendance_session_before_reads) then raise exception 'Session transition read changed graph';end if;end;$unchanged$;
rollback to archived;
savepoint stale_owner;
update public.classrooms set teacher_id='d1000000-0000-4000-8000-000000000002' where id='d2000000-0000-4000-8000-000000000001';
update pg_temp.attendance_session_before_reads set graph=pg_temp.attendance_session_graph();
set local role service_role;do $read$ begin perform pg_temp.expect_attendance_session('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','teacher_entitlements','forbidden','disabled','ready','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001');end;$read$;reset role;
do $unchanged$ begin if pg_temp.attendance_session_graph() is distinct from (select graph from pg_temp.attendance_session_before_reads) then raise exception 'Session transition read changed graph';end if;end;$unchanged$;
rollback to stale_owner;
savepoint expired;
update public.attendance_teacher_entitlements set valid_until='2020-01-02' where teacher_id='d1000000-0000-4000-8000-000000000001';
update pg_temp.attendance_session_before_reads set graph=pg_temp.attendance_session_graph();
set local role service_role;do $read$ begin perform pg_temp.expect_attendance_session('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','teacher_entitlements','ok','disabled','ready','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001');end;$read$;reset role;
do $unchanged$ begin if pg_temp.attendance_session_graph() is distinct from (select graph from pg_temp.attendance_session_before_reads) then raise exception 'Session transition read changed graph';end if;end;$unchanged$;
rollback to expired;
savepoint revoked;
update public.attendance_teacher_entitlements set status='revoked' where teacher_id='d1000000-0000-4000-8000-000000000001';
update pg_temp.attendance_session_before_reads set graph=pg_temp.attendance_session_graph();
set local role service_role;do $read$ begin perform pg_temp.expect_attendance_session('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','teacher_entitlements','ok','disabled','ready','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001');end;$read$;reset role;
do $unchanged$ begin if pg_temp.attendance_session_graph() is distinct from (select graph from pg_temp.attendance_session_before_reads) then raise exception 'Session transition read changed graph';end if;end;$unchanged$;
rollback to revoked;
savepoint no_grant;
delete from public.attendance_teacher_entitlements where teacher_id='d1000000-0000-4000-8000-000000000001';
update pg_temp.attendance_session_before_reads set graph=pg_temp.attendance_session_graph();
set local role service_role;do $read$ begin perform pg_temp.expect_attendance_session('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','teacher_entitlements','ok','disabled','ready','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001');end;$read$;reset role;
do $unchanged$ begin if pg_temp.attendance_session_graph() is distinct from (select graph from pg_temp.attendance_session_before_reads) then raise exception 'Session transition read changed graph';end if;end;$unchanged$;
rollback to no_grant;
savepoint canary_without_grant;
delete from public.attendance_teacher_entitlements where teacher_id='d1000000-0000-4000-8000-000000000001';
update pg_temp.attendance_session_before_reads set graph=pg_temp.attendance_session_graph();
set local role service_role;do $read$ begin perform pg_temp.expect_attendance_session('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','exact_canary','ok','ready','ready','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001');end;$read$;reset role;
do $unchanged$ begin if pg_temp.attendance_session_graph() is distinct from (select graph from pg_temp.attendance_session_before_reads) then raise exception 'Session transition read changed graph';end if;end;$unchanged$;
rollback to canary_without_grant;
savepoint deactivating;
update public.attendance_roster_mappings set integration_state='deactivating' where classroom_id='d2000000-0000-4000-8000-000000000001';
update pg_temp.attendance_session_before_reads set graph=pg_temp.attendance_session_graph();
set local role service_role;do $read$ begin perform pg_temp.expect_attendance_session('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','teacher_entitlements','ok','disabled','ready','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001');end;$read$;reset role;
do $unchanged$ begin if pg_temp.attendance_session_graph() is distinct from (select graph from pg_temp.attendance_session_before_reads) then raise exception 'Session transition read changed graph';end if;end;$unchanged$;
rollback to deactivating;
savepoint inactive;
update public.attendance_roster_mappings set integration_state='inactive' where classroom_id='d2000000-0000-4000-8000-000000000001';
update pg_temp.attendance_session_before_reads set graph=pg_temp.attendance_session_graph();
set local role service_role;do $read$ begin perform pg_temp.expect_attendance_session('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','teacher_entitlements','ok','disabled','ready','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001');end;$read$;reset role;
do $unchanged$ begin if pg_temp.attendance_session_graph() is distinct from (select graph from pg_temp.attendance_session_before_reads) then raise exception 'Session transition read changed graph';end if;end;$unchanged$;
rollback to inactive;
set local role service_role;do $maintenance$ declare k text;begin
 foreach k in array array['pika.classroom_archive_restore','pika.classroom_archive_compaction','pika.identity_mapping','pika.classroom_purge_finalize','pika.course_blueprint_purge_finalize','pika.student_purge_finalize'] loop
  perform set_config(k,'on',true);perform pg_temp.expect_attendance_session('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','exact_canary','blocked','disabled','ready','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001');perform set_config(k,'off',true);
 end loop;end;$maintenance$;reset role;
savepoint hot_fence;
-- Genuine127 prerequisite: class C contains no attendance state.
insert into public.classroom_purge_operations(id,teacher_id,classroom_id,request_sha256,source_revision,impact_summary) values
 ('d3000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000003',repeat('a',64),1,'{}');
insert into public.classroom_purge_fences(classroom_id,operation_id,teacher_id) values
 ('d2000000-0000-4000-8000-000000000003','d3000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001');
set local role service_role;do $read$ begin perform pg_temp.expect_attendance_session('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000003','teacher_entitlements','blocked','disabled','ready','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000003');end;$read$;reset role;
rollback to hot_fence;
--122 rejects cold fences on hot parents. Absent hot-parent403 above, together
--with source-contract coverage of cold_classroom_purge_fences, is honest evidence;
--do not fabricate a native cold purge or bypass its prerequisites.
savepoint decommission;
insert into public.attendance_decommission_operations(id,classroom_id,teacher_id,installation_ref,roster_ref,actor_principal_ref) values
 ('d4000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','session_fixture','roster_fixture','principal_fixture');
set local role service_role;do $read$ begin perform pg_temp.expect_attendance_session('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','teacher_entitlements','blocked','disabled','ready','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001');end;$read$;reset role;
rollback to decommission;
rollback to fixture;
do $whole_rollback$ begin if pg_temp.attendance_session_graph() is distinct from (select graph from pg_temp.attendance_session_original) then raise exception 'Session fixture automatic Free/Pal/full graph rollback differs';end if;end;$whole_rollback$;
rollback;
select pg_catalog.json_build_object('version',1,'scope','attendance-session-rollback-contract-v1','outcome','passed','stage','complete','sqlstate',null);
