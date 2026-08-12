#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="${STUDENT_PURGE_DB_CONTAINER:-supabase_db_pika}"
if ! docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
  echo "Local Pika Supabase database container is not running." >&2
  exit 2
fi

PROJECT_LABEL="$(docker inspect "$DB_CONTAINER" \
  --format '{{ index .Config.Labels "com.supabase.cli.project" }}')"
DB_BINDING="$(docker port "$DB_CONTAINER" 5432/tcp 2>/dev/null || true)"
if [[ "$PROJECT_LABEL" != "pika" ]] || ! grep -q ':54322$' <<<"$DB_BINDING"; then
  echo "Refusing non-local or unexpected Supabase database target." >&2
  exit 2
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
do $migration$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '123')
    or to_regprocedure('public.begin_student_purge(uuid,uuid,uuid,uuid,text,bigint,text,text)') is null
  then raise exception 'Migration 123 is not applied to the local database'; end if;
end;
$migration$;

begin;

do $privileges$
declare v_table text;
begin
  if (select rollout_mode from public.student_purge_settings where singleton) <> 'disabled'
  then raise exception 'Student purge rollout was enabled by migration'; end if;
  if has_function_privilege('anon',
      'public.begin_student_purge(uuid,uuid,uuid,uuid,text,bigint,text,text)', 'execute')
    or has_function_privilege('authenticated',
      'public.begin_student_purge(uuid,uuid,uuid,uuid,text,bigint,text,text)', 'execute')
    or not has_function_privilege('service_role',
      'public.begin_student_purge(uuid,uuid,uuid,uuid,text,bigint,text,text)', 'execute')
  then raise exception 'Student purge entry-point privileges are unsafe'; end if;
  foreach v_table in array array[
    'student_purge_settings','student_purge_operations','student_purge_resources',
    'student_purge_objects','student_purge_fences'
  ] loop
    if has_table_privilege('service_role', 'public.' || v_table, 'INSERT')
      or has_table_privilege('service_role', 'public.' || v_table, 'UPDATE')
      or has_table_privilege('service_role', 'public.' || v_table, 'DELETE')
    then raise exception 'service_role can forge student purge authority through %', v_table; end if;
  end loop;
end;
$privileges$;

do $activate$
declare v_run public.managed_storage_readiness_runs;
begin
  select * into v_run from public.refresh_managed_storage_readiness();
  if v_run.status <> 'ready' then raise exception 'Managed storage readiness blocked'; end if;
  perform public.activate_managed_storage_enforcement(v_run.generation, v_run.inventory_digest);
end;
$activate$;

insert into public.users (id, email, role) values
  ('d1230000-0000-4000-8000-000000000001', 'student-purge-teacher@example.test', 'teacher'),
  ('d1230000-0000-4000-8000-000000000002', 'student-purge-target@example.test', 'student'),
  ('d1230000-0000-4000-8000-000000000003', 'student-purge-classmate@example.test', 'student'),
  ('d1230000-0000-4000-8000-000000000004', 'student-purge-provider-blocked@example.test', 'student');

insert into public.classrooms (id, teacher_id, title, class_code) values
  ('d1230000-0000-4000-8000-000000000010', 'd1230000-0000-4000-8000-000000000001', 'Student purge target', 'SP123A'),
  ('d1230000-0000-4000-8000-000000000011', 'd1230000-0000-4000-8000-000000000001', 'Student purge preserved', 'SP123B');

insert into public.classroom_enrollments (classroom_id, student_id) values
  ('d1230000-0000-4000-8000-000000000010', 'd1230000-0000-4000-8000-000000000002'),
  ('d1230000-0000-4000-8000-000000000010', 'd1230000-0000-4000-8000-000000000003'),
  ('d1230000-0000-4000-8000-000000000010', 'd1230000-0000-4000-8000-000000000004'),
  ('d1230000-0000-4000-8000-000000000011', 'd1230000-0000-4000-8000-000000000002');
insert into public.classroom_roster (classroom_id, email) values
  ('d1230000-0000-4000-8000-000000000010', 'student-purge-target@example.test'),
  ('d1230000-0000-4000-8000-000000000010', 'student-purge-classmate@example.test'),
  ('d1230000-0000-4000-8000-000000000010', 'student-purge-provider-blocked@example.test'),
  ('d1230000-0000-4000-8000-000000000011', 'student-purge-target@example.test');
insert into public.entries (student_id, classroom_id, date, text, on_time) values
  ('d1230000-0000-4000-8000-000000000002', 'd1230000-0000-4000-8000-000000000010', '2026-08-11', 'target', true),
  ('d1230000-0000-4000-8000-000000000003', 'd1230000-0000-4000-8000-000000000010', '2026-08-11', 'classmate', true),
  ('d1230000-0000-4000-8000-000000000002', 'd1230000-0000-4000-8000-000000000011', '2026-08-11', 'other classroom', true);

select public.begin_managed_storage_upload(
  'd1230000-0000-4000-8000-000000000020', 'submission-images',
  'student-purge-fixture/target.png', 'd1230000-0000-4000-8000-000000000010',
  null, null, 'student_inline_image',
  'd1230000-0000-4000-8000-000000000002',
  'd1230000-0000-4000-8000-000000000002',
  'fixture', null, 'image/png', 1
);
insert into storage.objects (bucket_id, name) values (
  'submission-images', 'student-purge-fixture/target.png'
);
select public.verify_managed_storage_upload(
  'd1230000-0000-4000-8000-000000000020', repeat('a', 64)
);
select public.managed_storage_mark_ready('d1230000-0000-4000-8000-000000000020');

do $storage_authority$
begin
  begin
    delete from storage.objects where bucket_id = 'submission-images'
      and name = 'student-purge-fixture/target.png';
    raise exception 'Managed object delete bypassed student purge lease authority';
  exception when sqlstate '55000' then null;
  end;
end;
$storage_authority$;

insert into public.pal_daily_log_week_configurations (
  student_id, period_key, config_version, period_status, eligible_days, configured_at
) values (
  'd1230000-0000-4000-8000-000000000004', '2026-W33', 1, 'open', 5, clock_timestamp()
);

update public.student_purge_settings set rollout_mode = 'enabled',
  canary_teacher_id = null, canary_classroom_id = null, canary_student_id = null,
  updated_at = clock_timestamp()
where singleton;

do $provider_block$
declare v_inventory jsonb;
begin
  v_inventory := public.get_student_purge_inventory(
    'd1230000-0000-4000-8000-000000000001',
    'd1230000-0000-4000-8000-000000000010',
    'd1230000-0000-4000-8000-000000000004'
  );
  if v_inventory->>'unavailable_reason' <> 'student_purge_external_erasure_required'
  then raise exception 'Pal-backed student did not fail closed'; end if;
end;
$provider_block$;

do $begin_purge$
declare v_inventory jsonb; v_result jsonb;
begin
  v_inventory := public.get_student_purge_inventory(
    'd1230000-0000-4000-8000-000000000001',
    'd1230000-0000-4000-8000-000000000010',
    'd1230000-0000-4000-8000-000000000002'
  );
  if not (v_inventory->>'deletion_available')::boolean
  then raise exception 'Canary student purge was not available: %', v_inventory; end if;
  v_result := public.begin_student_purge(
    'd1230000-0000-4000-8000-000000000100',
    'd1230000-0000-4000-8000-000000000001',
    'd1230000-0000-4000-8000-000000000010',
    'd1230000-0000-4000-8000-000000000002',
    'student-purge-target@example.test',
    (v_inventory->>'source_revision')::bigint,
    v_inventory->>'storage_inventory_sha256',
    v_inventory->>'relational_inventory_sha256'
  );
  if not (v_result->>'ok')::boolean then raise exception 'Student purge did not start: %', v_result; end if;
end;
$begin_purge$;

do $fence$
begin
  begin
    insert into public.entries (student_id, classroom_id, date, text, on_time) values (
      'd1230000-0000-4000-8000-000000000002',
      'd1230000-0000-4000-8000-000000000010', '2026-08-12', 'must be fenced', true
    );
    raise exception 'Target student write bypassed the purge fence';
  exception when sqlstate '55000' then null;
  end;
  begin
    update public.entries set student_id = 'd1230000-0000-4000-8000-000000000003'
    where student_id = 'd1230000-0000-4000-8000-000000000002'
      and classroom_id = 'd1230000-0000-4000-8000-000000000010';
    raise exception 'Target row reassignment bypassed the purge fence';
  exception when sqlstate '55000' then null;
  end;
  insert into public.entries (student_id, classroom_id, date, text, on_time) values (
    'd1230000-0000-4000-8000-000000000003',
    'd1230000-0000-4000-8000-000000000010', '2026-08-12', 'classmate allowed', true
  );
end;
$fence$;

do $storage_delete$
declare v_claim jsonb; v_object jsonb; v_result jsonb;
begin
  v_claim := public.claim_student_purge_object(
    'd1230000-0000-4000-8000-000000000100',
    'd1230000-0000-4000-8000-000000000001'
  );
  v_object := v_claim->'object';
  if v_object is null then raise exception 'Student purge did not claim its managed object: %', v_claim; end if;
  begin
    perform public.complete_student_purge_object(
      'd1230000-0000-4000-8000-000000000100',
      'd1230000-0000-4000-8000-000000000001',
      (v_object->>'id')::uuid, (v_object->>'lease_token')::uuid
    );
    raise exception 'Student purge accepted storage completion while bytes remained';
  exception when sqlstate '55000' then null;
  end;
  delete from storage.objects where bucket_id = v_object->>'storage_bucket'
    and name = v_object->>'storage_path';
  v_result := public.complete_student_purge_object(
    'd1230000-0000-4000-8000-000000000100',
    'd1230000-0000-4000-8000-000000000001',
    (v_object->>'id')::uuid, (v_object->>'lease_token')::uuid
  );
  if not (v_result->>'ok')::boolean then raise exception 'Managed object completion failed: %', v_result; end if;
end;
$storage_delete$;

do $finalize$
declare v_result jsonb;
begin
  v_result := public.finalize_student_purge(
    'd1230000-0000-4000-8000-000000000100',
    'd1230000-0000-4000-8000-000000000001'
  );
  if v_result->>'operation_status' <> 'completed'
  then raise exception 'Student purge did not finalize: %', v_result; end if;
end;
$finalize$;

do $preservation$
begin
  if not exists (select 1 from public.users where id = 'd1230000-0000-4000-8000-000000000002')
    or not exists (select 1 from public.classroom_enrollments
      where classroom_id = 'd1230000-0000-4000-8000-000000000011'
        and student_id = 'd1230000-0000-4000-8000-000000000002')
    or not exists (select 1 from public.entries
      where classroom_id = 'd1230000-0000-4000-8000-000000000011'
        and student_id = 'd1230000-0000-4000-8000-000000000002')
    or not exists (select 1 from public.entries
      where classroom_id = 'd1230000-0000-4000-8000-000000000010'
        and student_id = 'd1230000-0000-4000-8000-000000000003')
  then raise exception 'User, other Classroom, or classmate data was removed'; end if;
  if exists (select 1 from public.entries
      where classroom_id = 'd1230000-0000-4000-8000-000000000010'
        and student_id = 'd1230000-0000-4000-8000-000000000002')
    or exists (select 1 from public.classroom_enrollments
      where classroom_id = 'd1230000-0000-4000-8000-000000000010'
        and student_id = 'd1230000-0000-4000-8000-000000000002')
    or exists (select 1 from public.classroom_roster
      where classroom_id = 'd1230000-0000-4000-8000-000000000010'
        and student_id = 'd1230000-0000-4000-8000-000000000002')
  then raise exception 'Target Classroom student data remained'; end if;
  if exists (select 1 from public.managed_storage_objects
      where id = 'd1230000-0000-4000-8000-000000000020')
    or exists (select 1 from storage.objects where bucket_id = 'submission-images'
      and name = 'student-purge-fixture/target.png')
  then raise exception 'Target managed storage object remained'; end if;
  if exists (select 1 from public.student_purge_fences
    where operation_id = 'd1230000-0000-4000-8000-000000000100')
  then raise exception 'Completed student purge left an active fence'; end if;
end;
$preservation$;

rollback;
SQL
