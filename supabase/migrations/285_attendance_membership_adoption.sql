-- Explicit admitted callers only allocate membership references. Installation
-- does not rotate pointers, enable admission, or enable provider cleanup.
begin;
set local lock_timeout='5s';

-- Ephemeral transaction authority, not retained subject history. Only the
-- allocator can populate this table; every successful call removes its row.
create table private.attendance_pointer_mutations (
  transaction_id bigint not null,
  scope_digest text not null,
  generation_id uuid not null references private.pal_membership_generations(generation_id),
  old_participant_ref text,
  new_participant_ref text not null,
  primary key(transaction_id,scope_digest)
);
alter table private.attendance_pointer_mutations enable row level security;
revoke all on private.attendance_pointer_mutations from public,anon,authenticated,service_role;

create function private.attendance_membership_pointer_valid(p_classroom_id uuid,p_student_id uuid)
returns boolean language sql volatile security definer set search_path='' as $$
  select exists(
    select 1 from public.classroom_enrollments enrollment
    join private.pal_membership_generations generation on generation.generation_id=enrollment.id
      and generation.state='active'
      and generation.scope_digest=private.pal_membership_scope(enrollment.classroom_id,enrollment.student_id)
    join public.attendance_participant_mappings mapping on mapping.classroom_id=enrollment.classroom_id
      and mapping.student_id=enrollment.student_id and mapping.active
    join private.attendance_membership_generations attendance on attendance.generation_id=enrollment.id
      and attendance.participant_ref=mapping.participant_ref and attendance.scope_digest=generation.scope_digest
    join private.attendance_participant_associations association on association.participant_ref=attendance.participant_ref
      and association.scope_digest=attendance.scope_digest and not association.closed
      and (association.generation_id is null or association.generation_id=attendance.generation_id)
    where enrollment.classroom_id=p_classroom_id and enrollment.student_id=p_student_id
  );
$$;
revoke all on function private.attendance_membership_pointer_valid(uuid,uuid) from public,anon,authenticated,service_role;

create function private.attendance_pointer_mutation_allowed(p_old jsonb,p_new jsonb)
returns boolean language sql volatile security definer set search_path='' as $$
  select p_new is not null and p_new->'active'='true'::jsonb
    and (p_old is null or (
      (p_old-array['participant_ref','active','updated_at'])=(p_new-array['participant_ref','active','updated_at'])))
    and exists(
      select 1 from private.attendance_pointer_mutations capability
      join public.classroom_enrollments enrollment on enrollment.id=capability.generation_id
        and enrollment.classroom_id=(p_new->>'classroom_id')::uuid
        and enrollment.student_id=(p_new->>'student_id')::uuid
      join private.pal_membership_generations generation on generation.generation_id=enrollment.id
        and generation.state='active' and generation.scope_digest=capability.scope_digest
      join private.attendance_membership_generations attendance on attendance.generation_id=enrollment.id
        and attendance.participant_ref=capability.new_participant_ref and attendance.scope_digest=capability.scope_digest
      join private.attendance_participant_associations association on association.participant_ref=attendance.participant_ref
        and association.scope_digest=attendance.scope_digest and association.generation_id=attendance.generation_id
        and not association.closed
      where capability.transaction_id=txid_current()
        and capability.scope_digest=private.pal_membership_scope(enrollment.classroom_id,enrollment.student_id)
        and capability.old_participant_ref is not distinct from p_old->>'participant_ref'
        and capability.new_participant_ref=p_new->>'participant_ref'
        and not exists(select 1 from public.student_purge_fences where classroom_id=enrollment.classroom_id and student_id=enrollment.student_id)
        and not exists(select 1 from public.classroom_purge_fences where classroom_id=enrollment.classroom_id)
        and not exists(select 1 from public.cold_classroom_purge_fences where classroom_id=enrollment.classroom_id)
        and not exists(select 1 from public.attendance_decommission_operations where classroom_id=enrollment.classroom_id)
    );
$$;
revoke all on function private.attendance_pointer_mutation_allowed(jsonb,jsonb) from public,anon,authenticated,service_role;

create function private.allocate_attendance_membership_participant(p_classroom_id uuid,p_student_id uuid,p_generation_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_scope text; v_old public.attendance_participant_mappings; v_bound private.attendance_membership_generations;
  v_ref text; v_generation private.pal_membership_generations;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='55000',message='attendance_membership_isolation_required';
  end if;
  perform private.try_lock_classroom_membership_change(p_classroom_id,p_student_id);
  v_scope:=private.pal_membership_scope(p_classroom_id,p_student_id);
  perform 1 from public.classroom_enrollments enrollment where enrollment.classroom_id=p_classroom_id
    and enrollment.student_id=p_student_id and enrollment.id=p_generation_id for update;
  if not found then raise exception using errcode='40001',message='attendance_roster_source_changed'; end if;
  select * into v_generation from private.pal_membership_generations where generation_id=p_generation_id for update;
  if v_generation.state is distinct from 'active' or v_generation.scope_digest is distinct from v_scope
    or exists(select 1 from public.student_purge_fences where classroom_id=p_classroom_id and student_id=p_student_id)
    or exists(select 1 from public.classroom_purge_fences where classroom_id=p_classroom_id)
    or exists(select 1 from public.cold_classroom_purge_fences where classroom_id=p_classroom_id)
    or exists(select 1 from public.attendance_decommission_operations where classroom_id=p_classroom_id) then
    raise exception using errcode='55000',message='attendance_membership_generation_closed';
  end if;
  select * into v_old from public.attendance_participant_mappings
    where classroom_id=p_classroom_id and student_id=p_student_id for update;
  if v_old.participant_ref is not null then
    perform private.capture_attendance_participant_association(p_classroom_id,p_student_id,v_old.participant_ref);
  end if;
  select * into v_bound from private.attendance_membership_generations where generation_id=p_generation_id;
  if found then
    if v_bound.scope_digest is distinct from v_scope or v_bound.participant_ref is distinct from v_old.participant_ref
      or not private.attendance_membership_pointer_valid(p_classroom_id,p_student_id) then
      raise exception using errcode='55000',message='attendance_membership_binding_conflict';
    end if;
    return v_bound.participant_ref;
  end if;
  if exists(select 1 from private.attendance_membership_generations attendance
    join private.pal_membership_generations generation using(generation_id)
    where attendance.participant_ref=v_old.participant_ref and generation.state='active') then
    raise exception using errcode='55000',message='attendance_membership_binding_conflict';
  end if;
  v_ref:='participant_'||replace(gen_random_uuid()::text,'-','');
  if exists(select 1 from private.attendance_participant_associations where participant_ref=v_ref)
    or exists(select 1 from private.attendance_membership_generations where participant_ref=v_ref)
    or exists(select 1 from public.attendance_participant_mappings where participant_ref=v_ref)
    or exists(select 1 from public.attendance_check_in_facts where participant_ref=v_ref) then
    raise exception using errcode='40001',message='attendance_participant_reference_collision';
  end if;
  -- This exact locked allocation is the independent proof. Never relabel an
  -- existing legacy ref or mutate168/171/283 evidence to manufacture a binding.
  insert into private.attendance_membership_generations(generation_id,participant_ref,scope_digest)
    values(p_generation_id,v_ref,v_scope);
  insert into private.attendance_participant_associations(participant_ref,scope_digest,generation_id)
    values(v_ref,v_scope,p_generation_id);
  insert into private.attendance_pointer_mutations(transaction_id,scope_digest,generation_id,old_participant_ref,new_participant_ref)
    values(txid_current(),v_scope,p_generation_id,v_old.participant_ref,v_ref);
  if v_old.participant_ref is null then
    insert into public.attendance_participant_mappings(classroom_id,student_id,participant_ref,active)
      values(p_classroom_id,p_student_id,v_ref,true);
  else
    update public.attendance_participant_mappings set participant_ref=v_ref,active=true,updated_at=clock_timestamp()
      where classroom_id=p_classroom_id and student_id=p_student_id and participant_ref=v_old.participant_ref;
  end if;
  if not private.attendance_membership_pointer_valid(p_classroom_id,p_student_id) then
    raise exception using errcode='55000',message='attendance_membership_binding_conflict';
  end if;
  if v_old.participant_ref is not null then
    update public.attendance_integration_outbox set status='superseded',lease_token=null,lease_expires_at=null,
      last_error_code='membership_replaced',last_error_detail=null
      where classroom_id=p_classroom_id and message_type='roster.snapshot'
        and status in ('pending','processing','non_retryable')
        and private.attendance_payload_targets_participant(p_classroom_id,payload,v_old.participant_ref);
  end if;
  delete from private.attendance_pointer_mutations where transaction_id=txid_current() and scope_digest=v_scope;
  return v_ref;
end;
$$;
revoke all on function private.allocate_attendance_membership_participant(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function private.authorize_attendance_membership_owner(
  p_teacher_id uuid,p_classroom_id uuid,p_scope_mode text,p_canary_actor_id uuid,p_canary_classroom_id uuid
) returns void language plpgsql security definer set search_path='' as $$
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='55000',message='attendance_membership_isolation_required';
  end if;
  if p_teacher_id is null or p_classroom_id is null or p_scope_mode is null
    or p_scope_mode not in ('exact_canary','teacher_entitlements') then
    raise exception using errcode='22023',message='attendance_membership_scope_invalid';
  end if;
  perform private.try_lock_classroom_membership_change(p_classroom_id);
  perform 1 from public.classrooms classroom join public.users owner_user on owner_user.id=classroom.teacher_id
    where classroom.id=p_classroom_id and classroom.teacher_id=p_teacher_id and classroom.archived_at is null
      and owner_user.workos_user_id is not null for update of classroom;
  if not found then raise exception using errcode='42501',message='attendance_classroom_forbidden'; end if;
  if p_scope_mode='exact_canary' and (p_canary_actor_id is distinct from p_teacher_id
    or p_canary_classroom_id is distinct from p_classroom_id) then
    raise exception using errcode='42501',message='attendance_canary_not_active';
  end if;
  if coalesce(public.is_classroom_archive_maintenance_mode('restore'),false)
    or coalesce(public.is_classroom_archive_maintenance_mode('compaction'),false)
    or coalesce(current_setting('pika.identity_mapping',true),'off')='on'
    or coalesce(current_setting('pika.classroom_purge_finalize',true),'off')='on'
    or coalesce(current_setting('pika.course_blueprint_purge_finalize',true),'off')='on'
    or coalesce(current_setting('pika.student_purge_finalize',true),'off')='on'
    or exists(select 1 from public.classroom_purge_fences where classroom_id=p_classroom_id)
    or exists(select 1 from public.cold_classroom_purge_fences where classroom_id=p_classroom_id)
    or exists(select 1 from public.attendance_decommission_operations where classroom_id=p_classroom_id)
    or exists(select 1 from public.student_purge_fences where classroom_id=p_classroom_id) then
    raise exception using errcode='55000',message='attendance_membership_operation_blocked';
  end if;
end;
$$;
revoke all on function private.authorize_attendance_membership_owner(uuid,uuid,text,uuid,uuid) from public,anon,authenticated,service_role;

create function public.prepare_attendance_membership_snapshot_v1(
  p_teacher_id uuid,p_classroom_id uuid,p_window_start date,p_window_end date,p_scope_mode text,
  p_canary_actor_id uuid default null,p_canary_classroom_id uuid default null,p_at timestamptz default clock_timestamp()
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_enrollment record;
begin
  perform private.authorize_attendance_membership_owner(p_teacher_id,p_classroom_id,p_scope_mode,p_canary_actor_id,p_canary_classroom_id);
  if p_at is null then raise exception using errcode='22023',message='attendance_snapshot_window_invalid'; end if;
  if p_scope_mode='exact_canary' or public.attendance_teacher_entitled_v1(p_teacher_id,p_at) then
    for v_enrollment in select id,student_id from public.classroom_enrollments
      where classroom_id=p_classroom_id order by student_id for update loop
      perform private.allocate_attendance_membership_participant(p_classroom_id,v_enrollment.student_id,v_enrollment.id);
    end loop;
  end if;
  if p_scope_mode='teacher_entitlements' then
    return public.prepare_attendance_snapshot_v2(p_teacher_id,p_classroom_id,p_window_start,p_window_end,p_at);
  end if;
  return public.prepare_attendance_snapshot_v1(p_teacher_id,p_classroom_id,p_window_start,p_window_end);
end;
$$;
revoke all on function public.prepare_attendance_membership_snapshot_v1(uuid,uuid,date,date,text,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.prepare_attendance_membership_snapshot_v1(uuid,uuid,date,date,text,uuid,uuid,timestamptz) to service_role;

create function public.stage_attendance_membership_roster_snapshot_v1(
  p_teacher_id uuid,p_classroom_id uuid,p_source_token text,p_message jsonb,p_scope_mode text,
  p_canary_actor_id uuid default null,p_canary_classroom_id uuid default null,p_at timestamptz default clock_timestamp()
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.authorize_attendance_membership_owner(p_teacher_id,p_classroom_id,p_scope_mode,p_canary_actor_id,p_canary_classroom_id);
  if p_at is null or p_source_token is null or p_source_token !~ '^[a-f0-9]{32}$'
    or p_message is null or jsonb_typeof(p_message) is distinct from 'object'
    or not (p_message ?& array['schema_version','message_type','idempotency_key','correlation_ref',
      'installation_ref','roster_ref','revision','owner_principal_ref','display_name','owner_display_name','participants'])
    or jsonb_typeof(p_message->'participants') is distinct from 'array' then
    raise exception using errcode='22023',message='attendance_roster_stage_invalid';
  end if;
  if exists(select 1 from public.classroom_enrollments enrollment where enrollment.classroom_id=p_classroom_id
    and not private.attendance_membership_pointer_valid(enrollment.classroom_id,enrollment.student_id)) then
    raise exception using errcode='40001',message='attendance_roster_source_changed';
  end if;
  if p_scope_mode='teacher_entitlements' then
    return public.stage_attendance_roster_snapshot_v2(p_teacher_id,p_classroom_id,p_source_token,p_message,p_at);
  end if;
  return public.stage_attendance_roster_snapshot_v1(p_teacher_id,p_classroom_id,p_source_token,p_message);
end;
$$;
revoke all on function public.stage_attendance_membership_roster_snapshot_v1(uuid,uuid,text,jsonb,text,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.stage_attendance_membership_roster_snapshot_v1(uuid,uuid,text,jsonb,text,uuid,uuid,timestamptz) to service_role;

create function public.resolve_attendance_membership_scan_generation(p_classroom_id uuid,p_student_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_generation uuid; v_participant text;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='55000',message='attendance_membership_isolation_required';
  end if;
  perform private.try_lock_classroom_membership_change(p_classroom_id,p_student_id);
  if exists(select 1 from public.student_purge_fences where classroom_id=p_classroom_id and student_id=p_student_id)
    or exists(select 1 from public.classroom_purge_fences where classroom_id=p_classroom_id)
    or exists(select 1 from public.cold_classroom_purge_fences where classroom_id=p_classroom_id)
    or exists(select 1 from public.attendance_decommission_operations where classroom_id=p_classroom_id)
    or exists(select 1 from public.classroom_roster roster join public.classroom_enrollments enrollment
      on enrollment.id=roster.removed_enrollment_id and enrollment.classroom_id=roster.classroom_id
        and enrollment.student_id=roster.removed_student_id
      where enrollment.classroom_id=p_classroom_id and enrollment.student_id=p_student_id and roster.removed_at is not null)
    or not private.attendance_membership_pointer_valid(p_classroom_id,p_student_id) then
    return jsonb_build_object('status','forbidden');
  end if;
  select enrollment.id,mapping.participant_ref into v_generation,v_participant
    from public.classroom_enrollments enrollment
    join public.classrooms classroom on classroom.id=enrollment.classroom_id and classroom.archived_at is null
    join public.attendance_participant_mappings mapping on mapping.classroom_id=enrollment.classroom_id
      and mapping.student_id=enrollment.student_id and mapping.active
    where enrollment.classroom_id=p_classroom_id and enrollment.student_id=p_student_id;
  if v_generation is null then return jsonb_build_object('status','forbidden'); end if;
  return jsonb_build_object('status','active','generation_id',v_generation,'participant_ref',v_participant);
end;
$$;
revoke all on function public.resolve_attendance_membership_scan_generation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.resolve_attendance_membership_scan_generation(uuid,uuid) to service_role;

create or replace function private.attendance_participant_generation_closed(p_participant_ref text)
returns boolean language sql volatile security definer set search_path='' as $$
  select exists(select 1 from private.attendance_membership_generations attendance
    join private.pal_membership_generations generation using(generation_id)
    where attendance.participant_ref=p_participant_ref and generation.state<>'active')
    or exists(select 1 from private.attendance_participant_associations association
      where association.participant_ref=p_participant_ref and (association.closed or exists(
        select 1 from private.pal_membership_generations generation where generation.generation_id=association.generation_id
          and (generation.state<>'active' or generation.scope_digest is distinct from association.scope_digest))));
$$;

create or replace function private.attendance_payload_generation_closed(p_classroom_id uuid,p_payload jsonb)
returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
  if exists(select 1 from jsonb_path_query(p_payload,'$.**.participant_ref') ref
    where private.attendance_participant_generation_closed(ref #>> '{}')) then return true; end if;
  -- An unknown legacy generation remains unknown. Its superseded roster payload
  -- nevertheless cannot replace the newly allocated current participant.
  if p_payload->>'message_type'='roster.snapshot' and exists(
    select 1 from jsonb_path_query(p_payload,'$.**.participant_ref') ref
    join private.attendance_participant_associations association on association.participant_ref=ref #>> '{}'
    join public.attendance_participant_mappings mapping on mapping.classroom_id=p_classroom_id
      and private.pal_membership_scope(mapping.classroom_id,mapping.student_id)=association.scope_digest
    join private.attendance_membership_generations current_binding on current_binding.participant_ref=mapping.participant_ref
      and current_binding.scope_digest=association.scope_digest
    where mapping.participant_ref<>association.participant_ref) then return true; end if;
  if p_payload->>'message_type'='check_in.invalidate' and exists(
    select 1 from jsonb_path_query(p_payload,'$.**.check_in_ref') ref
    left join public.attendance_check_in_facts fact on fact.classroom_id=p_classroom_id and fact.check_in_ref=ref #>> '{}'
    where fact.check_in_ref is null or private.attendance_participant_generation_closed(fact.participant_ref)) then return true; end if;
  -- Preserve the legacy conservative matcher for unknown payload shapes.
  return exists(select 1 from private.attendance_membership_generations attendance
    join private.pal_membership_generations generation using(generation_id)
    left join public.attendance_participant_mappings mapping on mapping.participant_ref=attendance.participant_ref
    left join private.student_provider_cleanup_bindings binding on binding.generation_id=attendance.generation_id
    left join public.student_purge_operations operation on operation.id=binding.operation_id
    where (mapping.classroom_id=p_classroom_id or operation.classroom_id=p_classroom_id) and generation.state<>'active'
      and private.attendance_payload_targets_participant(p_classroom_id,p_payload,attendance.participant_ref));
end;
$$;

create function private.resolve_attendance_delivery_subject(p_classroom_id uuid,p_participant_ref text)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare v_student uuid;
begin
  perform private.try_lock_classroom_membership_change(p_classroom_id);
  if private.attendance_participant_generation_closed(p_participant_ref) then return null; end if;
  if exists(select 1 from private.attendance_participant_associations where participant_ref=p_participant_ref) then
    return private.resolve_attendance_participant_subject(p_classroom_id,p_participant_ref);
  end if;
  select student_id into v_student from public.attendance_participant_mappings
    where classroom_id=p_classroom_id and participant_ref=p_participant_ref;
  return v_student;
end;
$$;
revoke all on function private.resolve_attendance_delivery_subject(uuid,text) from public,anon,authenticated,service_role;

create or replace function private.capture_attendance_membership_generation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_generation uuid; v_scope text;
begin
  -- The admitted allocator establishes exact evidence before inserting its pointer.
  if exists(select 1 from private.attendance_membership_generations where participant_ref=new.participant_ref) then
    if not private.attendance_membership_pointer_valid(new.classroom_id,new.student_id) then
      raise exception using errcode='55000',message='attendance_membership_binding_conflict';
    end if;
    return new;
  end if;
  if not coalesce((select enabled from private.student_provider_cleanup_settings where singleton),false) then return new; end if;
  perform private.try_lock_classroom_membership_change(new.classroom_id,new.student_id);
  v_scope := private.pal_membership_scope(new.classroom_id,new.student_id);
  select enrollment.id into v_generation from public.classroom_enrollments enrollment
    join private.pal_membership_generations generation on generation.generation_id=enrollment.id
    where enrollment.classroom_id=new.classroom_id and enrollment.student_id=new.student_id
      and generation.state='active' and generation.scope_digest=v_scope
      and enrollment.created_at >= (select eligible_after from private.student_provider_cleanup_settings where singleton);
  if v_generation is not null then
    insert into private.attendance_membership_generations(generation_id,participant_ref,scope_digest)
      values(v_generation,new.participant_ref,v_scope);
  end if;
  return new;
end;
$$;

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
    -- Explicit refs are checked independently of older closed generations in
    -- this scope. Unattributed overrides retain their conservative legacy guard.
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

create or replace function public.attendance_roster_source_document_v1(p_classroom_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'title', classroom.title,
    'owner_principal_ref', owner_principal.principal_ref,
    'entitlement_revision', coalesce(entitlement.revision, 0),
    'enrolled_student_ids', coalesce((
      select jsonb_agg(enrollment.student_id order by enrollment.student_id)
      from public.classroom_enrollments enrollment
      where enrollment.classroom_id = classroom.id
    ), '[]'::jsonb),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'student_id', mapping.student_id,
        'participant_ref', mapping.participant_ref,
        'active', exists (
          select 1 from public.classroom_enrollments enrollment
          where enrollment.classroom_id = mapping.classroom_id
            and enrollment.student_id = mapping.student_id
        ),
        'first_name', profile.first_name,
        'last_name', profile.last_name,
        'principal_ref', student_principal.principal_ref
      ) order by mapping.student_id)
      from public.attendance_participant_mappings mapping
      join public.student_profiles profile on profile.user_id = mapping.student_id
      join public.users student_user on student_user.id = mapping.student_id
      left join public.attendance_principal_mappings student_principal
        on student_principal.user_id = student_user.id
      where mapping.classroom_id = classroom.id and not private.attendance_participant_generation_closed(mapping.participant_ref)
    ), '[]'::jsonb)
  ) || case when exists(select 1 from public.attendance_participant_mappings adopted
    join private.attendance_membership_generations bound on bound.participant_ref=adopted.participant_ref
      and bound.scope_digest=private.pal_membership_scope(adopted.classroom_id,adopted.student_id)
    join private.attendance_participant_associations association
      on association.participant_ref=bound.participant_ref and association.scope_digest=bound.scope_digest
    where adopted.classroom_id=classroom.id) then jsonb_build_object(
      'membership_generations',coalesce((select jsonb_agg(jsonb_build_object(
        'student_id',enrollment.student_id,'enrollment_id',enrollment.id,
        'participant_ref',mapping.participant_ref,'generation_id',attendance.generation_id
      ) order by enrollment.student_id)
      from public.classroom_enrollments enrollment
      left join public.attendance_participant_mappings mapping on mapping.classroom_id=enrollment.classroom_id
        and mapping.student_id=enrollment.student_id
      left join private.attendance_membership_generations attendance on attendance.participant_ref=mapping.participant_ref
      where enrollment.classroom_id=classroom.id),'[]'::jsonb)) else '{}'::jsonb end
  from public.classrooms classroom
  join public.users owner_user on owner_user.id = classroom.teacher_id
  join public.attendance_principal_mappings owner_principal
    on owner_principal.user_id = owner_user.id
  left join public.attendance_teacher_entitlements entitlement
    on entitlement.teacher_id = classroom.teacher_id
  where classroom.id = p_classroom_id;
$$;

create or replace function public.apply_attendance_event_v1(
  p_event jsonb,
  p_transport_nonce text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inbox_id uuid;
  v_classroom_id uuid;
  v_student_id uuid;
  v_existing_check_in public.attendance_check_in_facts%rowtype;
  v_incoming_revision bigint;
  v_incoming_invalidated_at timestamptz;
  v_projection_rows integer := 0;
begin
  if not public.attendance_event_v1_valid(p_event)
    or p_transport_nonce !~ '^[A-Za-z0-9._~-]{16,128}$' then
    raise exception using errcode = '22023', message = 'attendance_event_invalid';
  end if;

  select occurrence.classroom_id into v_classroom_id
  from public.attendance_occurrence_mappings occurrence
  join public.attendance_roster_mappings roster
    on roster.classroom_id = occurrence.classroom_id
  where occurrence.occurrence_ref = p_event->>'occurrence_ref'
    and roster.roster_ref = p_event->>'roster_ref';
  if v_classroom_id is null then
    raise exception using errcode = '23514', message = 'attendance_event_mapping_mismatch';
  end if;

  perform private.try_lock_classroom_membership_change(v_classroom_id);
  if private.attendance_payload_generation_closed(v_classroom_id,p_event) then
    raise exception using errcode='55000',message='attendance_membership_generation_closed';
  end if;

  if p_event->>'event_type' in (
    'attendance.check_in.accepted', 'attendance.check_in.invalidated'
  ) then
    v_student_id:=private.resolve_attendance_delivery_subject(v_classroom_id,p_event->'metadata'->>'participant_ref');
    if v_student_id is null then
      raise exception using errcode = '23514', message = 'attendance_event_participant_mismatch';
    end if;
  end if;

  insert into public.attendance_integration_inbox (
    classroom_id, installation_ref, transport_nonce, event_id,
    idempotency_key, correlation_ref, event_type, occurred_at,
    roster_ref, occurrence_ref, session_revision, payload
  ) values (
    v_classroom_id, p_event->>'installation_ref', p_transport_nonce,
    p_event->>'event_id', p_event->>'idempotency_key',
    p_event->>'correlation_ref', p_event->>'event_type',
    (p_event->>'occurred_at')::timestamptz, p_event->>'roster_ref',
    p_event->>'occurrence_ref', (p_event->>'session_revision')::bigint, p_event
  ) on conflict do nothing returning id into v_inbox_id;

  if v_inbox_id is null then
    if exists (
      select 1 from public.attendance_integration_inbox
      where installation_ref = p_event->>'installation_ref'
        and event_id = p_event->>'event_id' and payload = p_event
    ) then
      return jsonb_build_object(
        'accepted', true, 'duplicate', true, 'projection_applied', false
      );
    end if;
    raise exception using errcode = '23505', message = 'attendance_event_replay_conflict';
  end if;

  if p_event->>'event_type' in (
    'attendance.session.scheduled', 'attendance.session.opened',
    'attendance.session.closed', 'attendance.session.cancelled'
  ) then
    insert into public.attendance_session_projection (
      classroom_id, installation_ref, roster_ref, occurrence_ref,
      session_revision, status, opens_at, closes_at,
      last_event_id, last_event_at
    ) values (
      v_classroom_id, p_event->>'installation_ref', p_event->>'roster_ref',
      p_event->>'occurrence_ref', (p_event->>'session_revision')::bigint,
      case p_event->>'event_type'
        when 'attendance.session.scheduled' then 'scheduled'
        when 'attendance.session.opened' then 'open'
        when 'attendance.session.closed' then 'closed'
        else 'cancelled'
      end,
      case when p_event->>'event_type' = 'attendance.session.scheduled'
        then (p_event->'metadata'->>'accepts_at')::timestamptz end,
      case when p_event->>'event_type' = 'attendance.session.scheduled'
        then (p_event->'metadata'->>'stops_accepting_at')::timestamptz end,
      p_event->>'event_id', (p_event->>'occurred_at')::timestamptz
    ) on conflict (installation_ref, occurrence_ref) do update
      set roster_ref = excluded.roster_ref,
          classroom_id = excluded.classroom_id,
          session_revision = excluded.session_revision,
          status = excluded.status,
          opens_at = coalesce(excluded.opens_at, public.attendance_session_projection.opens_at),
          closes_at = coalesce(excluded.closes_at, public.attendance_session_projection.closes_at),
          last_event_id = excluded.last_event_id,
          last_event_at = excluded.last_event_at,
          updated_at = clock_timestamp()
      where excluded.session_revision > public.attendance_session_projection.session_revision;
    get diagnostics v_projection_rows = row_count;

    if p_event->>'event_type' in (
      'attendance.session.opened', 'attendance.session.closed',
      'attendance.session.cancelled'
    ) then
      update public.attendance_occurrence_mappings
      set policy_frozen_at = coalesce(
        policy_frozen_at, (p_event->>'occurred_at')::timestamptz
      )
      where occurrence_ref = p_event->>'occurrence_ref';
    end if;
  else
    v_incoming_revision := (p_event->'metadata'->>'check_in_revision')::bigint;
    v_incoming_invalidated_at := case
      when p_event->>'event_type' = 'attendance.check_in.invalidated'
      then (p_event->'metadata'->>'invalidated_at')::timestamptz end;
    perform pg_advisory_xact_lock(hashtextextended(
      (p_event->>'installation_ref') || ':' ||
        (p_event->'metadata'->>'check_in_ref'), 0
    ));
    select * into v_existing_check_in
    from public.attendance_check_in_facts
    where installation_ref = p_event->>'installation_ref'
      and check_in_ref = p_event->'metadata'->>'check_in_ref'
    for update;

    if v_existing_check_in.id is null then
      insert into public.attendance_check_in_facts (
        classroom_id, student_id, installation_ref, roster_ref,
        occurrence_ref, participant_ref, check_in_ref, check_in_revision,
        accepted_at, invalidated_at, reason_code, last_event_id, last_event_at
      ) values (
        v_classroom_id, v_student_id, p_event->>'installation_ref',
        p_event->>'roster_ref', p_event->>'occurrence_ref',
        p_event->'metadata'->>'participant_ref',
        p_event->'metadata'->>'check_in_ref', v_incoming_revision,
        (p_event->'metadata'->>'accepted_at')::timestamptz,
        v_incoming_invalidated_at, p_event->'metadata'->>'reason_code',
        p_event->>'event_id', (p_event->>'occurred_at')::timestamptz
      );
      v_projection_rows := 1;
    elsif v_existing_check_in.classroom_id <> v_classroom_id
      or v_existing_check_in.student_id <> v_student_id
      or v_existing_check_in.roster_ref <> p_event->>'roster_ref'
      or v_existing_check_in.occurrence_ref <> p_event->>'occurrence_ref'
      or v_existing_check_in.participant_ref <>
        p_event->'metadata'->>'participant_ref'
      or v_existing_check_in.accepted_at <>
        (p_event->'metadata'->>'accepted_at')::timestamptz then
      raise exception using errcode = '23514', message = 'attendance_check_in_identity_conflict';
    elsif v_incoming_revision < v_existing_check_in.check_in_revision then
      v_projection_rows := 0;
    elsif v_incoming_revision = v_existing_check_in.check_in_revision then
      if v_existing_check_in.invalidated_at is distinct from v_incoming_invalidated_at
        or v_existing_check_in.reason_code is distinct from
          p_event->'metadata'->>'reason_code' then
        raise exception using errcode = '23514', message = 'attendance_check_in_revision_conflict';
      end if;
      v_projection_rows := 0;
    elsif v_existing_check_in.invalidated_at is not null
      or v_incoming_invalidated_at is null
      or v_incoming_revision <> v_existing_check_in.check_in_revision + 1 then
      raise exception using errcode = '23514', message = 'attendance_check_in_transition_invalid';
    else
      update public.attendance_check_in_facts
      set check_in_revision = v_incoming_revision,
          invalidated_at = v_incoming_invalidated_at,
          reason_code = p_event->'metadata'->>'reason_code',
          last_event_id = p_event->>'event_id',
          last_event_at = (p_event->>'occurred_at')::timestamptz,
          updated_at = clock_timestamp()
      where id = v_existing_check_in.id;
      v_projection_rows := 1;
    end if;
    update public.attendance_occurrence_mappings
    set policy_frozen_at = coalesce(
      policy_frozen_at, (p_event->'metadata'->>'accepted_at')::timestamptz
    )
    where occurrence_ref = p_event->>'occurrence_ref';
  end if;

  update public.attendance_integration_inbox
  set projection_applied = v_projection_rows > 0 where id = v_inbox_id;
  return jsonb_build_object(
    'accepted', true, 'duplicate', false,
    'projection_applied', v_projection_rows > 0
  );
end;
$$;

create or replace function public.apply_attendance_session_snapshot_v1(
  p_installation_ref text,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check_in jsonb;
  v_classroom_id uuid;
  v_student_id uuid;
  v_existing_check_in public.attendance_check_in_facts%rowtype;
  v_incoming_revision bigint;
  v_incoming_invalidated_at timestamptz;
  v_session_rows integer := 0;
  v_check_in_rows integer := 0;
  v_current_rows integer := 0;
begin
  if p_installation_ref !~ '^[A-Za-z0-9._~-]{1,128}$'
    or not public.attendance_session_snapshot_v1_valid(p_snapshot) then
    raise exception using errcode = '22023', message = 'attendance_snapshot_invalid';
  end if;

  select occurrence.classroom_id into v_classroom_id
  from public.attendance_occurrence_mappings occurrence
  join public.attendance_roster_mappings roster
    on roster.classroom_id = occurrence.classroom_id
  where occurrence.occurrence_ref = p_snapshot->>'occurrence_ref'
    and roster.roster_ref = p_snapshot->>'roster_ref'
    and occurrence.desired_state = 'scheduled'
    and occurrence.opens_at = (p_snapshot->>'accepts_at')::timestamptz
    and occurrence.closes_at = (p_snapshot->>'stops_accepting_at')::timestamptz;
  if v_classroom_id is null then
    raise exception using errcode = '23514', message = 'attendance_snapshot_mapping_mismatch';
  end if;

  perform private.try_lock_classroom_membership_change(v_classroom_id);

  if exists (
    select 1 from jsonb_array_elements(p_snapshot->'check_ins') check_in
    where not private.attendance_participant_generation_closed(check_in->>'participant_ref')
      and private.resolve_attendance_delivery_subject(v_classroom_id,check_in->>'participant_ref') is null
  ) then
    raise exception using errcode = '23514', message = 'attendance_snapshot_participant_mismatch';
  end if;

  insert into public.attendance_session_projection (
    classroom_id, installation_ref, roster_ref, occurrence_ref,
    session_revision, status, opens_at, closes_at, last_event_id, last_event_at
  ) values (
    v_classroom_id, p_installation_ref, p_snapshot->>'roster_ref',
    p_snapshot->>'occurrence_ref', (p_snapshot->>'session_revision')::bigint,
    p_snapshot->>'status', (p_snapshot->>'accepts_at')::timestamptz,
    (p_snapshot->>'stops_accepting_at')::timestamptz,
    'reconcile:' || (p_snapshot->>'occurrence_ref') || ':' ||
      (p_snapshot->>'session_revision'), clock_timestamp()
  ) on conflict (installation_ref, occurrence_ref) do update
    set roster_ref = excluded.roster_ref,
        classroom_id = excluded.classroom_id,
        session_revision = excluded.session_revision,
        status = excluded.status,
        opens_at = excluded.opens_at,
        closes_at = excluded.closes_at,
        last_event_id = excluded.last_event_id,
        last_event_at = excluded.last_event_at,
        updated_at = clock_timestamp()
    where excluded.session_revision > public.attendance_session_projection.session_revision;
  get diagnostics v_session_rows = row_count;

  for v_check_in in select value from jsonb_array_elements(p_snapshot->'check_ins') loop
    if private.attendance_participant_generation_closed(v_check_in->>'participant_ref') then continue; end if;
    v_student_id:=private.resolve_attendance_delivery_subject(v_classroom_id,v_check_in->>'participant_ref');
    v_incoming_revision := (v_check_in->>'check_in_revision')::bigint;
    v_incoming_invalidated_at := case when v_check_in ? 'invalidated_at'
      then (v_check_in->>'invalidated_at')::timestamptz end;
    perform pg_advisory_xact_lock(hashtextextended(
      p_installation_ref || ':' || (v_check_in->>'check_in_ref'), 0
    ));
    select * into v_existing_check_in
    from public.attendance_check_in_facts
    where installation_ref = p_installation_ref
      and check_in_ref = v_check_in->>'check_in_ref'
    for update;

    if v_existing_check_in.id is null then
      insert into public.attendance_check_in_facts (
        classroom_id, student_id, installation_ref, roster_ref, occurrence_ref,
        participant_ref, check_in_ref, check_in_revision, accepted_at,
        invalidated_at, reason_code, last_event_id, last_event_at
      ) values (
        v_classroom_id, v_student_id, p_installation_ref, p_snapshot->>'roster_ref',
        p_snapshot->>'occurrence_ref', v_check_in->>'participant_ref',
        v_check_in->>'check_in_ref', v_incoming_revision,
        (v_check_in->>'accepted_at')::timestamptz, v_incoming_invalidated_at,
        v_check_in->>'reason_code',
        'reconcile:' || (v_check_in->>'check_in_ref') || ':' || v_incoming_revision,
        clock_timestamp()
      );
      v_current_rows := 1;
    elsif v_existing_check_in.classroom_id <> v_classroom_id
      or v_existing_check_in.student_id <> v_student_id
      or v_existing_check_in.roster_ref <> p_snapshot->>'roster_ref'
      or v_existing_check_in.occurrence_ref <> p_snapshot->>'occurrence_ref'
      or v_existing_check_in.participant_ref <> v_check_in->>'participant_ref'
      or v_existing_check_in.accepted_at <>
        (v_check_in->>'accepted_at')::timestamptz then
      raise exception using errcode = '23514', message = 'attendance_check_in_identity_conflict';
    elsif v_incoming_revision < v_existing_check_in.check_in_revision then
      v_current_rows := 0;
    elsif v_incoming_revision = v_existing_check_in.check_in_revision then
      if v_existing_check_in.invalidated_at is distinct from v_incoming_invalidated_at
        or v_existing_check_in.reason_code is distinct from v_check_in->>'reason_code' then
        raise exception using errcode = '23514', message = 'attendance_check_in_revision_conflict';
      end if;
      v_current_rows := 0;
    elsif v_existing_check_in.invalidated_at is not null
      or v_incoming_invalidated_at is null
      or v_incoming_revision <> v_existing_check_in.check_in_revision + 1 then
      raise exception using errcode = '23514', message = 'attendance_check_in_transition_invalid';
    else
      update public.attendance_check_in_facts
      set check_in_revision = v_incoming_revision,
          invalidated_at = v_incoming_invalidated_at,
          reason_code = v_check_in->>'reason_code',
          last_event_id = 'reconcile:' || (v_check_in->>'check_in_ref') || ':' ||
            v_incoming_revision,
          last_event_at = clock_timestamp(),
          updated_at = clock_timestamp()
      where id = v_existing_check_in.id;
      v_current_rows := 1;
    end if;
    v_check_in_rows := v_check_in_rows + v_current_rows;
  end loop;

  update public.attendance_occurrence_mappings
  set last_reconciled_at = clock_timestamp(),
      policy_frozen_at = case
        when p_snapshot->>'status' in ('open', 'closed', 'cancelled')
          or jsonb_array_length(p_snapshot->'check_ins') > 0
        then coalesce(policy_frozen_at, clock_timestamp())
        else policy_frozen_at end
  where occurrence_ref = p_snapshot->>'occurrence_ref';

  return jsonb_build_object(
    'applied', true,
    'session_projection_applied', v_session_rows > 0,
    'check_in_projection_count', v_check_in_rows
  );
end;
$$;

create or replace function private.close_removed_attendance_delivery()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_classroom uuid; v_participant text;
begin
  if old.state='active' and new.state='removed' then
    select attendance.participant_ref into v_participant from private.attendance_membership_generations attendance
      where attendance.generation_id=new.generation_id;
    if v_participant is null then return new; end if;
    select mapping.classroom_id into v_classroom from public.attendance_participant_mappings mapping
      where mapping.participant_ref=v_participant
        and private.pal_membership_scope(mapping.classroom_id,mapping.student_id)=new.scope_digest;
    if v_classroom is null then
      select roster.classroom_id into v_classroom from public.classroom_roster roster
        where roster.removed_enrollment_id=new.generation_id and roster.removed_at is not null
          and private.pal_membership_scope(roster.classroom_id,roster.removed_student_id)=new.scope_digest
        order by roster.classroom_id limit 1;
    end if;
    if v_classroom is not null then
      update public.attendance_integration_outbox set status='superseded',lease_token=null,lease_expires_at=null,
        last_error_code='membership_removed',last_error_detail=null
      where classroom_id=v_classroom and status in ('pending','processing','non_retryable')
        and private.attendance_payload_targets_participant(classroom_id,payload,v_participant);
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.prepare_attendance_snapshot_v1(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_window_start date,
  p_window_end date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom public.classrooms%rowtype;
  v_roster public.attendance_roster_mappings%rowtype;
  v_owner_principal_ref text;
  v_roster_document jsonb;
  v_schedule_document jsonb;
  v_roster_token text;
  v_schedule_token text;
  v_missing_profiles bigint;
begin
  perform private.try_lock_classroom_membership_change(p_classroom_id);
  if p_teacher_id is null or p_classroom_id is null
    or p_window_start is null or p_window_end is null
    or p_window_end < p_window_start
    or p_window_end - p_window_start > 400 then
    raise exception using errcode = '22023', message = 'attendance_snapshot_window_invalid';
  end if;

  select * into v_classroom
  from public.classrooms
  where id = p_classroom_id
  for update;
  if v_classroom.id is null then
    raise exception using errcode = 'P0002', message = 'attendance_classroom_not_found';
  end if;
  if v_classroom.teacher_id <> p_teacher_id then
    raise exception using errcode = '42501', message = 'attendance_classroom_forbidden';
  end if;
  if v_classroom.archived_at is not null then
    raise exception using errcode = '42501', message = 'attendance_classroom_archived';
  end if;

  if not exists (
    select 1 from public.users
    where id = v_classroom.teacher_id and workos_user_id is not null
  ) then
    raise exception using errcode = '23514', message = 'attendance_owner_identity_not_linked';
  end if;

  select count(*) into v_missing_profiles
  from public.classroom_enrollments enrollment
  left join public.student_profiles profile on profile.user_id = enrollment.student_id
  where enrollment.classroom_id = p_classroom_id and profile.user_id is null;
  if v_missing_profiles > 0 then
    raise exception using errcode = '23514', message = 'attendance_student_profile_missing';
  end if;

  insert into public.attendance_roster_mappings (classroom_id)
  values (p_classroom_id)
  on conflict (classroom_id) do nothing;

  update public.attendance_participant_mappings mapping
  set active = exists (
        select 1 from public.classroom_enrollments enrollment
        where enrollment.classroom_id = mapping.classroom_id
          and enrollment.student_id = mapping.student_id
      ),
      updated_at = clock_timestamp()
  where mapping.classroom_id = p_classroom_id and not private.attendance_participant_generation_closed(mapping.participant_ref)
    and mapping.active is distinct from exists (
      select 1 from public.classroom_enrollments enrollment
      where enrollment.classroom_id = mapping.classroom_id
        and enrollment.student_id = mapping.student_id
    );

  insert into public.attendance_participant_mappings (
    classroom_id, student_id, active
  )
  select enrollment.classroom_id, enrollment.student_id, true
  from public.classroom_enrollments enrollment
  where enrollment.classroom_id = p_classroom_id
    -- BEFORE INSERT runs even for discarded ON CONFLICT rows. Already-valid
    -- adopted pointers were handled by the preceding UPDATE; do not invent a
    -- second reference for them. Unadopted legacy conflict behavior is retained.
    and not private.attendance_membership_pointer_valid(enrollment.classroom_id,enrollment.student_id)
  on conflict (classroom_id, student_id) do update
    set active = true, updated_at = clock_timestamp();

  insert into public.attendance_principal_mappings (user_id)
  select candidate.user_id
  from (
    select v_classroom.teacher_id as user_id
    union
    select enrollment.student_id
    from public.classroom_enrollments enrollment
    join public.users student_user on student_user.id = enrollment.student_id
    where enrollment.classroom_id = p_classroom_id
      and student_user.workos_user_id is not null
  ) candidate
  on conflict (user_id) do nothing;

  select principal_ref into v_owner_principal_ref
  from public.attendance_principal_mappings
  where user_id = v_classroom.teacher_id;
  if v_owner_principal_ref is null then
    raise exception using errcode = '23514', message = 'attendance_owner_principal_missing';
  end if;

  insert into public.attendance_occurrence_mappings (
    classroom_id, class_date, opens_at, closes_at
  )
  select class_day.classroom_id, class_day.date, null, null
  from public.class_days class_day
  where class_day.classroom_id = p_classroom_id
    and class_day.date between p_window_start and p_window_end
    and class_day.is_class_day
  on conflict (classroom_id, class_date) do nothing;

  select * into v_roster
  from public.attendance_roster_mappings
  where classroom_id = p_classroom_id
  for update;

  v_roster_document := public.attendance_roster_source_document_v1(p_classroom_id);
  v_schedule_document := public.attendance_schedule_source_document_v1(
    p_classroom_id, p_window_start, p_window_end
  );
  if v_schedule_document is null then
    raise exception using errcode = '23514', message = 'attendance_window_policy_missing';
  end if;
  v_roster_token := md5(v_roster_document::text);
  v_schedule_token := md5(v_schedule_document::text);

  return jsonb_build_object(
    'classroom_id', p_classroom_id,
    'roster_ref', v_roster.roster_ref,
    'title', v_classroom.title,
    'owner_principal_ref', v_owner_principal_ref,
    'roster_source_token', v_roster_token,
    'roster_revision', case
      when v_roster.source_token = v_roster_token then greatest(v_roster.source_revision, 1)
      else v_roster.source_revision + 1
    end,
    'schedule_source_token', v_schedule_token,
    'schedule_revision', case
      when v_roster.schedule_source_token = v_schedule_token
        then greatest(v_roster.schedule_source_revision, 1)
      else v_roster.schedule_source_revision + 1
    end,
    'policy', v_schedule_document->'policy',
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'student_id', mapping.student_id,
        'participant_ref', mapping.participant_ref,
        'display_name', btrim(profile.first_name || ' ' || profile.last_name),
        'active', mapping.active,
        'principal_ref', student_principal.principal_ref
      ) order by profile.last_name, profile.first_name, mapping.student_id)
      from public.attendance_participant_mappings mapping
      join public.student_profiles profile on profile.user_id = mapping.student_id
      join public.users student_user on student_user.id = mapping.student_id
      left join public.attendance_principal_mappings student_principal
        on student_principal.user_id = student_user.id
      where mapping.classroom_id = p_classroom_id and not private.attendance_participant_generation_closed(mapping.participant_ref)
    ), '[]'::jsonb),
    'class_days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', class_day.date,
        'is_class_day', class_day.is_class_day,
        'occurrence_ref', occurrence.occurrence_ref
      ) order by class_day.date)
      from public.class_days class_day
      left join public.attendance_occurrence_mappings occurrence
        on occurrence.classroom_id = class_day.classroom_id
       and occurrence.class_date = class_day.date
      where class_day.classroom_id = p_classroom_id
        and class_day.date between p_window_start and p_window_end
    ), '[]'::jsonb)
  );
end;
$$;

commit;
