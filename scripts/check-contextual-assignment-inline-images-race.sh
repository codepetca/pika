#!/usr/bin/env bash
set -euo pipefail

# Local-only committed fixture for cross-connection races. Migration 213 is
# already applied by an explicitly authorized owner; this harness never applies
# migrations and removes only the exact UUIDs below on every exit path.
# Pal intentionally retains immutable, anonymized membership-generation audit
# evidence when fixture enrollments are removed; this harness never bypasses
# that guard. All mutable/public fixture rows and test schema artifacts clear.
RACE_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}')"
if [[ "$RACE_CONTAINER" != 'supabase_db_pika' ]] \
  || [[ "$(docker inspect "$RACE_CONTAINER" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" != 'pika' ]]; then
  echo 'The exact local Supabase container supabase_db_pika for project pika is required.' >&2
  exit 2
fi

readonly RACE_OWNER='c2130000-0000-4000-8000-000000000101'
readonly RACE_STUDENT='c2130000-0000-4000-8000-000000000102'
readonly RACE_CLASSROOM='c2130000-0000-4000-8000-000000000110'
readonly RACE_ROSTER='c2130000-0000-4000-8000-000000000111'
readonly RACE_ASSIGNMENT='c2130000-0000-4000-8000-000000000120'
readonly RACE_DOC='c2130000-0000-4000-8000-000000000130'
readonly RACE_OBJECT_RESERVE='c2130000-0000-4000-8000-000000000141'
readonly RACE_OBJECT_FINALIZE='c2130000-0000-4000-8000-000000000142'
readonly RACE_PATH_PREFIX="classrooms/$RACE_CLASSROOM/students/$RACE_STUDENT/assignment-docs/$RACE_DOC/"
RACE_FINALIZE_OUTPUT=''

psql_exec() {
  docker exec -i "$RACE_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 "$@"
}

baseline_counts="$(psql_exec -Atqc "select (select count(*) from public.users), (select count(*) from public.classrooms), (select count(*) from public.assignment_docs), (select count(*) from public.managed_storage_objects)")"
race_background_pids=()

assert_pristine_fixture() {
  local collision
  if [[ "$(psql_exec -Atqc "select mode from public.managed_storage_settings where singleton")" != compatibility ]]; then
    echo 'Race fixtures require local compatibility mode; no settings are changed.' >&2
    exit 2
  fi
  collision="$(psql_exec -Atqc "select exists (
    select 1 from public.users where id in ('$RACE_OWNER'::uuid, '$RACE_STUDENT'::uuid)
    union all select 1 from public.classrooms where id = '$RACE_CLASSROOM'::uuid
    union all select 1 from public.classroom_roster where id = '$RACE_ROSTER'::uuid
    union all select 1 from public.assignments where id = '$RACE_ASSIGNMENT'::uuid
    union all select 1 from public.assignment_docs where id = '$RACE_DOC'::uuid
    union all select 1 from public.managed_storage_objects where id in ('$RACE_OBJECT_RESERVE'::uuid, '$RACE_OBJECT_FINALIZE'::uuid)
    union all select 1 from storage.objects where bucket_id = 'submission-images' and name like '$RACE_PATH_PREFIX%'
    union all select 1 from pg_proc where oid in (to_regprocedure('public.race_213_hold_reservation()'), to_regprocedure('public.race_213_hold_finalization()'))
    union all select 1 from pg_trigger where tgname in ('race_213_hold_reservation', 'race_213_hold_finalization') and not tgisinternal
  )")"
  if [[ "$collision" != f ]]; then
    echo 'Refusing to touch pre-existing contextual inline-image race fixture state.' >&2
    exit 2
  fi
}

cleanup_background() {
  local pid
  for pid in "${race_background_pids[@]-}"; do
    [[ -n "$pid" ]] || continue
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
}

cleanup_fixture() {
  psql_exec >/dev/null <<SQL
begin;
-- Storage metadata only: no physical bytes are uploaded by this fixture.
-- Scope the existing local-test deletion protocol to this cleanup transaction.
select set_config('storage.allow_delete_query', 'true', true);
do \$\$ begin
  if public.lock_managed_storage_protocol() then
    raise exception 'Refusing fixture cleanup after storage mode changed';
  end if;
end \$\$;
drop trigger if exists race_213_hold_reservation on public.managed_storage_objects;
drop trigger if exists race_213_hold_finalization on public.managed_storage_objects;
drop function if exists public.race_213_hold_reservation();
drop function if exists public.race_213_hold_finalization();
delete from public.managed_storage_objects
where id in ('$RACE_OBJECT_RESERVE'::uuid, '$RACE_OBJECT_FINALIZE'::uuid);
delete from storage.objects
where bucket_id = 'submission-images' and name like '$RACE_PATH_PREFIX%';
delete from public.effective_feature_entitlements
where subject_user_id = '$RACE_OWNER'::uuid
  and feature_key = 'classrooms.create'
  and source = 'manual';
delete from public.classrooms where id = '$RACE_CLASSROOM'::uuid;
delete from public.users where id in ('$RACE_OWNER'::uuid, '$RACE_STUDENT'::uuid);
commit;
SQL
  rm -f "$RACE_FINALIZE_OUTPUT"
}

assert_cleanup() {
  local current_counts
  current_counts="$(psql_exec -Atqc "select (select count(*) from public.users), (select count(*) from public.classrooms), (select count(*) from public.assignment_docs), (select count(*) from public.managed_storage_objects)")"
  if [[ "$current_counts" != "$baseline_counts" ]]; then
    echo "Race fixture cleanup changed baseline counts: before=$baseline_counts after=$current_counts" >&2
    return 1
  fi
}

assert_pristine_fixture
RACE_FINALIZE_OUTPUT="$(mktemp /tmp/contextual-inline-image-race.XXXXXX)"
trap 'cleanup_background; cleanup_fixture; assert_cleanup' EXIT

seed_fixture() {
  cleanup_fixture
  psql_exec >/dev/null <<SQL
begin;
do \$\$ begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '213') then
    raise exception 'Migration 213 is required; this race harness never applies it';
  end if;
end \$\$;
insert into public.users (id, email, role) values
  ('$RACE_OWNER', 'inline-image-race-owner@example.invalid', 'teacher'),
  ('$RACE_STUDENT', 'inline-image-race-student@example.invalid', 'student');
set local role service_role;
select public.set_effective_feature_entitlement_v1(
  gen_random_uuid(), '$RACE_OWNER', 'classrooms.create', 'manual', true,
  clock_timestamp(), null, 2, 'test:migration-213-race', 'inline_image_race_fixture',
  coalesce((select revision from public.effective_feature_entitlements
    where subject_user_id = '$RACE_OWNER' and feature_key = 'classrooms.create'), 0)
);
reset role;
insert into public.classrooms (id, teacher_id, title, class_code, archived_at) values
  ('$RACE_CLASSROOM', '$RACE_OWNER', 'Inline image race fixture', 'C213RACE', null);
insert into public.classroom_roster (id, classroom_id, email) values
  ('$RACE_ROSTER', '$RACE_CLASSROOM', 'inline-image-race-student@example.invalid');
insert into public.classroom_enrollments (classroom_id, student_id) values
  ('$RACE_CLASSROOM', '$RACE_STUDENT');
insert into public.assignments (id, classroom_id, title, description, due_at, created_by, is_draft, released_at) values
  ('$RACE_ASSIGNMENT', '$RACE_CLASSROOM', 'Inline image race assignment', '', clock_timestamp() + interval '7 days', '$RACE_OWNER', false, clock_timestamp() - interval '1 hour');
insert into public.assignment_docs (id, assignment_id, student_id, content, is_submitted) values
  ('$RACE_DOC', '$RACE_ASSIGNMENT', '$RACE_STUDENT', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"race"}]}]}', false);
commit;
SQL
}

wait_for_activity() {
  local sql="$1"
  for _ in {1..100}; do
    if [[ "$(psql_exec -Atqc "$sql")" == t ]]; then return 0; fi
    sleep 0.05
  done
  return 1
}

assert_blocked_by() {
  local waiter="$1"
  local holder="$2"
  wait_for_activity "select exists (
    select 1 from pg_stat_activity waiter
    join pg_stat_activity holder on holder.pid = any(pg_blocking_pids(waiter.pid))
    where waiter.datname = current_database()
      and waiter.application_name = '$waiter'
      and waiter.wait_event_type = 'Lock'
      and holder.application_name = '$holder'
  )" || {
    echo "Expected $waiter to be blocked by $holder at a real database lock." >&2
    return 1
  }
}

assert_sleeping_holder() {
  local app="$1"
  wait_for_activity "select exists (
    select 1 from pg_stat_activity
    where datname = current_database() and application_name = '$app' and wait_event = 'PgSleep'
  )" || {
    echo "Race holder $app did not reach its deterministic checkpoint." >&2
    return 1
  }
}

reserve_sql() {
  local object_id="$1"
  cat <<SQL
set role service_role;
select public.reserve_assignment_inline_image_for_member_v1(
  '$RACE_STUDENT', '$RACE_CLASSROOM', '$RACE_DOC', '$object_id', 'png', 'image/png', 4
);
reset role;
SQL
}

finalize_sql() {
  cat <<SQL
set role service_role;
select public.finalize_assignment_inline_image_for_member_v1(
  '$RACE_STUDENT', '$RACE_CLASSROOM', '$RACE_DOC', '$RACE_OBJECT_FINALIZE'
);
reset role;
SQL
}

submit_sql() {
  cat <<SQL
set role service_role;
select public.submit_assignment_doc_for_member_v1(
  '$RACE_STUDENT', '$RACE_ASSIGNMENT',
  '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"race"}]}]}'::jsonb,
  (select updated_at from public.assignment_docs where id = '$RACE_DOC'),
  1, 4, '{}'::uuid[], false, null
);
reset role;
SQL
}

prepare_finalization_object() {
  psql_exec >/dev/null <<SQL
begin;
set local role service_role;
select public.reserve_assignment_inline_image_for_member_v1(
  '$RACE_STUDENT', '$RACE_CLASSROOM', '$RACE_DOC', '$RACE_OBJECT_FINALIZE', 'png', 'image/png', 4
);
reset role;
insert into storage.objects (bucket_id, name) values (
  'submission-images', '$RACE_PATH_PREFIX$RACE_OBJECT_FINALIZE.png'
);
commit;
SQL
}

# Removal owns the classroom fence first; reservation must visibly block, then
# fail closed after the committed membership revocation.
seed_fixture
removal_holder="race_213_removal_holder_$$"
docker exec -e PGAPPNAME="$removal_holder" -i "$RACE_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL &
begin;
set local statement_timeout = '15s';
select public.remove_classroom_students_preserving_data('$RACE_OWNER', '$RACE_CLASSROOM', array['$RACE_ROSTER'::uuid]);
select pg_sleep(5);
commit;
SQL
removal_pid=$!
race_background_pids+=("$removal_pid")
assert_sleeping_holder "$removal_holder"
reserve_waiter="race_213_reserve_waiter_$$"
docker exec -e PGAPPNAME="$reserve_waiter" -i "$RACE_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL &
begin;
set local statement_timeout = '15s';
set role service_role;
do \$\$ begin
  begin
    perform public.reserve_assignment_inline_image_for_member_v1(
      '$RACE_STUDENT', '$RACE_CLASSROOM', '$RACE_DOC', '$RACE_OBJECT_RESERVE', 'png', 'image/png', 4
    );
    raise exception 'Reservation crossed committed membership removal';
  exception when insufficient_privilege then null;
  end;
end \$\$;
reset role;
commit;
SQL
reserve_pid=$!
race_background_pids+=("$reserve_pid")
assert_blocked_by "$reserve_waiter" "$removal_holder"
wait "$removal_pid"
wait "$reserve_pid"
psql_exec >/dev/null <<SQL
do \$\$ begin
  if exists (select 1 from public.classroom_enrollments where classroom_id='$RACE_CLASSROOM' and student_id='$RACE_STUDENT')
    or exists (select 1 from public.managed_storage_objects where id='$RACE_OBJECT_RESERVE') then
    raise exception 'Removal/reservation race left a forbidden membership or reservation';
  end if;
end \$\$;
SQL

# A canonical reservation owns the shared lock first. The real removal must
# fail closed while the exact-object trigger holds that in-flight transaction.
seed_fixture
psql_exec >/dev/null <<SQL
create function public.race_213_hold_reservation() returns trigger language plpgsql as \$\$
begin
  if new.id = '$RACE_OBJECT_RESERVE'::uuid then perform pg_sleep(5); end if;
  return new;
end;
\$\$;
create trigger race_213_hold_reservation after insert on public.managed_storage_objects
for each row execute function public.race_213_hold_reservation();
SQL
reservation_holder="race_213_reservation_holder_$$"
docker exec -e PGAPPNAME="$reservation_holder" -i "$RACE_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL &
begin;
set local statement_timeout = '15s';
$(reserve_sql "$RACE_OBJECT_RESERVE")
commit;
SQL
reservation_pid=$!
race_background_pids+=("$reservation_pid")
assert_sleeping_holder "$reservation_holder"
psql_exec >/dev/null <<SQL
do \$\$ begin
  begin
    perform public.remove_classroom_students_preserving_data('$RACE_OWNER', '$RACE_CLASSROOM', array['$RACE_ROSTER'::uuid]);
    raise exception 'Membership removal crossed in-flight reservation';
  exception when serialization_failure then
    if sqlerrm <> 'classroom_operation_busy' then raise; end if;
  end;
end \$\$;
SQL
wait "$reservation_pid"
psql_exec >/dev/null <<SQL
do \$\$ begin
  if not exists (select 1 from public.classroom_enrollments where classroom_id='$RACE_CLASSROOM' and student_id='$RACE_STUDENT')
    or not exists (select 1 from public.managed_storage_objects where id='$RACE_OBJECT_RESERVE' and status='reserved') then
    raise exception 'Reservation/removal race did not preserve the winning reservation state';
  end if;
end \$\$;
SQL

# Submission owns the document fence first; finalization must visibly block and
# then return its explicit 409 without advancing the object status.
seed_fixture
prepare_finalization_object
submission_holder="race_213_submission_holder_$$"
docker exec -e PGAPPNAME="$submission_holder" -i "$RACE_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL &
begin;
set local statement_timeout = '15s';
$(submit_sql)
select pg_sleep(5);
commit;
SQL
submission_pid=$!
race_background_pids+=("$submission_pid")
assert_sleeping_holder "$submission_holder"
finalize_waiter="race_213_finalize_waiter_$$"
docker exec -e PGAPPNAME="$finalize_waiter" -i "$RACE_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 >"$RACE_FINALIZE_OUTPUT" <<SQL &
begin;
set local statement_timeout = '15s';
set role service_role;
do \$\$ declare v_result jsonb; begin
  v_result := public.finalize_assignment_inline_image_for_member_v1(
    '$RACE_STUDENT', '$RACE_CLASSROOM', '$RACE_DOC', '$RACE_OBJECT_FINALIZE'
  );
  if (v_result->>'ok')::boolean or (v_result->>'status')::integer <> 409 then
    raise exception 'Finalization did not return the expected submitted-document denial: %', v_result;
  end if;
end \$\$;
reset role;
commit;
SQL
finalize_pid=$!
race_background_pids+=("$finalize_pid")
assert_blocked_by "$finalize_waiter" "$submission_holder"
wait "$submission_pid"
wait "$finalize_pid"
rm -f "$RACE_FINALIZE_OUTPUT"
psql_exec >/dev/null <<SQL
do \$\$ begin
  if not (select is_submitted from public.assignment_docs where id='$RACE_DOC')
    or (select status from public.managed_storage_objects where id='$RACE_OBJECT_FINALIZE') <> 'reserved' then
    raise exception 'Submission/finalization race allowed a forbidden storage transition';
  end if;
end \$\$;
SQL

# Canonical finalization wins first. Submission must visibly serialize behind
# its assignment lock; after finalization commits, submission can complete.
seed_fixture
prepare_finalization_object
psql_exec >/dev/null <<SQL
create function public.race_213_hold_finalization() returns trigger language plpgsql as \$\$
begin
  if new.id = '$RACE_OBJECT_FINALIZE'::uuid and new.status = 'verified' then perform pg_sleep(5); end if;
  return new;
end;
\$\$;
create trigger race_213_hold_finalization after update on public.managed_storage_objects
for each row execute function public.race_213_hold_finalization();
SQL
finalization_holder="race_213_finalization_holder_$$"
docker exec -e PGAPPNAME="$finalization_holder" -i "$RACE_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL &
begin;
set local statement_timeout = '15s';
$(finalize_sql)
commit;
SQL
finalization_pid=$!
race_background_pids+=("$finalization_pid")
assert_sleeping_holder "$finalization_holder"
submit_waiter="race_213_submit_waiter_$$"
docker exec -e PGAPPNAME="$submit_waiter" -i "$RACE_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL &
begin;
set local statement_timeout = '15s';
$(submit_sql)
commit;
SQL
submit_pid=$!
race_background_pids+=("$submit_pid")
assert_blocked_by "$submit_waiter" "$finalization_holder"
wait "$finalization_pid"
wait "$submit_pid"
psql_exec >/dev/null <<SQL
do \$\$ begin
  if not (select is_submitted from public.assignment_docs where id='$RACE_DOC')
    or (select status from public.managed_storage_objects where id='$RACE_OBJECT_FINALIZE') <> 'verified' then
    raise exception 'Finalization/submission race did not serialize to its valid terminal state';
  end if;
end \$\$;
SQL

echo 'Contextual Assignment inline-image race checks passed.'
