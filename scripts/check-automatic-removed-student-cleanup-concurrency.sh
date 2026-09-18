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
  for _ in {1..120}; do
    if [[ "$(docker exec "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -Atc "
      select exists(select 1 from pg_stat_activity
        where datname='$TMP_DB' and application_name='$application_name'
          and state='active' and wait_event_type='$wait_type');")" == 't' ]]; then
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
  if [[ "$(basename "$migration")" == '176_automatic_removed_student_cleanup.sql' ]]; then
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

echo 'Automatic cleanup gate concurrency checks passed in a disposable database.'
