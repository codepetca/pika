#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_URL="${CAPTURE_BASE_URL:-http://localhost:3017}"

if [[ "${ALLOW_MARKETING_SEED:-false}" != "true" ]]; then
  echo "Refusing to run full build without ALLOW_MARKETING_SEED=true" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required" >&2
  exit 1
fi

if ! curl -fsS "$BASE_URL/login" >/dev/null 2>&1; then
  echo "Dev server not reachable at $BASE_URL" >&2
  echo "Start it first (example): PORT=3017 pnpm dev" >&2
  exit 1
fi

cd "$ROOT_DIR"

echo "[1/8] Seeding deterministic marketing demo data..."
pnpm seed:marketing

echo "[2/8] Generating auth storage states for marketing accounts..."
pnpm auth:marketing

echo "[3/8] Capturing screenshot pack..."
pnpm capture:marketing

echo "[4/8] Recording walkthrough raw clips..."
pnpm walkthrough:marketing

echo "[5/8] Generating voiceover audio..."
if ! pnpm voiceover:marketing; then
  echo "Warning: voiceover generation failed (continuing without narration)." >&2
  echo "Set VOICEOVER_REQUIRED=true to fail hard when voiceover cannot be generated." >&2
  if [[ "${VOICEOVER_REQUIRED:-false}" == "true" ]]; then
    exit 1
  fi
fi

echo "[6/8] Generating captions..."
pnpm captions:marketing

echo "[7/8] Rendering final videos and channel variants..."
pnpm video:marketing

echo "[8/8] Bundling publish-ready assets..."
pnpm bundle:marketing

echo "Done. Publish bundle: $ROOT_DIR/artifacts/marketing/publish"
