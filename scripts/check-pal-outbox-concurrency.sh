#!/usr/bin/env bash

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}' | head -n 1)"
if [[ -z "$DB_CONTAINER" ]]; then
  DB_CONTAINER="$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)"
fi
if [[ -z "$DB_CONTAINER" ]]; then
  echo "Local Supabase database container is not running." >&2
  exit 1
fi

TMP_DB="${PAL_OUTBOX_CONCURRENCY_DATABASE_NAME:-pika_pal_outbox_concurrency_${RANDOM}_$$}"
cleanup() {
  if [[ "${KEEP_PAL_OUTBOX_CONCURRENCY_DATABASE:-false}" == "true" ]]; then
    echo "Kept disposable Pal outbox database: $TMP_DB"
    return
  fi
  docker exec "$DB_CONTAINER" dropdb -U postgres --if-exists "$TMP_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_for_worker_lock() {
  local application_name="$1"
  local observed=""

  for _ in {1..100}; do
    observed="$(docker exec "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -Atc "
      select exists (
        select 1
        from pg_stat_activity
        where datname = '$TMP_DB'
          and application_name = '$application_name'
          and state = 'active'
          and wait_event = 'PgSleep'
      );
    ")"
    if [[ "$observed" == "t" ]]; then
      return
    fi
    sleep 0.05
  done

  echo "Worker $application_name did not acquire its claim before the contention check." >&2
  return 1
}

wait_for_worker_contention() {
  local application_name="$1"
  local observed=""

  for _ in {1..100}; do
    observed="$(docker exec "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -Atc "
      select exists (
        select 1
        from pg_stat_activity
        where datname = '$TMP_DB'
          and application_name = '$application_name'
          and state = 'active'
          and wait_event_type = 'Lock'
      );
    ")"
    if [[ "$observed" == "t" ]]; then
      return
    fi
    sleep 0.05
  done

  echo "Worker $application_name did not contend on the claimed row." >&2
  return 1
}

release_worker() {
  local scenario="$1"
  docker exec "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 \
    -c "update public.pal_outbox_concurrency_gate set released = true where scenario = '$scenario'" \
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
set client_min_messages = warning;
do $$
declare
  v_policy record;
begin
  for v_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'storage'
  loop
    execute format(
      'drop policy %I on %I.%I',
      v_policy.policyname,
      v_policy.schemaname,
      v_policy.tablename
    );
  end loop;
end;
$$;
drop schema public cascade;
drop schema private cascade;
create schema public;
SQL

for migration in "$ROOT"/supabase/migrations/*.sql; do
  docker exec -e PGOPTIONS='-c client_min_messages=warning' -i "$DB_CONTAINER" \
    psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 \
    < "$migration" >/dev/null
done

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
create table public.pal_outbox_concurrency_evidence (
  scenario text not null,
  worker text not null,
  claimed integer not null,
  primary key (scenario, worker)
);

create table public.pal_outbox_concurrency_gate (
  scenario text primary key,
  released boolean not null default false
);

insert into public.pal_outbox_concurrency_gate (scenario) values
  ('batch_pending'),
  ('batch_expired'),
  ('targeted_pending'),
  ('targeted_expired');

insert into public.users (id, email, role, email_verified_at) values (
  '7a100000-0000-4000-8000-000000000001',
  'pal-concurrency-student@example.invalid',
  'student',
  clock_timestamp()
);

insert into public.pal_event_outbox (
  id, idempotency_key, student_id, event_type, source_kind, source_id,
  payload, status, attempts, next_attempt_at, lease_token, lease_expires_at
)
select
  fixture.id,
  fixture.idempotency_key,
  '7a100000-0000-4000-8000-000000000001'::uuid,
  'platform.session.started',
  'pal_concurrency_fixture',
  fixture.source_id,
  jsonb_build_object(
    'schema_version', 1,
    'idempotency_key', fixture.idempotency_key,
    'learner_id', 'lrn-pal-concurrency-fixture',
    'event_type', 'platform.session.started',
    'occurred_at', '2026-08-08T12:00:00.000Z',
    'metadata', '{}'::jsonb
  ),
  'non_retryable',
  0,
  clock_timestamp() + interval '1 day',
  null,
  null
from (values
  ('7a100000-0000-4000-8000-000000000011'::uuid, 'pika:pal-concurrency:batch-pending', 'batch-pending'),
  ('7a100000-0000-4000-8000-000000000012'::uuid, 'pika:pal-concurrency:batch-expired', 'batch-expired'),
  ('7a100000-0000-4000-8000-000000000013'::uuid, 'pika:pal-concurrency:targeted-pending', 'targeted-pending'),
  ('7a100000-0000-4000-8000-000000000014'::uuid, 'pika:pal-concurrency:targeted-expired', 'targeted-expired')
) as fixture(id, idempotency_key, source_id);
SQL

# Two batch workers compete for one pending row. The first holds the row lock;
# SKIP LOCKED must make the second worker claim nothing.
docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
update public.pal_event_outbox
set status = 'pending', attempts = 0, next_attempt_at = clock_timestamp() - interval '1 minute'
where id = '7a100000-0000-4000-8000-000000000011';
SQL
docker exec -e PGAPPNAME=pal_batch_pending_a -i "$DB_CONTAINER" \
  psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
with claimed as (
  select id from public.claim_pal_event_outbox(1, 60)
)
insert into public.pal_outbox_concurrency_evidence (scenario, worker, claimed)
select 'batch_pending', 'a', count(*) from claimed;
do $$
begin
  while not (select released from public.pal_outbox_concurrency_gate
             where scenario = 'batch_pending') loop
    perform pg_sleep(0.05);
  end loop;
end;
$$;
commit;
SQL
BATCH_PENDING_A_PID=$!
wait_for_worker_lock pal_batch_pending_a
docker exec -i "$DB_CONTAINER" \
  psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
insert into public.pal_outbox_concurrency_evidence (scenario, worker, claimed)
select 'batch_pending', 'b', count(*)
from public.claim_pal_event_outbox(1, 60);
SQL
BATCH_PENDING_B_PID=$!
wait "$BATCH_PENDING_B_PID"
release_worker batch_pending
wait "$BATCH_PENDING_A_PID"

# The same batch race must reclaim one expired processing lease exactly once.
docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
update public.pal_event_outbox
set status = 'processing', attempts = 1,
    lease_token = '7a100000-0000-4000-8000-000000000030',
    lease_expires_at = clock_timestamp() - interval '1 minute'
where id = '7a100000-0000-4000-8000-000000000012';
SQL
docker exec -e PGAPPNAME=pal_batch_expired_a -i "$DB_CONTAINER" \
  psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
with claimed as (
  select id from public.claim_pal_event_outbox(1, 60)
)
insert into public.pal_outbox_concurrency_evidence (scenario, worker, claimed)
select 'batch_expired', 'a', count(*) from claimed;
do $$
begin
  while not (select released from public.pal_outbox_concurrency_gate
             where scenario = 'batch_expired') loop
    perform pg_sleep(0.05);
  end loop;
end;
$$;
commit;
SQL
BATCH_EXPIRED_A_PID=$!
wait_for_worker_lock pal_batch_expired_a
docker exec -i "$DB_CONTAINER" \
  psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
insert into public.pal_outbox_concurrency_evidence (scenario, worker, claimed)
select 'batch_expired', 'b', count(*)
from public.claim_pal_event_outbox(1, 60);
SQL
BATCH_EXPIRED_B_PID=$!
wait "$BATCH_EXPIRED_B_PID"
release_worker batch_expired
wait "$BATCH_EXPIRED_A_PID"

# Reproduce the PostgREST conditional UPDATE used by targeted immediate
# delivery. PostgreSQL must recheck the predicates after the row lock clears,
# so only one competing request can claim a pending row.
docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
update public.pal_event_outbox
set status = 'pending', attempts = 0, next_attempt_at = clock_timestamp() - interval '1 minute'
where id = '7a100000-0000-4000-8000-000000000013';
SQL
docker exec -e PGAPPNAME=pal_targeted_pending_a -i "$DB_CONTAINER" \
  psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
with claimed as (
  update public.pal_event_outbox
  set status = 'processing', attempts = attempts + 1,
      lease_token = '7a100000-0000-4000-8000-000000000031',
      lease_expires_at = clock_timestamp() + interval '1 minute'
  where id = '7a100000-0000-4000-8000-000000000013'
    and status = 'pending' and attempts = 0
    and next_attempt_at <= clock_timestamp()
  returning id
)
insert into public.pal_outbox_concurrency_evidence (scenario, worker, claimed)
select 'targeted_pending', 'a', count(*) from claimed;
do $$
begin
  while not (select released from public.pal_outbox_concurrency_gate
             where scenario = 'targeted_pending') loop
    perform pg_sleep(0.05);
  end loop;
end;
$$;
commit;
SQL
TARGETED_PENDING_A_PID=$!
wait_for_worker_lock pal_targeted_pending_a
docker exec -e PGAPPNAME=pal_targeted_pending_b -i "$DB_CONTAINER" \
  psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
with claimed as (
  update public.pal_event_outbox
  set status = 'processing', attempts = attempts + 1,
      lease_token = '7a100000-0000-4000-8000-000000000032',
      lease_expires_at = clock_timestamp() + interval '1 minute'
  where id = '7a100000-0000-4000-8000-000000000013'
    and status = 'pending' and attempts = 0
    and next_attempt_at <= clock_timestamp()
  returning id
)
insert into public.pal_outbox_concurrency_evidence (scenario, worker, claimed)
select 'targeted_pending', 'b', count(*) from claimed;
SQL
TARGETED_PENDING_B_PID=$!
wait_for_worker_contention pal_targeted_pending_b
release_worker targeted_pending
wait "$TARGETED_PENDING_A_PID"
wait "$TARGETED_PENDING_B_PID"

# Targeted delivery must apply the same compare-and-swap rule when reclaiming
# an expired processing lease.
docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
update public.pal_event_outbox
set status = 'processing', attempts = 1,
    lease_token = '7a100000-0000-4000-8000-000000000033',
    lease_expires_at = clock_timestamp() - interval '1 minute'
where id = '7a100000-0000-4000-8000-000000000014';
SQL
docker exec -e PGAPPNAME=pal_targeted_expired_a -i "$DB_CONTAINER" \
  psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
with claimed as (
  update public.pal_event_outbox
  set status = 'processing', attempts = attempts + 1,
      lease_token = '7a100000-0000-4000-8000-000000000034',
      lease_expires_at = clock_timestamp() + interval '1 minute'
  where id = '7a100000-0000-4000-8000-000000000014'
    and status = 'processing' and attempts = 1
    and lease_expires_at <= clock_timestamp()
  returning id
)
insert into public.pal_outbox_concurrency_evidence (scenario, worker, claimed)
select 'targeted_expired', 'a', count(*) from claimed;
do $$
begin
  while not (select released from public.pal_outbox_concurrency_gate
             where scenario = 'targeted_expired') loop
    perform pg_sleep(0.05);
  end loop;
end;
$$;
commit;
SQL
TARGETED_EXPIRED_A_PID=$!
wait_for_worker_lock pal_targeted_expired_a
docker exec -e PGAPPNAME=pal_targeted_expired_b -i "$DB_CONTAINER" \
  psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
with claimed as (
  update public.pal_event_outbox
  set status = 'processing', attempts = attempts + 1,
      lease_token = '7a100000-0000-4000-8000-000000000035',
      lease_expires_at = clock_timestamp() + interval '1 minute'
  where id = '7a100000-0000-4000-8000-000000000014'
    and status = 'processing' and attempts = 1
    and lease_expires_at <= clock_timestamp()
  returning id
)
insert into public.pal_outbox_concurrency_evidence (scenario, worker, claimed)
select 'targeted_expired', 'b', count(*) from claimed;
SQL
TARGETED_EXPIRED_B_PID=$!
wait_for_worker_contention pal_targeted_expired_b
release_worker targeted_expired
wait "$TARGETED_EXPIRED_A_PID"
wait "$TARGETED_EXPIRED_B_PID"

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $$
declare
  v_scenario text;
begin
  foreach v_scenario in array array[
    'batch_pending', 'batch_expired', 'targeted_pending', 'targeted_expired'
  ] loop
    if (select sum(claimed) from public.pal_outbox_concurrency_evidence
        where scenario = v_scenario) <> 1
      or (select count(*) from public.pal_outbox_concurrency_evidence
          where scenario = v_scenario and claimed = 1) <> 1
      or (select count(*) from public.pal_outbox_concurrency_evidence
          where scenario = v_scenario and claimed = 0) <> 1 then
      raise exception 'Pal outbox scenario % did not have exactly one claim winner', v_scenario;
    end if;
  end loop;

  if (select attempts from public.pal_event_outbox
      where id = '7a100000-0000-4000-8000-000000000011') <> 1
    or (select attempts from public.pal_event_outbox
      where id = '7a100000-0000-4000-8000-000000000012') <> 2
    or (select attempts from public.pal_event_outbox
      where id = '7a100000-0000-4000-8000-000000000013') <> 1
    or (select attempts from public.pal_event_outbox
      where id = '7a100000-0000-4000-8000-000000000014') <> 2 then
    raise exception 'Pal outbox attempts did not advance exactly once per winning claim';
  end if;

  if exists (
    select 1 from public.pal_event_outbox
    where id in (
      '7a100000-0000-4000-8000-000000000011',
      '7a100000-0000-4000-8000-000000000012',
      '7a100000-0000-4000-8000-000000000013',
      '7a100000-0000-4000-8000-000000000014'
    ) and (
      status <> 'processing'
      or lease_token is null
      or lease_expires_at <= clock_timestamp()
    )
  ) then
    raise exception 'Winning Pal outbox claims did not own active processing leases';
  end if;
end;
$$;
SQL

echo "Pal outbox PostgreSQL concurrency checks passed."
