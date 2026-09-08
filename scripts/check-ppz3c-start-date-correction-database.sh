#!/usr/bin/env bash
set -euo pipefail

PPZ3C_DATABASE_URL="${PPZ3C_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

psql "$PPZ3C_DATABASE_URL" \
  -X \
  -v ON_ERROR_STOP=1 \
  -f "scripts/check-ppz3c-start-date-correction-database.sql"
