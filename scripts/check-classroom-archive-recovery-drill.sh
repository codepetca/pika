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

pnpm exec tsx scripts/run-classroom-archive-recovery-drill.ts
