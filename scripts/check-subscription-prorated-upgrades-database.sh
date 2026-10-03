#!/usr/bin/env bash
set -euo pipefail
# Requires separately authorized local migrations 230 and 231; never applies schema.
if [[ "$(docker inspect supabase_db_pika --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" != 'pika' ]] \
  || ! docker port supabase_db_pika 5432/tcp | grep -q ':54322$'; then
  echo 'Refusing unexpected prorated-upgrade database target.' >&2
  exit 2
fi
if [[ "$(docker exec supabase_db_pika psql -U postgres -d postgres -X -Atc "select count(*) from supabase_migrations.schema_migrations where version='230' and name='subscription_prorated_upgrades'")" != '1' ]]; then
  echo 'Migration 230 must already be applied locally; this harness never applies it.' >&2
  exit 2
fi
if [[ "$(docker exec supabase_db_pika psql -U postgres -d postgres -X -Atc "select count(*) from supabase_migrations.schema_migrations where version='231' and name='subscription_upgrade_conflict_recovery'")" != '1' ]]; then
  echo 'Migration 231 must already be applied locally; this harness never applies it.' >&2
  exit 2
fi
UPGRADE_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
docker exec -i supabase_db_pika psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  < "$UPGRADE_SCRIPT_DIR/check-subscription-prorated-upgrades-database.sql"
