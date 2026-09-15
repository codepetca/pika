#!/usr/bin/env bash
set -euo pipefail

# Synthetic rollback-only tests. No migration application and no hosted URLs.
PAL_MEMBERSHIP_PROJECT="${PAL_MEMBERSHIP_PROJECT:-pika}"
PAL_MEMBERSHIP_CONTAINER="supabase_db_$PAL_MEMBERSHIP_PROJECT"
PAL_MEMBERSHIP_DATABASE="${PAL_MEMBERSHIP_DATABASE:-postgres}"
if [[ ! "$PAL_MEMBERSHIP_PROJECT" =~ ^[a-z0-9_-]+$ ]] \
  || [[ ! "$PAL_MEMBERSHIP_DATABASE" =~ ^(postgres|pika_pal_168_[a-z0-9_]+)$ ]]; then
  echo 'Refusing unexpected database target.' >&2
  exit 2
fi
PAL_MEMBERSHIP_LABEL="$(docker inspect "$PAL_MEMBERSHIP_CONTAINER" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')"
if [[ "$PAL_MEMBERSHIP_LABEL" != "$PAL_MEMBERSHIP_PROJECT" ]]; then
  echo 'Refusing unexpected Supabase project.' >&2
  exit 2
fi
docker exec -i "$PAL_MEMBERSHIP_CONTAINER" psql -U postgres -d "$PAL_MEMBERSHIP_DATABASE" -X -v ON_ERROR_STOP=1 \
  < "$(dirname "$0")/check-pal-membership-database.sql"

# Exercise both directions of the migration's source-table lock barrier. These
# sessions only take locks; synthetic removal/enrollment effects are above.
for pal_table in classroom_roster classroom_enrollments; do
  for pal_mode in 'row exclusive' 'share row exclusive'; do
    if [[ "$pal_mode" == 'row exclusive' ]]; then
      pal_competing_mode='share row exclusive'
      pal_pg_mode='RowExclusiveLock'
    else
      pal_competing_mode='row exclusive'
      pal_pg_mode='ShareRowExclusiveLock'
    fi
    pal_probe="pal_membership_lock_$$"
    docker exec -e PGAPPNAME="$pal_probe" "$PAL_MEMBERSHIP_CONTAINER" \
      psql -U postgres -d "$PAL_MEMBERSHIP_DATABASE" -X -v ON_ERROR_STOP=1 \
      -c "begin; lock table public.$pal_table in $pal_mode mode; select pg_sleep(4); rollback;" >/dev/null &
    pal_holder=$!
    pal_ready=f
    for _ in {1..30}; do
      pal_ready="$(docker exec "$PAL_MEMBERSHIP_CONTAINER" psql -U postgres -d "$PAL_MEMBERSHIP_DATABASE" -X -Atc \
        "select exists(select 1 from pg_stat_activity a join pg_locks l on l.pid=a.pid where a.datname=current_database() and a.application_name='$pal_probe' and l.relation='public.$pal_table'::regclass and l.mode='$pal_pg_mode' and l.granted)")"
      [[ "$pal_ready" == t ]] && break
      sleep 0.05
    done
    if [[ "$pal_ready" != t ]]; then
      wait "$pal_holder"
      echo 'Membership lock probe did not become ready.' >&2
      exit 1
    fi
    docker exec -i "$PAL_MEMBERSHIP_CONTAINER" psql -U postgres -d "$PAL_MEMBERSHIP_DATABASE" -X -v ON_ERROR_STOP=1 <<SQL
begin;
set local lock_timeout='100ms';
do \$\$ begin
  begin
    lock table public.$pal_table in $pal_competing_mode mode;
    raise exception 'Concurrent source write crossed migration lock barrier';
  exception when lock_not_available then null;
  end;
end \$\$;
rollback;
SQL
    wait "$pal_holder"
  done
done
