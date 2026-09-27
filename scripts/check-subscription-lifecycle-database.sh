#!/usr/bin/env bash
set -euo pipefail
# Requires separately authorized migration application. Every fixture is rolled back.
if [[ "$(docker inspect supabase_db_pika --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" != 'pika' ]] \
  || ! docker port supabase_db_pika 5432/tcp | grep -q ':54322$'; then
  echo 'Refusing unexpected subscription lifecycle database target.' >&2
  exit 2
fi
if [[ "$(docker exec supabase_db_pika psql -U postgres -d postgres -X -Atc "select count(*) from supabase_migrations.schema_migrations where version = '214'")" != '1' ]]; then
  echo 'Migration 214 must already be applied locally; this harness never applies it.' >&2
  exit 2
fi
docker exec -i supabase_db_pika psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  < scripts/check-subscription-lifecycle-database.sql

# Forward validation repair is independently migration-gated and rollback-only.
bash scripts/check-subscription-lifecycle-validation-database.sh
