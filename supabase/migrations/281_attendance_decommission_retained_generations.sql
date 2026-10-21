-- Compatibility only: no deletion, provider request or rollout activation occurs
-- on installation. Retained private membership/replay evidence stays immutable.
begin;
set local lock_timeout = '5s';

create table private.attendance_decommission_delete_capabilities (
  transaction_id bigint primary key,
  operation_id uuid not null references public.attendance_decommission_operations(id) on delete restrict,
  classroom_id uuid not null,
  phase integer not null check (phase between 1 and 14),
  table_name text not null
);
alter table private.attendance_decommission_delete_capabilities enable row level security;
revoke all on private.attendance_decommission_delete_capabilities from public,anon,authenticated,service_role;

-- No caller-controlled setting or public setter. Both the capability and the
-- saved operation must agree on this transaction's exact phase/table/classroom.
create function private.attendance_decommission_delete_allowed(p_table text,p_row jsonb)
returns boolean language sql volatile security definer set search_path='' as $$
  select exists(
    select 1 from private.attendance_decommission_delete_capabilities capability
    join public.attendance_decommission_operations operation on operation.id=capability.operation_id
    join public.attendance_decommission_settings settings on settings.singleton
    where capability.transaction_id=txid_current()
      and operation.state='remote_deleted'
      and settings.installation_ref=operation.installation_ref
      and public.attendance_decommission_allowed(operation.teacher_id,operation.classroom_id)
      and operation.classroom_id=capability.classroom_id
      and operation.phase=capability.phase
      and capability.classroom_id=(p_row->>'classroom_id')::uuid
      and capability.table_name=p_table
      -- An event's redundant classroom/student fields cannot authorize deleting
      -- a child of another classroom or an independently fenced learner.
      and (p_table<>'attendance_status_override_events' or exists(
        select 1 from public.attendance_status_overrides parent
        where parent.id=(p_row->>'override_id')::uuid
          and parent.classroom_id=capability.classroom_id
          and parent.student_id=(p_row->>'student_id')::uuid))
      and p_table=(array[
        'attendance_status_override_events','attendance_status_overrides','attendance_override_requests',
        'attendance_check_in_facts','attendance_record_projection','attendance_session_projection',
        'attendance_integration_inbox','attendance_integration_outbox','attendance_integration_smoke_runs',
        'attendance_classroom_qr_handles','attendance_occurrence_mappings','attendance_participant_mappings',
        'attendance_window_policies','attendance_roster_mappings'
      ])[capability.phase]
  );
$$;
revoke all on function private.attendance_decommission_delete_allowed(text,jsonb) from public,anon,authenticated,service_role;

create or replace function public.begin_attendance_decommission(
  p_teacher_id uuid, p_classroom_id uuid, p_operation_id uuid, p_confirmation text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_class public.classrooms;
  v_roster text;
  v_principal text;
  v_installation text;
begin
  -- An older repeatable-read snapshot could miss a removal that committed while
  -- waiting for the shared classroom lock. Require fresh admission visibility.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='55000',message='attendance_decommission_isolation_required';
  end if;
  if p_operation_id is null then raise exception using errcode = '22023', message = 'invalid_operation'; end if;
  perform 1 from public.attendance_decommission_settings where singleton for share;
  if not public.attendance_decommission_allowed(p_teacher_id, p_classroom_id) then
    raise exception using errcode = '55000', message = 'attendance_decommission_disabled';
  end if;
  perform public.classroom_purge_lock(p_classroom_id);
  perform 1 from public.attendance_decommission_operations where id = p_operation_id;
  if found then
    return public.authorize_attendance_decommission_advance(p_teacher_id, p_classroom_id, p_operation_id);
  end if;
  select * into v_class from public.classrooms where id = p_classroom_id for update;
  if not found or v_class.teacher_id is distinct from p_teacher_id then
    raise exception using errcode = '42501', message = 'classroom_forbidden';
  end if;
  if v_class.archived_at is null then raise exception using errcode = '55000', message = 'classroom_not_archived'; end if;
  if p_confirmation is null or (p_confirmation <> 'DELETE' and p_confirmation <> v_class.title) then
    raise exception using errcode = '22023', message = 'confirmation_mismatch';
  end if;
  perform public.guard_classroom_purge_lifecycle(p_classroom_id);
  if exists (select 1 from public.classroom_archive_operations where classroom_id = p_classroom_id
      and status <> 'completed' and (status <> 'failed' or coalesce(retryable, false)))
    or exists (select 1 from public.student_purge_operations where classroom_id = p_classroom_id and status <> 'completed')
    or exists (select 1 from private.removed_student_cleanup_jobs where classroom_id = p_classroom_id
      and status in ('queued','processing','retry_wait','quarantined'))
    or exists (select 1 from public.classroom_cold_tombstones where classroom_id = p_classroom_id) then
    raise exception using errcode = '55000', message = 'classroom_operation_conflict';
  end if;
  select roster_ref into v_roster from public.attendance_roster_mappings where classroom_id = p_classroom_id;
  select principal_ref into v_principal from public.attendance_principal_mappings where user_id = p_teacher_id;
  select installation_ref into v_installation from public.attendance_decommission_settings where singleton;
  if v_roster is null or v_principal is null then
    raise exception using errcode = '55000', message = 'attendance_mapping_unverified';
  end if;
  insert into public.attendance_decommission_operations
    (id, classroom_id, teacher_id, installation_ref, roster_ref, actor_principal_ref)
  values (p_operation_id, p_classroom_id, p_teacher_id, v_installation, v_roster, v_principal);
  return public.get_attendance_decommission(p_teacher_id, p_classroom_id, p_operation_id);
end;
$$;

create or replace function public.tick_attendance_decommission(p_teacher_id uuid, p_classroom_id uuid, p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_op public.attendance_decommission_operations;
  v_table text;
  v_count integer;
  v_tables constant text[] := array[
    'attendance_status_override_events', 'attendance_status_overrides', 'attendance_override_requests',
    'attendance_check_in_facts', 'attendance_record_projection', 'attendance_session_projection',
    'attendance_integration_inbox', 'attendance_integration_outbox', 'attendance_integration_smoke_runs',
    'attendance_classroom_qr_handles', 'attendance_occurrence_mappings', 'attendance_participant_mappings',
    'attendance_window_policies', 'attendance_roster_mappings'
  ];
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='55000',message='attendance_decommission_isolation_required';
  end if;
  perform public.authorize_attendance_decommission_advance(p_teacher_id, p_classroom_id, p_operation_id);
  perform public.classroom_purge_lock(p_classroom_id);
  select * into v_op from public.attendance_decommission_operations where id = p_operation_id
    and teacher_id = p_teacher_id and classroom_id = p_classroom_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'decommission_not_found'; end if;
  if v_op.state = 'fenced' then raise exception using errcode = '55000', message = 'remote_deletion_unverified'; end if;
  if v_op.state = 'local_deleted' then
    return public.get_attendance_decommission(p_teacher_id, p_classroom_id, p_operation_id);
  end if;
  v_table := v_tables[v_op.phase];
  if v_table is not null then
    insert into private.attendance_decommission_delete_capabilities(transaction_id,operation_id,classroom_id,phase,table_name)
      values(txid_current(),v_op.id,v_op.classroom_id,v_op.phase,v_table);
    execute format('delete from public.%I where ctid in
      (select ctid from public.%I where classroom_id = $1 limit 500)', v_table, v_table)
      using p_classroom_id;
    get diagnostics v_count = row_count;
    -- The capability never spans phase advancement or a successful return.
    -- Any exception rolls back the capability, deleted rows and operation together.
    delete from private.attendance_decommission_delete_capabilities where transaction_id=txid_current();
    update public.attendance_decommission_operations set
      phase = phase + case when v_count = 0 then 1 else 0 end,
      deleted_count = deleted_count + v_count, updated_at = clock_timestamp()
    where id = p_operation_id;
  else
    for v_table in select unnest(v_tables) loop
      execute format('select count(*) from (select 1 from public.%I where classroom_id = $1 limit 1) t', v_table)
        into v_count using p_classroom_id;
      if v_count <> 0 then raise exception using errcode = '55000', message = 'local_absence_unverified'; end if;
    end loop;
    update public.attendance_decommission_operations set state = 'local_deleted', updated_at = clock_timestamp()
      where id = p_operation_id;
  end if;
  return public.get_attendance_decommission(p_teacher_id, p_classroom_id, p_operation_id);
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

create or replace function private.guard_removed_academic_attendance_reference()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_row jsonb; v_parent public.attendance_status_overrides;
begin
  if tg_op='DELETE' and exists(select 1 from private.attendance_decommission_delete_capabilities
    where transaction_id=txid_current()) then
    if private.attendance_decommission_delete_allowed(tg_table_name,to_jsonb(old)) then return old; end if;
    raise exception using errcode='55000',message='attendance_decommission_delete_forbidden';
  end if;
  if tg_op='DELETE' and private.removed_academic_delete_allowed(tg_table_name,to_jsonb(old)) then return old; end if;
  if tg_op='DELETE' and exists(select 1 from private.removed_academic_mutations
    where transaction_id=txid_current() and action='finalize') then
    raise exception using errcode='55000',message='academic_cleanup_unstaged_attendance_child';
  end if;
  for v_row in select value from jsonb_array_elements(jsonb_build_array(
    case when tg_op<>'DELETE' then to_jsonb(new) end,case when tg_op<>'INSERT' then to_jsonb(old) end))
    where jsonb_typeof(value)='object' loop
    perform private.try_lock_classroom_membership_change((v_row->>'classroom_id')::uuid,(v_row->>'student_id')::uuid);
    select * into v_parent from public.attendance_status_overrides where id=(v_row->>'override_id')::uuid;
    if not found then continue; end if;
    perform private.try_lock_classroom_membership_change(v_parent.classroom_id,v_parent.student_id);
    if exists(select 1 from public.student_purge_fences fence
      join private.student_provider_cleanup_bindings binding on binding.operation_id=fence.operation_id
      where (fence.classroom_id=v_parent.classroom_id and fence.student_id=v_parent.student_id)
        or (fence.classroom_id=(v_row->>'classroom_id')::uuid and fence.student_id=(v_row->>'student_id')::uuid)) then
      raise exception using errcode='55000',message='academic_cleanup_attendance_reference_fenced';
    end if;
  end loop;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

revoke all on function private.guard_attendance_closed_subject(),private.guard_removed_academic_attendance_reference()
  from public,anon,authenticated,service_role;
revoke all on function public.begin_attendance_decommission(uuid,uuid,uuid,text),
  public.tick_attendance_decommission(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.begin_attendance_decommission(uuid,uuid,uuid,text),
  public.tick_attendance_decommission(uuid,uuid,uuid) to service_role;
commit;
