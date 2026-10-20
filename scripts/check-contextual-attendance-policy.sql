-- SOURCE ONLY: exact isolated target authorization required. ON_ERROR_STOP; rollback only.
begin;
do $acl$
declare v_proc oid := 'public.read_attendance_policy_for_owner_v1(uuid,uuid,text,uuid,uuid)'::regprocedure;
begin
  if pg_catalog.has_function_privilege('anon',v_proc,'execute')
    or pg_catalog.has_function_privilege('authenticated',v_proc,'execute')
    or not pg_catalog.has_function_privilege('service_role',v_proc,'execute') then raise exception 'Attendance owner ACL invalid'; end if;
  if not exists(select 1 from pg_catalog.pg_proc where oid=v_proc and provolatile='s' and not prosecdef
    and 'search_path=""'=any(proconfig) and 'lock_timeout=1s'=any(proconfig) and 'statement_timeout=8s'=any(proconfig)) then
    raise exception 'Attendance owner snapshot catalog invalid'; end if;
  if not pg_catalog.has_column_privilege('service_role','public.attendance_decommission_operations','classroom_id','select')
    or pg_catalog.has_table_privilege('service_role','public.attendance_decommission_operations','select')
    or pg_catalog.has_column_privilege('service_role','public.attendance_decommission_operations','installation_ref','select')
    or pg_catalog.has_column_privilege('service_role','public.attendance_decommission_operations','actor_principal_ref','select')
    or pg_catalog.has_column_privilege('service_role','public.attendance_decommission_operations','id','select')
    or pg_catalog.has_column_privilege('service_role','public.attendance_decommission_operations','roster_ref','select')
    or pg_catalog.has_table_privilege('service_role','public.attendance_decommission_operations','insert,update,delete') then
    raise exception 'Attendance fence identity grant widened'; end if;
end;
$acl$;

insert into public.users(id,email,role) values
 ('f1000000-0000-4000-8000-000000000001','attendance-owner-teacher@example.invalid','teacher'),
 ('f1000000-0000-4000-8000-000000000002','attendance-owner-student@example.invalid','student'),
 ('f1000000-0000-4000-8000-000000000003','attendance-stranger@example.invalid','student');
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','Attendance A','ATTA26'),
 ('f2000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000002','Attendance B','ATTB26'),
 ('f2000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000001','Attendance-free purge fence','ATTC26');
insert into public.classroom_enrollments(classroom_id,student_id) values
 ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001'),
 ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000002');
insert into public.attendance_window_policies(classroom_id,opens_local,closes_local) values
 ('f2000000-0000-4000-8000-000000000001','08:45','10:15');
-- Synthetic pre-existing grant only; the reader never grants or changes it.
insert into public.attendance_teacher_entitlements(teacher_id,status,valid_from,revision,source) values
 ('f1000000-0000-4000-8000-000000000001','active',now()-interval '1 day',1,'synthetic-test');

create function pg_temp.expect_attendance_policy(p_actor uuid,p_class uuid,p_mode text,p_expected text,p_canary_actor uuid default null,p_canary_class uuid default null)
returns void language plpgsql security invoker set search_path = '' as $function$
declare v_result jsonb;
begin
  v_result:=public.read_attendance_policy_for_owner_v1(p_actor,p_class,p_mode,p_canary_actor,p_canary_class);
  if v_result->>'actor_id' is distinct from p_actor::text or v_result->>'classroom_id' is distinct from p_class::text
    or v_result->>'scope_mode' is distinct from p_mode or v_result->>'status' is distinct from p_expected
    or (p_expected<>'ready' and v_result->'policy' is distinct from 'null'::jsonb)
    or octet_length(v_result::text)>4096 then raise exception 'Attendance snapshot mismatch'; end if;
end;
$function$;
-- Both grants are confined to this session's rollback-only temporary schema.
grant usage on schema pg_temp to service_role;
revoke all on function pg_temp.expect_attendance_policy(uuid,uuid,text,text,uuid,uuid) from public, anon, authenticated;
grant execute on function pg_temp.expect_attendance_policy(uuid,uuid,text,text,uuid,uuid) to service_role;
do $helper_acl$
begin
  if not pg_catalog.has_schema_privilege('service_role',pg_my_temp_schema(),'usage')
    or pg_catalog.has_function_privilege('anon','pg_temp.expect_attendance_policy(uuid,uuid,text,text,uuid,uuid)','execute')
    or pg_catalog.has_function_privilege('authenticated','pg_temp.expect_attendance_policy(uuid,uuid,text,text,uuid,uuid)','execute')
    or not pg_catalog.has_function_privilege('service_role','pg_temp.expect_attendance_policy(uuid,uuid,text,text,uuid,uuid)','execute') then
    raise exception 'Attendance temporary helper ACL invalid'; end if;
end;
$helper_acl$;

set local role service_role;
do $read_matrix$
declare a uuid:='f1000000-0000-4000-8000-000000000001'; b uuid:='f1000000-0000-4000-8000-000000000002';
 c uuid:='f2000000-0000-4000-8000-000000000001'; d uuid:='f2000000-0000-4000-8000-000000000002'; v jsonb;
begin
  perform pg_temp.expect_attendance_policy(a,c,'teacher_entitlements','ready'); -- owner self enrollment has precedence
  perform pg_temp.expect_attendance_policy(b,d,'teacher_entitlements','disabled'); -- student owner receives no grant
  perform pg_temp.expect_attendance_policy(a,c,'exact_canary','ready',a,c);
  perform pg_temp.expect_attendance_policy(b,d,'exact_canary','ready',b,d);
  v:=public.read_attendance_policy_for_owner_v1(b,d,'exact_canary',b,d);
  if v->'policy' is distinct from 'null'::jsonb then raise exception 'Missing policy changed nullable DTO'; end if;
  perform pg_temp.expect_attendance_policy(b,c,'exact_canary','forbidden',b,c); -- member
  perform pg_temp.expect_attendance_policy(a,d,'exact_canary','forbidden',a,d); -- cross-class
  perform pg_temp.expect_attendance_policy('f1000000-0000-4000-8000-000000000003',c,'teacher_entitlements','forbidden');
  --122 begin_cold_archived_classroom_purge rejects every extant hot parent
  --(classroom_is_hot_archived). A legitimate cold purge therefore reaches the
  --same absent-hot-parent denial below before273's defensive cold-fence branch.
  --This proves absent-parent denial, not a fabricated hot/cold overlap or a
  --native cold-purge workflow. The cold fence itself is source-contract checked.
  perform pg_temp.expect_attendance_policy(a,'f2000000-0000-4000-8000-000000000099','teacher_entitlements','forbidden');
  perform pg_temp.expect_attendance_policy(a,c,'exact_canary','disabled',b,c);
  perform pg_temp.expect_attendance_policy(a,c,'exact_canary','disabled',a,d);
  perform pg_temp.expect_attendance_policy(a,c,'invalid','blocked');
end;
$read_matrix$;
reset role;

-- Each transition is synthetic and transaction-local; no rollout setting changes.
update public.classrooms set teacher_id='f1000000-0000-4000-8000-000000000002' where id='f2000000-0000-4000-8000-000000000001';
set local role service_role;
do $expect$ begin perform pg_temp.expect_attendance_policy('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','exact_canary','forbidden','f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001'); end; $expect$;
reset role;
update public.classrooms set teacher_id='f1000000-0000-4000-8000-000000000001', archived_at=now() where id='f2000000-0000-4000-8000-000000000001';
set local role service_role;
do $expect$ begin perform pg_temp.expect_attendance_policy('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','teacher_entitlements','archived'); end; $expect$;
reset role;
update public.classrooms set archived_at=null where id='f2000000-0000-4000-8000-000000000001';

-- Exact validity bounds and revocation remain132's entitlement policy.
update public.attendance_teacher_entitlements set valid_from=now()-interval '2 days',valid_until=now()-interval '1 day' where teacher_id='f1000000-0000-4000-8000-000000000001';
set local role service_role;
do $expect$ begin perform pg_temp.expect_attendance_policy('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','teacher_entitlements','disabled'); end; $expect$;
reset role;
update public.attendance_teacher_entitlements set valid_until=null,status='revoked' where teacher_id='f1000000-0000-4000-8000-000000000001';
set local role service_role;
do $expect$ begin perform pg_temp.expect_attendance_policy('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','teacher_entitlements','disabled'); end; $expect$;
reset role;
update public.attendance_teacher_entitlements set status='active' where teacher_id='f1000000-0000-4000-8000-000000000001';

-- A pre-existing synthetic grant can cover either historical account label.
savepoint student_entitlement;
insert into public.attendance_teacher_entitlements(teacher_id,status,valid_from,revision,source) values
 ('f1000000-0000-4000-8000-000000000002','active',now()-interval '1 day',1,'synthetic-test');
set local role service_role;
do $expect$ begin perform pg_temp.expect_attendance_policy('f1000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000002','teacher_entitlements','ready'); end; $expect$;
reset role;
rollback to student_entitlement;

insert into public.attendance_roster_mappings(classroom_id,integration_state) values
 ('f2000000-0000-4000-8000-000000000001','deactivating');
set local role service_role;
do $expect$ begin perform pg_temp.expect_attendance_policy('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','teacher_entitlements','disabled'); end; $expect$;
reset role;
update public.attendance_roster_mappings set integration_state='inactive' where classroom_id='f2000000-0000-4000-8000-000000000001';
set local role service_role;
do $expect$ begin perform pg_temp.expect_attendance_policy('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','teacher_entitlements','disabled'); end; $expect$;
reset role;
update public.attendance_roster_mappings set integration_state='active' where classroom_id='f2000000-0000-4000-8000-000000000001';

-- Every genuine maintenance context rejects even an exact owner/canary.
set local role service_role;
do $maintenance$
declare v_key text;
begin
  foreach v_key in array array['pika.classroom_archive_restore','pika.classroom_archive_compaction','pika.identity_mapping',
    'pika.classroom_purge_finalize','pika.course_blueprint_purge_finalize','pika.student_purge_finalize'] loop
    perform set_config(v_key,'on',true);
    perform pg_temp.expect_attendance_policy('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','exact_canary','blocked','f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001');
    perform set_config(v_key,'off',true);
  end loop;
end;
$maintenance$;
reset role;

savepoint hot_fence;
--127 rejects purge operations for any classroom with attendance state. Use
--the separate owner-owned, attendance-free class so its genuine trigger runs.
insert into public.classroom_purge_operations(id,teacher_id,classroom_id,request_sha256,source_revision,impact_summary) values
 ('f3000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000003',repeat('a',64),1,'{}');
insert into public.classroom_purge_fences(classroom_id,operation_id,teacher_id) values
 ('f2000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001');
set local role service_role;
do $expect$ begin perform pg_temp.expect_attendance_policy('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000003','teacher_entitlements','blocked'); end; $expect$;
reset role;
rollback to hot_fence;

insert into public.attendance_decommission_operations(id,classroom_id,teacher_id,installation_ref,roster_ref,actor_principal_ref) values
 ('f4000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','synthetic','roster_synthetic','principal_synthetic');
set local role service_role;
do $expect$ begin perform pg_temp.expect_attendance_policy('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','teacher_entitlements','blocked'); end; $expect$;
reset role;
rollback;
select pg_catalog.json_build_object('version',1,'scope','attendance-policy-rollback-contract-v1','outcome','passed','stage','complete','sqlstate',null);
