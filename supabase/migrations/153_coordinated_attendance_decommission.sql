-- Dormant coordinated deletion. No rows are erased and no gate is enabled by
-- applying this migration. Shared users/principal mappings are never deleted.
create table public.attendance_decommission_settings (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'disabled' check (mode in ('disabled', 'canary', 'enabled')),
  installation_ref text check (installation_ref ~ '^[A-Za-z0-9._~-]{1,128}$'),
  canary_teacher_id uuid,
  canary_classroom_id uuid
);
insert into public.attendance_decommission_settings (singleton) values (true);

-- Deliberately no classroom FK: this opaque operation/fence survives purge and
-- forbids reusing the deleted classroom identity. It is not a restore resource.
create table public.attendance_decommission_operations (
  id uuid primary key,
  classroom_id uuid not null unique,
  teacher_id uuid not null,
  installation_ref text not null,
  roster_ref text not null,
  actor_principal_ref text not null,
  state text not null default 'fenced' check (state in ('fenced', 'remote_deleted', 'local_deleted')),
  phase integer not null default 1 check (phase between 1 and 15),
  deleted_count bigint not null default 0 check (deleted_count >= 0),
  remote_deleted_count bigint check (remote_deleted_count >= 0),
  started_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (installation_ref, roster_ref)
);
alter table public.attendance_decommission_settings enable row level security;
alter table public.attendance_decommission_operations enable row level security;
revoke all on public.attendance_decommission_settings, public.attendance_decommission_operations
  from public, anon, authenticated, service_role;

create function public.attendance_decommission_allowed(p_teacher_id uuid, p_classroom_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select installation_ref is not null and
    (mode = 'enabled' or (mode = 'canary' and canary_teacher_id = p_teacher_id
      and canary_classroom_id = p_classroom_id))
    from public.attendance_decommission_settings where singleton), false)
$$;

-- Reuse the existing lock order and global classroom writer coverage. All
-- classroom changes remain stopped. The existing purge's narrowly scoped
-- begin/finalize trigger contexts remain its only authorized write path.
create or replace function public.guard_classroom_purge_lifecycle(p_classroom_id uuid)
returns void language plpgsql set search_path = '' as $$
begin
  if p_classroom_id is null then return; end if;
  if not public.classroom_purge_try_lock(p_classroom_id) then
    raise exception using errcode = '40001', message = 'classroom_operation_busy';
  end if;
  if exists (select 1 from public.classroom_purge_fences where classroom_id = p_classroom_id) then
    raise exception using errcode = '55000', message = 'classroom_purge_active';
  end if;
  if exists (select 1 from public.attendance_decommission_operations
    where classroom_id = p_classroom_id) then
    raise exception using errcode = '55000', message = 'attendance_decommission_active';
  end if;
end;
$$;

-- Attendance is outside the archive resource graph. Fence its writers explicitly
-- and permanently, including late inbox delivery and outbox claim/update races.
create function public.reject_attendance_write_during_decommission()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  for v_id in select distinct value from unnest(array[
    new.classroom_id, case when tg_op = 'UPDATE' then old.classroom_id end
  ]) value where value is not null loop
    if not public.classroom_purge_try_lock(v_id) then
      raise exception using errcode = '40001', message = 'classroom_operation_busy';
    end if;
    if exists (select 1 from public.attendance_decommission_operations where classroom_id = v_id) then
      raise exception using errcode = '55000', message = 'attendance_decommission_active';
    end if;
  end loop;
  return new;
end;
$$;

do $$ declare v_table text; begin
  foreach v_table in array array[
    'attendance_status_override_events', 'attendance_status_overrides', 'attendance_override_requests',
    'attendance_check_in_facts', 'attendance_record_projection', 'attendance_session_projection',
    'attendance_integration_inbox', 'attendance_integration_outbox', 'attendance_integration_smoke_runs',
    'attendance_classroom_qr_handles', 'attendance_occurrence_mappings', 'attendance_participant_mappings',
    'attendance_window_policies', 'attendance_roster_mappings'
  ] loop
    execute format('create trigger attendance_decommission_fence before insert or update on public.%I
      for each row execute function public.reject_attendance_write_during_decommission()', v_table);
  end loop;
end $$;

create function public.reject_decommissioned_classroom_reactivation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.archived_at is null and exists (select 1 from public.attendance_decommission_operations
    where classroom_id = new.id) then
    raise exception using errcode = '55000', message = 'attendance_decommission_irreversible';
  end if;
  return new;
end;
$$;
create trigger attendance_decommission_reactivation before insert or update on public.classrooms
for each row execute function public.reject_decommissioned_classroom_reactivation();

create function public.get_attendance_decommission(p_teacher_id uuid, p_classroom_id uuid, p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_op public.attendance_decommission_operations;
begin
  select * into v_op from public.attendance_decommission_operations
  where id = p_operation_id and teacher_id = p_teacher_id and classroom_id = p_classroom_id;
  if not found then raise exception using errcode = 'P0002', message = 'decommission_not_found'; end if;
  return jsonb_build_object('operation_id', v_op.id, 'state', v_op.state,
    'installation_ref', v_op.installation_ref, 'roster_ref', v_op.roster_ref,
    'operation_ref', 'decommission_' || replace(v_op.id::text, '-', ''),
    'actor_principal_ref', v_op.actor_principal_ref, 'deleted_count', v_op.deleted_count);
end;
$$;

create function public.begin_attendance_decommission(
  p_teacher_id uuid, p_classroom_id uuid, p_operation_id uuid, p_confirmation text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_class public.classrooms;
  v_op public.attendance_decommission_operations;
  v_roster text;
  v_principal text;
  v_installation text;
begin
  if p_operation_id is null then raise exception using errcode = '22023', message = 'invalid_operation'; end if;
  perform 1 from public.attendance_decommission_settings where singleton for share;
  if not public.attendance_decommission_allowed(p_teacher_id, p_classroom_id) then
    raise exception using errcode = '55000', message = 'attendance_decommission_disabled';
  end if;
  perform public.classroom_purge_lock(p_classroom_id);
  select * into v_op from public.attendance_decommission_operations where id = p_operation_id;
  if found then
    return public.get_attendance_decommission(p_teacher_id, p_classroom_id, p_operation_id);
  end if;
  select * into v_class from public.classrooms where id = p_classroom_id for update;
  if not found or v_class.teacher_id <> p_teacher_id then
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

create function public.record_attendance_decommission_receipt(
  p_teacher_id uuid, p_classroom_id uuid, p_operation_id uuid, p_receipt jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_op public.attendance_decommission_operations;
begin
  perform public.classroom_purge_lock(p_classroom_id);
  select * into v_op from public.attendance_decommission_operations where id = p_operation_id
    and teacher_id = p_teacher_id and classroom_id = p_classroom_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'decommission_not_found'; end if;
  if not public.attendance_decommission_allowed(p_teacher_id, p_classroom_id) then
    raise exception using errcode = '55000', message = 'attendance_decommission_disabled';
  end if;
  if p_receipt is null or jsonb_typeof(p_receipt) <> 'object'
    or (select count(*) from jsonb_object_keys(p_receipt)) <> 8
    or p_receipt->'schema_version' is distinct from '1'::jsonb
    or p_receipt->'ok' is distinct from 'true'::jsonb
    or p_receipt->>'state' is distinct from 'deleted'
    or p_receipt->'absence_verified' is distinct from 'true'::jsonb
    or p_receipt->>'installation_ref' is distinct from v_op.installation_ref
    or p_receipt->>'roster_ref' is distinct from v_op.roster_ref
    or p_receipt->>'operation_ref' is distinct from ('decommission_' || replace(v_op.id::text, '-', ''))
    or jsonb_typeof(p_receipt->'deleted_count') is distinct from 'number'
    or not coalesce(p_receipt->>'deleted_count' ~ '^[0-9]{1,15}$', false) then
    raise exception using errcode = '22023', message = 'decommission_receipt_unverified';
  end if;
  if v_op.state = 'fenced' then
    update public.attendance_decommission_operations set state = 'remote_deleted',
      remote_deleted_count = (p_receipt->>'deleted_count')::bigint, updated_at = clock_timestamp()
    where id = p_operation_id;
  end if;
  return public.get_attendance_decommission(p_teacher_id, p_classroom_id, p_operation_id);
end;
$$;

create function public.tick_attendance_decommission(p_teacher_id uuid, p_classroom_id uuid, p_operation_id uuid)
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
  if not public.attendance_decommission_allowed(p_teacher_id, p_classroom_id) then
    raise exception using errcode = '55000', message = 'attendance_decommission_disabled';
  end if;
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
    execute format('delete from public.%I where ctid in
      (select ctid from public.%I where classroom_id = $1 limit 500)', v_table, v_table)
      using p_classroom_id;
    get diagnostics v_count = row_count;
    update public.attendance_decommission_operations set
      phase = phase + case when v_count = 0 then 1 else 0 end,
      deleted_count = deleted_count + v_count, updated_at = clock_timestamp()
    where id = p_operation_id;
  else
    foreach v_table in array v_tables loop
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

revoke all on function public.attendance_decommission_allowed(uuid, uuid),
  public.reject_attendance_write_during_decommission(), public.reject_decommissioned_classroom_reactivation(),
  public.get_attendance_decommission(uuid, uuid, uuid),
  public.begin_attendance_decommission(uuid, uuid, uuid, text),
  public.record_attendance_decommission_receipt(uuid, uuid, uuid, jsonb),
  public.tick_attendance_decommission(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_attendance_decommission(uuid, uuid, uuid),
  public.begin_attendance_decommission(uuid, uuid, uuid, text),
  public.record_attendance_decommission_receipt(uuid, uuid, uuid, jsonb),
  public.tick_attendance_decommission(uuid, uuid, uuid) to service_role;
