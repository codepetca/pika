#!/usr/bin/env bash
set -euo pipefail

# Rollback-only fixture; never applies migrations or accepts a hosted URL.
REMOVAL_DB_CONTAINER="${REMOVAL_DB_CONTAINER:-supabase_db_pika}"
REMOVAL_DATABASE_NAME="${REMOVAL_DATABASE_NAME:-postgres}"
if [[ "$REMOVAL_DB_CONTAINER" != supabase_db_pika ]] \
  || [[ "$(docker inspect "$REMOVAL_DB_CONTAINER" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" != pika ]] \
  || [[ ! "$REMOVAL_DATABASE_NAME" =~ ^(postgres|pika_removal_164_[a-z0-9_]+)$ ]]; then
  echo 'Refusing unexpected classroom-removal test target.' >&2
  exit 2
fi

docker exec -i "$REMOVAL_DB_CONTAINER" psql -U postgres -d "$REMOVAL_DATABASE_NAME" \
  -X -v ON_ERROR_STOP=1 < scripts/check-student-classroom-removal-database.sql

# Competing purge locks must return a retryable conflict, not a deadlock or wait.
for removal_lock_key in \
  'pika-classroom-operation:c1640000-0000-4000-8000-000000000010' \
  'pika-student-purge-subject:c1640000-0000-4000-8000-000000000003'; do
  removal_probe="removal_164_lock_probe_$$"
  docker exec -e PGAPPNAME="$removal_probe" "$REMOVAL_DB_CONTAINER" \
    psql -U postgres -d "$REMOVAL_DATABASE_NAME" -X -v ON_ERROR_STOP=1 \
    -c "begin; select pg_advisory_xact_lock(hashtextextended('$removal_lock_key',0)); select pg_sleep(3); rollback;" >/dev/null &
  removal_holder=$!
  removal_ready=f
  for _ in {1..30}; do
    removal_ready="$(docker exec "$REMOVAL_DB_CONTAINER" psql -U postgres -d "$REMOVAL_DATABASE_NAME" -X -Atc \
      "select exists(select 1 from pg_stat_activity a join pg_locks l on l.pid=a.pid where a.datname=current_database() and a.application_name='$removal_probe' and l.locktype='advisory' and l.granted)")"
    [[ "$removal_ready" == t ]] && break
    sleep 0.05
  done
  if [[ "$removal_ready" != t ]]; then
    wait "$removal_holder"
    echo 'Lock probe failed to acquire its test lock.' >&2
    exit 1
  fi
  docker exec -i "$REMOVAL_DB_CONTAINER" psql -U postgres -d "$REMOVAL_DATABASE_NAME" -X -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local statement_timeout='1s';
do $$ begin
  begin
    perform private.try_lock_classroom_membership_change(
      'c1640000-0000-4000-8000-000000000010',
      'c1640000-0000-4000-8000-000000000003'
    );
    raise exception 'Expected a retryable busy conflict';
  exception when serialization_failure then null;
  end;
end $$;
rollback;
SQL
  wait "$removal_holder"
done
