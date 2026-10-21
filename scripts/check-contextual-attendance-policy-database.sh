#!/usr/bin/env bash
set -euo pipefail

# Existing ephemeral CI database, or separately authorized local execution only.
# No linked target, environment URL, schema application or hosted credentials.
attendance_policy_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
attendance_policy_container='supabase_db_pika'
[[ "$(docker inspect "$attendance_policy_container" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" == 'pika' ]] || exit 1
docker port "$attendance_policy_container" 5432/tcp | grep -Eq ':54322[[:space:]]*$'
docker exec -i -e 'PGOPTIONS=-c lock_timeout=1000 -c statement_timeout=8000' \
  "$attendance_policy_container" psql -U postgres -d postgres -XqAt \
  -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate \
  < "$attendance_policy_root/scripts/check-contextual-attendance-policy.sql"
