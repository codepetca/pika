#!/usr/bin/env bash
set -euo pipefail
# Rollback-only compatibility contract; never applies schema or targets hosted DBs.
if [[ "$(docker inspect supabase_db_pika --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" != 'pika' ]] \
  || ! docker port supabase_db_pika 5432/tcp | grep -q ':54322$'; then
  echo 'Refusing unexpected subscription validation database target.' >&2
  exit 2
fi
if [[ "$(docker exec supabase_db_pika psql -U postgres -d postgres -X -Atc "select count(*) from supabase_migrations.schema_migrations where version = '216' and name = 'subscription_lifecycle_validation'")" != '1' ]]; then
  echo 'Migration 216 (subscription_lifecycle_validation) must already be applied locally; this harness never applies it.' >&2
  exit 2
fi
docker exec -i supabase_db_pika psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  < scripts/check-subscription-lifecycle-validation-database.sql
