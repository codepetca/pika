#!/usr/bin/env bash
set -euo pipefail

HUB_REPO="${PIKA_HUB_REPO:-$HOME/Repos/pika}"
PROD_WT="$HUB_REPO/.claude/worktrees/production"
DATE_TAG="$(date +%Y%m%d)"
BRANCH_NAME="codex/merge-main-into-production-${DATE_TAG}"
TITLE="Merge main into production ($(date +%Y-%m-%d))"
BODY='## Summary
- Merge latest main into production

## Notes
- Created by merge_main_into_production.sh using PR-required flow.'
DRY_RUN=0

usage() {
  cat <<USAGE
Usage: $0 [--dry-run]

Env overrides:
  PIKA_HUB_REPO   Hub checkout path (default: $HOME/Repos/pika)
USAGE
}

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[dry-run]'
    for arg in "$@"; do
      printf ' %q' "$arg"
    done
    printf '\n'
  else
    "$@"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

command -v git >/dev/null 2>&1 || { echo "git is required" >&2; exit 1; }
command -v gh >/dev/null 2>&1 || { echo "gh is required" >&2; exit 1; }

if [[ ! -d "$HUB_REPO/.git" ]]; then
  echo "Hub repo not found at $HUB_REPO" >&2
  exit 1
fi

run git -C "$HUB_REPO" fetch origin
run git -C "$HUB_REPO" worktree prune

if [[ ! -d "$PROD_WT" ]]; then
  run git -C "$HUB_REPO" worktree add "$PROD_WT" production
fi

run git -C "$PROD_WT" fetch origin main production
run git -C "$PROD_WT" merge --ff-only origin/production
run git -C "$PROD_WT" merge origin/main
run git -C "$PROD_WT" push origin "HEAD:refs/heads/$BRANCH_NAME"

if [[ "$DRY_RUN" -eq 1 ]]; then
  printf '[dry-run] gh pr create --repo codepetca/pika --base production --head %q --title %q --body %q\n' "$BRANCH_NAME" "$TITLE" "$BODY"
  exit 0
fi

PR_URL="$(gh pr create \
  --repo codepetca/pika \
  --base production \
  --head "$BRANCH_NAME" \
  --title "$TITLE" \
  --body "$BODY")"

printf 'PR created: %s\n' "$PR_URL"
printf 'Next: merge the PR, then sync local production with:\n'
printf 'git -C %q fetch origin production\n' "$PROD_WT"
printf 'git -C %q merge --ff-only origin/production\n' "$PROD_WT"
