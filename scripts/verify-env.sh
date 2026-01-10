#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-}"

if [[ "$MODE" == "-h" || "$MODE" == "--help" ]]; then
  echo "Usage: bash scripts/verify-env.sh [--full]"
  echo ""
  echo "Default: fast checks (node, .ai layer, tests)."
  echo "  --full: also run lint + build (slower)."
  exit 0
fi

echo "🔍 Verifying Pika development environment..."

if ! command -v node >/dev/null 2>&1; then
  echo "❌ node not found"
  echo "   Install Node.js 22.x or newer"
  exit 1
fi

NODE_VERSION="$(node -p 'process.versions.node')"
NODE_MAJOR="${NODE_VERSION%%.*}"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  echo "❌ Node.js 22.x or newer required (found $NODE_VERSION)"
  exit 1
fi
echo "✅ Node.js $NODE_VERSION"

if ! command -v npm >/dev/null 2>&1; then
  echo "❌ npm not found"
  echo "   Install Node.js with npm"
  exit 1
fi
echo "✅ npm available"

PM_CMD="npm"
if command -v corepack >/dev/null 2>&1; then
  # Prefer pnpm via Corepack when the repo declares a packageManager.
  if node -e "const p=require('./package.json'); process.exit(p.packageManager ? 0 : 1)" >/dev/null 2>&1; then
    PM_CMD="corepack pnpm"
  fi
fi

if [[ ! -d ".ai" ]]; then
  echo "❌ .ai/ directory not found"
  echo "   AI continuity layer missing."
  exit 1
fi
echo "✅ AI continuity layer present"

if [[ -f "scripts/features.mjs" && -f ".ai/features.json" ]]; then
  echo "Validating .ai/features.json..."
  node scripts/features.mjs validate >/dev/null
  echo "✅ features.json valid"
fi

if [[ ! -d "node_modules" ]]; then
  echo "❌ node_modules not found"
  echo "   Install dependencies: $PM_CMD install"
  exit 1
fi
echo "✅ Dependencies installed"

echo "Running tests..."
$PM_CMD test
echo "✅ Tests passing"

if [[ "$MODE" == "--full" ]]; then
  echo "Running lint..."
  $PM_CMD run lint
  echo "✅ Lint passing"

  echo "Running build..."
  $PM_CMD run build
  echo "✅ Build successful"
fi

echo ""
echo "✨ Environment verified. Ready for development."
