#!/usr/bin/env bash
set -euo pipefail

hot_lifecycle_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
hot_lifecycle_container='supabase_db_pika'
[[ "$(docker inspect "$hot_lifecycle_container" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" == 'pika' ]] || exit 1
docker port "$hot_lifecycle_container" 5432/tcp | grep -Eq ':54322[[:space:]]*$'
docker exec -i "$hot_lifecycle_container" psql -U postgres -d postgres -XqAt -v ON_ERROR_STOP=1 < "$hot_lifecycle_root/scripts/check-contextual-classroom-hot-lifecycle-database.sql"
