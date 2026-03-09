#!/usr/bin/env bash
# Pika session start script — implements .ai/START-HERE.md ritual
set -euo pipefail

PASS="\033[0;32m✅\033[0m"
FAIL="\033[0;31m❌\033[0m"
INFO="\033[0;34mℹ️ \033[0m"

echo "╔══════════════════════════════════════════════╗"
echo "║         Pika Session Start Ritual            ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── 1. Verify worktree ──────────────────────────────
echo "── 1. Worktree check"
if [[ -z "${PIKA_WORKTREE:-}" ]]; then
  echo -e "${FAIL} PIKA_WORKTREE is not set."
  echo "   Run: pika codex <worktree>"
  exit 1
fi

HUB="${HOME}/Repos/pika"
if [[ "$PIKA_WORKTREE" == "$HUB" ]]; then
  echo -e "${FAIL} PIKA_WORKTREE is the hub ($HUB). Do not work in the hub."
  echo "   Run: pika codex <worktree>"
  exit 1
fi

echo -e "${PASS} PIKA_WORKTREE = $PIKA_WORKTREE"

# ── 2. Verify environment ───────────────────────────
echo ""
echo "── 2. Environment check"
if [[ -f "$PIKA_WORKTREE/scripts/verify-env.sh" ]]; then
  bash "$PIKA_WORKTREE/scripts/verify-env.sh" && \
    echo -e "${PASS} verify-env.sh passed" || \
    { echo -e "${FAIL} verify-env.sh failed. Fix before proceeding."; exit 1; }
else
  echo -e "${INFO} verify-env.sh not found, skipping"
fi

# ── 3. Git context ──────────────────────────────────
echo ""
echo "── 3. Git context"
BRANCH=$(git -C "$PIKA_WORKTREE" branch --show-current)
echo -e "${INFO} Branch: $BRANCH"
echo ""
git -C "$PIKA_WORKTREE" log --oneline -8
echo ""
git -C "$PIKA_WORKTREE" status -sb

# ── 4. Recent journal ───────────────────────────────
echo ""
echo "── 4. Recent journal (last 40 lines)"
JOURNAL="$PIKA_WORKTREE/.ai/JOURNAL.md"
if [[ -f "$JOURNAL" ]]; then
  tail -40 "$JOURNAL"
else
  echo -e "${INFO} No journal found at $JOURNAL"
fi

# ── 5. Feature inventory ────────────────────────────
echo ""
echo "── 5. Feature inventory"
FEATURES_SCRIPT="$PIKA_WORKTREE/scripts/features.mjs"
if [[ -f "$FEATURES_SCRIPT" ]]; then
  node "$FEATURES_SCRIPT" summary 2>/dev/null || echo "(features.mjs summary unavailable)"
  echo ""
  echo "Next unblocked feature:"
  node "$FEATURES_SCRIPT" next 2>/dev/null || echo "(features.mjs next unavailable)"
else
  echo -e "${INFO} features.mjs not found"
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Session ready. State your task and wait    ║"
echo "║  for plan approval before writing code.     ║"
echo "╚══════════════════════════════════════════════╝"
