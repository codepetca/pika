#!/usr/bin/env bash
set -euo pipefail
# Root-run only after frozen source review and reviewed local migration apply.
# SQL restores the singleton index/168 guards and proves global rows after rollback.
GROUP_CLEANUP_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
GROUP_CLEANUP_DB_CONTAINER='supabase_db_pika'
[[ "${1:-}" == '' || "${1:-}" == '--force-failure' ]] || exit 2
[[ "$(docker inspect "$GROUP_CLEANUP_DB_CONTAINER" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" == 'pika' ]]
[[ "$(docker port "$GROUP_CLEANUP_DB_CONTAINER" 5432/tcp)" =~ :54322$ ]]
# Consume status without exposing credentials.
if ! supabase status -o json 2>/dev/null | node -e '
let raw=""; process.stdin.on("data", chunk => raw += chunk);
process.stdin.on("end", () => { try {
  const status=JSON.parse(raw), url=new URL(status.DB_URL);
  if(status.API_URL !== "http://127.0.0.1:54321" || !["postgres:","postgresql:"].includes(url.protocol)
    || !["127.0.0.1","localhost"].includes(url.hostname) || url.port !== "54322" || url.pathname !== "/postgres") process.exit(1);
} catch { process.exit(1); } });'; then
  echo 'FAIL retained roster group cleanup target guard.' >&2
  exit 1
fi
if ! GROUP_CLEANUP_OUTPUT="$(docker exec -i "$GROUP_CLEANUP_DB_CONTAINER" psql -U postgres -d postgres -Xq \
  -v ON_ERROR_STOP=1 < "$GROUP_CLEANUP_SCRIPT_DIR/check-retained-roster-group-cleanup-database.sql" 2>/dev/null)"; then
  echo 'FAIL retained roster group cleanup SQL proof.' >&2
  exit 1
fi
if ! grep -Fxq 'PASS retained roster group cleanup SQL and exact rollback teardown' <<< "$GROUP_CLEANUP_OUTPUT"; then
  echo 'FAIL retained roster group cleanup teardown receipt missing.' >&2
  exit 1
fi
unset GROUP_CLEANUP_OUTPUT
echo 'PASS retained roster group cleanup exact teardown.'
# This forces wrapper failure only AFTER the actual rollback/teardown proof.
# Mid-transaction fault rollback is separately asserted by the SQL fault cases.
if [[ "${1:-}" == '--force-failure' ]]; then
  echo 'FAIL forced retained roster group cleanup wrapper failure.' >&2
  exit 1
fi
