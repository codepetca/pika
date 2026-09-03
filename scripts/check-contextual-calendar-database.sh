#!/usr/bin/env bash
set -euo pipefail

# Local-only, rollback-only behavioral fixture. Does not apply migrations or seed
# durable rows. Run only after separately authorized application of migration 152.
CALENDAR_DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}')"
if [[ "$CALENDAR_DB_CONTAINER" != 'supabase_db_pika' ]]; then
  echo 'The exact local Supabase container supabase_db_pika must be running.' >&2
  exit 1
fi

docker exec -i "$CALENDAR_DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $check$
begin
  if to_regprocedure('public.create_classroom_calendar_v1(uuid,uuid,date,date,date[])') is null
    or to_regprocedure('public.set_classroom_calendar_day_v1(uuid,uuid,date,boolean)') is null
  then
    raise exception 'Migration 152 is required; this harness never applies it';
  end if;
  if has_function_privilege('anon', 'public.create_classroom_calendar_v1(uuid,uuid,date,date,date[])', 'execute')
    or has_function_privilege('authenticated', 'public.create_classroom_calendar_v1(uuid,uuid,date,date,date[])', 'execute')
    or has_function_privilege('anon', 'public.set_classroom_calendar_day_v1(uuid,uuid,date,boolean)', 'execute')
    or has_function_privilege('authenticated', 'public.set_classroom_calendar_day_v1(uuid,uuid,date,boolean)', 'execute')
    or not has_function_privilege('service_role', 'public.create_classroom_calendar_v1(uuid,uuid,date,date,date[])', 'execute')
    or not has_function_privilege('service_role', 'public.set_classroom_calendar_day_v1(uuid,uuid,date,boolean)', 'execute')
  then
    raise exception 'Calendar function execution privileges are incorrect';
  end if;
end;
$check$;

insert into public.users (id, email, role) values
  ('c1520000-0000-4000-8000-000000000001', 'calendar-owner@example.invalid', 'student'),
  ('c1520000-0000-4000-8000-000000000002', 'calendar-other@example.invalid', 'teacher');
insert into public.classrooms (id, teacher_id, title, class_code, archived_at) values
  ('c1520000-0000-4000-8000-000000000010', 'c1520000-0000-4000-8000-000000000001', 'Calendar contract A', 'C152A', null),
  ('c1520000-0000-4000-8000-000000000011', 'c1520000-0000-4000-8000-000000000002', 'Calendar contract B', 'C152B', null),
  ('c1520000-0000-4000-8000-000000000012', 'c1520000-0000-4000-8000-000000000001', 'Calendar rollback', 'C152C', null),
  ('c1520000-0000-4000-8000-000000000013', 'c1520000-0000-4000-8000-000000000001', 'Calendar archived', 'C152D', clock_timestamp());
insert into public.classroom_enrollments (classroom_id, student_id) values
  ('c1520000-0000-4000-8000-000000000011', 'c1520000-0000-4000-8000-000000000001');

set local role service_role;
do $test$
declare
  v_actor constant uuid := 'c1520000-0000-4000-8000-000000000001';
  v_class constant uuid := 'c1520000-0000-4000-8000-000000000010';
  v_other constant uuid := 'c1520000-0000-4000-8000-000000000011';
  v_archived constant uuid := 'c1520000-0000-4000-8000-000000000013';
  v_day date := (clock_timestamp() at time zone 'America/Toronto')::date + 10;
  v_count integer;
  v_day_id uuid;
  v_ctid text;
begin
  -- A student-valued owner is authorized from ownership, not the global role.
  select count(*) into v_count from public.create_classroom_calendar_v1(
    v_actor, v_class, v_day, v_day + 2, array[v_day, v_day + 1, v_day + 2]
  );
  if v_count <> 3 or not exists (
    select 1 from public.classrooms where id = v_class and start_date = v_day and end_date = v_day + 2
  ) then
    raise exception 'Calendar range and days were not created together';
  end if;

  begin
    perform public.create_classroom_calendar_v1(v_actor, v_class, v_day, v_day + 3, array[v_day]);
    raise exception 'Expected existing-calendar conflict';
  exception when unique_violation then null;
  end;
  if not exists (select 1 from public.classrooms where id = v_class and end_date = v_day + 2) then
    raise exception 'Conflicting generation changed the existing range';
  end if;

  begin
    perform public.create_classroom_calendar_v1(v_actor, v_other, v_day, v_day + 2, array[v_day]);
    raise exception 'Expected enrolled nonowner generation denial';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_classroom_calendar_day_v1(v_actor, v_other, v_day, true);
    raise exception 'Expected enrolled nonowner toggle denial';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_classroom_calendar_v1(v_actor, v_archived, v_day, v_day + 2, array[v_day]);
    raise exception 'Expected archived generation denial';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_classroom_calendar_day_v1(v_actor, v_archived, v_day, true);
    raise exception 'Expected archived toggle denial';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_classroom_calendar_day_v1(v_actor, v_class, v_day - 11, true);
    raise exception 'Expected Toronto past-day denial';
  exception when invalid_parameter_value then null;
  end;

  update public.class_days set prompt_text = 'Synthetic prompt to preserve'
  where classroom_id = v_class and date = v_day;
  select id into v_day_id from public.set_classroom_calendar_day_v1(v_actor, v_class, v_day, false);
  select ctid::text into v_ctid from public.class_days where id = v_day_id;
  perform public.set_classroom_calendar_day_v1(v_actor, v_class, v_day, false);
  if not exists (
    select 1 from public.class_days
    where id = v_day_id and classroom_id = v_class and date = v_day
      and not is_class_day and prompt_text = 'Synthetic prompt to preserve' and ctid::text = v_ctid
  ) then
    raise exception 'Identical toggle did not preserve the day and prompt';
  end if;
  select count(*) into v_count from public.set_classroom_calendar_day_v1(v_actor, v_class, v_day + 3, true);
  if v_count <> 1 then raise exception 'Missing date did not produce exactly one day'; end if;
  if exists (select 1 from public.class_days where classroom_id in (v_other, v_archived)) then
    raise exception 'Denied request wrote another or archived classroom';
  end if;

  update public.classrooms set teacher_id = 'c1520000-0000-4000-8000-000000000002' where id = v_class;
  begin
    perform public.set_classroom_calendar_day_v1(v_actor, v_class, v_day, true);
    raise exception 'Expected former-owner denial after ownership changed';
  exception when insufficient_privilege then null;
  end;
  if (select is_class_day from public.class_days where id = v_day_id) then
    raise exception 'Former owner changed the calendar';
  end if;
end;
$test$;
reset role;

-- Force failure after the range update, proving PostgreSQL rolls that update back.
-- The trigger and function exist only in this transaction and target only fixture C.
create function pg_temp.fail_calendar_fixture_insert() returns trigger language plpgsql as $trigger$
begin
  if new.classroom_id = 'c1520000-0000-4000-8000-000000000012'::uuid then
    raise exception using errcode = '23514', message = 'Forced synthetic calendar insert failure';
  end if;
  return new;
end;
$trigger$;
create trigger c152_contract_insert_failure before insert on public.class_days
for each row execute function pg_temp.fail_calendar_fixture_insert();

do $rollback_test$
declare
  v_day date := (clock_timestamp() at time zone 'America/Toronto')::date + 10;
  v_class constant uuid := 'c1520000-0000-4000-8000-000000000012';
begin
  begin
    perform public.create_classroom_calendar_v1(
      'c1520000-0000-4000-8000-000000000001', v_class, v_day, v_day + 2, array[v_day]
    );
    raise exception 'Expected forced insertion failure';
  exception when check_violation then null;
  end;
  if exists (select 1 from public.class_days where classroom_id = v_class)
    or exists (select 1 from public.classrooms where id = v_class and (start_date is not null or end_date is not null))
  then
    raise exception 'Calendar generation failure left a partial write';
  end if;
end;
$rollback_test$;

rollback;
SQL

echo 'Contextual calendar ownership, archive, date, privilege, toggle, and rollback contracts passed.'
