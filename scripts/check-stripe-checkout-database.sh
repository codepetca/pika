#!/usr/bin/env bash
set -euo pipefail

# Rollback-only contract. Never applies schema or uses a hosted target.
case "${PIKA_CHECKOUT_TEST_PROJECT:-pika}" in
  pika) checkout_project=pika; checkout_container=supabase_db_pika; checkout_port=54322 ;;
  pika_billing_checkout) checkout_project=pika_billing_checkout; checkout_container=supabase_db_pika_billing_checkout; checkout_port=55322 ;;
  *) echo 'Refusing unknown Stripe checkout test project.' >&2; exit 2 ;;
esac
if [[ "$(docker inspect "$checkout_container" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" != "$checkout_project" ]] \
  || ! docker port "$checkout_container" 5432/tcp | grep -q ":${checkout_port}$"; then
  echo 'Refusing unexpected Stripe checkout database target.' >&2
  exit 2
fi
if [[ "$(docker exec "$checkout_container" psql -U postgres -d postgres -X -Atc "select count(*) from supabase_migrations.schema_migrations where version = '211'")" != '1' ]]; then
  echo 'Migration 211 must already be applied locally; this harness never applies it.' >&2
  exit 2
fi
docker exec -i "$checkout_container" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  < scripts/check-stripe-checkout-database.sql
