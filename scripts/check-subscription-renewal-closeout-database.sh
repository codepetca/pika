#!/usr/bin/env bash
set -euo pipefail
# Requires separately authorized local application of 228. Never applies schema.
# All fixture data and the transaction-local sandbox setting are rolled back.
if [[ "$(docker inspect supabase_db_pika --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" != 'pika' ]] \
  || ! docker port supabase_db_pika 5432/tcp | grep -q ':54322$'; then
  echo 'Refusing unexpected subscription renewal closeout database target.' >&2
  exit 2
fi
if [[ "$(docker exec supabase_db_pika psql -U postgres -d postgres -X -Atc "select count(*) from supabase_migrations.schema_migrations where version = '228' and name = 'subscription_renewal_closeout'")" != '1' ]]; then
  echo 'Migration 228 (subscription_renewal_closeout) must already be applied locally; this harness never applies it.' >&2
  exit 2
fi
RENEWAL_CLOSEOUT_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
docker exec -i supabase_db_pika psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  < "$RENEWAL_CLOSEOUT_SCRIPT_DIR/subscription-renewal-closeout-database-check.sql"
