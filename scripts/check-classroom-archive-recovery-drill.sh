#!/usr/bin/env bash
set -euo pipefail

eval "$(supabase status -o env \
  --override-name api.url=NEXT_PUBLIC_SUPABASE_URL \
  --override-name auth.anon_key=NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
  --override-name auth.service_role_key=SUPABASE_SECRET_KEY)"

export NEXT_PUBLIC_SUPABASE_URL
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
export SUPABASE_SECRET_KEY
export CLASSROOM_ARCHIVE_RECOVERY_DRILL_ACK=I_UNDERSTAND_THIS_DELETES_LOCAL_FIXTURE_DATA

if ! pnpm exec tsx scripts/run-classroom-archive-recovery-drill.ts; then
  database_container="$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)"
  if [[ -n "$database_container" ]]; then
    # Emit only identifier-shaped database error tokens. Never copy database
    # log lines, statements, object paths, or other free-form details into CI.
    docker logs --since 2m "$database_container" 2>&1 \
      | grep -Eo '(managed_storage|assignment_artifact|operational_managed|archive_operation|classroom_archive)_[a-z_]+' \
      | sort -u \
      | sed 's/^/[recovery-db-error-token] /' || true
  fi
  exit 1
fi
