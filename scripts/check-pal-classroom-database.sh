#!/usr/bin/env bash
set -euo pipefail
# Existing local project only. This script never applies migrations or resets DBs.
pal_classroom_container=supabase_db_pika
pal_classroom_label="$(docker inspect "$pal_classroom_container" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')"
if [[ "$pal_classroom_label" != pika ]]; then
  echo 'Refusing an unexpected database target.' >&2
  exit 2
fi
pal_classroom_log="$(mktemp -t pika-pal-classroom.XXXXXX)"
trap 'rm -f "$pal_classroom_log"' EXIT
docker exec -i "$pal_classroom_container" psql -U postgres -d postgres -X -At -v ON_ERROR_STOP=1 \
  < "$(dirname "$0")/check-pal-classroom-database.sql" > "$pal_classroom_log"
pnpm exec tsx "$(dirname "$0")/validate-pal-classroom-fixture.ts" "$pal_classroom_log"
docker exec -i "$pal_classroom_container" psql -U postgres -d postgres -X -At -v ON_ERROR_STOP=1 \
  < "$(dirname "$0")/check-pal-classroom-producer-database.sql"

# Two-session planner exclusion without committing any rollout gate or fixture.
pal_classroom_probe="pal_classroom_planner_$$"
docker exec -e PGAPPNAME="$pal_classroom_probe" "$pal_classroom_container" \
  psql -U postgres -d postgres -X -At -v ON_ERROR_STOP=1 \
  -c "begin; select pg_advisory_xact_lock(hashtextextended('pal_membership_week_sync_v1',0)); select pg_sleep(4); rollback;" >/dev/null &
pal_classroom_holder=$!
pal_classroom_ready=f
for _ in {1..30}; do
  pal_classroom_ready="$(docker exec "$pal_classroom_container" psql -U postgres -d postgres -X -Atc \
    "select exists(select 1 from pg_stat_activity a join pg_locks l on l.pid=a.pid where a.application_name='$pal_classroom_probe' and l.locktype='advisory' and l.granted)")"
  [[ "$pal_classroom_ready" == t ]] && break
  sleep 0.05
done
if [[ "$pal_classroom_ready" != t ]]; then
  wait "$pal_classroom_holder"
  echo 'Planner exclusion probe did not acquire its lock.' >&2
  exit 1
fi
docker exec -i "$pal_classroom_container" psql -U postgres -d postgres -X -At -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local lock_timeout='3s';
update private.pal_membership_settings set enabled=true;
update private.pal_classroom_signal_settings set enabled=true,activated_at=coalesce(activated_at,now());
do $$ begin
  if public.sync_pal_membership_weeks(1)->>'status' <> 'busy' then
    raise exception 'Overlapping weekly planner was not excluded';
  end if;
end $$;
rollback;
SQL
wait "$pal_classroom_holder"
echo 'Classroom Pal database and concurrent planner contracts passed.'
