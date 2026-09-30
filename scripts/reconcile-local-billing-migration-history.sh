#!/usr/bin/env bash
set -euo pipefail
# --apply-approved is not permission: obtain exact one-time owner authorization
# for this local history adjustment before invoking it. Default is check only.
if (( $# > 1 )); then
  echo 'Expected at most one mode argument.' >&2; exit 2
fi
cd "$(dirname "$0")/.."
case "${1:---check}" in
  --check) apply_approved=false ;;
  --apply-approved) apply_approved=true ;;
  *) echo 'Use --check or separately authorized --apply-approved' >&2; exit 2 ;;
esac
if [[ "$(docker inspect supabase_db_pika --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" != 'pika' ]] \
  || ! docker port supabase_db_pika 5432/tcp | grep -q ':54322$'; then
  echo 'Refusing unexpected local migration-history target.' >&2
  exit 2
fi
# Verify the reviewed source before any history adjustment.
shasum -a 256 --check <<'HASHES'
30beb1feafe20e149137e624a6c6c4546344d3fb99f3d9c19b0e11e86b735c75  supabase/migrations/215_subscription_lifecycle.sql
0ea33aad03396292aa84ed2911aebd069a2a16d7195b0aedaf060da75e116ce1  supabase/migrations/216_subscription_lifecycle_validation.sql
6141f6b722a64129805062927729a6e04e73015d4ae2b7bc2a74d8883a1ba682  supabase/migrations/217_subscription_lifecycle_warning_cleanup.sql
HASHES
docker exec -i supabase_db_pika psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  -v "apply_approved=$apply_approved" < scripts/reconcile-local-billing-migration-history.sql
