#!/usr/bin/env bash
set -euo pipefail
# Explicit disposable target only; all fixtures/assertions roll back.
DB_CONTAINER="${STUDENT_TEST_SESSION_DB_CONTAINER:-}"
if [[ -z "$DB_CONTAINER" || ! "$DB_CONTAINER" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]; then
  echo 'Set STUDENT_TEST_SESSION_DB_CONTAINER to the explicit disposable database container.' >&2
  exit 2
fi
if [[ "$DB_CONTAINER" == 'supabase_db_pika' && !( "${CI:-}" == 'true' && "${STUDENT_TEST_SESSION_ALLOW_CI_DATABASE:-}" == '1' ) ]]; then
  echo 'Refusing the canonical local Pika database container.' >&2
  exit 2
fi
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < "$(dirname "$0")/check-student-test-session-status.sql"
