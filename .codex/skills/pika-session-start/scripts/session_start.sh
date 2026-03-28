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
WORKTREE_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"

if [[ -z "$WORKTREE_ROOT" ]]; then
  echo -e "${FAIL} Not inside a git repository."
  exit 1
fi

HUB="${HOME}/Repos/pika"
if [[ "$WORKTREE_ROOT" == "$HUB" ]]; then
  echo -e "${FAIL} Working in hub ($HUB). Sessions must run inside a worktree."
  echo "   Create one: git -C \"\$HOME/Repos/pika\" worktree add .claude/worktrees/<name> -b <branch>"
  exit 1
fi

if [[ "$WORKTREE_ROOT" != *".claude/worktrees/"* ]]; then
  echo -e "${FAIL} Worktree path does not contain .claude/worktrees/ — unexpected location: $WORKTREE_ROOT"
  exit 1
fi

echo -e "${PASS} Worktree: $WORKTREE_ROOT"

# ── 2. Verify environment ───────────────────────────
echo ""
echo "── 2. Environment check"
if [[ -f "$WORKTREE_ROOT/scripts/verify-env.sh" ]]; then
  bash "$WORKTREE_ROOT/scripts/verify-env.sh" && \
    echo -e "${PASS} verify-env.sh passed" || \
    { echo -e "${FAIL} verify-env.sh failed. Fix before proceeding."; exit 1; }
else
  echo -e "${INFO} verify-env.sh not found, skipping"
fi

# ── 3. Git context ──────────────────────────────────
echo ""
echo "── 3. Git context"
BRANCH=$(git branch --show-current)
echo -e "${INFO} Branch: $BRANCH"
echo ""
git log --oneline -8
echo ""
git status -sb

# ── 4. Recent session log ────────────────────────────
echo ""
echo "── 4. Recent session log"
SESSION_LOG="$WORKTREE_ROOT/.ai/SESSION-LOG.md"
if [[ -f "$SESSION_LOG" ]]; then
  cat "$SESSION_LOG"
else
  echo -e "${INFO} No session log found at $SESSION_LOG"
fi

# ── 5. Feature inventory ────────────────────────────
echo ""
echo "── 5. Feature inventory"
FEATURES_SCRIPT="$WORKTREE_ROOT/scripts/features.mjs"
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
