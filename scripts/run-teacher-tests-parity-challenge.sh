#!/usr/bin/env bash
set -euo pipefail

WORKTREE="${PIKA_WORKTREE:-$(pwd)}"
HUB="${HOME}/Repos/pika"
MODEL="gpt-5.4"
REFRESH_AUTH=0
SKIP_PRECAPTURE=0

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
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 [--model <model>] [--refresh-auth] [--skip-precapture]" >&2
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

mkdir -p "$ARTIFACT_DIR"

if [[ $REFRESH_AUTH -eq 1 ]]; then
  echo "Refreshing Playwright auth state..."
  (
    cd "$WORKTREE"
    pnpm e2e:auth
  )
fi

if [[ $SKIP_PRECAPTURE -eq 0 ]]; then
  echo "Capturing current parity references and targets..."
  (
    cd "$WORKTREE"
    pnpm e2e:verify assessment-ux-parity
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
(
  cd "$WORKTREE"
  env PIKA_WORKTREE="$WORKTREE" codex exec \
    --ephemeral \
    --full-auto \
    -m "$MODEL" \
    -C "$WORKTREE" \
    -i "$REFERENCE_IMAGE" \
    -i "$BEFORE_IMAGE" \
    -o "$LAST_MESSAGE" \
    - <"$PROMPT_COPY"
)

echo "Re-capturing parity screenshots after the challenge..."
(
  cd "$WORKTREE"
  pnpm e2e:verify assessment-ux-parity
)

printf '\nArtifacts:\n'
printf '  Reference: %s\n' "$REFERENCE_IMAGE"
printf '  Before:    %s\n' "$BEFORE_IMAGE"
printf '  After:     %s\n' "$TARGET_IMAGE"
printf '  Prompt:    %s\n' "$PROMPT_COPY"
printf '  Summary:   %s\n' "$LAST_MESSAGE"
