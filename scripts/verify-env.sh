#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-}"

if [[ "$MODE" == "-h" || "$MODE" == "--help" ]]; then
  echo "Usage: bash scripts/verify-env.sh [--tests|--full]"
  echo ""
  echo "Default: fast checks (node, package manager, AI continuity layer, features.json, dependencies)."
  echo "  --tests: also run pnpm/npm test."
  echo "  --full: run tests + lint + build."
  exit 0
fi

echo "🔍 Verifying Pika development environment..."

if ! command -v node >/dev/null 2>&1; then
  echo "❌ node not found"
  echo "   Install Node.js 24.x"
  exit 1
fi

NODE_VERSION="$(node -p 'process.versions.node')"
NODE_MAJOR="${NODE_VERSION%%.*}"
if [[ "$NODE_MAJOR" -ne 24 ]]; then
  echo "❌ Node.js 24.x required (found $NODE_VERSION)"
  exit 1
fi
echo "✅ Node.js $NODE_VERSION"

PACKAGE_MANAGER="$(node -p "const p=require('./package.json'); (p.packageManager || 'npm').split('@')[0]")"
PM_CMD=()

case "$PACKAGE_MANAGER" in
  pnpm)
    if command -v pnpm >/dev/null 2>&1; then
      PM_CMD=(pnpm)
      echo "✅ pnpm available"
    elif command -v corepack >/dev/null 2>&1; then
      PM_CMD=(corepack pnpm)
      echo "✅ corepack pnpm available"
    else
      echo "❌ pnpm not found"
      echo "   Install pnpm or enable Corepack for the declared package manager"
      exit 1
    fi
    ;;
  npm)
    if ! command -v npm >/dev/null 2>&1; then
      echo "❌ npm not found"
      echo "   Install Node.js with npm"
      exit 1
    fi
    PM_CMD=(npm)
    echo "✅ npm available"
    ;;
  *)
    echo "❌ Unsupported package manager in package.json: $PACKAGE_MANAGER"
    exit 1
    ;;
esac

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
  echo "   Install dependencies: ${PM_CMD[*]} install"
  exit 1
fi
echo "✅ Dependencies installed"

WORKOS_AUTH_STATUS="$(node <<'NODE'
const fs = require('node:fs')

const environment = { ...process.env }
if (fs.existsSync('.env.local')) {
  for (const rawLine of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const match = rawLine.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match || Object.hasOwn(environment, match[1])) continue
    let value = match[2]
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    environment[match[1]] = value
  }
}

if (environment.PIKA_LEGACY_PASSWORD_AUTH === 'true') {
  process.stdout.write('legacy|')
  process.exit(0)
}

const missing = []
if (!environment.WORKOS_CLIENT_ID?.trim().startsWith('client_')) missing.push('WORKOS_CLIENT_ID')
if (!environment.WORKOS_API_KEY?.trim().startsWith('sk_')) missing.push('WORKOS_API_KEY')
if ((environment.WORKOS_COOKIE_PASSWORD?.length ?? 0) < 32) missing.push('WORKOS_COOKIE_PASSWORD')
if ((environment.SESSION_SECRET?.length ?? 0) < 32) missing.push('SESSION_SECRET')
process.stdout.write(`workos|${missing.join(' ')}`)
NODE
)"

AUTH_MODE="${WORKOS_AUTH_STATUS%%|*}"
MISSING_WORKOS="${WORKOS_AUTH_STATUS#*|}"

if [[ "$AUTH_MODE" == "workos" ]]; then
  if [[ -n "$MISSING_WORKOS" ]]; then
    echo "❌ WorkOS Magic Auth is the default, but local configuration is incomplete: $MISSING_WORKOS"
    echo "   Add dedicated development values to .env.local before starting Pika."
    echo "   Use PIKA_LEGACY_PASSWORD_AUTH=true only for an intentional rollback or password-specific test."
    exit 1
  fi
  echo "✅ WorkOS Magic Auth configured"
else
  echo "⚠️  Legacy password authentication explicitly enabled for this environment"
fi

if [[ "$MODE" == "--tests" || "$MODE" == "--full" ]]; then
  echo "Running tests..."
  "${PM_CMD[@]}" test
  echo "✅ Tests passing"
fi

if [[ "$MODE" == "--full" ]]; then
  echo "Running lint..."
  "${PM_CMD[@]}" run lint
  echo "✅ Lint passing"

  echo "Running build..."
  "${PM_CMD[@]}" run build
  echo "✅ Build successful"
fi

echo ""
echo "✨ Environment verified. Ready for development."
