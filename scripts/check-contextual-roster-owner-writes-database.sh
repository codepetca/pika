#!/usr/bin/env bash
set -euo pipefail
# Serialized rollback-only proof; reviewed235 must already be installed.
ROSTER_OWNER_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROSTER_OWNER_DB_CONTAINER='supabase_db_pika'
[[ "$(docker inspect "$ROSTER_OWNER_DB_CONTAINER" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" == 'pika' ]]
[[ "$(docker port "$ROSTER_OWNER_DB_CONTAINER" 5432/tcp)" =~ :54322$ ]]
# Status output contains credentials; never print it or the caught command error.
if ! supabase status -o json 2>/dev/null | node -e '
let raw=""; process.stdin.on("data", chunk => raw += chunk);
process.stdin.on("end", () => { try {
  const status=JSON.parse(raw);
  if(status.API_URL !== "http://127.0.0.1:54321") process.exit(1);
} catch { process.exit(1); } });'; then
  echo 'Local roster proof target guard failed.' >&2
  exit 1
fi
docker exec -i "$ROSTER_OWNER_DB_CONTAINER" psql -U postgres -d postgres -Xq -v ON_ERROR_STOP=1 \
  < "$ROSTER_OWNER_SCRIPT_DIR/check-contextual-roster-owner-writes-database.sql"
echo 'Roster owner transaction and rollback checks passed; all fixture state rolled back.'
