#!/usr/bin/env bash
set -euo pipefail
set +x
unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE
unset GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
unset GIT_CEILING_DIRECTORIES GIT_DISCOVERY_ACROSS_FILESYSTEM

CHECK_ONLY=0
if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=1
  shift
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SKILL_REPO_HINT="$(cd "$SCRIPT_DIR/../../../.." && pwd -P)"
PIKA_WORKTREE_INPUT="${1:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"

if [[ -z "$PIKA_WORKTREE_INPUT" || ! -d "$PIKA_WORKTREE_INPUT" ]]; then
  echo "Pass the path to a Pika worktree." >&2
  exit 1
fi

for command_name in git node openssl pnpm supabase; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required local command is unavailable: $command_name" >&2
    exit 1
  }
done

PIKA_WORKTREE="$(cd "$PIKA_WORKTREE_INPUT" && pwd -P)"
TRUSTED_REPO_ROOT="$(git -C "$SKILL_REPO_HINT" rev-parse --show-toplevel 2>/dev/null || true)"
TARGET_REPO_ROOT="$(git -C "$PIKA_WORKTREE" rev-parse --show-toplevel 2>/dev/null || true)"

if [[ -z "$TRUSTED_REPO_ROOT" || -z "$TARGET_REPO_ROOT" || "$PIKA_WORKTREE" != "$TARGET_REPO_ROOT" ]]; then
  echo "Refusing to launch outside a Pika Git worktree root." >&2
  exit 1
fi

TRUSTED_GIT_COMMON_DIR="$(git -C "$TRUSTED_REPO_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
TARGET_GIT_COMMON_DIR="$(git -C "$TARGET_REPO_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"

if [[ -z "$TRUSTED_GIT_COMMON_DIR" || "$TRUSTED_GIT_COMMON_DIR" != "$TARGET_GIT_COMMON_DIR" ]]; then
  echo "Refusing to pass local credentials to an untrusted Pika worktree." >&2
  exit 1
fi

if ! git -C "$TRUSTED_REPO_ROOT" worktree list --porcelain -z >/dev/null 2>&1; then
  echo "Unable to read Pika's registered worktrees." >&2
  exit 1
fi

TARGET_IS_REGISTERED=0
while IFS= read -r -d '' worktree_field; do
  if [[ "$worktree_field" == worktree\ * && "${worktree_field#worktree }" == "$TARGET_REPO_ROOT" ]]; then
    TARGET_IS_REGISTERED=1
    break
  fi
done < <(git -C "$TRUSTED_REPO_ROOT" worktree list --porcelain -z)

if [[ "$TARGET_IS_REGISTERED" -ne 1 ]]; then
  echo "Refusing to pass local credentials to an unregistered Pika worktree." >&2
  exit 1
fi

if [[ ! -f "$PIKA_WORKTREE/package.json" || ! -d "$PIKA_WORKTREE/supabase" ]]; then
  echo "The trusted worktree is missing required Pika project files." >&2
  exit 1
fi

SUPABASE_STATUS_JSON="$(supabase status --workdir "$PIKA_WORKTREE" -o json 2>/dev/null)" || {
  echo "Local Supabase is not running for this Pika worktree. Start it before launching Pika." >&2
  exit 1
}

read_supabase_status_value() {
  node -e '
    let input = ""
    process.stdin.setEncoding("utf8")
    process.stdin.on("data", (chunk) => { input += chunk })
    process.stdin.on("end", () => {
      let status
      try {
        status = JSON.parse(input)
      } catch {
        process.exit(1)
      }
      for (const key of process.argv.slice(1)) {
        if (typeof status[key] === "string" && status[key].length > 0) {
          process.stdout.write(status[key])
          return
        }
      }
      process.exit(1)
    })
  ' "$@" <<< "$SUPABASE_STATUS_JSON"
}

if ! LOCAL_SUPABASE_URL="$(read_supabase_status_value API_URL)"; then
  echo "Local Supabase status did not provide an API URL." >&2
  exit 1
fi
if ! LOCAL_SUPABASE_PUBLISHABLE_KEY="$(read_supabase_status_value PUBLISHABLE_KEY ANON_KEY)"; then
  echo "Local Supabase status did not provide a publishable or anon key." >&2
  exit 1
fi
if ! LOCAL_SUPABASE_SECRET_KEY="$(read_supabase_status_value SECRET_KEY SERVICE_ROLE_KEY)"; then
  echo "Local Supabase status did not provide a secret or service-role key." >&2
  exit 1
fi
unset SUPABASE_STATUS_JSON

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
if ! GENERATED_SESSION_SECRET="$(openssl rand -hex 32)"; then
  echo "Unable to generate a local session secret." >&2
  exit 1
fi
if [[ ! "$GENERATED_SESSION_SECRET" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Generated local session secret did not meet the required format." >&2
  exit 1
fi
export SESSION_SECRET="$GENERATED_SESSION_SECRET"
unset GENERATED_SESSION_SECRET

cd "$PIKA_WORKTREE"
exec pnpm dev
