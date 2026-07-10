#!/usr/bin/env bash
# Repo hygiene report: stale branches, worktrees, and idle PRs.
# Read-only — prints findings and suggested commands, never deletes anything.
#
# Usage: bash scripts/repo-tidy.sh
# Requires: git, gh (authenticated), jq

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

IDLE_DAYS="${IDLE_DAYS:-30}"
ISSUES=0

echo "🧹 Pika repo tidy report ($(date +%Y-%m-%d))"
echo ""

git fetch --prune --quiet

# 1) Remote branches whose PR is already merged or closed (squash merges hide
#    this from `git branch --merged`, so map through the PR list instead).
echo "── Remote branches ──────────────────────────────"
PR_MAP="$(gh pr list --state all --limit 1000 --json headRefName,state,number \
  --jq 'group_by(.headRefName) | map({branch: .[0].headRefName, states: [.[].state], number: .[0].number})')"

while read -r branch; do
  [[ "$branch" == "main" || "$branch" == "production" ]] && continue
  entry="$(jq -r --arg b "$branch" '.[] | select(.branch == $b)' <<<"$PR_MAP")"
  age="$(git log -1 --format=%cs "origin/$branch" 2>/dev/null || echo '?')"
  if [[ -z "$entry" ]]; then
    echo "  ⚠️  $branch — no PR (last commit $age)"
    ISSUES=$((ISSUES + 1))
  elif ! jq -e '.states | index("OPEN")' <<<"$entry" > /dev/null; then
    pr="$(jq -r '.number' <<<"$entry")"
    state="$(jq -r '.states[0]' <<<"$entry")"
    echo "  🗑  $branch — PR #$pr is $state; delete with: git push origin --delete $branch"
    ISSUES=$((ISSUES + 1))
  fi
done < <(git ls-remote --heads origin | awk '{print $2}' | sed 's|refs/heads/||')

# 2) Local branches whose upstream is gone.
echo ""
echo "── Local branches ───────────────────────────────"
while IFS='|' read -r name track wt; do
  if [[ "$track" == "[gone]" && -z "$wt" ]]; then
    echo "  🗑  $name — upstream deleted; delete with: git branch -D $name"
    ISSUES=$((ISSUES + 1))
  fi
done < <(git for-each-ref refs/heads --format='%(refname:short)|%(upstream:track)|%(worktreepath)')

# 3) Worktrees: flag dirty state and unpushed commits so nothing is lost blindly.
#    The hub (main worktree) and the production release worktree are infrastructure.
echo ""
echo "── Worktrees ────────────────────────────────────"
HUB_WT="$(git worktree list --porcelain | head -1 | sed 's/^worktree //')"
while read -r wt; do
  [[ "$wt" == "$HUB_WT" ]] && continue
  dirty="$(git -C "$wt" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  branch="$(git -C "$wt" branch --show-current 2>/dev/null || true)"
  label="${branch:-DETACHED}"
  if [[ "$branch" == "production" ]]; then
    echo "  🏛  $wt (production) — release infrastructure, keep"
    continue
  fi
  flags=""
  [[ "$dirty" != "0" ]] && flags+=" dirty:$dirty"
  if [[ -n "$branch" ]] && ! git ls-remote --exit-code --heads origin "$branch" > /dev/null 2>&1; then
    flags+=" not-on-remote"
  fi
  if [[ -n "$flags" ]]; then
    echo "  ⚠️  $wt ($label)$flags — inspect before removing"
    ISSUES=$((ISSUES + 1))
  else
    echo "  ✓  $wt ($label) — clean; removable with: git worktree remove $wt"
  fi
done < <(git worktree list --porcelain | awk '/^worktree /{print substr($0, 10)}')

# 4) Open PRs idle beyond the threshold.
echo ""
echo "── Open PRs idle > ${IDLE_DAYS} days ────────────────────"
CUTOFF="$(date -v -"${IDLE_DAYS}"d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -d "-${IDLE_DAYS} days" +%Y-%m-%dT%H:%M:%SZ)"
IDLE="$(gh pr list --state open --json number,title,updatedAt | jq -r --arg cutoff "$CUTOFF" \
  '.[] | select(.updatedAt < $cutoff) | "  💤 #\(.number) \(.title) (updated \(.updatedAt[0:10]))"')"
if [[ -n "$IDLE" ]]; then
  echo "$IDLE"
  ISSUES=$((ISSUES + $(wc -l <<<"$IDLE" | tr -d ' ')))
else
  echo "  none"
fi

echo ""
if [[ "$ISSUES" -eq 0 ]]; then
  echo "✅ Nothing to tidy."
else
  echo "Found $ISSUES item(s) to review. This script deletes nothing — run the suggested commands yourself, or ask an agent to run /repo-tidy."
fi
