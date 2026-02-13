#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/docs/marketing/voiceover-60s.txt"
OUT_DIR="$ROOT_DIR/artifacts/marketing/audio"
OUT_FILE="$OUT_DIR/pika-voiceover-60s.aiff"
VOICE="${VOICE_NAME:-Samantha}"

mkdir -p "$OUT_DIR"

if [[ ! -f "$SCRIPT_PATH" ]]; then
  echo "Voiceover script not found: $SCRIPT_PATH" >&2
  exit 1
fi

if ! command -v say >/dev/null 2>&1; then
  echo "macOS 'say' command not found; cannot generate voiceover audio." >&2
  exit 1
fi

say -v "$VOICE" -f "$SCRIPT_PATH" -o "$OUT_FILE"
echo "Generated: $OUT_FILE"
