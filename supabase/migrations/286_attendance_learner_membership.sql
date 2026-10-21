-- Exact current-membership reads and owner overrides. No historical backfill,
-- provider operation, public mapping cardinality change or rollout activation.
begin;
set local lock_timeout='5s';

create function private.attendance_membership_target_valid(p_classroom_id uuid,p_student_id uuid,p_generation_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.classroom_enrollments e
    join public.classrooms c on c.id=e.classroom_id and c.teacher_id<>e.student_id and c.archived_at is null
    join private.pal_membership_generations g on g.generation_id=e.id and g.state='active'
      and g.scope_digest=private.pal_membership_scope(e.classroom_id,e.student_id)
    where e.classroom_id=p_classroom_id and e.student_id=p_student_id and e.id=p_generation_id
      and not exists(select 1 from public.classroom_roster r where r.classroom_id=e.classroom_id
        and r.removed_student_id=e.student_id and r.removed_enrollment_id=e.id and r.removed_at is not null));
$$;
revoke all on function private.attendance_membership_target_valid(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function private.attendance_membership_read_blocked(p_classroom_id uuid,p_student_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(public.is_classroom_archive_maintenance_mode('restore'),false)
    or coalesce(public.is_classroom_archive_maintenance_mode('compaction'),false)
    or coalesce(current_setting('pika.identity_mapping',true),'off')='on'
    or coalesce(current_setting('pika.classroom_purge_finalize',true),'off')='on'
    or coalesce(current_setting('pika.course_blueprint_purge_finalize',true),'off')='on'
    or coalesce(current_setting('pika.student_purge_finalize',true),'off')='on'
    or exists(select 1 from public.classroom_purge_fences where classroom_id=p_classroom_id)
    or exists(select 1 from public.cold_classroom_purge_fences where classroom_id=p_classroom_id)
    or exists(select 1 from public.attendance_decommission_operations where classroom_id=p_classroom_id)
    or exists(select 1 from public.attendance_roster_mappings where classroom_id=p_classroom_id and integration_state<>'active')
    or exists(select 1 from public.student_purge_fences where classroom_id=p_classroom_id and student_id=p_student_id);
$$;
revoke all on function private.attendance_membership_read_blocked(uuid,uuid) from public,anon,authenticated,service_role;

create function public.read_attendance_membership_status_v1(
  p_student_id uuid,p_class_date date,p_runtime_integration text,p_scope_mode text,p_installation_ref text,
  p_canary_actor_id uuid default null,p_canary_classroom_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='8s' as $$
declare v_ids uuid[]; v_classroom uuid; v_result jsonb;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='55000',message='attendance_membership_isolation_required';
  end if;
  if p_student_id is null or p_class_date is null or p_runtime_integration is null
    or p_runtime_integration not in ('disabled','not_configured','ready') or p_scope_mode is null
    or p_scope_mode not in ('exact_canary','teacher_entitlements')
    or (p_runtime_integration='ready' and (p_installation_ref is null or p_installation_ref !~ '^[A-Za-z0-9._~-]{1,128}$')) then return null; end if;
  select array_agg(e.classroom_id order by e.classroom_id) into v_ids from (
    select classroom_id from public.classroom_enrollments where student_id=p_student_id order by classroom_id limit 51
  ) e;
  if cardinality(v_ids)>50 then return null; end if;
  foreach v_classroom in array coalesce(v_ids,'{}'::uuid[]) loop
    perform private.try_lock_classroom_membership_change(v_classroom,p_student_id);
  end loop;
  -- All rows and evidence use one fresh statement snapshot after the locks.
  -- Newly joined classrooms outside the locked set wait for the next refresh.
  with memberships as materialized (
    select e.classroom_id,e.id as generation_id,c.teacher_id,m.participant_ref,
      case when private.attendance_membership_read_blocked(e.classroom_id,p_student_id)
        or not private.attendance_membership_target_valid(e.classroom_id,p_student_id,e.id) then 'disabled'
        when p_runtime_integration<>'ready' then p_runtime_integration
        when not private.attendance_membership_pointer_valid(e.classroom_id,p_student_id) then 'disabled'
        when p_scope_mode='exact_canary' then case when p_canary_actor_id=c.teacher_id
          and p_canary_classroom_id=c.id then 'ready' else 'disabled' end
        when public.get_attendance_classroom_access_v1(c.teacher_id,c.id,statement_timestamp())->>'state'='ready' then 'ready'
        else 'disabled' end as integration
    from public.classroom_enrollments e join public.classrooms c on c.id=e.classroom_id
      and c.teacher_id<>p_student_id and c.archived_at is null
    left join public.attendance_participant_mappings m on m.classroom_id=e.classroom_id and m.student_id=e.student_id
    where e.student_id=p_student_id and e.classroom_id=any(coalesce(v_ids,'{}'::uuid[]))
  ), projected as (
    select m.classroom_id,jsonb_build_object('classroom_id',m.classroom_id,'integration',m.integration,
      'generation_id',case when m.integration='ready' then m.generation_id end,
      'participant_ref',case when m.integration='ready' then m.participant_ref end,
      'occurrence',case when o.occurrence_ref is not null then jsonb_build_object('classroom_id',o.classroom_id,'class_date',o.class_date,'occurrence_ref',o.occurrence_ref,
        'opens_at',o.opens_at,'closes_at',o.closes_at,'present_through_at',o.present_through_at,'absent_at',o.absent_at,'desired_state',o.desired_state) end,
      'session',(select jsonb_build_object('occurrence_ref',s.occurrence_ref,'status',s.status,'opens_at',s.opens_at,'closes_at',s.closes_at)
        from public.attendance_session_projection s where s.installation_ref=p_installation_ref and s.occurrence_ref=o.occurrence_ref),
      'check_in',(select jsonb_build_object('classroom_id',f.classroom_id,'occurrence_ref',f.occurrence_ref,'check_in_ref',f.check_in_ref,
        'check_in_revision',f.check_in_revision,'accepted_at',f.accepted_at,'invalidated_at',f.invalidated_at)
        from public.attendance_check_in_facts f where f.installation_ref=p_installation_ref and f.classroom_id=m.classroom_id
          and f.student_id=p_student_id and f.occurrence_ref=o.occurrence_ref and f.participant_ref=m.participant_ref
          and f.invalidated_at is null order by f.accepted_at desc,f.check_in_ref limit 1),
      'override',(select jsonb_build_object('classroom_id',ev.classroom_id,'occurrence_ref',ev.occurrence_ref,'status',ev.status,
        'active',ev.action='set','revision',ev.revision,'updated_at',ev.created_at)
        from public.attendance_status_override_events ev join private.attendance_override_event_generations proof on proof.event_id=ev.id
        where proof.generation_id=m.generation_id and ev.classroom_id=m.classroom_id and ev.student_id=p_student_id
          and ev.occurrence_ref=o.occurrence_ref order by ev.revision desc,ev.id desc limit 1)
    ) as item from memberships m left join public.attendance_occurrence_mappings o
      on m.integration='ready' and o.classroom_id=m.classroom_id and o.class_date=p_class_date
  ) select jsonb_build_object('student_id',p_student_id,'class_date',p_class_date,'runtime_integration',p_runtime_integration,
    'scope_mode',p_scope_mode,'installation_ref',p_installation_ref,'observed_at',statement_timestamp(),
    'classrooms',coalesce((select jsonb_agg(item order by classroom_id) from projected),'[]'::jsonb)) into v_result;
  if octet_length(convert_to(v_result::text,'UTF8'))>1048576 then return null; end if;
  return v_result;
end;
$$;
revoke all on function public.read_attendance_membership_status_v1(uuid,date,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_attendance_membership_status_v1(uuid,date,text,text,text,uuid,uuid) to service_role;

create function public.read_attendance_membership_session_for_owner_v1(
  p_actor_id uuid,p_classroom_id uuid,p_class_date date,p_runtime_integration text,p_scope_mode text,p_installation_ref text,
  p_canary_actor_id uuid default null,p_canary_classroom_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='8s' as $$
declare v_result jsonb; v_targets jsonb;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='55000',message='attendance_membership_isolation_required';
  end if;
  perform private.try_lock_classroom_membership_change(p_classroom_id);
  v_result:=public.read_attendance_session_for_owner_v1(p_actor_id,p_classroom_id,p_class_date,p_runtime_integration,
    p_scope_mode,p_installation_ref,p_canary_actor_id,p_canary_classroom_id);
  if v_result is null then return null; end if;
  if v_result->>'status'='ok' and v_result->>'integration'='ready' then
    select jsonb_agg(jsonb_build_object('student_id',e.student_id,'generation_id',e.id) order by e.student_id)
      into v_targets from public.classroom_enrollments e where e.classroom_id=p_classroom_id
        and private.attendance_membership_target_valid(e.classroom_id,e.student_id,e.id)
        and not private.attendance_membership_read_blocked(e.classroom_id,e.student_id);
  end if;
  return v_result||jsonb_build_object('membership_targets',coalesce(v_targets,'[]'::jsonb));
end;
$$;
revoke all on function public.read_attendance_membership_session_for_owner_v1(uuid,uuid,date,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_attendance_membership_session_for_owner_v1(uuid,uuid,date,text,text,text,uuid,uuid) to service_role;

-- This table contains only the exact in-flight writer rows. Every successful
-- call deletes its capability; any failure rolls it back with the whole write.
create table private.attendance_override_mutations (
  transaction_id bigint not null,
  event_id uuid not null,
  generation_id uuid not null references private.pal_membership_generations(generation_id),
  old_override jsonb,
  new_override jsonb not null,
  new_event jsonb not null,
  primary key(transaction_id,event_id)
);
alter table private.attendance_override_mutations enable row level security;
revoke all on private.attendance_override_mutations from public,anon,authenticated,service_role;

create function private.attendance_override_mutation_allowed(p_table text,p_operation text,p_old jsonb,p_new jsonb)
returns boolean language sql stable security definer set search_path='' as $$
  select p_operation in ('INSERT','UPDATE') and exists(select 1 from private.attendance_override_mutations cap
    where cap.transaction_id=txid_current()
      and private.attendance_membership_target_valid((cap.new_override->>'classroom_id')::uuid,
        (cap.new_override->>'student_id')::uuid,cap.generation_id)
      and not private.attendance_membership_read_blocked((cap.new_override->>'classroom_id')::uuid,(cap.new_override->>'student_id')::uuid)
      and ((p_table='attendance_status_overrides' and cap.new_override=p_new and cap.old_override is not distinct from p_old)
        or (p_table='attendance_status_override_events' and p_operation='INSERT' and p_old is null and cap.new_event=p_new)));
$$;
revoke all on function private.attendance_override_mutation_allowed(text,text,jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function private.guard_attendance_override_event_generation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' and exists(select 1 from private.attendance_override_mutations cap
    join public.attendance_status_override_events ev on ev.id=cap.event_id and to_jsonb(ev)=cap.new_event
    where cap.transaction_id=txid_current() and cap.event_id=new.event_id and cap.generation_id=new.generation_id
      and private.attendance_override_mutation_allowed('attendance_status_override_events','INSERT',null,to_jsonb(ev))) then return new; end if;
  raise exception using errcode='55000',message='attendance_override_generation_writer_required';
end;
$$;

create function public.apply_attendance_membership_status_overrides_v1(
  p_teacher_id uuid,p_classroom_id uuid,p_class_date date,p_request_id uuid,p_marks jsonb,p_scope_mode text,
  p_canary_actor_id uuid default null,p_canary_classroom_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_mark record; v_occurrence text; v_fingerprint text; v_request public.attendance_override_requests;
  v_old public.attendance_status_overrides; v_new public.attendance_status_overrides;
  v_event public.attendance_status_override_events; v_previous public.attendance_status_override_events;
  v_applied integer:=0; v_unchanged integer:=0; v_result jsonb;
begin
  if p_teacher_id is null or p_classroom_id is null or p_class_date is null or p_request_id is null
    or p_marks is null or jsonb_typeof(p_marks)<>'array' then
    raise exception using errcode='22023',message='attendance_override_request_invalid'; end if;
  if jsonb_array_length(p_marks) not between 1 and 200 or exists(select 1 from jsonb_array_elements(p_marks) mark
    where jsonb_typeof(mark)<>'object' or (mark-array['student_id','expected_generation_id','status','reason_code'])<>'{}'::jsonb)
    or exists(select 1 from jsonb_to_recordset(p_marks) mark(student_id uuid,expected_generation_id uuid,status text,reason_code text)
      where student_id is null or expected_generation_id is null or status is null or status not in ('automatic','present','late','absent')
        or (reason_code is not null and reason_code !~ '^[a-z][a-z0-9._-]{0,99}$'))
    or (select count(*)<>count(distinct student_id) from jsonb_to_recordset(p_marks) mark(student_id uuid)) then
    raise exception using errcode='22023',message='attendance_override_request_invalid'; end if;
  perform private.authorize_attendance_membership_owner(p_teacher_id,p_classroom_id,p_scope_mode,p_canary_actor_id,p_canary_classroom_id);
  -- Match132/274 entitlement serialization. A competing revocation is a
  -- conflict, not permission to commit against an earlier authorization read.
  if not pg_try_advisory_xact_lock(hashtextextended(p_teacher_id::text,13220260823)) then
    raise exception using errcode='40001',message='classroom_operation_busy'; end if;
  perform 1 from public.attendance_teacher_entitlements where teacher_id=p_teacher_id for share nowait;
  perform 1 from public.attendance_roster_mappings where classroom_id=p_classroom_id for share nowait;
  if p_scope_mode='teacher_entitlements' and not public.attendance_teacher_entitled_v1(p_teacher_id,statement_timestamp()) then
    raise exception using errcode='42501',message='attendance_classroom_forbidden'; end if;
  if exists(select 1 from public.attendance_roster_mappings where classroom_id=p_classroom_id and integration_state<>'active') then
    raise exception using errcode='55000',message='attendance_membership_operation_blocked'; end if;
  select occurrence_ref into v_occurrence from public.attendance_occurrence_mappings
    where classroom_id=p_classroom_id and class_date=p_class_date;
  if v_occurrence is null then raise exception using errcode='23514',message='attendance_occurrence_missing'; end if;
  for v_mark in select * from jsonb_to_recordset(p_marks) mark(student_id uuid,expected_generation_id uuid) order by student_id loop
    perform private.try_lock_classroom_membership_change(p_classroom_id,v_mark.student_id);
    if not private.attendance_membership_target_valid(p_classroom_id,v_mark.student_id,v_mark.expected_generation_id) then
      raise exception using errcode='23514',message='attendance_roster_changed'; end if;
  end loop;
  -- Admission/scope comes from the server; the immutable request fingerprint
  -- includes every exact loaded generation before idempotency can return.
  v_fingerprint:=md5(jsonb_build_object('contract','membership-v1','teacher_id',p_teacher_id,'classroom_id',p_classroom_id,
    'class_date',p_class_date,'occurrence_ref',v_occurrence,'marks',p_marks)::text);
  select * into v_request from public.attendance_override_requests where request_id=p_request_id;
  if found then
    if v_request.classroom_id is distinct from p_classroom_id or v_request.request_fingerprint is distinct from v_fingerprint then
      raise exception using errcode='23505',message='attendance_override_request_conflict'; end if;
    return v_request.result||jsonb_build_object('outcome','duplicate');
  end if;
  for v_mark in select * from jsonb_to_recordset(p_marks) mark(student_id uuid,expected_generation_id uuid,status text,reason_code text)
    order by student_id loop
    select * into v_old from public.attendance_status_overrides where classroom_id=p_classroom_id
      and student_id=v_mark.student_id and occurrence_ref=v_occurrence for update;
    select ev.* into v_previous from public.attendance_status_override_events ev
      join private.attendance_override_event_generations proof on proof.event_id=ev.id
      where proof.generation_id=v_mark.expected_generation_id and ev.classroom_id=p_classroom_id
        and ev.student_id=v_mark.student_id and ev.occurrence_ref=v_occurrence order by ev.revision desc,ev.id desc limit 1;
    if (v_mark.status='automatic' and v_old.id is null)
      or (v_previous.id is not null and ((v_mark.status='automatic' and v_previous.action='undo')
        or (v_previous.action='set' and v_previous.status=v_mark.status and v_previous.reason_code is not distinct from v_mark.reason_code))) then
      v_unchanged:=v_unchanged+1; continue; end if;
    v_new:=v_old;
    v_new.id:=coalesce(v_old.id,gen_random_uuid()); v_new.classroom_id:=p_classroom_id; v_new.student_id:=v_mark.student_id;
    v_new.occurrence_ref:=v_occurrence; v_new.status:=case when v_mark.status='automatic' then null else v_mark.status end;
    v_new.active:=v_mark.status<>'automatic'; v_new.revision:=coalesce(v_old.revision,0)+1;
    v_new.reason_code:=v_mark.reason_code; v_new.updated_by:=p_teacher_id;
    v_new.created_at:=coalesce(v_old.created_at,clock_timestamp()); v_new.updated_at:=clock_timestamp();
    v_event.id:=gen_random_uuid(); v_event.override_id:=v_new.id; v_event.request_id:=p_request_id;
    v_event.classroom_id:=p_classroom_id; v_event.student_id:=v_mark.student_id; v_event.occurrence_ref:=v_occurrence;
    v_event.revision:=v_new.revision; v_event.action:=case when v_mark.status='automatic' then 'undo' else 'set' end;
    v_event.status:=v_new.status; v_event.reason_code:=v_mark.reason_code; v_event.actor_user_id:=p_teacher_id; v_event.created_at:=v_new.updated_at;
    insert into private.attendance_override_mutations(transaction_id,event_id,generation_id,old_override,new_override,new_event)
      values(txid_current(),v_event.id,v_mark.expected_generation_id,case when v_old.id is not null then to_jsonb(v_old) end,to_jsonb(v_new),to_jsonb(v_event));
    if v_old.id is null then insert into public.attendance_status_overrides select (v_new).*;
    else update public.attendance_status_overrides set status=v_new.status,active=v_new.active,revision=v_new.revision,
      reason_code=v_new.reason_code,updated_by=v_new.updated_by,updated_at=v_new.updated_at where id=v_new.id; end if;
    insert into public.attendance_status_override_events select (v_event).*;
    insert into private.attendance_override_event_generations(event_id,generation_id) values(v_event.id,v_mark.expected_generation_id);
    delete from private.attendance_override_mutations where transaction_id=txid_current() and event_id=v_event.id;
    v_applied:=v_applied+1;
  end loop;
  v_result:=jsonb_build_object('outcome','applied','occurrence_ref',v_occurrence,'applied_count',v_applied,'unchanged_count',v_unchanged);
  insert into public.attendance_override_requests(request_id,classroom_id,request_fingerprint,result)
    values(p_request_id,p_classroom_id,v_fingerprint,v_result);
  return v_result;
end;
$$;
revoke all on function public.apply_attendance_membership_status_overrides_v1(uuid,uuid,date,uuid,jsonb,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.apply_attendance_membership_status_overrides_v1(uuid,uuid,date,uuid,jsonb,text,uuid,uuid) to service_role;

-- The existing285 guard is replaced below only to admit the exact in-flight
-- override row. Deletion, participant, fact and all legacy guards stay intact.
create or replace function private.guard_attendance_closed_subject()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_scope text; v_row jsonb;
begin
  if tg_op='DELETE' and exists(select 1 from private.attendance_decommission_delete_capabilities
    where transaction_id=txid_current()) then
    if private.attendance_decommission_delete_allowed(tg_table_name,to_jsonb(old)) then return old; end if;
    raise exception using errcode='55000',message='attendance_decommission_delete_forbidden';
  end if;
  if tg_op='DELETE' and private.removed_academic_delete_allowed(tg_table_name,to_jsonb(old)) then return old; end if;
  if tg_table_name in ('attendance_status_overrides','attendance_status_override_events') and tg_op in ('INSERT','UPDATE')
    and private.attendance_override_mutation_allowed(tg_table_name,tg_op,
      case when tg_op='UPDATE' then to_jsonb(old) end,to_jsonb(new)) then return new; end if;
  if tg_table_name='attendance_participant_mappings' and tg_op in ('INSERT','UPDATE') then
    perform private.try_lock_classroom_membership_change(new.classroom_id,new.student_id);
    if private.attendance_pointer_mutation_allowed(case when tg_op='UPDATE' then to_jsonb(old) end,to_jsonb(new)) then return new; end if;
    if (tg_op='INSERT' or new.participant_ref is distinct from old.participant_ref)
      and exists(select 1 from private.attendance_participant_associations
        where scope_digest=private.pal_membership_scope(new.classroom_id,new.student_id))
      and exists(select 1 from private.attendance_membership_generations
        where scope_digest=private.pal_membership_scope(new.classroom_id,new.student_id)) then
      raise exception using errcode='55000',message='attendance_membership_generation_immutable';
    end if;
  end if;
  if tg_table_name='attendance_participant_mappings' and tg_op<>'INSERT'
    and exists(select 1 from private.attendance_membership_generations where participant_ref=to_jsonb(old)->>'participant_ref') then
    if tg_op='DELETE' or to_jsonb(new)->'participant_ref' is distinct from to_jsonb(old)->'participant_ref'
      or new.classroom_id is distinct from old.classroom_id or new.student_id is distinct from old.student_id then
      raise exception using errcode='55000',message='attendance_membership_generation_immutable';
    end if;
  end if;
  for v_row in select value from jsonb_array_elements(jsonb_build_array(
    case when tg_op<>'DELETE' then to_jsonb(new) end,
    case when tg_op<>'INSERT' then to_jsonb(old) end)) where jsonb_typeof(value)='object' loop
    perform private.try_lock_classroom_membership_change((v_row->>'classroom_id')::uuid,(v_row->>'student_id')::uuid);
    if tg_table_name='attendance_participant_mappings' and tg_op='UPDATE'
      and to_jsonb(new)->'active'='false'::jsonb and to_jsonb(old)->'active'='true'::jsonb
      and (to_jsonb(new)-'active'-'updated_at')=(to_jsonb(old)-'active'-'updated_at') then return new; end if;
    if private.attendance_participant_generation_closed(v_row->>'participant_ref') then
      raise exception using errcode='55000',message='attendance_membership_generation_closed';
    end if;
    v_scope:=private.pal_membership_scope((v_row->>'classroom_id')::uuid,(v_row->>'student_id')::uuid);
    if tg_table_name='attendance_participant_mappings'
      and private.attendance_membership_pointer_valid((v_row->>'classroom_id')::uuid,(v_row->>'student_id')::uuid)
      and exists(select 1 from public.attendance_participant_mappings mapping
        where mapping.classroom_id=(v_row->>'classroom_id')::uuid and mapping.student_id=(v_row->>'student_id')::uuid
          and mapping.participant_ref=v_row->>'participant_ref') then continue; end if;
    if tg_table_name in ('attendance_check_in_facts','attendance_record_projection')
      and exists(select 1 from private.attendance_participant_associations association
        where association.participant_ref=v_row->>'participant_ref' and association.scope_digest=v_scope)
      and private.resolve_attendance_delivery_subject((v_row->>'classroom_id')::uuid,v_row->>'participant_ref')=(v_row->>'student_id')::uuid
      then continue; end if;
    if exists(select 1 from private.attendance_membership_generations attendance
      join private.pal_membership_generations generation using(generation_id)
      where attendance.scope_digest=v_scope and generation.state='removed') then
      if tg_table_name='attendance_participant_mappings' and tg_op='UPDATE'
        and to_jsonb(new)->'active'='false'::jsonb and to_jsonb(old)->'active'='true'::jsonb
        and (to_jsonb(new)-'active'-'updated_at')=(to_jsonb(old)-'active'-'updated_at') then return new; end if;
      raise exception using errcode='55000',message='attendance_membership_generation_closed';
    end if;
  end loop;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
revoke all on function private.guard_attendance_override_event_generation(),private.guard_attendance_closed_subject()
  from public,anon,authenticated,service_role;

comment on function public.read_attendance_membership_status_v1(uuid,date,text,text,text,uuid,uuid) is
  'Service-only bounded exact-membership learner projection. Unknown history is excluded, never inferred or mutated.';
comment on function public.apply_attendance_membership_status_overrides_v1(uuid,uuid,date,uuid,jsonb,text,uuid,uuid) is
  'Service-only expected-enrollment override writer. Event-time attribution and exact transaction capability; legacy history preserved.';
commit;
