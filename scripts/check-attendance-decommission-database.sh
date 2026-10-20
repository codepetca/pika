#!/usr/bin/env bash
set -euo pipefail

# Rollback-only synthetic fixture. No hosted target mode and no migration apply.
DECOMMISSION_DB_CONTAINER="supabase_db_pika"
PROJECT_LABEL="$(docker inspect "$DECOMMISSION_DB_CONTAINER" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')"
DB_BINDING="$(docker port "$DECOMMISSION_DB_CONTAINER" 5432/tcp)"
if [[ "$PROJECT_LABEL" != "pika" ]] || ! grep -q ':54322$' <<<"$DB_BINDING"; then
  echo 'Refusing unexpected database target.' >&2
  exit 2
fi
for fixture_owner_role in teacher student; do
docker exec -i "$DECOMMISSION_DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  -v fixture_owner_role="$fixture_owner_role" <<'SQL'
begin;
set local lock_timeout = '3s';
set local statement_timeout = '45s';
do $$ begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '153') then
    raise exception 'Migration 153 requires separate local application approval';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '281') then
    raise exception 'Migration 281 requires separate local application approval';
  end if;
end $$;
create function pg_temp.expect_error(p_sql text, p_message text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm = p_message then return; end if;
    raise;
  end;
  raise exception 'Expected rejection: %', p_message;
end $$;

insert into public.users (id, email, role) values
 ('d1530000-0000-4000-8000-000000000001', 'decommission-teacher@example.test', 'teacher'),
 ('d1530000-0000-4000-8000-000000000002', 'decommission-student@example.test', 'student'),
 ('d1530000-0000-4000-8000-000000000003', 'decommission-removed@example.test', 'student');
insert into public.classrooms (id, teacher_id, title, class_code, archived_at) values
 ('d1530000-0000-4000-8000-000000000010', 'd1530000-0000-4000-8000-000000000001', 'Synthetic deletion', 'D15301', now()),
 ('d1530000-0000-4000-8000-000000000011', 'd1530000-0000-4000-8000-000000000001', 'Other class', 'D15302', now());
insert into public.attendance_principal_mappings (user_id, principal_ref) values
 ('d1530000-0000-4000-8000-000000000001', 'principal_15300000000000000000000000000001');
insert into public.attendance_roster_mappings (classroom_id, roster_ref) values
 ('d1530000-0000-4000-8000-000000000010', 'roster_15300000000000000000000000000010'),
 ('d1530000-0000-4000-8000-000000000011', 'roster_15300000000000000000000000000011');
insert into public.attendance_participant_mappings (classroom_id, student_id) values
 ('d1530000-0000-4000-8000-000000000010', 'd1530000-0000-4000-8000-000000000002'),
 ('d1530000-0000-4000-8000-000000000010', 'd1530000-0000-4000-8000-000000000003'),
 ('d1530000-0000-4000-8000-000000000011', 'd1530000-0000-4000-8000-000000000002');
insert into public.attendance_classroom_qr_handles (classroom_id) values
 ('d1530000-0000-4000-8000-000000000010');
insert into public.attendance_occurrence_mappings(classroom_id,class_date)
 select classroom_id,'2026-09-13'::date from public.attendance_roster_mappings
 where classroom_id in ('d1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000011');
insert into public.attendance_window_policies(classroom_id,opens_local,closes_local)
 select classroom_id,'08:00','15:00' from public.attendance_occurrence_mappings
 where classroom_id in ('d1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000011');
insert into public.attendance_override_requests(request_id,classroom_id,request_fingerprint,result)
 select gen_random_uuid(),classroom_id,repeat('a',32),jsonb_build_object('outcome','applied',
 'occurrence_ref',occurrence_ref,'applied_count',1,'unchanged_count',0)
 from public.attendance_occurrence_mappings
 where classroom_id in ('d1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000011');
insert into public.attendance_session_projection(classroom_id,installation_ref,roster_ref,occurrence_ref,
 session_revision,status,last_event_id,last_event_at)
 select classroom_id,'installation_synthetic',roster_ref,occurrence_ref,1,'open','event_'||classroom_id,clock_timestamp()
 from public.attendance_roster_mappings join public.attendance_occurrence_mappings using(classroom_id)
 where classroom_id in ('d1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000011');
insert into public.attendance_integration_smoke_runs(installation_ref,teacher_id,classroom_id,request_id,challenge_hash,status)
 select 'installation_synthetic','d1530000-0000-4000-8000-000000000001',classroom_id,
 'request_'||classroom_id,md5(classroom_id::text)||md5(classroom_id::text),'passed'
 from public.attendance_roster_mappings
 where classroom_id in ('d1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000011');
insert into public.attendance_integration_outbox(classroom_id,idempotency_key,message_type,payload)
 select classroom_id,'roster:fixture:'||classroom_id,'roster.snapshot',jsonb_build_object(
 'schema_version',1,'message_type','roster.snapshot','idempotency_key','roster:fixture:'||classroom_id,
 'correlation_ref','fixture153','installation_ref','installation_synthetic','roster_ref',roster_ref,'revision',1)
 from public.attendance_roster_mappings
 where classroom_id in ('d1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000011');
insert into public.attendance_integration_inbox(classroom_id,installation_ref,transport_nonce,event_id,idempotency_key,
 correlation_ref,event_type,occurred_at,roster_ref,occurrence_ref,session_revision,payload)
 select classroom_id,'installation_synthetic','nonce_'||classroom_id,'event_'||classroom_id,'event:'||classroom_id,
 'fixture153','attendance.session.opened','2026-09-13T13:00:00Z',roster_ref,occurrence_ref,1,jsonb_build_object(
 'schema_version',1,'event_id','event_'||classroom_id,'idempotency_key','event:'||classroom_id,
 'correlation_ref','fixture153','event_type','attendance.session.opened','occurred_at','2026-09-13T13:00:00Z',
 'installation_ref','installation_synthetic','roster_ref',roster_ref,'occurrence_ref',occurrence_ref,'session_revision',1,
 'metadata',jsonb_build_object('opened_at','2026-09-13T13:00:00Z','trigger','staff'))
 from public.attendance_roster_mappings join public.attendance_occurrence_mappings using(classroom_id)
 where classroom_id in ('d1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000011');

-- Seed live attendance before closing the historical scope. Private generations
-- are synthetic retained evidence; no provider settings or callbacks are enabled.
insert into public.attendance_check_in_facts(classroom_id,student_id,installation_ref,roster_ref,
 occurrence_ref,participant_ref,check_in_ref,check_in_revision,accepted_at)
 select mapping.classroom_id,mapping.student_id,'installation_synthetic',roster.roster_ref,
 'occurrence_153',mapping.participant_ref,'check_'||replace(mapping.classroom_id::text,'-','')||
 replace(mapping.student_id::text,'-',''),1,clock_timestamp()
 from public.attendance_participant_mappings mapping join public.attendance_roster_mappings roster using(classroom_id)
 where mapping.classroom_id in ('d1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000011');
insert into public.attendance_record_projection(classroom_id,student_id,installation_ref,roster_ref,
 occurrence_ref,participant_ref,record_revision,status,source,actor_type,last_event_id,last_event_at)
 select classroom_id,student_id,installation_ref,roster_ref,occurrence_ref,participant_ref,1,
 'present','student_qr','student',check_in_ref,accepted_at from public.attendance_check_in_facts
 where classroom_id in ('d1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000011');
insert into public.attendance_status_overrides(classroom_id,student_id,occurrence_ref,status,active,updated_by)
 select classroom_id,student_id,occurrence_ref,'present',true,'d1530000-0000-4000-8000-000000000001'
 from public.attendance_check_in_facts
 where classroom_id in ('d1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000011');
insert into public.attendance_status_override_events(override_id,request_id,classroom_id,student_id,
 occurrence_ref,revision,action,status,actor_user_id)
 select id,gen_random_uuid(),classroom_id,student_id,occurrence_ref,series,'set','present',updated_by
 from public.attendance_status_overrides cross join generate_series(1,501) series
 where classroom_id='d1530000-0000-4000-8000-000000000010';
-- A preexisting inconsistent cross-class child must fail the scoped capability.
insert into public.attendance_status_override_events(id,override_id,request_id,classroom_id,student_id,
 occurrence_ref,revision,action,status,actor_user_id)
 select 'd1530000-0000-4000-8000-000000000099',id,gen_random_uuid(),
 'd1530000-0000-4000-8000-000000000010',student_id,occurrence_ref,1,'set','present',updated_by
 from public.attendance_status_overrides where classroom_id='d1530000-0000-4000-8000-000000000011';
insert into private.pal_membership_generations(generation_id,scope_digest,state)
 values
 ('d1530000-0000-4000-8000-000000000030',private.pal_membership_scope('d1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000002'),'active'),
 ('d1530000-0000-4000-8000-000000000031',private.pal_membership_scope('d1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000003'),'removed'),
 ('d1530000-0000-4000-8000-000000000032',private.pal_membership_scope('d1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000003'),'removed');
insert into private.attendance_membership_generations(generation_id,scope_digest,participant_ref)
 select generation_id,scope_digest,case when generation_id='d1530000-0000-4000-8000-000000000032'
 then 'participant_15300000000000000000000000000032' else mapping.participant_ref end
 from private.pal_membership_generations generation
 join public.attendance_participant_mappings mapping on generation.scope_digest=private.pal_membership_scope(mapping.classroom_id,mapping.student_id)
 where generation_id in ('d1530000-0000-4000-8000-000000000030','d1530000-0000-4000-8000-000000000031','d1530000-0000-4000-8000-000000000032');
create temp table replay_before as
 select 'pal' as kind,to_jsonb(generation) as evidence from private.pal_membership_generations generation
 union all select 'attendance',to_jsonb(generation) from private.attendance_membership_generations generation;
create function pg_temp.attendance_snapshot(p_classroom_id uuid) returns jsonb language plpgsql as $$
declare v_table text; v_rows jsonb; v_result jsonb:='{}'; begin
 foreach v_table in array array[
  'attendance_status_override_events','attendance_status_overrides','attendance_override_requests',
  'attendance_check_in_facts','attendance_record_projection','attendance_session_projection',
  'attendance_integration_inbox','attendance_integration_outbox','attendance_integration_smoke_runs',
  'attendance_classroom_qr_handles','attendance_occurrence_mappings','attendance_participant_mappings',
  'attendance_window_policies','attendance_roster_mappings'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(item) order by to_jsonb(item)::text),''[]''::jsonb)
   from public.%I item where classroom_id=$1',v_table) into v_rows using p_classroom_id;
  v_result:=v_result||jsonb_build_object(v_table,v_rows);
 end loop;
 return v_result;
end;
$$;
create temp table other_attendance_before as
 select pg_temp.attendance_snapshot('d1530000-0000-4000-8000-000000000011') as snapshot;
select pg_temp.expect_error($q$delete from public.attendance_participant_mappings
 where classroom_id='d1530000-0000-4000-8000-000000000010'
 and student_id='d1530000-0000-4000-8000-000000000002'$q$,'attendance_membership_generation_immutable');
select pg_temp.expect_error($q$delete from public.attendance_check_in_facts
 where classroom_id='d1530000-0000-4000-8000-000000000010'
 and student_id='d1530000-0000-4000-8000-000000000003'$q$,'attendance_membership_generation_closed');

-- Label is not classroom authority; each complete matrix rolls back independently.
update public.users set role = :'fixture_owner_role'
 where id = 'd1530000-0000-4000-8000-000000000001';

do $$ declare v_signature text; begin
  foreach v_signature in array array[
    'public.begin_attendance_decommission(uuid,uuid,uuid,text)',
    'public.record_attendance_decommission_receipt(uuid,uuid,uuid,jsonb)',
    'public.tick_attendance_decommission(uuid,uuid,uuid)',
    'public.get_attendance_decommission(uuid,uuid,uuid)',
    'public.authorize_attendance_decommission_advance(uuid,uuid,uuid)'
  ] loop
    if has_function_privilege('anon', v_signature, 'execute') or
       has_function_privilege('authenticated', v_signature, 'execute') or
       not has_function_privilege('service_role', v_signature, 'execute') then
      raise exception 'Invalid RPC privilege: %', v_signature;
    end if;
  end loop;
end $$;
select pg_temp.expect_error($q$select public.begin_attendance_decommission(
 'd1530000-0000-4000-8000-000000000001','d1530000-0000-4000-8000-000000000010',
 'd1530000-0000-4000-8000-000000000020','DELETE')$q$, 'attendance_decommission_disabled');

update public.attendance_decommission_settings set mode = 'canary', installation_ref = 'installation_synthetic',
 canary_teacher_id = 'd1530000-0000-4000-8000-000000000001', canary_classroom_id = 'd1530000-0000-4000-8000-000000000010';
-- Open the synthetic DB gate only inside this rollback to distinguish ownership
-- rejection from the independently tested canary rejection.
update public.attendance_decommission_settings set mode = 'enabled';
select pg_temp.expect_error($q$select public.begin_attendance_decommission(
 'd1530000-0000-4000-8000-000000000002','d1530000-0000-4000-8000-000000000010',
 'd1530000-0000-4000-8000-000000000020','DELETE')$q$, 'classroom_forbidden');
update public.attendance_decommission_settings set mode = 'canary';
select pg_temp.expect_error($q$select public.begin_attendance_decommission(
 'd1530000-0000-4000-8000-000000000001','d1530000-0000-4000-8000-000000000010',
 'd1530000-0000-4000-8000-000000000020','wrong')$q$, 'confirmation_mismatch');
-- Every unfinished queue state blocks BEFORE a durable remote-erasure intent.
do $$ declare v_status text; begin
 foreach v_status in array array['queued','processing','retry_wait','quarantined'] loop
  insert into private.removed_student_cleanup_jobs(operation_id,teacher_id,classroom_id,student_id,generation_id,
   status,lease_token,lease_expires_at,quarantined_at)
  values ('d1530000-0000-4000-8000-000000000040','d1530000-0000-4000-8000-000000000001',
   'd1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000003',
   'd1530000-0000-4000-8000-000000000031',v_status,
   case when v_status='processing' then gen_random_uuid() end,
   case when v_status='processing' then clock_timestamp()+interval '2 minutes' end,
   case when v_status='quarantined' then clock_timestamp() end);
  perform pg_temp.expect_error($q$select public.begin_attendance_decommission(
   'd1530000-0000-4000-8000-000000000001','d1530000-0000-4000-8000-000000000010',
   'd1530000-0000-4000-8000-000000000020','DELETE')$q$,'classroom_operation_conflict');
  if exists(select 1 from public.attendance_decommission_operations where id='d1530000-0000-4000-8000-000000000020') then
   raise exception 'Pending cleanup job created destructive intent'; end if;
  delete from private.removed_student_cleanup_jobs where operation_id='d1530000-0000-4000-8000-000000000040';
 end loop;
end $$;
-- Existing independently reserved purge work keeps the same denial.
insert into public.student_purge_operations(id,teacher_id,classroom_id,student_id,student_binding_sha256,
 request_sha256,status,source_revision)
 values('d1530000-0000-4000-8000-000000000041','d1530000-0000-4000-8000-000000000001',
 'd1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000003',repeat('a',64),repeat('b',64),'failed',1);
select pg_temp.expect_error($q$select public.begin_attendance_decommission(
 'd1530000-0000-4000-8000-000000000001','d1530000-0000-4000-8000-000000000010',
 'd1530000-0000-4000-8000-000000000020','DELETE')$q$,'classroom_operation_conflict');
delete from public.student_purge_operations where id='d1530000-0000-4000-8000-000000000041';
select public.begin_attendance_decommission(
 'd1530000-0000-4000-8000-000000000001','d1530000-0000-4000-8000-000000000010',
 'd1530000-0000-4000-8000-000000000020','DELETE');
select pg_temp.expect_error($q$select public.get_attendance_decommission(
 'd1530000-0000-4000-8000-000000000002','d1530000-0000-4000-8000-000000000010',
 'd1530000-0000-4000-8000-000000000020')$q$, 'decommission_not_found');
select pg_temp.expect_error($q$select public.get_attendance_decommission(
 'd1530000-0000-4000-8000-000000000001','d1530000-0000-4000-8000-000000000011',
 'd1530000-0000-4000-8000-000000000020')$q$, 'decommission_not_found');
select pg_temp.expect_error($q$select public.get_attendance_decommission(
 'd1530000-0000-4000-8000-000000000001','d1530000-0000-4000-8000-000000000010',
 'd1530000-0000-4000-8000-000000000021')$q$, 'decommission_not_found');
-- A durable fence is not permission to keep deleting after any gate change.
do $$ declare v_before jsonb; v_after jsonb; v_mode text; begin
  v_before := public.get_attendance_decommission('d1530000-0000-4000-8000-000000000001',
    'd1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000020');
  foreach v_mode in array array['disabled', 'teacher', 'classroom', 'installation'] loop
    update public.attendance_decommission_settings set
      mode = case when v_mode = 'disabled' then 'disabled' else 'canary' end,
      canary_teacher_id = case when v_mode = 'teacher' then 'd1530000-0000-4000-8000-000000000002'::uuid
        else 'd1530000-0000-4000-8000-000000000001'::uuid end,
      canary_classroom_id = case when v_mode = 'classroom' then 'd1530000-0000-4000-8000-000000000011'::uuid
        else 'd1530000-0000-4000-8000-000000000010'::uuid end,
      installation_ref = case when v_mode = 'installation' then 'installation_other' else 'installation_synthetic' end;
    perform pg_temp.expect_error($q$select public.authorize_attendance_decommission_advance(
      'd1530000-0000-4000-8000-000000000001','d1530000-0000-4000-8000-000000000010',
      'd1530000-0000-4000-8000-000000000020')$q$,
      case when v_mode = 'installation' then 'attendance_decommission_installation_mismatch'
        else 'attendance_decommission_disabled' end);
    v_after := public.get_attendance_decommission('d1530000-0000-4000-8000-000000000001',
      'd1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000020');
    if v_before is distinct from v_after then raise exception 'Pause changed the durable fence'; end if;
  end loop;
end $$;
update public.attendance_decommission_settings set mode = 'canary', installation_ref = 'installation_synthetic',
 canary_teacher_id = 'd1530000-0000-4000-8000-000000000001', canary_classroom_id = 'd1530000-0000-4000-8000-000000000010';
select public.authorize_attendance_decommission_advance(
 'd1530000-0000-4000-8000-000000000001','d1530000-0000-4000-8000-000000000010',
 'd1530000-0000-4000-8000-000000000020');
select pg_temp.expect_error($q$select public.guard_classroom_purge_lifecycle(
 'd1530000-0000-4000-8000-000000000010')$q$, 'attendance_decommission_active');
select pg_temp.expect_error($q$update public.attendance_roster_mappings set source_revision = source_revision + 1
 where classroom_id = 'd1530000-0000-4000-8000-000000000010'$q$, 'attendance_decommission_active');
select pg_temp.expect_error($q$select public.tick_attendance_decommission(
 'd1530000-0000-4000-8000-000000000001','d1530000-0000-4000-8000-000000000010',
 'd1530000-0000-4000-8000-000000000020')$q$, 'remote_deletion_unverified');

-- Caller GUCs and the durable fence do not grant local DELETE authority.
select set_config('pika.attendance_decommission_delete','on',true);
select pg_temp.expect_error($q$delete from public.attendance_participant_mappings
 where classroom_id='d1530000-0000-4000-8000-000000000010'
 and student_id='d1530000-0000-4000-8000-000000000002'$q$,'attendance_membership_generation_immutable');
do $$ declare v_role text; v_privilege text; begin
 foreach v_role in array array['anon','authenticated','service_role'] loop
  foreach v_privilege in array array['select','insert','update','delete','truncate'] loop
   if has_table_privilege(v_role,'private.attendance_decommission_delete_capabilities',v_privilege) then
    raise exception 'Delete capability table ACL leaked'; end if;
  end loop;
  if has_function_privilege(v_role,'private.attendance_decommission_delete_allowed(text,jsonb)','execute') then
   raise exception 'Delete capability helper ACL leaked'; end if;
 end loop;
 begin
  execute 'set local role service_role';
  execute 'select private.attendance_decommission_delete_allowed(''attendance_participant_mappings'',''{}''::jsonb)';
  raise exception 'Service role invoked private capability helper';
 exception when insufficient_privilege then null; end;
 begin
  execute 'set local role service_role';
  execute 'insert into private.attendance_decommission_delete_capabilities values(1,null,null,1,''attendance_participant_mappings'')';
  raise exception 'Service role installed private capability';
 exception when insufficient_privilege then null; end;
 if not (select relrowsecurity from pg_class where oid='private.attendance_decommission_delete_capabilities'::regclass) then
  raise exception 'Delete capability RLS missing'; end if;
 if private.attendance_decommission_delete_allowed('attendance_status_override_events',
  '{"classroom_id":"d1530000-0000-4000-8000-000000000010"}') then
  raise exception 'Missing delete capability accepted'; end if;
 -- Even privileged synthetic capability rows cannot authorize before receipt.
 insert into private.attendance_decommission_delete_capabilities values(txid_current(),
  'd1530000-0000-4000-8000-000000000020','d1530000-0000-4000-8000-000000000010',1,'attendance_status_override_events');
 if private.attendance_decommission_delete_allowed('attendance_status_override_events',
  '{"classroom_id":"d1530000-0000-4000-8000-000000000010"}') then
  raise exception 'Unverified remote state authorized DELETE'; end if;
 delete from private.attendance_decommission_delete_capabilities where transaction_id=txid_current();
end $$;

create function pg_temp.fail_decommission_delete() returns trigger language plpgsql as $$
begin raise exception using errcode='P1531',message='injected_decommission_failure'; end;
$$;

do $$ declare v_receipt jsonb; v_op jsonb; v_before jsonb; v_count bigint; v_previous bigint;
 v_forgery text; v_row jsonb; begin
  v_receipt := jsonb_build_object('schema_version',1,'ok',true,'installation_ref','installation_synthetic',
   'roster_ref','roster_15300000000000000000000000000010',
   'operation_ref','decommission_d1530000000040008000000000000020',
   'state','deleted','absence_verified',true,'deleted_count',7);
  begin
    perform public.record_attendance_decommission_receipt('d1530000-0000-4000-8000-000000000001',
     'd1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000020',
     v_receipt || '{"absence_verified":false}'::jsonb);
    raise exception 'accepted unverified receipt';
  exception when invalid_parameter_value then null; end;
  perform public.record_attendance_decommission_receipt('d1530000-0000-4000-8000-000000000001',
   'd1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000020',v_receipt);
  select to_jsonb(event) into v_row from public.attendance_status_override_events event
   where id='d1530000-0000-4000-8000-000000000099';
  insert into private.attendance_decommission_delete_capabilities values(txid_current(),
   'd1530000-0000-4000-8000-000000000020','d1530000-0000-4000-8000-000000000010',1,'attendance_status_override_events');
  if private.attendance_decommission_delete_allowed('attendance_status_override_events',v_row) then
   raise exception 'Foreign attendance parent authorized DELETE'; end if;
  perform pg_temp.expect_error($q$delete from public.attendance_status_override_events
   where id='d1530000-0000-4000-8000-000000000099'$q$,'attendance_decommission_delete_forbidden');
  -- A real matching child still needs current installation/canary admission.
  select to_jsonb(event) into v_row from public.attendance_status_override_events event
   where classroom_id='d1530000-0000-4000-8000-000000000010'
    and id<>'d1530000-0000-4000-8000-000000000099' limit 1;
  foreach v_forgery in array array['gate','installation','canary'] loop
   update public.attendance_decommission_settings set
    mode=case when v_forgery='gate' then 'disabled' else 'canary' end,
    installation_ref=case when v_forgery='installation' then 'installation_other' else 'installation_synthetic' end,
    canary_classroom_id=case when v_forgery='canary' then 'd1530000-0000-4000-8000-000000000011'::uuid
     else 'd1530000-0000-4000-8000-000000000010'::uuid end;
   if private.attendance_decommission_delete_allowed('attendance_status_override_events',v_row) then
    raise exception 'Changed admission authorized DELETE: %',v_forgery; end if;
  end loop;
  update public.attendance_decommission_settings set mode='canary',installation_ref='installation_synthetic',
   canary_classroom_id='d1530000-0000-4000-8000-000000000010';
  if not private.attendance_decommission_delete_allowed('attendance_status_override_events',v_row) then
   raise exception 'Exact saved capability rejected'; end if;
  delete from private.attendance_decommission_delete_capabilities where transaction_id=txid_current();
  delete from public.attendance_status_override_events where id='d1530000-0000-4000-8000-000000000099';
  foreach v_forgery in array array['transaction','classroom','table','phase','operation'] loop
   if v_forgery='operation' then
    begin
     insert into private.attendance_decommission_delete_capabilities values(txid_current(),
      'd1530000-0000-4000-8000-000000000099','d1530000-0000-4000-8000-000000000010',1,'attendance_status_override_events');
     raise exception 'Unknown operation capability accepted';
    exception when foreign_key_violation then null; end;
    continue;
   end if;
   insert into private.attendance_decommission_delete_capabilities values(
    case when v_forgery='transaction' then txid_current()+1 else txid_current() end,
    'd1530000-0000-4000-8000-000000000020',
    case when v_forgery='classroom' then 'd1530000-0000-4000-8000-000000000011'::uuid else 'd1530000-0000-4000-8000-000000000010'::uuid end,
    case when v_forgery='phase' then 12 else 1 end,
    case when v_forgery='table' then 'attendance_participant_mappings' else 'attendance_status_override_events' end);
   if private.attendance_decommission_delete_allowed('attendance_status_override_events',v_row) then
    raise exception 'Forged delete capability accepted: %',v_forgery; end if;
   if v_forgery<>'transaction' then
    perform pg_temp.expect_error($q$delete from public.attendance_status_override_events
     where classroom_id='d1530000-0000-4000-8000-000000000010'$q$,'attendance_decommission_delete_forbidden');
   end if;
   delete from private.attendance_decommission_delete_capabilities
    where transaction_id in(txid_current(),txid_current()+1);
  end loop;
  execute 'create trigger decommission_failure after delete on public.attendance_status_override_events
   for each statement execute function pg_temp.fail_decommission_delete()';
  v_before := (select to_jsonb(operation) from public.attendance_decommission_operations operation
   where id='d1530000-0000-4000-8000-000000000020');
  select count(*) into v_count from public.attendance_status_override_events
   where classroom_id='d1530000-0000-4000-8000-000000000010';
  perform pg_temp.expect_error($q$select public.tick_attendance_decommission(
   'd1530000-0000-4000-8000-000000000001','d1530000-0000-4000-8000-000000000010',
   'd1530000-0000-4000-8000-000000000020')$q$,'injected_decommission_failure');
  if v_before is distinct from (select to_jsonb(operation) from public.attendance_decommission_operations operation
    where id='d1530000-0000-4000-8000-000000000020')
   or v_count<>(select count(*) from public.attendance_status_override_events
    where classroom_id='d1530000-0000-4000-8000-000000000010')
   or exists(select 1 from private.attendance_decommission_delete_capabilities) then
   raise exception 'Failed tick changed durable state'; end if;
  execute 'drop trigger decommission_failure on public.attendance_status_override_events';
  v_previous:=0;
  for i in 1..50 loop
    v_op := public.tick_attendance_decommission('d1530000-0000-4000-8000-000000000001',
     'd1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000020');
    if (v_op->>'deleted_count')::bigint-v_previous not between 0 and 500 then
     raise exception 'Tick exceeded 500 rows'; end if;
    v_previous:=(v_op->>'deleted_count')::bigint;
    if exists(select 1 from private.attendance_decommission_delete_capabilities) then
     raise exception 'Delete capability survived tick'; end if;
    exit when v_op->>'state' = 'local_deleted';
  end loop;
  if v_op->>'state' <> 'local_deleted' or public.attendance_classroom_has_state_v1('d1530000-0000-4000-8000-000000000010') then
    raise exception 'Attendance absence was not established';
  end if;
  if exists(select 1 from jsonb_each(pg_temp.attendance_snapshot('d1530000-0000-4000-8000-000000000010'))
    where value<>'[]'::jsonb) then raise exception 'A public attendance table survived'; end if;
  if pg_temp.attendance_snapshot('d1530000-0000-4000-8000-000000000011') is distinct from
   (select snapshot from other_attendance_before) then raise exception 'Other classroom attendance changed'; end if;
  if exists((select kind,evidence from replay_before except
    (select 'pal',to_jsonb(generation) from private.pal_membership_generations generation
     union all select 'attendance',to_jsonb(generation) from private.attendance_membership_generations generation)))
   or (select count(*) from replay_before)<>(select count(*) from private.pal_membership_generations)+
      (select count(*) from private.attendance_membership_generations) then
   raise exception 'Private replay evidence changed'; end if;
  if public.begin_attendance_decommission('d1530000-0000-4000-8000-000000000001',
    'd1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000020','DELETE') is distinct from v_op
   or public.tick_attendance_decommission('d1530000-0000-4000-8000-000000000001',
    'd1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000020') is distinct from v_op then
   raise exception 'Same-key completion replay changed'; end if;
  if not exists (select 1 from public.classrooms where id = 'd1530000-0000-4000-8000-000000000010')
    or not exists (select 1 from public.attendance_roster_mappings where classroom_id = 'd1530000-0000-4000-8000-000000000011')
    or (select count(*) from public.users where id in ('d1530000-0000-4000-8000-000000000001','d1530000-0000-4000-8000-000000000002')) <> 2
    or not exists (select 1 from public.attendance_principal_mappings where user_id = 'd1530000-0000-4000-8000-000000000001') then
    raise exception 'Deletion crossed the classroom attendance ownership boundary';
  end if;
end $$;
select pg_temp.expect_error($q$insert into public.attendance_roster_mappings (classroom_id)
 values ('d1530000-0000-4000-8000-000000000010')$q$, 'attendance_decommission_active');
-- A separate fresh inventory and independently gated final purge may remove
-- the Classroom only after attendance completes. This fixture has no objects;
-- no Storage or provider request is made or represented as verified here.
update public.managed_storage_settings set mode='enforced' where singleton;
update public.classroom_purge_settings set rollout_mode='canary',
 canary_teacher_id='d1530000-0000-4000-8000-000000000001',
 canary_classroom_id='d1530000-0000-4000-8000-000000000010' where singleton;
do $$ declare v_inventory jsonb;v_result jsonb;v_saved jsonb;begin
 v_saved:=public.get_attendance_decommission('d1530000-0000-4000-8000-000000000001',
  'd1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000020');
 v_inventory:=public.get_hot_archived_classroom_purge_inventory(
  'd1530000-0000-4000-8000-000000000001','d1530000-0000-4000-8000-000000000010');
 v_result:=public.begin_hot_archived_classroom_purge('d1530000-0000-4000-8000-000000000050',
  'd1530000-0000-4000-8000-000000000001','d1530000-0000-4000-8000-000000000010',repeat('a',64),v_inventory);
 if not coalesce((v_result->>'ok')::boolean,false) or exists(select 1 from public.classroom_purge_objects
  where operation_id='d1530000-0000-4000-8000-000000000050') then
  raise exception 'Fresh attendance-complete Classroom purge did not begin without objects';end if;
 v_result:=public.finalize_hot_archived_classroom_purge('d1530000-0000-4000-8000-000000000050',
  'd1530000-0000-4000-8000-000000000001');
 if not coalesce((v_result->>'ok')::boolean,false) or v_result->>'operation_status'<>'completed'
  or exists(select 1 from public.classrooms where id='d1530000-0000-4000-8000-000000000010') then
  raise exception 'Attendance-complete Classroom purge did not finalize';end if;
 if public.get_attendance_decommission('d1530000-0000-4000-8000-000000000001',
  'd1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000020') is distinct from v_saved
  or pg_temp.attendance_snapshot('d1530000-0000-4000-8000-000000000011') is distinct from
   (select snapshot from other_attendance_before)
  or (select count(*) from public.users where id in ('d1530000-0000-4000-8000-000000000001',
   'd1530000-0000-4000-8000-000000000002','d1530000-0000-4000-8000-000000000003'))<>3
  or not exists(select 1 from public.attendance_principal_mappings
   where user_id='d1530000-0000-4000-8000-000000000001')
  or exists((select kind,evidence from replay_before except
   (select 'pal',to_jsonb(generation) from private.pal_membership_generations generation
    union all select 'attendance',to_jsonb(generation) from private.attendance_membership_generations generation)))
  or (select count(*) from replay_before)<>(select count(*) from private.pal_membership_generations)+
   (select count(*) from private.attendance_membership_generations) then
  raise exception 'Final Classroom purge changed saved fence, other attendance, or private replay history';end if;
end $$;
rollback;
SQL
done
echo 'Rollback-only attendance decommission contracts passed.'
