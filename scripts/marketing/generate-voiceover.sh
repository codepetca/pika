#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/docs/marketing/voiceover-60s.txt"
OUT_DIR="$ROOT_DIR/artifacts/marketing/audio"
OUT_FILE="$OUT_DIR/pika-voiceover-60s.aiff"
TMP_WAV_FILE="$OUT_DIR/pika-voiceover-60s.wav"
ENV_FILE="${ENV_FILE:-}"

explicit_voice_name_set="${VOICE_NAME+x}"
explicit_voice_name="${VOICE_NAME-}"
explicit_provider_set="${VOICE_PROVIDER+x}"
explicit_provider="${VOICE_PROVIDER-}"
explicit_openai_key_set="${OPENAI_API_KEY+x}"
explicit_openai_key="${OPENAI_API_KEY-}"
explicit_openai_model_set="${OPENAI_TTS_MODEL+x}"
explicit_openai_model="${OPENAI_TTS_MODEL-}"
explicit_openai_voice_set="${OPENAI_TTS_VOICE+x}"
explicit_openai_voice="${OPENAI_TTS_VOICE-}"
explicit_openai_format_set="${OPENAI_TTS_FORMAT+x}"
explicit_openai_format="${OPENAI_TTS_FORMAT-}"
explicit_openai_instructions_set="${OPENAI_TTS_INSTRUCTIONS+x}"
explicit_openai_instructions="${OPENAI_TTS_INSTRUCTIONS-}"

mkdir -p "$OUT_DIR"

if [[ ! -f "$SCRIPT_PATH" ]]; then
  echo "Voiceover script not found: $SCRIPT_PATH" >&2
  exit 1
fi

load_env_file() {
  local env_path="$1"
  if [[ -f "$env_path" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_path"
    set +a
    return 0
  fi
  return 1
}

if [[ "${SKIP_MARKETING_DOTENV:-false}" != "true" ]]; then
  if [[ -n "$ENV_FILE" ]]; then
    load_env_file "$ROOT_DIR/$ENV_FILE" || true
  else
    # Load both so existing shared keys in .env also work.
    # .env.local is loaded last to mirror common local-override behavior.
    load_env_file "$ROOT_DIR/.env" || true
    load_env_file "$ROOT_DIR/.env.local" || true
  fi
fi

# Respect CLI/env overrides even when .env.local exists.
if [[ -n "$explicit_voice_name_set" ]]; then export VOICE_NAME="$explicit_voice_name"; fi
if [[ -n "$explicit_provider_set" ]]; then export VOICE_PROVIDER="$explicit_provider"; fi
if [[ -n "$explicit_openai_key_set" ]]; then export OPENAI_API_KEY="$explicit_openai_key"; fi
if [[ -n "$explicit_openai_model_set" ]]; then export OPENAI_TTS_MODEL="$explicit_openai_model"; fi
if [[ -n "$explicit_openai_voice_set" ]]; then export OPENAI_TTS_VOICE="$explicit_openai_voice"; fi
if [[ -n "$explicit_openai_format_set" ]]; then export OPENAI_TTS_FORMAT="$explicit_openai_format"; fi
if [[ -n "$explicit_openai_instructions_set" ]]; then export OPENAI_TTS_INSTRUCTIONS="$explicit_openai_instructions"; fi

: "${VOICE_NAME:=Samantha}"
: "${VOICE_PROVIDER:=openai}"
: "${OPENAI_TTS_MODEL:=gpt-4o-mini-tts}"
: "${OPENAI_TTS_VOICE:=nova}"
: "${OPENAI_TTS_FORMAT:=wav}"

VOICE="$VOICE_NAME"

convert_wav_to_aiff() {
  local src_wav="$1"
  local dest_aiff="$2"

  if command -v afconvert >/dev/null 2>&1; then
    if afconvert -f AIFF -d LEI16 "$src_wav" "$dest_aiff" >/dev/null 2>&1; then
      return 0
    fi
  fi

  if command -v ffmpeg >/dev/null 2>&1; then
    ffmpeg -y -i "$src_wav" "$dest_aiff" >/dev/null 2>&1
    return 0
  fi

  return 1
}

generate_openai_voiceover() {
  if [[ -z "${OPENAI_API_KEY:-}" ]]; then
    return 1
  fi

  echo "OpenAI TTS config: model=${OPENAI_TTS_MODEL} voice=${OPENAI_TTS_VOICE} format=${OPENAI_TTS_FORMAT}"

  local payload
  payload="$(
    node - "$SCRIPT_PATH" <<'NODE'
const fs = require('fs')
const scriptPath = process.argv[2]
const input = fs.readFileSync(scriptPath, 'utf8').trim()
const body = {
  model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
  voice: process.env.OPENAI_TTS_VOICE || 'nova',
  format: process.env.OPENAI_TTS_FORMAT || 'wav',
  input,
}
if (process.env.OPENAI_TTS_INSTRUCTIONS) {
  body.instructions = process.env.OPENAI_TTS_INSTRUCTIONS
}
process.stdout.write(JSON.stringify(body))
NODE
  )"

  local response_file headers_file status_code
  response_file="$(mktemp "${TMPDIR:-/tmp}/pika-openai-tts-audio.XXXXXX")"
  headers_file="$(mktemp "${TMPDIR:-/tmp}/pika-openai-tts-headers.XXXXXX")"

  status_code="$(
    curl -sS \
      -X POST "https://api.openai.com/v1/audio/speech" \
      -H "Authorization: Bearer ${OPENAI_API_KEY}" \
      -H "Content-Type: application/json" \
      -o "$response_file" \
      -D "$headers_file" \
      --data "$payload" \
      -w "%{http_code}"
  )"

  if [[ ! "$status_code" =~ ^2 ]]; then
    echo "OpenAI TTS failed (HTTP $status_code)." >&2
    rm -f "$response_file" "$headers_file"
    return 1
  fi

  if grep -qi '^content-type:[[:space:]]*application/json' "$headers_file"; then
    echo "OpenAI TTS returned JSON response instead of audio." >&2
    rm -f "$response_file" "$headers_file"
    return 1
  fi

  mv "$response_file" "$TMP_WAV_FILE"
  rm -f "$headers_file"

  if convert_wav_to_aiff "$TMP_WAV_FILE" "$OUT_FILE"; then
    rm -f "$TMP_WAV_FILE"
    return 0
  fi

  rm -f "$TMP_WAV_FILE"
  echo "Could not convert OpenAI WAV output to AIFF (requires afconvert or ffmpeg)." >&2
  return 1
}

generate_say_voiceover() {
  if ! command -v say >/dev/null 2>&1; then
    return 1
  fi
  say -v "$VOICE" -f "$SCRIPT_PATH" -o "$OUT_FILE"
  return 0
}

if [[ "$VOICE_PROVIDER" == "openai" ]]; then
  if ! generate_openai_voiceover; then
    echo "VOICE_PROVIDER=openai but OpenAI generation failed." >&2
    exit 1
  fi
  echo "Generated (openai): $OUT_FILE"
  exit 0
fi

if [[ "$VOICE_PROVIDER" == "say" ]]; then
  if ! generate_say_voiceover; then
    echo "VOICE_PROVIDER=say but macOS 'say' is not available." >&2
    exit 1
  fi
  echo "Generated (say): $OUT_FILE"
  exit 0
fi

# auto: prefer OpenAI, fallback to macOS say
if generate_openai_voiceover; then
  echo "Generated (openai): $OUT_FILE"
  exit 0
fi

if generate_say_voiceover; then
  echo "Generated (say fallback): $OUT_FILE"
  exit 0
fi

echo "Voice generation failed: OpenAI unavailable and macOS 'say' not found." >&2
exit 1
