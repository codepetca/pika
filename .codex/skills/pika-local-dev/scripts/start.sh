#!/usr/bin/env bash
set -euo pipefail

CHECK_ONLY=0
if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=1
  shift
fi

PIKA_WORKTREE="${1:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"

if [[ -z "$PIKA_WORKTREE" || ! -f "$PIKA_WORKTREE/package.json" || ! -d "$PIKA_WORKTREE/supabase" ]]; then
  echo "Pass the path to a Pika worktree." >&2
  exit 1
fi

for command_name in jq openssl pnpm supabase; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required local command is unavailable: $command_name" >&2
    exit 1
  }
done

SUPABASE_STATUS_JSON="$(supabase status --workdir "$PIKA_WORKTREE" -o json 2>/dev/null)" || {
  echo "Local Supabase is not running for this Pika worktree. Start it before launching Pika." >&2
  exit 1
}

LOCAL_SUPABASE_URL="$(jq -er '.API_URL // empty' <<< "$SUPABASE_STATUS_JSON")"
LOCAL_SUPABASE_PUBLISHABLE_KEY="$(jq -er '.PUBLISHABLE_KEY // empty' <<< "$SUPABASE_STATUS_JSON")"
LOCAL_SUPABASE_SECRET_KEY="$(jq -er '.SECRET_KEY // empty' <<< "$SUPABASE_STATUS_JSON")"

if [[ ! "$LOCAL_SUPABASE_URL" =~ ^http://(127\.0\.0\.1|localhost|\[::1\]):[0-9]+/?$ ]]; then
  echo "Refusing non-loopback Supabase API URL for local development." >&2
  exit 1
fi

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  echo "Pika local-dev prerequisites are ready."
  exit 0
fi

export NEXT_PUBLIC_SUPABASE_URL="$LOCAL_SUPABASE_URL"
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$LOCAL_SUPABASE_PUBLISHABLE_KEY"
export SUPABASE_SECRET_KEY="$LOCAL_SUPABASE_SECRET_KEY"
export SESSION_SECRET="$(openssl rand -hex 32)"

cd "$PIKA_WORKTREE"
exec pnpm dev
