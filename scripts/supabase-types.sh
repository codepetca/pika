#!/usr/bin/env bash

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
OUTPUT="$ROOT/src/types/database.generated.ts"
MODE="${1:-check}"

if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI is required. Install the pinned CI version (2.103.0)." >&2
  exit 1
fi

MIGRATION_STATUS="$(supabase migration list --local 2>&1)" || {
  echo "Failed to read the local Supabase migration history." >&2
  echo "$MIGRATION_STATUS" >&2
  exit 1
}
if ! MIGRATION_DRIFT="$(printf '%s\n' "$MIGRATION_STATUS" | node "$ROOT/scripts/parse-supabase-migration-list.mjs")"; then
  echo "Failed to parse the local Supabase migration history." >&2
  exit 1
fi

if [[ -n "$MIGRATION_DRIFT" ]]; then
  echo "Local database migration history does not match this worktree:" >&2
  echo "$MIGRATION_DRIFT" >&2
  echo "Use a local database created from this branch before generating database types." >&2
  exit 1
fi

TEMP_FILE="$(mktemp)"
NORMALIZED_FILE="${TEMP_FILE}.normalized"
trap 'rm -f "$TEMP_FILE" "$NORMALIZED_FILE"' EXIT

supabase gen types typescript --local --schema public > "$TEMP_FILE"

# Keep generated output stable for Git while preserving blank lines within the file.
awk '
  /^[[:space:]]*$/ { blank_lines += 1; next }
  {
    while (blank_lines > 0) { print ""; blank_lines -= 1 }
    print
  }
' "$TEMP_FILE" > "$NORMALIZED_FILE"
mv "$NORMALIZED_FILE" "$TEMP_FILE"

case "$MODE" in
  generate)
    mv "$TEMP_FILE" "$OUTPUT"
    trap - EXIT
    echo "Updated ${OUTPUT#$ROOT/}"
    ;;
  check)
    if ! cmp -s "$OUTPUT" "$TEMP_FILE"; then
      echo "Generated Supabase types are out of date." >&2
      echo "Run: pnpm run db:types:generate" >&2
      diff -u "$OUTPUT" "$TEMP_FILE" || true
      exit 1
    fi
    echo "Generated Supabase types match the local migration schema."
    ;;
  *)
    echo "Usage: $0 <generate|check>" >&2
    exit 2
    ;;
esac
