#!/usr/bin/env bash
set -euo pipefail

metadata_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
metadata_container='supabase_db_pika'
[[ "$(docker inspect "$metadata_container" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" == 'pika' ]] || exit 1
docker port "$metadata_container" 5432/tcp | grep -Eq ':54322[[:space:]]*$'
docker exec -i "$metadata_container" psql -U postgres -d postgres -XqAt -v ON_ERROR_STOP=1 < "$metadata_root/scripts/check-contextual-classroom-metadata-database.sql"
