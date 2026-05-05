#!/usr/bin/env bash
# Pika session start script — implements .ai/START-HERE.md ritual
set -euo pipefail

PASS="\033[0;32m✅\033[0m"
FAIL="\033[0;31m❌\033[0m"
INFO="\033[0;34mℹ️ \033[0m"

print_required_doc() {
  local label="$1"
  local file="$2"
  local range="$3"

  echo ""
  echo "── $label"
  if [[ -f "$file" ]]; then
    sed -n "$range" "$file"
  else
    echo -e "${INFO} Missing required startup doc: $file"
  fi
}

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

# ── 4. Required startup docs ────────────────────────
START_HERE="$PIKA_WORKTREE/.ai/START-HERE.md"
CURRENT="$PIKA_WORKTREE/.ai/CURRENT.md"
FEATURES_FILE="$PIKA_WORKTREE/.ai/features.json"
AI_INSTRUCTIONS="$PIKA_WORKTREE/docs/ai-instructions.md"

print_required_doc "4. Startup contract (.ai/START-HERE.md)" "$START_HERE" '1,200p'
print_required_doc "5. Current context (.ai/CURRENT.md)" "$CURRENT" '1,220p'
print_required_doc "6. Feature inventory (.ai/features.json)" "$FEATURES_FILE" '1,220p'
print_required_doc "7. AI routing (docs/ai-instructions.md)" "$AI_INSTRUCTIONS" '1,260p'

# ── 8. Feature summary ──────────────────────────────
echo ""
echo "── 8. Feature summary"
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
echo "── 9. Reminder"
echo -e "${INFO} The required startup docs were rendered above."
echo -e "${INFO} Load only the task-specific docs routed by docs/ai-instructions.md before coding."
echo -e "${INFO} Use .ai/SESSION-LOG.md only for recent handoff context."
echo -e "${INFO} Use .ai/JOURNAL-ARCHIVE.md only for historical investigation."

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Session ready. State your task and wait    ║"
echo "║  for plan approval before writing code.     ║"
echo "╚══════════════════════════════════════════════╝"
