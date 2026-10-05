#!/usr/bin/env bash
set -euo pipefail
# Root-run, rollback-only. Never applies a migration or changes rollout settings.
ROSTER_REMOVAL_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROSTER_REMOVAL_DB_CONTAINER='supabase_db_pika'
[[ "$(docker inspect "$ROSTER_REMOVAL_DB_CONTAINER" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" == 'pika' ]]
[[ "$(docker port "$ROSTER_REMOVAL_DB_CONTAINER" 5432/tcp)" =~ :54322$ ]]
# Status contains credentials. The pipeline consumes it without printing it.
if ! supabase status -o json 2>/dev/null | node -e '
let raw=""; process.stdin.on("data", chunk => raw += chunk);
process.stdin.on("end", () => { try {
  const status=JSON.parse(raw), url=new URL(status.DB_URL);
  if(status.API_URL !== "http://127.0.0.1:54321" || !["postgres:","postgresql:"].includes(url.protocol)
    || !["127.0.0.1","localhost"].includes(url.hostname) || url.port !== "54322" || url.pathname !== "/postgres") process.exit(1);
} catch { process.exit(1); } });'; then
  echo 'Local preserving-removal target guard failed.' >&2
  exit 1
fi
# Suppress raw errors: a statement may contain a synthetic identity. Only emit a
# fixed failure sentinel; ON_ERROR_STOP closes the connection and rolls back.
if ! docker exec -i "$ROSTER_REMOVAL_DB_CONTAINER" psql -U postgres -d postgres -Xq \
  -v ON_ERROR_STOP=1 < "$ROSTER_REMOVAL_SCRIPT_DIR/check-contextual-roster-removal-owner-writes-database.sql" 2>/dev/null; then
  echo 'FAIL rollback-only preserving-removal SQL proof.' >&2
  exit 1
fi
