#!/usr/bin/env bash
set -euo pipefail

# Helper script to create a git worktree with symlinked .env.local
# Usage: ./scripts/wt-add.sh <branch-name>

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <branch-name>"
  echo "Example: $0 feature/my-feature"
  exit 1
fi

BRANCH_NAME="$1"
WORKTREE_BASE="$HOME/repos/.worktrees/pika"
WORKTREE_PATH="$WORKTREE_BASE/$BRANCH_NAME"
CANONICAL_ENV="$HOME/repos/.env/pika/.env.local"

# Create worktree
echo "📦 Creating worktree at: $WORKTREE_PATH"
git fetch
git worktree add "$WORKTREE_PATH" "$BRANCH_NAME"

# Create symlink to canonical .env.local
echo "🔗 Symlinking .env.local from: $CANONICAL_ENV"
ln -sf "$CANONICAL_ENV" "$WORKTREE_PATH/.env.local"

echo ""
echo "✅ Worktree ready at:"
echo "   $WORKTREE_PATH"
echo ""
echo "To switch to this worktree:"
echo "   cd $WORKTREE_PATH"

# Bootstrap pnpm dependencies within the new worktree if necessary.
if [[ -f "$WORKTREE_PATH/package.json" ]]; then
  pushd "$WORKTREE_PATH" > /dev/null
  if [[ -d "node_modules" ]]; then
    echo "🔁 node_modules already present; skipping install."
  else
    echo "📦 Installing dependencies (corepack pnpm install)..."
    corepack pnpm install
  fi
  popd > /dev/null
fi
