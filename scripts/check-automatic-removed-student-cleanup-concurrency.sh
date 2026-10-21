#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}' | head -n 1)"
if [[ -z "$DB_CONTAINER" ]]; then
  echo 'Local Supabase database container is not running.' >&2
  exit 1
fi

TMP_DB="pika_automatic_cleanup_concurrency_${RANDOM}_$$"
if [[ ! "$TMP_DB" =~ ^pika_automatic_cleanup_concurrency_[0-9]+_[0-9]+$ ]]; then
  echo 'Refusing unsafe disposable database name.' >&2
  exit 2
fi

worker_pids=()
cleanup() {
  for pid in "${worker_pids[@]:-}"; do kill "$pid" >/dev/null 2>&1 || true; done
  docker exec "$DB_CONTAINER" dropdb -U postgres --if-exists "$TMP_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_for_activity() {
  local application_name="$1"
  local wait_type="$2"
  local blocker_application_name="${3:-}"
  for _ in {1..120}; do
    if [[ "$(docker exec "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -Atc "
      select exists(select 1 from pg_stat_activity activity
        where datname='$TMP_DB' and application_name='$application_name'
          and state='active' and wait_event_type='$wait_type'
          and ('$blocker_application_name'='' or exists (
            select 1 from pg_stat_activity blocker
            where blocker.datname='$TMP_DB'
              and blocker.application_name='$blocker_application_name'
              and blocker.pid=any(pg_blocking_pids(activity.pid)))));")" == 't' ]]; then
      return
    fi
    sleep 0.05
  done
  echo "Session $application_name never reached $wait_type wait." >&2
  exit 1
}

release_scenario() {
  docker exec "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 \
    -c "update public.automatic_cleanup_concurrency_gate set released=true where scenario='$1'" \
    >/dev/null
}

docker exec "$DB_CONTAINER" createdb -U postgres "$TMP_DB"
docker exec "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 -c '
  drop schema public;
  create schema extensions;
  create extension "uuid-ossp" with schema extensions;
  create extension pgcrypto with schema extensions;
  create extension pg_stat_statements with schema extensions;
  create schema vault;
  create extension supabase_vault with schema vault;
  create extension pg_net with schema extensions;
' >/dev/null

docker exec "$DB_CONTAINER" pg_dump -U postgres -d postgres --schema-only --no-owner --no-privileges \
  --schema=public --schema=private --schema=auth --schema=storage \
  | sed '/^SET log_min_messages =/d; /^CREATE SCHEMA extensions;/d; /^CREATE SCHEMA vault;/d' \
  | docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
set client_min_messages=warning;
do $$ declare item record; begin
  for item in select schemaname,tablename,policyname from pg_policies where schemaname='storage' loop
    execute format('drop policy %I on %I.%I',item.policyname,item.schemaname,item.tablename);
  end loop;
end $$;
drop schema public cascade;
drop schema private cascade;
create schema public;
SQL

for migration in "$ROOT"/supabase/migrations/*.sql; do
  if [[ "$(basename "$migration")" == '176_automatic_removed_student_cleanup.sql' ||
        "$(basename "$migration")" == '219_test_ai_grading_background.sql' ]]; then
    # pg_cron is bound to the host database, not this disposable concurrency database.
    # Keep migration 219's schema, functions, and triggers while omitting its scheduler.
    sed -e '/^create extension if not exists pg_cron;$/d' \
      -e '/^select cron\.schedule(/,/^);$/d' "$migration" \
      | docker exec -e PGOPTIONS='-c client_min_messages=warning' -i "$DB_CONTAINER" \
        psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null
  elif [[ "$(basename "$migration")" == '180_hourly_removed_student_cleanup_watchdog.sql' ]]; then
    # This disposable database intentionally omits pg_cron and the watchdog job.
    # Migration180 changes only that omitted scheduler, not concurrency contracts.
    continue
  else
    docker exec -e PGOPTIONS='-c client_min_messages=warning' -i "$DB_CONTAINER" \
      psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 < "$migration" >/dev/null
  fi
done

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
create table public.automatic_cleanup_concurrency_gate(
  scenario text primary key,
  released boolean not null default false
);
insert into public.automatic_cleanup_concurrency_gate(scenario)
values('gate_off_wins'),('removal_wins');

insert into public.users(id,email,role,workos_user_id) values
('c1780000-0000-4000-8000-000000000001','teacher-178@example.invalid','teacher','user_178_teacher'),
('c1780000-0000-4000-8000-000000000002','first-178@example.invalid','student','user_178_first'),
('c1780000-0000-4000-8000-000000000003','second-178@example.invalid','student','user_178_second');
insert into public.student_profiles(user_id,first_name,last_name) values
('c1780000-0000-4000-8000-000000000002','Gate','Second'),
('c1780000-0000-4000-8000-000000000003','Removal','First');
insert into public.classrooms(id,teacher_id,title,class_code) values
('c1780000-0000-4000-8000-000000000010','c1780000-0000-4000-8000-000000000001','Gate serialization fixture','C178Q');
insert into public.classroom_roster(id,classroom_id,email) values
('c1780000-0000-4000-8000-000000000020','c1780000-0000-4000-8000-000000000010','first-178@example.invalid'),
('c1780000-0000-4000-8000-000000000021','c1780000-0000-4000-8000-000000000010','second-178@example.invalid');
update private.student_provider_cleanup_settings set
  enabled=true,live_enabled=true,automatic_enabled=true,
  eligible_after=clock_timestamp()-interval '1 second',
  pal_origin='https://pal.example.invalid',pal_integration_id='c1780000-0000-4000-8000-000000000040',
  bara_origin='https://bara.example.invalid',installation_ref='pika_synthetic_178'
where singleton;
insert into public.classroom_enrollments(id,classroom_id,student_id) values
('c1780000-0000-4000-8000-000000000030','c1780000-0000-4000-8000-000000000010','c1780000-0000-4000-8000-000000000002'),
('c1780000-0000-4000-8000-000000000031','c1780000-0000-4000-8000-000000000010','c1780000-0000-4000-8000-000000000003');
insert into public.attendance_roster_mappings(classroom_id)
values('c1780000-0000-4000-8000-000000000010');
insert into public.attendance_principal_mappings(user_id)
values('c1780000-0000-4000-8000-000000000001');
insert into public.attendance_participant_mappings(classroom_id,student_id) values
('c1780000-0000-4000-8000-000000000010','c1780000-0000-4000-8000-000000000002'),
('c1780000-0000-4000-8000-000000000010','c1780000-0000-4000-8000-000000000003');
SQL

docker exec -e PGAPPNAME=automatic_cleanup_gate_off -i "$DB_CONTAINER" \
  psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
update private.student_provider_cleanup_settings set automatic_enabled=false where singleton;
do $$ begin while not (select released from public.automatic_cleanup_concurrency_gate
  where scenario='gate_off_wins') loop perform pg_sleep(0.05); end loop; end $$;
commit;
SQL
worker_pids+=("$!")
wait_for_activity automatic_cleanup_gate_off Timeout

docker exec -e PGAPPNAME=automatic_cleanup_removal_after_gate_off -i "$DB_CONTAINER" \
  psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
select public.remove_classroom_students_preserving_data(
  'c1780000-0000-4000-8000-000000000001','c1780000-0000-4000-8000-000000000010',
  array['c1780000-0000-4000-8000-000000000020'::uuid]);
SQL
worker_pids+=("$!")
wait_for_activity automatic_cleanup_removal_after_gate_off Lock
release_scenario gate_off_wins
wait "${worker_pids[0]}" "${worker_pids[1]}"

docker exec "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null -c "
do \$\$ begin
  if exists(select 1 from private.removed_student_cleanup_jobs
      where generation_id='c1780000-0000-4000-8000-000000000030') then
    raise exception 'Gate-off winner still allowed queue enrollment';
  end if;
end \$\$;
update private.student_provider_cleanup_settings set automatic_enabled=true where singleton;"

docker exec -e PGAPPNAME=automatic_cleanup_removal_first -i "$DB_CONTAINER" \
  psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select public.remove_classroom_students_preserving_data(
  'c1780000-0000-4000-8000-000000000001','c1780000-0000-4000-8000-000000000010',
  array['c1780000-0000-4000-8000-000000000021'::uuid]);
do $$ begin while not (select released from public.automatic_cleanup_concurrency_gate
  where scenario='removal_wins') loop perform pg_sleep(0.05); end loop; end $$;
commit;
SQL
worker_pids+=("$!")
wait_for_activity automatic_cleanup_removal_first Timeout

docker exec -e PGAPPNAME=automatic_cleanup_gate_after_removal -i "$DB_CONTAINER" \
  psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
update private.student_provider_cleanup_settings set automatic_enabled=false where singleton;
SQL
worker_pids+=("$!")
wait_for_activity automatic_cleanup_gate_after_removal Lock
release_scenario removal_wins
wait "${worker_pids[2]}" "${worker_pids[3]}"

docker exec "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 -Atc "
do \$\$ begin
  if (select count(*) from private.removed_student_cleanup_jobs
      where generation_id='c1780000-0000-4000-8000-000000000031')<>1 then
    raise exception 'Removal winner did not enqueue exactly once';
  end if;
  if (select automatic_enabled from private.student_provider_cleanup_settings where singleton) then
    raise exception 'Waiting gate update did not commit after removal';
  end if;
end \$\$;"

# These two classrooms isolate queue admission from the earlier rollout-gate
# races. Removal requires an active classroom; archive it in the winning removal
# transaction so begin must re-read both the archive and queue after its wait.
docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into public.automatic_cleanup_concurrency_gate(scenario)
values('removal_before_decommission'),('decommission_fence_wins');
alter table public.automatic_cleanup_concurrency_gate
  add column roster_digest text,
  add column enrollment_digest text,
  add column participant_digest text;
update private.student_provider_cleanup_settings set automatic_enabled=true where singleton;
update public.attendance_decommission_settings
set mode='enabled',installation_ref='pika_synthetic_178';
insert into public.classrooms(id,teacher_id,title,class_code) values
('c1780000-0000-4000-8000-000000000011','c1780000-0000-4000-8000-000000000001','Removal before decommission','C178R'),
('c1780000-0000-4000-8000-000000000012','c1780000-0000-4000-8000-000000000001','Decommission before removal','C178D');
insert into public.classroom_roster(id,classroom_id,email) values
('c1780000-0000-4000-8000-000000000022','c1780000-0000-4000-8000-000000000011','first-178@example.invalid'),
('c1780000-0000-4000-8000-000000000023','c1780000-0000-4000-8000-000000000012','second-178@example.invalid');
insert into public.classroom_enrollments(id,classroom_id,student_id) values
('c1780000-0000-4000-8000-000000000032','c1780000-0000-4000-8000-000000000011','c1780000-0000-4000-8000-000000000002'),
('c1780000-0000-4000-8000-000000000033','c1780000-0000-4000-8000-000000000012','c1780000-0000-4000-8000-000000000003');
insert into public.attendance_roster_mappings(classroom_id) values
('c1780000-0000-4000-8000-000000000011'),('c1780000-0000-4000-8000-000000000012');
insert into public.attendance_participant_mappings(classroom_id,student_id) values
('c1780000-0000-4000-8000-000000000011','c1780000-0000-4000-8000-000000000002'),
('c1780000-0000-4000-8000-000000000012','c1780000-0000-4000-8000-000000000003');
update public.classrooms set archived_at=clock_timestamp()
where id='c1780000-0000-4000-8000-000000000012';
update public.automatic_cleanup_concurrency_gate set
  roster_digest=(select md5(to_jsonb(roster)::text) from public.classroom_roster roster
    where id='c1780000-0000-4000-8000-000000000023'),
  enrollment_digest=(select md5(to_jsonb(enrollment)::text) from public.classroom_enrollments enrollment
    where id='c1780000-0000-4000-8000-000000000033'),
  participant_digest=(select md5(to_jsonb(participant)::text) from public.attendance_participant_mappings participant
    where classroom_id='c1780000-0000-4000-8000-000000000012'
      and student_id='c1780000-0000-4000-8000-000000000003')
where scenario='decommission_fence_wins';
SQL

docker exec -e PGAPPNAME=automatic_cleanup_removal_before_decommission -i "$DB_CONTAINER" \
  psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
set statement_timeout='20s';
begin isolation level read committed;
select public.remove_classroom_students_preserving_data(
  'c1780000-0000-4000-8000-000000000001','c1780000-0000-4000-8000-000000000011',
  array['c1780000-0000-4000-8000-000000000022'::uuid]);
update public.classrooms set archived_at=clock_timestamp()
where id='c1780000-0000-4000-8000-000000000011';
do $$ begin while not (select released from public.automatic_cleanup_concurrency_gate
  where scenario='removal_before_decommission') loop perform pg_sleep(0.05); end loop; end $$;
commit;
SQL
worker_pids+=("$!")
wait_for_activity automatic_cleanup_removal_before_decommission Timeout

docker exec -e PGAPPNAME=automatic_cleanup_begin_after_removal -i "$DB_CONTAINER" \
  psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
set statement_timeout='20s';
do $$ begin
  begin
    perform public.begin_attendance_decommission(
      'c1780000-0000-4000-8000-000000000001','c1780000-0000-4000-8000-000000000011',
      'c1780000-0000-4000-8000-000000000050','DELETE');
    raise exception 'Begin accepted a removal winner with outstanding cleanup';
  exception when sqlstate '55000' then
    if sqlerrm <> 'classroom_operation_conflict' then raise; end if;
  end;
end $$;
SQL
worker_pids+=("$!")
wait_for_activity automatic_cleanup_begin_after_removal Lock automatic_cleanup_removal_before_decommission
release_scenario removal_before_decommission
wait "${worker_pids[4]}" "${worker_pids[5]}"

# Use a fresh connection after both commits: the queue must be durably visible,
# and a denied begin must not have installed even an unadvanced fence.
docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $$ begin
  if (select count(*) from private.removed_student_cleanup_jobs
      where classroom_id='c1780000-0000-4000-8000-000000000011') <> 1
    or (select count(*) from private.removed_student_cleanup_jobs
      where classroom_id='c1780000-0000-4000-8000-000000000011'
        and teacher_id='c1780000-0000-4000-8000-000000000001'
        and student_id='c1780000-0000-4000-8000-000000000002'
        and generation_id='c1780000-0000-4000-8000-000000000032'
        and status='queued' and attempt_count=0 and lease_token is null
        and lease_expires_at is null and last_error_code is null) <> 1 then
    raise exception 'Removal winner did not retain exactly one untouched queued job';
  end if;
  if exists(select 1 from public.attendance_decommission_operations
      where classroom_id='c1780000-0000-4000-8000-000000000011'
        or id='c1780000-0000-4000-8000-000000000050') then
    raise exception 'Pending cleanup denial left an attendance fence';
  end if;
  if exists(select 1 from public.classroom_enrollments
      where classroom_id='c1780000-0000-4000-8000-000000000011')
    or not exists(select 1 from public.classroom_roster
      where id='c1780000-0000-4000-8000-000000000022' and removed_at is not null
        and removed_enrollment_id='c1780000-0000-4000-8000-000000000032')
    or not exists(select 1 from public.classrooms
      where id='c1780000-0000-4000-8000-000000000011' and archived_at is not null) then
    raise exception 'Removal and archive winner did not commit its membership state';
  end if;
end $$;
SQL

docker exec -e PGAPPNAME=automatic_cleanup_decommission_fence_first -i "$DB_CONTAINER" \
  psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
set statement_timeout='20s';
begin isolation level read committed;
select public.begin_attendance_decommission(
  'c1780000-0000-4000-8000-000000000001','c1780000-0000-4000-8000-000000000012',
  'c1780000-0000-4000-8000-000000000051','DELETE');
do $$ begin while not (select released from public.automatic_cleanup_concurrency_gate
  where scenario='decommission_fence_wins') loop perform pg_sleep(0.05); end loop; end $$;
commit;
SQL
worker_pids+=("$!")
wait_for_activity automatic_cleanup_decommission_fence_first Timeout

# Removal deliberately uses pg_try_advisory_xact_lock, so this contender must
# fail immediately while begin holds the lock; it must not be claimed to wait.
docker exec -e PGAPPNAME=automatic_cleanup_removal_during_decommission -i "$DB_CONTAINER" \
  psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
set statement_timeout='5s';
do $$ begin
  begin
    perform public.remove_classroom_students_preserving_data(
      'c1780000-0000-4000-8000-000000000001','c1780000-0000-4000-8000-000000000012',
      array['c1780000-0000-4000-8000-000000000023'::uuid]);
    raise exception 'Removal ignored an uncommitted decommission lock';
  exception when sqlstate '40001' then
    if sqlerrm <> 'classroom_operation_busy' then raise; end if;
  end;
end $$;
SQL
release_scenario decommission_fence_wins
wait "${worker_pids[6]}"

# A new connection now tests the committed fence rather than the earlier busy
# advisory lock. The fence must take precedence over the archived-class guard.
docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $$ declare v_snapshot public.automatic_cleanup_concurrency_gate; begin
  begin
    perform public.remove_classroom_students_preserving_data(
      'c1780000-0000-4000-8000-000000000001','c1780000-0000-4000-8000-000000000012',
      array['c1780000-0000-4000-8000-000000000023'::uuid]);
    raise exception 'Removal accepted a committed attendance fence';
  exception when sqlstate '55000' then
    if sqlerrm <> 'attendance_decommission_active' then raise; end if;
  end;
  select * into strict v_snapshot from public.automatic_cleanup_concurrency_gate
    where scenario='decommission_fence_wins';
  if v_snapshot.roster_digest is null or v_snapshot.enrollment_digest is null
    or v_snapshot.participant_digest is null
    or v_snapshot.roster_digest is distinct from (select md5(to_jsonb(roster)::text)
      from public.classroom_roster roster where id='c1780000-0000-4000-8000-000000000023')
    or v_snapshot.enrollment_digest is distinct from (select md5(to_jsonb(enrollment)::text)
      from public.classroom_enrollments enrollment where id='c1780000-0000-4000-8000-000000000033')
    or v_snapshot.participant_digest is distinct from (select md5(to_jsonb(participant)::text)
      from public.attendance_participant_mappings participant
      where classroom_id='c1780000-0000-4000-8000-000000000012'
        and student_id='c1780000-0000-4000-8000-000000000003') then
    raise exception 'Denied removal changed the retained roster, enrollment, or participant';
  end if;
  if exists(select 1 from private.removed_student_cleanup_jobs
      where classroom_id='c1780000-0000-4000-8000-000000000012'
        or generation_id='c1780000-0000-4000-8000-000000000033') then
    raise exception 'Fence winner left hidden outstanding cleanup';
  end if;
  if (select count(*) from public.attendance_decommission_operations
      where classroom_id='c1780000-0000-4000-8000-000000000012') <> 1
    or not exists(select 1 from public.attendance_decommission_operations
      where id='c1780000-0000-4000-8000-000000000051'
        and classroom_id='c1780000-0000-4000-8000-000000000012'
        and teacher_id='c1780000-0000-4000-8000-000000000001'
        and state='fenced' and phase=1 and deleted_count=0) then
    raise exception 'Fence winner did not retain exactly its initial operation';
  end if;
  if exists(select 1 from public.student_purge_operations where classroom_id in (
      'c1780000-0000-4000-8000-000000000011','c1780000-0000-4000-8000-000000000012')) then
    raise exception 'Queue admission race unexpectedly created a student purge operation';
  end if;
end $$;
SQL

echo 'Automatic cleanup gate and attendance decommission concurrency checks passed in a disposable database.'
