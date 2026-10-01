#!/usr/bin/env bash
set -euo pipefail

# Local-only, rollback-only behavioral fixture; never applies a migration.
DAILY_LOG_DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}')"
if [[ "$DAILY_LOG_DB_CONTAINER" != 'supabase_db_pika' ]]; then
  echo 'The exact local Supabase container supabase_db_pika must be running.' >&2
  exit 1
fi
docker exec -i "$DAILY_LOG_DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';
do $check$
declare
  v_signature text := 'public.save_daily_log_for_member_v1(uuid,uuid,date,text,jsonb,boolean,jsonb,integer,text,integer,uuid)';
begin
  if to_regprocedure(v_signature) is null or not exists (
    select 1 from supabase_migrations.schema_migrations where version = '224'
  ) then raise exception 'Migration 224 is required; this harness never applies it'; end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '225')
  then raise exception 'Migration 225 is required; this harness never applies it'; end if;
  if has_function_privilege('anon', v_signature, 'execute')
    or has_function_privilege('authenticated', v_signature, 'execute')
    or not has_function_privilege('service_role', v_signature, 'execute')
    or not exists (select 1 from pg_proc where oid = to_regprocedure(v_signature)
      and prosecdef and proconfig @> array['search_path=""']::text[])
  then raise exception 'Daily Log save privileges or search path are incorrect'; end if;
end;
$check$;

insert into public.users (id, email, role) values
  ('c2240000-0000-4000-8000-000000000001', 'daily-save-teacher-member@example.invalid', 'teacher'),
  ('c2240000-0000-4000-8000-000000000002', 'daily-save-student-owner@example.invalid', 'student'),
  ('c2240000-0000-4000-8000-000000000003', 'daily-save-outsider@example.invalid', 'student'),
  ('c2240000-0000-4000-8000-000000000004', 'daily-save-student-member@example.invalid', 'student');
set local role service_role;
select public.set_effective_feature_entitlement_v1(
  gen_random_uuid(), 'c2240000-0000-4000-8000-000000000002',
  'classrooms.create', 'manual', true, clock_timestamp(), null, 10,
  'test:migration-224', 'daily_log_save_fixture',
  coalesce((select revision from public.effective_feature_entitlements
    where subject_user_id = 'c2240000-0000-4000-8000-000000000002'
      and feature_key = 'classrooms.create'), 0)
);
reset role;
insert into public.classrooms (id, teacher_id, title, class_code, archived_at) values
  ('c2240000-0000-4000-8000-000000000010', 'c2240000-0000-4000-8000-000000000002', 'Daily save active', 'C224LIVE', null),
  ('c2240000-0000-4000-8000-000000000011', 'c2240000-0000-4000-8000-000000000002', 'Daily save archived', 'C224ARCH', clock_timestamp());
insert into public.classroom_enrollments (classroom_id, student_id) values
  ('c2240000-0000-4000-8000-000000000010', 'c2240000-0000-4000-8000-000000000001'),
  ('c2240000-0000-4000-8000-000000000010', 'c2240000-0000-4000-8000-000000000002'),
  ('c2240000-0000-4000-8000-000000000010', 'c2240000-0000-4000-8000-000000000004'),
  ('c2240000-0000-4000-8000-000000000011', 'c2240000-0000-4000-8000-000000000001');
insert into public.class_days (classroom_id, date, is_class_day)
select classroom_id, day, true from unnest(array[
  'c2240000-0000-4000-8000-000000000010'::uuid,
  'c2240000-0000-4000-8000-000000000011'::uuid
]) as classroom_id cross join unnest(array[
  (clock_timestamp() at time zone 'America/Toronto')::date,
  (clock_timestamp() at time zone 'America/Toronto')::date + 1
]) as day;

set local role service_role;
do $behavior$
declare
  v_teacher constant uuid := 'c2240000-0000-4000-8000-000000000001';
  v_owner constant uuid := 'c2240000-0000-4000-8000-000000000002';
  v_outsider constant uuid := 'c2240000-0000-4000-8000-000000000003';
  v_student constant uuid := 'c2240000-0000-4000-8000-000000000004';
  v_class constant uuid := 'c2240000-0000-4000-8000-000000000010';
  v_day date := (clock_timestamp() at time zone 'America/Toronto')::date;
  v_content jsonb := '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Saved"}]}]}';
  v_result jsonb;
  v_entry uuid;
  v_event jsonb;
begin
  v_result := public.save_daily_log_for_member_v1(v_teacher, v_class, v_day, 'Saved', v_content, true);
  v_entry := (v_result->'entry'->>'id')::uuid;
  if v_result->>'ok' is distinct from 'true' or v_result->>'created' is distinct from 'true'
    or v_result->'entry'->>'student_id' is distinct from v_teacher::text
  then raise exception 'Teacher-valued member could not create own Daily Log'; end if;

  v_result := public.save_daily_log_for_member_v1(v_teacher, v_class, v_day, 'Overwrite', v_content, true);
  if v_result->>'status' is distinct from '409'
    or (select text from public.entries where id = v_entry) <> 'Saved'
  then raise exception 'Create-only retry overwrote an existing entry'; end if;

  v_result := public.save_daily_log_for_member_v1(v_teacher, v_class, v_day, 'Updated', v_content, true,
    p_expected_version => 1, p_expected_entry_id => v_entry);
  if v_result->>'ok' is distinct from 'true' or v_result->'entry'->>'version' <> '2'
  then raise exception 'Versioned update failed'; end if;
  v_result := public.save_daily_log_for_member_v1(v_teacher, v_class, v_day, 'Stale', v_content, true,
    p_expected_version => 1, p_expected_entry_id => v_entry);
  if v_result->>'status' is distinct from '409' or v_result->'entry'->>'version' <> '2'
  then raise exception 'Stale revision did not return current own entry'; end if;
  v_result := public.save_daily_log_for_member_v1(v_teacher, v_class, v_day, 'Wrong ID', v_content, true,
    p_expected_version => 2, p_expected_entry_id => gen_random_uuid());
  if v_result->>'status' is distinct from '409'
  then raise exception 'Wrong entry identity was accepted'; end if;

  begin
    perform public.save_daily_log_for_member_v1(v_outsider, v_class, v_day, 'Denied', v_content, true);
    raise exception 'Nonmember was allowed to save';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_daily_log_for_member_v1(v_owner, v_class, v_day, 'Denied', v_content, true);
    raise exception 'Owner self-enrollment must not confer member access';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_daily_log_for_member_v1(v_teacher, 'c2240000-0000-4000-8000-000000000011', v_day, 'Denied', v_content, true);
    raise exception 'Archived classroom was writable';
  exception when no_data_found then null; end;
  begin
    perform public.save_daily_log_for_member_v1(v_teacher, v_class, v_day + 1, 'Denied', v_content, true);
    raise exception 'Future day was writable';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.save_daily_log_for_member_v1(v_teacher, v_class, v_day - 1, 'Denied', v_content, false);
    raise exception 'Non-class day was writable';
  exception when invalid_parameter_value then null; end;

  v_event := jsonb_build_object('schema_version', 1,
    'idempotency_key', 'pika:v1:pika-fact-' || repeat('a', 43),
    'learner_id', 'pika-learner-' || repeat('b', 43),
    'event_type', 'daily_log.completed', 'occurred_at', clock_timestamp(),
    'metadata', jsonb_build_object('activity_day', v_day::text,
      'period_key', 'pika-week-' || (v_day - (extract(isodow from v_day)::integer - 1))::text));
  v_result := public.save_daily_log_for_member_v1(v_student, v_class, v_day, 'Saved', v_content, true, v_event);
  if v_result->>'ok' is distinct from 'true' or not exists (
    select 1 from public.pal_event_outbox where student_id = v_student
      and source_kind = 'daily_log' and source_id = v_day::text and payload = v_event
  ) then raise exception 'Student save and Pal outbox were not atomic'; end if;

  begin
    perform public.save_daily_log_for_member_v1(v_teacher, v_class, v_day, 'Bad event', v_content, true,
      jsonb_set(v_event, '{metadata,activity_day}', to_jsonb((v_day - 1)::text)),
      p_expected_version => 2, p_expected_entry_id => v_entry);
    raise exception 'Cross-day Pal event was accepted';
  exception when invalid_parameter_value then null; end;
  if (select version from public.entries where id = v_entry) <> 2
  then raise exception 'Rejected event changed the entry'; end if;

  delete from public.classroom_enrollments where classroom_id = v_class and student_id = v_teacher;
  begin
    perform public.save_daily_log_for_member_v1(v_teacher, v_class, v_day, 'Removed', v_content, true,
      p_expected_version => 2, p_expected_entry_id => v_entry);
    raise exception 'Removed member retained write access';
  exception when insufficient_privilege then null; end;
end;
$behavior$;

-- Fault-inject only inside this rollback transaction. The original dependency
-- definition and fixtures are restored by rollback, including on psql failure.
create or replace function public.upsert_student_entry_with_pal_event_atomic(
  p_student_id uuid, p_classroom_id uuid, p_date date, p_text text,
  p_rich_content jsonb, p_on_time boolean, p_pal_event jsonb,
  p_minutes_reported integer default null, p_mood text default null,
  p_expected_version integer default null
)
returns jsonb language sql security definer set search_path = ''
as $fault$ select '{}'::jsonb; $fault$;
do $binding_conflict$
declare
  v_actor constant uuid := 'c2240000-0000-4000-8000-000000000004';
  v_class constant uuid := 'c2240000-0000-4000-8000-000000000010';
  v_day date := (clock_timestamp() at time zone 'America/Toronto')::date;
  v_entry public.entries%rowtype;
begin
  select * into strict v_entry from public.entries
  where classroom_id = v_class and student_id = v_actor and date = v_day;
  begin
    perform public.save_daily_log_for_member_v1(v_actor, v_class, v_day,
      'Must not persist', '{"type":"doc","content":[]}', true,
      p_expected_version => v_entry.version, p_expected_entry_id => v_entry.id);
    raise exception 'Malformed inner save did not raise a binding conflict';
  exception when sqlstate 'PT409' then null;
  end;
  if exists (select 1 from public.entries where id = v_entry.id
    and (text is distinct from v_entry.text or version is distinct from v_entry.version))
  then raise exception 'Binding conflict changed the entry'; end if;
end;
$binding_conflict$;
rollback;
SQL
echo 'Contextual Daily Log save behavior passed (all fixtures rolled back).'
