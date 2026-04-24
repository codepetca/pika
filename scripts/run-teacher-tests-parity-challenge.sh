#!/usr/bin/env bash
set -euo pipefail

WORKTREE="${PIKA_WORKTREE:-$(pwd)}"
HUB="${HOME}/Repos/pika"
MODEL="gpt-5.4"
REFRESH_AUTH=0
SKIP_PRECAPTURE=0
TIMEOUT_SECONDS=900
BASE_URL="${E2E_BASE_URL:-http://localhost:3000}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)
      MODEL="${2:?missing value for --model}"
      shift 2
      ;;
    --refresh-auth)
      REFRESH_AUTH=1
      shift
      ;;
    --skip-precapture)
      SKIP_PRECAPTURE=1
      shift
      ;;
    --timeout)
      TIMEOUT_SECONDS="${2:?missing value for --timeout}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 [--model <model>] [--refresh-auth] [--skip-precapture] [--timeout <seconds>]" >&2
      exit 1
      ;;
  esac
done

if [[ ! -d "$WORKTREE" ]]; then
  echo "Worktree does not exist: $WORKTREE" >&2
  exit 1
fi

if [[ "$WORKTREE" == "$HUB" ]]; then
  echo "Refusing to run in the hub checkout: $HUB" >&2
  exit 1
fi

if ! git -C "$WORKTREE" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a git worktree: $WORKTREE" >&2
  exit 1
fi

ARTIFACT_DIR="$WORKTREE/artifacts/assessment-ux-parity"
PROMPT_PATH="$WORKTREE/.codex/prompts/teacher-tests-ux-parity.md"
REFERENCE_IMAGE="$ARTIFACT_DIR/teacher-assignments-reference.png"
TARGET_IMAGE="$ARTIFACT_DIR/teacher-tests-target.png"
BEFORE_IMAGE="$ARTIFACT_DIR/teacher-tests-target-before-challenge.png"
PROMPT_COPY="$ARTIFACT_DIR/teacher-tests-challenge-prompt.txt"
LAST_MESSAGE="$ARTIFACT_DIR/teacher-tests-challenge-last.txt"
RUN_LOG="$ARTIFACT_DIR/teacher-tests-challenge-run.log"
RUN_STATUS="$ARTIFACT_DIR/teacher-tests-challenge-status.txt"

mkdir -p "$ARTIFACT_DIR"
rm -f "$LAST_MESSAGE" "$RUN_LOG" "$RUN_STATUS"

if [[ $REFRESH_AUTH -eq 1 ]]; then
  echo "Refreshing Playwright auth state against $BASE_URL..."
  (
    cd "$WORKTREE"
    E2E_BASE_URL="$BASE_URL" pnpm e2e:auth
  )
fi

if [[ $SKIP_PRECAPTURE -eq 0 ]]; then
  echo "Capturing current parity references and targets from $BASE_URL..."
  (
    cd "$WORKTREE"
    E2E_BASE_URL="$BASE_URL" pnpm e2e:verify assessment-ux-parity
  )
fi

if [[ ! -f "$REFERENCE_IMAGE" ]]; then
  echo "Missing reference image: $REFERENCE_IMAGE" >&2
  exit 1
fi

if [[ ! -f "$TARGET_IMAGE" ]]; then
  echo "Missing target image: $TARGET_IMAGE" >&2
  exit 1
fi

cp "$TARGET_IMAGE" "$BEFORE_IMAGE"

cat >"$PROMPT_COPY" <<EOF
Fresh-context parity rerun.

The environment is already verified and the dev server is already running.
This is a task-scoped blind run. Do not widen the task into a repo audit or startup ritual beyond what the prompt itself requires.
If you use shell commands on App Router files with \`[classroomId]\` in the path, quote the path exactly so \`zsh\` does not treat it as a glob.

Use the attached screenshots as visual references:
- attached image 1: current teacher assignments reference
- attached image 2: current teacher tests target before your changes

Read and follow this prompt exactly:

$(<"$PROMPT_PATH")
EOF

echo "Running scoped teacher-tests parity challenge with model $MODEL..."
CHALLENGE_EXIT_CODE=0
set +e
(
  cd "$WORKTREE"
  env PIKA_WORKTREE="$WORKTREE" python3 - "$WORKTREE" "$MODEL" "$REFERENCE_IMAGE" "$BEFORE_IMAGE" "$LAST_MESSAGE" "$PROMPT_COPY" "$TIMEOUT_SECONDS" >"$RUN_LOG" 2>&1 <<'PY'
import subprocess
import sys
from pathlib import Path

worktree, model, reference_image, before_image, last_message, prompt_copy, timeout_seconds = sys.argv[1:]
timeout_seconds = int(timeout_seconds)
prompt_text = Path(prompt_copy).read_text()

command = [
    "codex",
    "exec",
    "--ephemeral",
    "--full-auto",
    "-m",
    model,
    "-C",
    worktree,
    "-i",
    reference_image,
    "-i",
    before_image,
    "-o",
    last_message,
    "-",
]

try:
    completed = subprocess.run(
        command,
        input=prompt_text,
        text=True,
        timeout=timeout_seconds,
        check=False,
    )
    raise SystemExit(completed.returncode)
except subprocess.TimeoutExpired as exc:
    if exc.stdout:
        print(exc.stdout, end="")
    if exc.stderr:
        print(exc.stderr, end="", file=sys.stderr)
    print(f"\n[challenge wrapper] codex exec timed out after {timeout_seconds}s", file=sys.stderr)
    raise SystemExit(124)
PY
)
CHALLENGE_EXIT_CODE=$?
set -e

if [[ $CHALLENGE_EXIT_CODE -eq 0 ]]; then
  printf 'status=completed\nexit_code=0\n' >"$RUN_STATUS"
elif [[ $CHALLENGE_EXIT_CODE -eq 124 ]]; then
  printf 'status=timed_out\nexit_code=124\n' >"$RUN_STATUS"
else
  printf 'status=failed\nexit_code=%s\n' "$CHALLENGE_EXIT_CODE" >"$RUN_STATUS"
fi

echo "Re-capturing parity screenshots after the challenge..."
(
  cd "$WORKTREE"
  E2E_BASE_URL="$BASE_URL" pnpm e2e:verify assessment-ux-parity
)

printf '\nArtifacts:\n'
printf '  Reference: %s\n' "$REFERENCE_IMAGE"
printf '  Before:    %s\n' "$BEFORE_IMAGE"
printf '  After:     %s\n' "$TARGET_IMAGE"
printf '  Prompt:    %s\n' "$PROMPT_COPY"
printf '  Summary:   %s\n' "$LAST_MESSAGE"
printf '  Run log:   %s\n' "$RUN_LOG"
printf '  Status:    %s\n' "$RUN_STATUS"

if [[ $CHALLENGE_EXIT_CODE -eq 124 ]]; then
  printf '\nChallenge status: timed out after %ss\n' "$TIMEOUT_SECONDS"
elif [[ $CHALLENGE_EXIT_CODE -ne 0 ]]; then
  printf '\nChallenge status: failed (exit %s)\n' "$CHALLENGE_EXIT_CODE"
else
  printf '\nChallenge status: completed\n'
fi
