#!/usr/bin/env bash
set -euo pipefail

# Rollback-only synthetic fixture. No hosted target mode and no migration apply.
DECOMMISSION_DB_CONTAINER="supabase_db_pika"
PROJECT_LABEL="$(docker inspect "$DECOMMISSION_DB_CONTAINER" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')"
DB_BINDING="$(docker port "$DECOMMISSION_DB_CONTAINER" 5432/tcp)"
if [[ "$PROJECT_LABEL" != "pika" ]] || ! rg -q ':54322$' <<<"$DB_BINDING"; then
  echo 'Refusing unexpected database target.' >&2
  exit 2
fi
docker exec -i "$DECOMMISSION_DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
begin;
do $$ begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '153') then
    raise exception 'Migration 153 requires separate local application approval';
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
 ('d1530000-0000-4000-8000-000000000002', 'decommission-student@example.test', 'student');
insert into public.classrooms (id, teacher_id, title, class_code, archived_at) values
 ('d1530000-0000-4000-8000-000000000010', 'd1530000-0000-4000-8000-000000000001', 'Synthetic deletion', 'D15301', now()),
 ('d1530000-0000-4000-8000-000000000011', 'd1530000-0000-4000-8000-000000000001', 'Other class', 'D15302', now());
insert into public.attendance_principal_mappings (user_id, principal_ref) values
 ('d1530000-0000-4000-8000-000000000001', 'principal_15300000000000000000000000000001');
insert into public.attendance_roster_mappings (classroom_id, roster_ref) values
 ('d1530000-0000-4000-8000-000000000010', 'roster_15300000000000000000000000000010'),
 ('d1530000-0000-4000-8000-000000000011', 'roster_15300000000000000000000000000011');
insert into public.attendance_participant_mappings (classroom_id, student_id) values
 ('d1530000-0000-4000-8000-000000000010', 'd1530000-0000-4000-8000-000000000002');
insert into public.attendance_classroom_qr_handles (classroom_id) values
 ('d1530000-0000-4000-8000-000000000010');

do $$ declare v_signature text; begin
  foreach v_signature in array array[
    'public.begin_attendance_decommission(uuid,uuid,uuid,text)',
    'public.record_attendance_decommission_receipt(uuid,uuid,uuid,jsonb)',
    'public.tick_attendance_decommission(uuid,uuid,uuid)',
    'public.get_attendance_decommission(uuid,uuid,uuid)'
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
select pg_temp.expect_error($q$select public.begin_attendance_decommission(
 'd1530000-0000-4000-8000-000000000001','d1530000-0000-4000-8000-000000000010',
 'd1530000-0000-4000-8000-000000000020','wrong')$q$, 'confirmation_mismatch');
select public.begin_attendance_decommission(
 'd1530000-0000-4000-8000-000000000001','d1530000-0000-4000-8000-000000000010',
 'd1530000-0000-4000-8000-000000000020','DELETE');
select pg_temp.expect_error($q$update public.attendance_roster_mappings set source_revision = source_revision + 1
 where classroom_id = 'd1530000-0000-4000-8000-000000000010'$q$, 'attendance_decommission_active');
select pg_temp.expect_error($q$select public.tick_attendance_decommission(
 'd1530000-0000-4000-8000-000000000001','d1530000-0000-4000-8000-000000000010',
 'd1530000-0000-4000-8000-000000000020')$q$, 'remote_deletion_unverified');

do $$ declare v_receipt jsonb; v_op jsonb; begin
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
  for i in 1..50 loop
    v_op := public.tick_attendance_decommission('d1530000-0000-4000-8000-000000000001',
     'd1530000-0000-4000-8000-000000000010','d1530000-0000-4000-8000-000000000020');
    exit when v_op->>'state' = 'local_deleted';
  end loop;
  if v_op->>'state' <> 'local_deleted' or public.attendance_classroom_has_state_v1('d1530000-0000-4000-8000-000000000010') then
    raise exception 'Attendance absence was not established';
  end if;
  if not exists (select 1 from public.classrooms where id = 'd1530000-0000-4000-8000-000000000010')
    or not exists (select 1 from public.attendance_roster_mappings where classroom_id = 'd1530000-0000-4000-8000-000000000011')
    or (select count(*) from public.users where id in ('d1530000-0000-4000-8000-000000000001','d1530000-0000-4000-8000-000000000002')) <> 2
    or not exists (select 1 from public.attendance_principal_mappings where user_id = 'd1530000-0000-4000-8000-000000000001') then
    raise exception 'Deletion crossed the classroom attendance ownership boundary';
  end if;
end $$;
select pg_temp.expect_error($q$insert into public.attendance_roster_mappings (classroom_id)
 values ('d1530000-0000-4000-8000-000000000010')$q$, 'attendance_decommission_active');
rollback;
SQL
echo 'Rollback-only attendance decommission contracts passed.'
