#!/usr/bin/env bash
set -euo pipefail

# Local-only transaction/rollback proofs. This does not apply migrations.
# Run only after the exact reviewed 234 has been applied through the owner flow.
MATERIAL_OWNER_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MATERIAL_OWNER_DB_CONTAINER='supabase_db_pika'
[[ "$(docker inspect "$MATERIAL_OWNER_DB_CONTAINER" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" == 'pika' ]]
docker port "$MATERIAL_OWNER_DB_CONTAINER" 5432/tcp | rg -q ':54322$'
docker exec -i "$MATERIAL_OWNER_DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  < "$MATERIAL_OWNER_SCRIPT_DIR/check-contextual-material-owner-writes-database.sql"
echo 'Material owner transaction and rollback checks passed; all fixture state rolled back.'
