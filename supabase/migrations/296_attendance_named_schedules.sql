-- Additional timing profiles share the existing classroom policy revision.
-- An absent assignment means the regular classroom policy applies.
begin;

create table public.attendance_named_schedules (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80 and name = btrim(name)),
  policy jsonb not null,
  unique (classroom_id, id),
  unique (classroom_id, name)
);
create table public.attendance_day_schedules (
  classroom_id uuid not null,
  class_date date not null,
  schedule_id uuid not null,
  primary key (classroom_id, class_date),
  foreign key (classroom_id, class_date) references public.class_days(classroom_id, date) on delete cascade,
  foreign key (classroom_id, schedule_id) references public.attendance_named_schedules(classroom_id, id) on delete no action
);
create index attendance_day_schedules_schedule_idx on public.attendance_day_schedules(classroom_id, schedule_id);
alter table public.attendance_named_schedules enable row level security;
alter table public.attendance_day_schedules enable row level security;
revoke all on table public.attendance_named_schedules from public, anon, authenticated, service_role;
revoke all on table public.attendance_day_schedules from public, anon, authenticated, service_role;
grant select on table public.attendance_named_schedules to service_role;
grant select on table public.attendance_day_schedules to service_role;
-- Match the existing attendance fence, including non-RPC maintenance writers.
create trigger attendance_decommission_fence before insert or update on public.attendance_named_schedules
  for each row execute function public.reject_attendance_write_during_decommission();
create trigger attendance_decommission_fence before insert or update on public.attendance_day_schedules
  for each row execute function public.reject_attendance_write_during_decommission();

-- Authorization, policy and schedule data use the same statement snapshot.
-- Scope and actor IDs are supplied only by the server, not by clients.
create function public.read_attendance_schedules_for_owner_v1(
  p_actor_id uuid, p_classroom_id uuid, p_scope_mode text, p_date date,
  p_canary_actor_id uuid default null, p_canary_classroom_id uuid default null
) returns jsonb language sql stable security invoker set search_path = ''
set lock_timeout = '1s' set statement_timeout = '8s' as $$
  with owner_authorization as materialized (
    select public.read_attendance_policy_for_owner_v1(
      p_actor_id,p_classroom_id,p_scope_mode,p_canary_actor_id,p_canary_classroom_id) as value
  ), decision as materialized (
    select value, case when p_date is null or not isfinite(p_date)
      or p_date < date '0001-01-01' or p_date > date '9999-12-31'
      then 'blocked' else value->>'status' end as status
    from owner_authorization
  ), schedule_rows as materialized (
    select s.id,s.name,s.policy from public.attendance_named_schedules s, decision d
    where d.status='ready' and s.classroom_id=p_classroom_id
    order by s.name,s.id limit 101
  ), payload as materialized (
    select jsonb_build_object(
      'actor_id',p_actor_id,'classroom_id',p_classroom_id,'scope_mode',p_scope_mode,
      'date',case when isfinite(p_date) then to_char(p_date,'YYYY-MM-DD') else null end,
      'status',d.status,'policy',case when d.status='ready' then d.value->'policy' else null end,
      'schedules',case when d.status='ready' then
        coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'policy',r.policy) order by r.name,r.id)
          from schedule_rows r),'[]'::jsonb) else '[]'::jsonb end,
      'selected_id',case when d.status='ready' then
        (select a.schedule_id from public.attendance_day_schedules a
          where a.classroom_id=p_classroom_id and a.class_date=p_date) else null end
    ) as value, (select count(*) from schedule_rows) as row_count from decision d
  )
  select case when row_count > 100 or octet_length(convert_to(value::text,'UTF8')) > 65536
    then null else value end from payload;
$$;
revoke all on function public.read_attendance_schedules_for_owner_v1(uuid,uuid,text,date,uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_attendance_schedules_for_owner_v1(uuid,uuid,text,date,uuid,uuid) to service_role;

create function public.mutate_attendance_schedule_v1(
  p_teacher_id uuid, p_classroom_id uuid, p_command text, p_schedule_id uuid,
  p_date date, p_name text, p_policy jsonb, p_expected_revision bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_classroom public.classrooms%rowtype;
  v_existing public.attendance_window_policies%rowtype;
  v_id uuid;
  v_revision bigint;
  v_key text;
  v_duration numeric;
  v_stops_at timestamptz;
begin
  if p_teacher_id is null or p_classroom_id is null or p_expected_revision is null
    or p_expected_revision < 1 or p_command not in ('upsert', 'assign', 'delete')
    or p_command is null then
    raise exception using errcode = '22023', message = 'attendance_schedule_invalid';
  end if;
  if not public.classroom_purge_try_lock(p_classroom_id) then
    raise exception using errcode = '40001', message = 'classroom_operation_busy';
  end if;
  select * into v_classroom from public.classrooms where id = p_classroom_id for update;
  if not found or v_classroom.teacher_id is distinct from p_teacher_id or v_classroom.archived_at is not null then
    raise exception using errcode = '42501', message = 'attendance_classroom_forbidden';
  end if;
  if coalesce(public.is_classroom_archive_maintenance_mode('restore'),false)
    or coalesce(public.is_classroom_archive_maintenance_mode('compaction'),false)
    or coalesce(pg_catalog.current_setting('pika.identity_mapping',true),'off')='on'
    or coalesce(pg_catalog.current_setting('pika.classroom_purge_finalize',true),'off')='on'
    or coalesce(pg_catalog.current_setting('pika.course_blueprint_purge_finalize',true),'off')='on'
    or coalesce(pg_catalog.current_setting('pika.student_purge_finalize',true),'off')='on' then
    raise exception using errcode='55000',message='attendance_schedule_write_fenced';
  end if;
  perform public.guard_classroom_purge_lifecycle(p_classroom_id);
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(p_teacher_id::text,13220260823)) then
    raise exception using errcode = '40001', message = 'attendance_schedule_busy';
  end if;
  perform 1 from public.attendance_teacher_entitlements where teacher_id = p_teacher_id for share;
  if not public.attendance_teacher_entitled_v1(p_teacher_id, pg_catalog.statement_timestamp())
    or exists (select 1 from public.attendance_roster_mappings where classroom_id = p_classroom_id and integration_state <> 'active') then
    raise exception using errcode = '42501', message = 'attendance_classroom_not_entitled';
  end if;
  select * into v_existing from public.attendance_window_policies where classroom_id = p_classroom_id for update;
  if not found or v_existing.policy_revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'attendance_policy_revision_conflict';
  end if;

  if p_command = 'upsert' then
    if p_date is not null or p_name is null or length(btrim(p_name)) not between 1 and 80
      or p_policy is null or jsonb_typeof(p_policy) is distinct from 'object'
      or (select count(*) from jsonb_object_keys(p_policy)) <> 7
      or not p_policy ?& array['session_starts_local','session_ends_local','session_end_day_offset',
        'entry_opens_minutes_before','present_grace_minutes','entry_closes_minutes_before_end','absent_minutes_before_end'] then
      raise exception using errcode = '22023', message = 'attendance_schedule_invalid';
    end if;
    foreach v_key in array array['session_starts_local','session_ends_local'] loop
      if jsonb_typeof(p_policy->v_key) is distinct from 'string'
        or (p_policy->>v_key) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception using errcode = '22023', message = 'attendance_schedule_invalid';
      end if;
    end loop;
    foreach v_key in array array['session_end_day_offset','entry_opens_minutes_before','present_grace_minutes',
      'entry_closes_minutes_before_end','absent_minutes_before_end'] loop
      if jsonb_typeof(p_policy->v_key) is distinct from 'number'
        or (p_policy->>v_key) !~ '^(0|[1-9][0-9]{0,2})$' then
        raise exception using errcode = '22023', message = 'attendance_schedule_invalid';
      end if;
    end loop;
    v_duration := extract(epoch from ((p_policy->>'session_ends_local')::time - (p_policy->>'session_starts_local')::time))/60
      + (p_policy->>'session_end_day_offset')::integer * 1440;
    if (p_policy->>'session_end_day_offset')::integer not in (0, 1)
      or (p_policy->>'entry_opens_minutes_before')::integer > 120
      or (p_policy->>'present_grace_minutes')::integer > 720
      or (p_policy->>'entry_closes_minutes_before_end')::integer > 720
      or (p_policy->>'absent_minutes_before_end')::integer > 720
      or v_duration <= 0 or v_duration > 720
      or (p_policy->>'present_grace_minutes')::integer >= v_duration - (p_policy->>'entry_closes_minutes_before_end')::integer
      or (p_policy->>'entry_closes_minutes_before_end')::integer < (p_policy->>'absent_minutes_before_end')::integer then
      raise exception using errcode = '22023', message = 'attendance_schedule_invalid';
    end if;
    if p_schedule_id is null then
      if (select count(*) from public.attendance_named_schedules where classroom_id=p_classroom_id) >= 100 then
        raise exception using errcode = '23514', message = 'attendance_schedule_limit';
      end if;
      insert into public.attendance_named_schedules(classroom_id,name,policy)
        values(p_classroom_id,btrim(p_name),p_policy) returning id into v_id;
    else
      update public.attendance_named_schedules set name=btrim(p_name), policy=p_policy
        where classroom_id=p_classroom_id and id=p_schedule_id returning id into v_id;
      if not found then raise exception using errcode = '22023', message = 'attendance_schedule_not_found'; end if;
    end if;
  elsif p_command = 'assign' then
    if p_date is null or p_name is not null or p_policy is not null then
      raise exception using errcode = '22023', message = 'attendance_schedule_invalid';
    end if;
    if not exists(select 1 from public.class_days where classroom_id=p_classroom_id and date=p_date and is_class_day)
      or (p_schedule_id is not null and not exists(select 1 from public.attendance_named_schedules where classroom_id=p_classroom_id and id=p_schedule_id)) then
      raise exception using errcode = '22023', message = 'attendance_schedule_not_found';
    end if;
    -- A new gate may already be open, but must not already be closed.
    if p_schedule_id is null then
      v_stops_at := ((p_date + v_existing.close_day_offset + v_existing.closes_local) at time zone 'America/Toronto')
        - make_interval(mins => v_existing.entry_closes_minutes_before_end);
    else
      select ((p_date + (s.policy->>'session_end_day_offset')::integer
          + (s.policy->>'session_ends_local')::time) at time zone 'America/Toronto')
        - make_interval(mins => (s.policy->>'entry_closes_minutes_before_end')::integer)
        into v_stops_at from public.attendance_named_schedules s
        where s.classroom_id=p_classroom_id and s.id=p_schedule_id;
    end if;
    if v_stops_at <= pg_catalog.statement_timestamp()
      or exists (select 1 from public.attendance_occurrence_mappings m
        left join public.attendance_session_projection s on s.occurrence_ref=m.occurrence_ref
        where m.classroom_id=p_classroom_id and m.class_date=p_date
          and (m.policy_frozen_at is not null or m.opens_at <= pg_catalog.statement_timestamp()
            or s.status in ('open','closed','cancelled'))) then
      raise exception using errcode = '40001', message = 'attendance_occurrence_policy_frozen';
    end if;
    if p_schedule_id is null then
      delete from public.attendance_day_schedules where classroom_id=p_classroom_id and class_date=p_date;
    else
      insert into public.attendance_day_schedules(classroom_id,class_date,schedule_id)
        values(p_classroom_id,p_date,p_schedule_id)
        on conflict (classroom_id,class_date) do update set schedule_id=excluded.schedule_id;
    end if;
    v_id := p_schedule_id;
  else
    if p_schedule_id is null or p_date is not null or p_name is not null or p_policy is not null then
      raise exception using errcode = '22023', message = 'attendance_schedule_invalid';
    end if;
    delete from public.attendance_named_schedules where classroom_id=p_classroom_id and id=p_schedule_id returning id into v_id;
    if not found then raise exception using errcode = '22023', message = 'attendance_schedule_not_found'; end if;
  end if;
  update public.attendance_window_policies set policy_revision=policy_revision+1, updated_at=pg_catalog.clock_timestamp()
    where classroom_id=p_classroom_id returning policy_revision into v_revision;
  return jsonb_build_object('id',v_id,'revision',v_revision);
end;
$$;
revoke all on function public.mutate_attendance_schedule_v1(uuid,uuid,text,uuid,date,text,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.mutate_attendance_schedule_v1(uuid,uuid,text,uuid,date,text,jsonb,bigint) to service_role;

create or replace function public.attendance_schedule_source_document_v1(p_classroom_id uuid, p_window_start date, p_window_end date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'title', classroom.title, 'window_start', p_window_start, 'window_end', p_window_end,
    'entitlement_revision', coalesce(entitlement.revision, 0),
    'policy', jsonb_build_object(
      'timezone', policy.timezone, 'session_starts_local', to_char(policy.opens_local, 'HH24:MI'),
      'session_ends_local', to_char(policy.closes_local, 'HH24:MI'), 'session_end_day_offset', policy.close_day_offset,
      'entry_opens_minutes_before', policy.entry_opens_minutes_before, 'present_grace_minutes', policy.present_grace_minutes,
      'entry_closes_minutes_before_end', policy.entry_closes_minutes_before_end, 'absent_minutes_before_end', policy.absent_minutes_before_end,
      'enabled', policy.enabled, 'policy_revision', policy.policy_revision),
    'class_days', coalesce((select jsonb_agg(jsonb_build_object('date', d.date, 'is_class_day', d.is_class_day) order by d.date)
      from public.class_days d where d.classroom_id=classroom.id and d.date between p_window_start and p_window_end), '[]'::jsonb),
    'named_schedules', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'policy', s.policy) order by s.id)
      from public.attendance_named_schedules s where s.classroom_id=classroom.id), '[]'::jsonb),
    'day_schedules', coalesce((select jsonb_agg(jsonb_build_object('date', d.class_date, 'schedule_id', d.schedule_id) order by d.class_date)
      from public.attendance_day_schedules d where d.classroom_id=classroom.id and d.class_date between p_window_start and p_window_end), '[]'::jsonb))
  from public.classrooms classroom
  join public.attendance_window_policies policy on policy.classroom_id=classroom.id
  left join public.attendance_teacher_entitlements entitlement on entitlement.teacher_id=classroom.teacher_id
  where classroom.id=p_classroom_id;
$$;
revoke all on function public.attendance_schedule_source_document_v1(uuid,date,date) from public, anon, authenticated, service_role;
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
  -- The original 14 phase numbers are a durable operation contract. Before
  -- phase 13 (or for an already advanced in-flight operation), drain these
  -- child tables in bounded batches after remote deletion is verified. This
  -- preserves existing phase/capability bindings and FK order. The operation
  -- lock and attendance fence prevent new rows between the drain and the
  -- original final absence check. Count each row once; retries are idempotent.
  if v_op.phase >= 13 then
    delete from public.attendance_day_schedules where ctid in
      (select ctid from public.attendance_day_schedules where classroom_id=p_classroom_id limit 500);
    get diagnostics v_count = row_count;
    if v_count = 0 then
      delete from public.attendance_named_schedules where ctid in
        (select ctid from public.attendance_named_schedules where classroom_id=p_classroom_id limit 500);
      get diagnostics v_count = row_count;
    end if;
    if v_count > 0 then
      update public.attendance_decommission_operations set
        deleted_count=deleted_count+v_count, updated_at=clock_timestamp()
        where id=p_operation_id;
      return public.get_attendance_decommission(p_teacher_id,p_classroom_id,p_operation_id);
    end if;
    if exists(select 1 from public.attendance_day_schedules where classroom_id=p_classroom_id)
      or exists(select 1 from public.attendance_named_schedules where classroom_id=p_classroom_id) then
      raise exception using errcode='55000', message='local_absence_unverified';
    end if;
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
revoke all on function public.tick_attendance_decommission(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.tick_attendance_decommission(uuid,uuid,uuid) to service_role;
commit;
