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

ensure_env_symlink() {
  local worktree="$1"
  local canonical="${HOME}/Repos/.env/pika/.env.local"
  local link="${worktree}/.env.local"

  if [[ ! -e "$canonical" ]]; then
    echo -e "${INFO} Shared env file not found at $canonical"
    echo "   Create it or link .env.local manually before running the app."
    return 0
  fi

  if [[ -L "$link" ]]; then
    local target
    target="$(readlink "$link")"
    if [[ "$target" == "$canonical" ]]; then
      echo -e "${PASS} .env.local -> $canonical"
    else
      echo -e "${INFO} .env.local points to $target"
      echo "   Expected shared env symlink target: $canonical"
    fi
    return 0
  fi

  if [[ -e "$link" ]]; then
    echo -e "${INFO} .env.local exists but is not a symlink; leaving it unchanged."
    echo "   Default worktree setup is: .env.local -> $canonical"
    return 0
  fi

  ln -s "$canonical" "$link"
  echo -e "${PASS} Created .env.local -> $canonical"
}

echo "╔══════════════════════════════════════════════╗"
echo "║         Pika Session Start Ritual            ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── 1. Verify worktree ──────────────────────────────
echo "── 1. Worktree check"

if WORKTREE=$(git rev-parse --show-toplevel 2>/dev/null); then
  WORKTREE=$(cd "$WORKTREE" && pwd -P)
else
  echo -e "${FAIL} Current directory is not inside a git checkout."
  echo "   Open a Pika worktree and re-run this script from inside it."
  exit 1
fi

HUB="${HOME}/Repos/pika"
WORKTREE_REAL="$(cd "$WORKTREE" && pwd -P)"
if [[ -d "$HUB" ]]; then
  HUB_REAL="$(cd "$HUB" && pwd -P)"
else
  HUB_REAL="$HUB"
fi

if [[ "$WORKTREE_REAL" == "$HUB_REAL" ]]; then
  echo -e "${FAIL} Current repo is the hub ($HUB). Do not do branch work in the hub."
  echo "   Create or open a dedicated worktree, then re-run this script from that checkout."
  exit 1
fi

echo -e "${PASS} Worktree = $WORKTREE"

# ── 2. Verify environment ───────────────────────────
echo ""
echo "── 2. Environment check"
ensure_env_symlink "$WORKTREE"
if [[ -f "$WORKTREE/scripts/verify-env.sh" ]]; then
  bash "$WORKTREE/scripts/verify-env.sh" && \
    echo -e "${PASS} verify-env.sh passed" || \
    { echo -e "${FAIL} verify-env.sh failed. Fix before proceeding."; exit 1; }
else
  echo -e "${INFO} verify-env.sh not found, skipping"
fi

# ── 3. Git context ──────────────────────────────────
echo ""
echo "── 3. Git context"
BRANCH=$(git -C "$WORKTREE" branch --show-current)
echo -e "${INFO} Branch: $BRANCH"
echo ""
git -C "$WORKTREE" log --oneline -8
echo ""
git -C "$WORKTREE" status -sb

# ── 4. Required startup docs ────────────────────────
START_HERE="$WORKTREE/.ai/START-HERE.md"
CURRENT="$WORKTREE/.ai/CURRENT.md"
FEATURES_FILE="$WORKTREE/.ai/features.json"
AI_INSTRUCTIONS="$WORKTREE/docs/ai-instructions.md"

print_required_doc "4. Startup contract (.ai/START-HERE.md)" "$START_HERE" '1,200p'
print_required_doc "5. Current context (.ai/CURRENT.md)" "$CURRENT" '1,220p'
print_required_doc "6. Feature inventory (.ai/features.json)" "$FEATURES_FILE" '1,220p'
print_required_doc "7. AI routing (docs/ai-instructions.md)" "$AI_INSTRUCTIONS" '1,260p'

# ── 8. Feature summary ──────────────────────────────
echo ""
echo "── 8. Feature summary"
FEATURES_SCRIPT="$WORKTREE/scripts/features.mjs"
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
