-- SOURCE ONLY: rollback synthetic contract for a separately authorized isolated
-- migration replay. No provider/network calls, permanent gates or account edits.
\set ON_ERROR_STOP on
begin;
set local lock_timeout='1s';
set local statement_timeout='15s';

do $contract$
declare v_function text; v_proc pg_proc; v_role text;
begin
  foreach v_function in array array['resolve_pal_classroom_context_for_member_v1(uuid,uuid)',
    'record_pal_classroom_visit_for_member_v1(uuid,uuid)'] loop
    if to_regprocedure('public.'||v_function) is null
      or has_function_privilege('anon','public.'||v_function,'execute')
      or has_function_privilege('authenticated','public.'||v_function,'execute')
      or not has_function_privilege('service_role','public.'||v_function,'execute') then
      raise exception 'Contextual Pal ACL contract failed: %',v_function;
    end if;
    select * into strict v_proc from pg_proc where oid=to_regprocedure('public.'||v_function);
    if pg_get_userbyid(v_proc.proowner) is distinct from 'postgres' or v_proc.prosecdef is not true
      or v_proc.proconfig is distinct from array['search_path=""','lock_timeout=1s','statement_timeout=5s']
      or exists(select 1 from aclexplode(coalesce(v_proc.proacl,acldefault('f',v_proc.proowner))) grant_row
        where grant_row.grantee=0 and grant_row.privilege_type='EXECUTE') then
      raise exception 'Contextual Pal owner/security/config contract failed: %',v_function;
    end if;
  end loop;
  select * into strict v_proc from pg_proc where oid='private.contextual_pal_member_context_v1(uuid,uuid)'::regprocedure;
  if pg_get_userbyid(v_proc.proowner) is distinct from 'postgres' or v_proc.prosecdef is not false
    or v_proc.proconfig is distinct from array['search_path=""']
    or exists(select 1 from aclexplode(coalesce(v_proc.proacl,acldefault('f',v_proc.proowner))) grant_row
      where grant_row.grantee=0 and grant_row.privilege_type='EXECUTE') then
    raise exception 'Private Pal owner/security/config contract failed';
  end if;
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_function_privilege(v_role,'private.contextual_pal_member_context_v1(uuid,uuid)','execute') then
      raise exception 'Private Pal helper exposed: %',v_role;
    end if;
  end loop;
end;
$contract$;

-- Synthetic existing-fixture IDs use a separate prefix from other contracts.
insert into public.users(id,email,role) values
 ('c2720000-0000-4000-8000-000000000001','owner272@example.invalid','student'),
 ('c2720000-0000-4000-8000-000000000002','member272@example.invalid','teacher'),
 ('c2720000-0000-4000-8000-000000000003','other272@example.invalid','student');
-- The complete isolated runner provides synthetic classroom creation capability;
-- no production/shared-local grant or operation is authorized by this source.
do $fixture$ begin
perform public.set_effective_feature_entitlement_v1(gen_random_uuid(),
 'c2720000-0000-4000-8000-000000000001','classrooms.create','manual',true,
 clock_timestamp(),null,2,'test:pal272','pal272_fixture',0);
end; $fixture$;
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('c2720000-0000-4000-8000-000000000010','c2720000-0000-4000-8000-000000000001','Pal272','PAL272');
insert into public.classroom_enrollments(id,classroom_id,student_id) values
 ('c2720000-0000-4000-8000-000000000020','c2720000-0000-4000-8000-000000000010','c2720000-0000-4000-8000-000000000002'),
 ('c2720000-0000-4000-8000-000000000021','c2720000-0000-4000-8000-000000000010','c2720000-0000-4000-8000-000000000001');

do $contract$
declare
 v_owner uuid:='c2720000-0000-4000-8000-000000000001';
 v_member uuid:='c2720000-0000-4000-8000-000000000002';
 v_other uuid:='c2720000-0000-4000-8000-000000000003';
 v_class uuid:='c2720000-0000-4000-8000-000000000010';
 v_context jsonb; v_readded jsonb; v_count bigint; v_setting text;
begin
  update private.pal_classroom_signal_settings set enabled=false;
  if public.resolve_pal_classroom_context_for_member_v1(v_member,v_class)->>'status' is distinct from 'disabled' then
    raise exception 'Disabled signals allowed context';
  end if;
  update private.pal_membership_settings set enabled=true;
  update private.pal_classroom_signal_settings set enabled=true,activated_at=coalesce(activated_at,now()-interval '1 second');
  v_context:=public.resolve_pal_classroom_context_for_member_v1(v_member,v_class);
  if v_context->>'status' is distinct from 'active' or v_context is distinct from public.resolve_pal_classroom_context(v_member,v_class)
    or coalesce(v_context->>'generation_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(v_context->>'learner_id','') !~ '^pika-membership-v1-[0-9a-f]{32}$'
    or coalesce(v_context->>'scope_key','') !~ '^pika-classroom-v1-[0-9a-f]{64}$' then
    raise exception 'Teacher-valued membership context changed shape';
  end if;
  -- Historical enrolled owner remains accepted by legacy resolver only.
  if public.resolve_pal_classroom_context(v_owner,v_class)->>'status' is distinct from 'active'
    or public.resolve_pal_classroom_context_for_member_v1(v_owner,v_class)->>'status' is distinct from 'forbidden'
    or public.record_pal_classroom_visit_for_member_v1(v_owner,v_class)->>'status' is distinct from 'forbidden'
    or public.resolve_pal_classroom_context_for_member_v1(v_other,v_class)->>'status' is distinct from 'forbidden' then
    raise exception 'Contextual ownership precedence failed';
  end if;
  if public.record_pal_classroom_visit_for_member_v1(v_member,v_class)->>'status' is distinct from 'recorded'
    or public.record_pal_classroom_visit_for_member_v1(v_member,v_class)->>'status' is distinct from 'recorded' then
    raise exception 'Member visit did not report recorded';
  end if;
  select count(*) into v_count from private.pal_membership_outbox binding join public.pal_event_outbox event on event.id=binding.outbox_id
    where binding.classroom_id=v_class and binding.student_id=v_member and event.event_type='platform.session.started';
  if v_count is distinct from 1 or exists(select 1 from private.pal_membership_outbox binding join public.pal_event_outbox event on event.id=binding.outbox_id
    where binding.classroom_id=v_class and binding.student_id=v_owner and event.event_type='platform.session.started') then
    raise exception 'Visit dedup or owner capture failed';
  end if;
  -- Prove both role values use the same live relationship.
  update public.users set role='student' where id=v_member;
  if public.resolve_pal_classroom_context_for_member_v1(v_member,v_class) is distinct from v_context then raise exception 'Role affected member identity'; end if;
  update public.classrooms set archived_at=clock_timestamp() where id=v_class;
  if public.resolve_pal_classroom_context_for_member_v1(v_member,v_class)->>'status' is distinct from 'forbidden' then raise exception 'Archive allowed Pal'; end if;
  update public.classrooms set archived_at=null where id=v_class;
  --095 recognizes the named GUC ONLY for the trusted current_user. Prove its
  --actual predicate before calling this genuine-maintenance denial a pass.
  foreach v_setting in array array['restore','compaction'] loop
    perform set_config(case v_setting when 'restore' then 'pika.classroom_archive_restore' else 'pika.classroom_archive_compaction' end,'on',true);
    if public.is_classroom_archive_maintenance_mode(v_setting) is not true then
      raise exception 'Fixture did not establish095 trusted maintenance: %',v_setting;
    end if;
    if public.resolve_pal_classroom_context_for_member_v1(v_member,v_class)->>'status' is distinct from 'forbidden' then raise exception 'Verified maintenance allowed Pal'; end if;
    perform set_config(case v_setting when 'restore' then 'pika.classroom_archive_restore' else 'pika.classroom_archive_compaction' end,'off',true);
  end loop;
  foreach v_setting in array array['pika.identity_mapping','pika.classroom_purge_finalize','pika.course_blueprint_purge_finalize','pika.student_purge_finalize'] loop
    perform set_config(v_setting,'on',true);
    if public.resolve_pal_classroom_context_for_member_v1(v_member,v_class)->>'status' is distinct from 'forbidden' then raise exception 'Maintenance context allowed Pal'; end if;
    perform set_config(v_setting,'off',true);
  end loop;
  delete from public.classroom_enrollments where classroom_id=v_class and student_id=v_member;
  if public.resolve_pal_classroom_context_for_member_v1(v_member,v_class)->>'status' is distinct from 'forbidden' then raise exception 'Removal allowed Pal'; end if;
  insert into public.classroom_enrollments(id,classroom_id,student_id) values(gen_random_uuid(),v_class,v_member);
  v_readded:=public.resolve_pal_classroom_context_for_member_v1(v_member,v_class);
  if v_readded->>'status' is distinct from 'active'
    or coalesce(v_readded->>'generation_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or v_readded->>'generation_id' is not distinct from v_context->>'generation_id'
    or coalesce(v_readded->>'learner_id','') !~ '^pika-membership-v1-[0-9a-f]{32}$'
    or coalesce(v_readded->>'scope_key','') !~ '^pika-classroom-v1-[0-9a-f]{64}$' then
    raise exception 'Re-add did not establish a fresh complete member generation';
  end if;
  insert into public.attendance_decommission_operations(id,classroom_id,teacher_id,installation_ref,roster_ref,actor_principal_ref)
    values(gen_random_uuid(),v_class,v_owner,'fixture272','roster272','principal272');
  if public.resolve_pal_classroom_context_for_member_v1(v_member,v_class)->>'status' is distinct from 'forbidden'
    or public.record_pal_classroom_visit_for_member_v1(v_member,v_class)->>'status' is distinct from 'forbidden' then
    raise exception 'Decommission allowed contextual Pal';
  end if;
end;
$contract$;
-- A forged GUC under an untrusted current_user is not095 maintenance. No
--privileged RPC is called in this role; ACL assertions above prove denial.
set local role authenticated;
do $forged$
begin
  perform set_config('pika.classroom_archive_restore','on',true);
  perform set_config('pika.classroom_archive_compaction','on',true);
  if public.is_classroom_archive_maintenance_mode('restore') is true
    or public.is_classroom_archive_maintenance_mode('compaction') is true then
    raise exception 'Forged GUC granted archive maintenance';
  end if;
end;
$forged$;
reset role;
rollback;
select '{"version":1,"scope":"lifecycle-services-rollback-contract-v1","outcome":"passed","stage":"pal-classroom","sqlstate":null}'::json;
