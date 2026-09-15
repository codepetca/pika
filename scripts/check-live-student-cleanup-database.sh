#!/usr/bin/env bash
set -euo pipefail
# Existing local Pika only; no migration replay, database creation/reset or seeding.
cleanup_container=supabase_db_pika
cleanup_label="$(docker inspect "$cleanup_container" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')"
if [[ "$cleanup_label" != pika ]]; then
  echo 'Refusing unexpected database target.' >&2
  exit 2
fi
docker exec -i "$cleanup_container" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  < "$(dirname "$0")/check-live-student-cleanup-database.sql"
