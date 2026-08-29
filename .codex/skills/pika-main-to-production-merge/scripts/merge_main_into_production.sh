#!/usr/bin/env bash
set -euo pipefail

HUB_REPO="${PIKA_HUB_REPO:-$HOME/Repos/pika}"
WORKTREE_ROOT="${PIKA_PROD_WT_ROOT:-$HOME/.codex/worktrees/pika}"
GITHUB_REPO="${PIKA_GITHUB_REPO:-codepetca/pika}"
PROD_WT="$WORKTREE_ROOT/production"
DATE_TAG="$(date +%Y%m%d)"
BRANCH_NAME="codex/merge-main-into-production-${DATE_TAG}"
TITLE="Merge main into production ($(date +%Y-%m-%d))"
BODY='## Summary
- Batch the currently reviewed main changes into production

## Notes
- Created or updated by merge_main_into_production.sh using the draft-first PR-required flow.
- Mark ready only after the cumulative promotion diff is reviewed.'
DRY_RUN=0
EXISTING_PR_HEAD=''
EXISTING_PR_URL=''
EXISTING_PR_IS_DRAFT=''

usage() {
  cat <<USAGE
Usage: $0 [--dry-run]

Env overrides:
  PIKA_HUB_REPO       Hub checkout path (default: $HOME/Repos/pika)
  PIKA_PROD_WT_ROOT   Production worktree root for new checkouts (default: $HOME/.codex/worktrees/pika)
  PIKA_GITHUB_REPO    GitHub repository (default: codepetca/pika)
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

if [[ "$DRY_RUN" -eq 0 ]]; then
  PROMOTION_COUNT="$(gh pr list \
    --repo "$GITHUB_REPO" \
    --base production \
    --state open \
    --limit 100 \
    --json headRefName \
    --jq '[.[] | select(.headRefName | startswith("codex/merge-main-into-production-"))] | length')"
  if [[ "$PROMOTION_COUNT" -gt 1 ]]; then
    echo "Multiple open main-to-production PRs exist; consolidate them before continuing." >&2
    exit 1
  fi
  if [[ "$PROMOTION_COUNT" -eq 1 ]]; then
    IFS=$'\t' read -r EXISTING_PR_HEAD EXISTING_PR_URL EXISTING_PR_IS_DRAFT <<< "$(gh pr list \
      --repo "$GITHUB_REPO" \
      --base production \
      --state open \
      --limit 100 \
      --json headRefName,url,isDraft \
      --jq '[.[] | select(.headRefName | startswith("codex/merge-main-into-production-"))][0] | [.headRefName, .url, (.isDraft | tostring)] | @tsv')"
    BRANCH_NAME="$EXISTING_PR_HEAD"
  fi
fi

run git -C "$HUB_REPO" fetch origin
run git -C "$HUB_REPO" worktree prune

EXISTING_PROD_WT="$(git -C "$HUB_REPO" worktree list --porcelain \
  | awk '/^worktree / { path=$2 } /^branch refs\/heads\/production$/ { print path; exit }')"
if [[ -n "$EXISTING_PROD_WT" ]]; then
  PROD_WT="$EXISTING_PROD_WT"
fi

if [[ ! -d "$PROD_WT" ]]; then
  run mkdir -p "$(dirname "$PROD_WT")"
  run git -C "$HUB_REPO" worktree add "$PROD_WT" production
fi

if [[ "$DRY_RUN" -eq 0 && -n "$(git -C "$PROD_WT" status --porcelain)" ]]; then
  echo "Production worktree has local changes; preserve or resolve them before promotion." >&2
  exit 1
fi

run git -C "$PROD_WT" fetch origin main production
run git -C "$PROD_WT" merge --ff-only origin/production
if [[ -n "$EXISTING_PR_HEAD" ]]; then
  if [[ "$EXISTING_PR_IS_DRAFT" != "true" ]]; then
    gh pr ready "$EXISTING_PR_URL" --repo "$GITHUB_REPO" --undo
  fi
  run git -C "$PROD_WT" fetch origin \
    "refs/heads/$EXISTING_PR_HEAD:refs/remotes/origin/$EXISTING_PR_HEAD"
  run git -C "$PROD_WT" merge --ff-only "origin/$EXISTING_PR_HEAD"
fi
run git -C "$PROD_WT" merge origin/main
run git -C "$PROD_WT" push origin "HEAD:refs/heads/$BRANCH_NAME"

if [[ "$DRY_RUN" -eq 1 ]]; then
  printf '[dry-run] gh pr create --draft --repo %q --base production --head %q --title %q --body %q\n' "$GITHUB_REPO" "$BRANCH_NAME" "$TITLE" "$BODY"
  exit 0
fi

if [[ -n "$EXISTING_PR_URL" ]]; then
  printf 'Promotion PR updated and kept draft for cumulative review: %s\n' "$EXISTING_PR_URL"
  printf 'Next: finish the batch review, record the reviewed SHA, then mark the PR ready.\n'
  exit 0
fi

PR_URL="$(gh pr create \
  --draft \
  --repo "$GITHUB_REPO" \
  --base production \
  --head "$BRANCH_NAME" \
  --title "$TITLE" \
  --body "$BODY")"

printf 'Draft promotion PR created: %s\n' "$PR_URL"
printf 'Next: finish cumulative review, mark ready, merge after PR Gate, then sync local production with:\n'
printf 'git -C %q fetch origin production\n' "$PROD_WT"
printf 'git -C %q merge --ff-only origin/production\n' "$PROD_WT"
