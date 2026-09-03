-- Additive, service-only contextual calendar mutations. No rows are changed by
-- applying this migration. API admission remains separately gated and off by default.
-- p_actor_id is supplied only by authenticated server code, never a browser claim.

begin;

create function public.create_classroom_calendar_v1(
  p_actor_id uuid,
  p_classroom_id uuid,
  p_start_date date,
  p_end_date date,
  p_dates date[]
)
returns setof public.class_days
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner_id uuid;
  v_archived_at timestamptz;
begin
  if p_actor_id is null or p_classroom_id is null
    or p_start_date is null or p_end_date is null
    or p_end_date <= p_start_date or p_end_date - p_start_date > 366
    or p_dates is null or cardinality(p_dates) = 0 or cardinality(p_dates) > 367
  then
    raise exception using errcode = '22023', message = 'Invalid classroom calendar';
  end if;

  if exists (
    select 1 from unnest(p_dates) as input(day)
    where input.day is null or input.day < p_start_date or input.day > p_end_date
  ) or cardinality(p_dates) <> (select count(distinct input.day) from unnest(p_dates) as input(day))
  then
    raise exception using errcode = '22023', message = 'Invalid classroom calendar dates';
  end if;

  -- Hold the parent row until the range and all day rows commit together. This
  -- serializes these operations with owner changes, archive/restore and deletion.
  select classroom.teacher_id, classroom.archived_at
  into v_owner_id, v_archived_at
  from public.classrooms as classroom
  where classroom.id = p_classroom_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Classroom not found';
  end if;
  if v_owner_id is distinct from p_actor_id then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;
  if v_archived_at is not null then
    raise exception using errcode = '42501', message = 'Classroom is archived';
  end if;

  if exists (select 1 from public.class_days as day where day.classroom_id = p_classroom_id) then
    raise exception using errcode = '23505', message = 'Class days already exist for this classroom. Use PATCH to update.';
  end if;

  update public.classrooms
  set start_date = p_start_date, end_date = p_end_date
  where id = p_classroom_id;

  -- Any insert/trigger error rolls the range update back as part of this statement.
  return query
  insert into public.class_days (classroom_id, date, is_class_day, prompt_text)
  select p_classroom_id, input.day, true, null
  from unnest(p_dates) as input(day)
  order by input.day
  returning *;
end;
$function$;

revoke all on function public.create_classroom_calendar_v1(uuid, uuid, date, date, date[])
  from public, anon, authenticated;
grant execute on function public.create_classroom_calendar_v1(uuid, uuid, date, date, date[])
  to service_role;

create function public.set_classroom_calendar_day_v1(
  p_actor_id uuid,
  p_classroom_id uuid,
  p_date date,
  p_is_class_day boolean
)
returns setof public.class_days
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner_id uuid;
  v_archived_at timestamptz;
begin
  if p_actor_id is null or p_classroom_id is null or p_date is null or p_is_class_day is null then
    raise exception using errcode = '22023', message = 'Invalid classroom calendar day';
  end if;

  select classroom.teacher_id, classroom.archived_at
  into v_owner_id, v_archived_at
  from public.classrooms as classroom
  where classroom.id = p_classroom_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Classroom not found';
  end if;
  if v_owner_id is distinct from p_actor_id then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;
  if v_archived_at is not null then
    raise exception using errcode = '42501', message = 'Classroom is archived';
  end if;

  -- Check the real Toronto date after any lock wait; never trust a client clock
  -- or transaction-start timestamp that may precede midnight.
  if p_date < (clock_timestamp() at time zone 'America/Toronto')::date then
    raise exception using errcode = '22023', message = 'Cannot modify past class days';
  end if;

  insert into public.class_days as existing (classroom_id, date, is_class_day, prompt_text)
  values (p_classroom_id, p_date, p_is_class_day, null)
  on conflict (classroom_id, date) do update
  set is_class_day = excluded.is_class_day
  where existing.is_class_day is distinct from excluded.is_class_day;

  -- An identical retry does not re-update the row or erase its prompt. Return the
  -- existing row even when ON CONFLICT correctly performed no update.
  return query
  select day.* from public.class_days as day
  where day.classroom_id = p_classroom_id and day.date = p_date;
end;
$function$;

revoke all on function public.set_classroom_calendar_day_v1(uuid, uuid, date, boolean)
  from public, anon, authenticated;
grant execute on function public.set_classroom_calendar_day_v1(uuid, uuid, date, boolean)
  to service_role;

commit;
