#!/usr/bin/env bash
set -euo pipefail
set +x

# This wrapper obtains credentials only from the running local Supabase status.
# The test itself rejects non-loopback URLs, creates random fixture IDs, and
# removes only rows with those exact IDs.
status_json="$(supabase status --workdir "$(pwd)" -o json 2>/dev/null)" || {
  echo 'Local Supabase is not running for this worktree.' >&2
  exit 1
}

status_value() {
  SUPABASE_STATUS_JSON="$status_json" node -e '
    const status = JSON.parse(process.env.SUPABASE_STATUS_JSON || "{}");
    for (const key of process.argv.slice(1)) {
      if (typeof status[key] === "string" && status[key].trim()) {
        process.stdout.write(status[key]);
        process.exit(0);
      }
    }
    process.exit(1);
  ' "$@"
}

PIKA_REHEARSAL_LOCAL_SUPABASE_URL="$(status_value API_URL)"
PIKA_REHEARSAL_LOCAL_SUPABASE_PUBLISHABLE_KEY="$(status_value PUBLISHABLE_KEY ANON_KEY)"
# The rehearsal deliberately uses the local demo service-role JWT rather than
# a hosted or newer secret key: the test decodes its claims as part of target
# validation before any request can run.
PIKA_REHEARSAL_LOCAL_SUPABASE_SECRET_KEY="$(status_value SERVICE_ROLE_KEY)"

export PIKA_CONTEXTUAL_ASSIGNMENT_REHEARSAL=isolated-only
export PIKA_REHEARSAL_LOCAL_SUPABASE_URL
export PIKA_REHEARSAL_LOCAL_SUPABASE_PUBLISHABLE_KEY
export PIKA_REHEARSAL_LOCAL_SUPABASE_SECRET_KEY

pnpm vitest run tests/api/integration/contextual-assignment-lifecycle.local.test.ts
