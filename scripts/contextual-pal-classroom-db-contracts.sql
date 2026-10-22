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
  -- The sealed272 profile preserves its historical legacy-owner behavior;
  -- forward287 deliberately closes MEMBERSHIP mode, not account-level Pal.
  if public.resolve_pal_classroom_context(v_owner,v_class)->>'status' is distinct from
      (case when to_regprocedure('private.pal_membership_evidence_v1(uuid,uuid)') is null then 'active' else 'forbidden' end)
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
-- Forward-only contracts leave the exact pre287 profile executable.
do $owner_delivery$
declare v_role text; v_owner uuid; v_member uuid; v_class uuid; v_other_class uuid;
  v_pending uuid; v_processing uuid; v_delivered uuid; v_other_event uuid; v_fresh uuid; v_lease uuid;
  v_context jsonb; v_payload jsonb; v_delivered_before jsonb; v_count bigint; v_generation uuid; v_setting text;
  v_proc pg_proc; v_signature text; v_db_role text;
begin
  if to_regprocedure('private.pal_membership_evidence_v1(uuid,uuid)') is null then return; end if;
  foreach v_signature in array array['private.pal_membership_evidence_v1(uuid,uuid)',
    'private.stop_pal_delivery_for_owner_v1(uuid,uuid)','private.stop_pal_delivery_on_owner_transition_v1()',
    'public.resolve_pal_membership(uuid,uuid)','public.authorize_pal_membership_delivery(uuid,uuid)'] loop
    select * into strict v_proc from pg_proc where oid=to_regprocedure(v_signature);
    if pg_get_userbyid(v_proc.proowner)<>'postgres'
      or v_proc.prosecdef<>(v_signature<>'private.pal_membership_evidence_v1(uuid,uuid)')
      or v_proc.proconfig is distinct from array['search_path=""','lock_timeout=1s','statement_timeout=5s'] then
      raise exception 'Pal287 function metadata differs: %',v_signature; end if;
    foreach v_db_role in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(v_db_role,v_signature,'execute')<>
        (v_db_role='service_role' and v_signature like 'public.%') then
        raise exception 'Pal287 exact RPC/private ACL differs: % %',v_signature,v_db_role; end if;
    end loop;
    if exists(select 1 from aclexplode(coalesce(v_proc.proacl,acldefault('f',v_proc.proowner))) a
      where a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'Pal287 PUBLIC execution exposed'; end if;
  end loop;
  foreach v_role in array array['student','teacher'] loop
    v_owner:=gen_random_uuid(); v_member:=gen_random_uuid(); v_class:=gen_random_uuid(); v_other_class:=gen_random_uuid();
    v_lease:=gen_random_uuid();
    insert into public.users(id,email,role) values
      (v_owner,'pal287-owner-'||v_owner::text||'@example.invalid',v_role),
      (v_member,'pal287-member-'||v_member::text||'@example.invalid',v_role);
    perform public.set_effective_feature_entitlement_v1(gen_random_uuid(),v_owner,'classrooms.create','manual',true,
      clock_timestamp(),null,2,'test:pal287','pal287_fixture',
      coalesce((select revision from public.effective_feature_entitlements where subject_user_id=v_owner and feature_key='classrooms.create'),0));
    perform public.set_effective_feature_entitlement_v1(gen_random_uuid(),v_member,'classrooms.create','manual',true,
      clock_timestamp(),null,2,'test:pal287','pal287_fixture',
      coalesce((select revision from public.effective_feature_entitlements where subject_user_id=v_member and feature_key='classrooms.create'),0));
    insert into public.classrooms(id,teacher_id,title,class_code) values
      (v_class,v_owner,'Owner transition287',upper(substr(replace(v_class::text,'-',''),1,10))),
      (v_other_class,v_owner,'Other membership287',upper(substr(replace(v_other_class::text,'-',''),1,10)));
    insert into public.classroom_enrollments(classroom_id,student_id) values(v_class,v_member),(v_other_class,v_member);
    v_context:=public.resolve_pal_classroom_context_for_member_v1(v_member,v_class);
    if v_context->>'status' is distinct from 'active' then raise exception 'Fixture287 member not active'; end if;
    v_generation:=(v_context->>'generation_id')::uuid;
    v_pending:=private.enqueue_membership_pal_fact(v_member,v_class,'platform.session.started','pending287',clock_timestamp(),'{}'::jsonb);
    v_processing:=private.enqueue_membership_pal_fact(v_member,v_class,'platform.session.started','processing287',clock_timestamp(),'{}'::jsonb);
    v_delivered:=private.enqueue_membership_pal_fact(v_member,v_class,'platform.session.started','delivered287',clock_timestamp(),'{}'::jsonb);
    v_other_event:=private.enqueue_membership_pal_fact(v_member,v_other_class,'platform.session.started','other287',clock_timestamp(),'{}'::jsonb);
    if v_pending is null or v_processing is null or v_delivered is null or v_other_event is null then
      raise exception 'Fixture287 must have nonempty captured histories'; end if;
    update public.pal_event_outbox set status='processing',lease_token=v_lease,lease_expires_at=now()+interval '1 minute'
      where id in(v_processing,v_delivered,v_other_event);
    if public.complete_pal_event_outbox(v_delivered,v_lease) is not true then raise exception 'Fixture287 delivered history not established'; end if;
    select to_jsonb(event) into v_delivered_before from public.pal_event_outbox event where id=v_delivered;
    select payload into v_payload from public.pal_event_outbox where id=v_processing;
    if public.authorize_pal_membership_delivery(v_processing,v_lease) is distinct from '{"status":"active"}'::jsonb then
      raise exception 'Valid processing member denied before promotion'; end if;
    update public.classrooms set teacher_id=v_member where id=v_class;
    select count(*) into v_count from private.pal_membership_outbox where classroom_id=v_class and student_id=v_member;
    if public.resolve_pal_membership(v_member,v_class) is distinct from '{"status":"forbidden"}'::jsonb
      or public.resolve_pal_classroom_context_for_member_v1(v_member,v_class)->>'status' is distinct from 'forbidden'
      or public.record_pal_classroom_visit_for_member_v1(v_member,v_class)->>'status' is distinct from 'forbidden'
      or private.enqueue_membership_pal_fact(v_member,v_class,'platform.session.started','denied287',clock_timestamp(),'{}'::jsonb) is not null
      or (select count(*) from private.pal_membership_outbox where classroom_id=v_class and student_id=v_member)<>v_count then
      raise exception 'New owner activity was captured or resolved'; end if;
    if public.authorize_pal_membership_delivery(v_processing,v_lease) is distinct from '{"status":"owner"}'::jsonb
      or public.authorize_pal_membership_delivery(v_other_event,v_lease) is distinct from '{"status":"active"}'::jsonb then
      raise exception 'Owner denial crossed classroom or lost valid lease proof'; end if;
    if public.authorize_pal_membership_delivery(v_processing,gen_random_uuid())->>'status' is distinct from 'forbidden'
      or public.authorize_pal_membership_delivery(v_pending,v_lease)->>'status' is distinct from 'forbidden'
      or public.authorize_pal_membership_delivery(v_delivered,v_lease)->>'status' is distinct from 'forbidden' then
      raise exception 'Owner evidence bypassed processing lease/state'; end if;
    update public.pal_event_outbox set lease_expires_at=now()-interval '1 second' where id=v_processing;
    if public.authorize_pal_membership_delivery(v_processing,v_lease)->>'status' is distinct from 'forbidden' then
      raise exception 'Owner evidence bypassed expired lease'; end if;
    update public.pal_event_outbox set lease_expires_at=now()+interval '1 minute',payload=jsonb_set(payload,'{learner_id}','"forged"') where id=v_processing;
    if public.authorize_pal_membership_delivery(v_processing,v_lease)->>'status' is distinct from 'forbidden' then
      raise exception 'Owner evidence bypassed payload learner'; end if;
    update public.pal_event_outbox set payload=v_payload where id=v_processing;
    update public.classrooms set archived_at=clock_timestamp() where id=v_class;
    if public.authorize_pal_membership_delivery(v_processing,v_lease)->>'status' is distinct from 'forbidden' then
      raise exception 'Owner evidence bypassed archive'; end if;
    update public.classrooms set archived_at=null where id=v_class;
    foreach v_setting in array array['pika.identity_mapping','pika.classroom_purge_finalize','pika.course_blueprint_purge_finalize','pika.student_purge_finalize'] loop
      perform set_config(v_setting,'on',true);
      if public.authorize_pal_membership_delivery(v_processing,v_lease)->>'status' is distinct from 'forbidden' then
        raise exception 'Owner evidence bypassed operational fence'; end if;
      perform set_config(v_setting,'off',true);
    end loop;
    update private.pal_classroom_signal_settings set enabled=false;
    if public.authorize_pal_membership_delivery(v_processing,v_lease)->>'status' is distinct from 'disabled' then raise exception 'Signals OFF allowed owner proof'; end if;
    update private.pal_classroom_signal_settings set enabled=true;
    update private.pal_membership_settings set enabled=false;
    if public.authorize_pal_membership_delivery(v_processing,v_lease)->>'status' is distinct from 'disabled' then raise exception 'Membership OFF allowed owner proof'; end if;
    update private.pal_membership_settings set enabled=true;
    -- The actual ownership transition stops even an unclaimed queued row.
    if not exists(select 1 from public.pal_event_outbox where id=v_pending and status='non_retryable'
      and lease_token is null and last_error_code='membership_owner')
      or not exists(select 1 from private.pal_membership_outbox where outbox_id in(v_pending,v_processing) and delivery_stopped_at is not null) then
      raise exception 'Ownership transition did not persist queued disposition'; end if;
    update public.classrooms set teacher_id=v_owner where id=v_class;
    if public.resolve_pal_membership(v_member,v_class)->>'status' is distinct from 'active'
      or public.authorize_pal_membership_delivery(v_processing,v_lease) is distinct from '{"status":"owner"}'::jsonb then
      raise exception 'Demotion cleared existing processing stop'; end if;
    -- A known accepted request can settle under its still-valid generation/lease.
    if public.authorize_pal_membership_delivery(v_processing,v_lease) is distinct from '{"status":"owner"}'::jsonb
      or public.complete_pal_event_outbox(v_processing,v_lease) is not true then
      raise exception 'Owner-only proof could not settle a known accepted request'; end if;
    if not exists(select 1 from public.pal_event_outbox where id=v_pending and status='non_retryable' and lease_token is null)
      or (select payload from public.pal_event_outbox where id=v_processing) is distinct from v_payload
      or (select to_jsonb(event) from public.pal_event_outbox event where id=v_delivered) is distinct from v_delivered_before then
      raise exception 'Demotion reopened stopped delivery or rewrote earned history'; end if;
    -- Actual removal closes generation evidence, even with a formerly valid lease.
    v_fresh:=private.enqueue_membership_pal_fact(v_member,v_class,'platform.session.started','fresh-after-demotion287',clock_timestamp(),'{}'::jsonb);
    if v_fresh is null then raise exception 'Demotion denied fresh learner activity'; end if;
    update public.pal_event_outbox set status='processing',lease_token=v_lease,lease_expires_at=now()+interval '1 minute' where id=v_fresh;
    if public.authorize_pal_membership_delivery(v_fresh,v_lease) is distinct from '{"status":"active"}'::jsonb then
      raise exception 'Fresh demoted-member event inherited historical stop'; end if;
    delete from public.classroom_enrollments where classroom_id=v_class and student_id=v_member;
    if public.authorize_pal_membership_delivery(v_fresh,v_lease)->>'status' is distinct from 'forbidden' then
      raise exception 'Removed generation retained owner proof'; end if;
    insert into public.classroom_enrollments(classroom_id,student_id) values(v_class,v_member);
    if (public.resolve_pal_classroom_context_for_member_v1(v_member,v_class)->>'generation_id')::uuid=v_generation
      or public.authorize_pal_membership_delivery(v_fresh,v_lease)->>'status' is distinct from 'forbidden'
      or (select to_jsonb(event) from public.pal_event_outbox event where id=v_delivered) is distinct from v_delivered_before then
      raise exception 'Replacement generation adopted or changed old history'; end if;
  end loop;
end;
$owner_delivery$;
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
