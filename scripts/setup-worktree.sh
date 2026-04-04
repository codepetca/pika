#!/usr/bin/env bash
# setup-worktree.sh — run once in a new worktree to link shared .env.local
#
# Usage (from worktree root):
#   bash scripts/setup-worktree.sh

set -euo pipefail

CANONICAL="$HOME/Repos/.env/pika/.env.local"

if [[ ! -f "$CANONICAL" ]]; then
  echo "❌ Canonical .env.local not found at $CANONICAL"
  echo "   Adjust the path if your env files live elsewhere."
  exit 1
fi

ln -sf "$CANONICAL" .env.local
echo "✅ .env.local linked → $CANONICAL"
