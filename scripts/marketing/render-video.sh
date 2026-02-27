#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RAW_DIR="$ROOT_DIR/artifacts/marketing/video/raw"
OUT_DIR="$ROOT_DIR/artifacts/marketing/video"
AUDIO_FILE="$ROOT_DIR/artifacts/marketing/audio/pika-voiceover-60s.aiff"
SRT_FILE="$ROOT_DIR/artifacts/marketing/captions/pika-voiceover-60s.srt"

OUTPUT_SUFFIX="${CAPTURE_OUTPUT_SUFFIX:-}"
if [[ -z "${OUTPUT_SUFFIX// }" ]]; then
  if [[ "${CAPTURE_DARK_MODE:-false}" == "true" ]]; then
    OUTPUT_SUFFIX="-dark"
  else
    OUTPUT_SUFFIX="-light"
  fi
elif [[ "$OUTPUT_SUFFIX" != -* ]]; then
  OUTPUT_SUFFIX="-$OUTPUT_SUFFIX"
fi

TEACHER_RAW="$RAW_DIR/teacher-flow$OUTPUT_SUFFIX.webm"
STUDENT_RAW="$RAW_DIR/student-flow$OUTPUT_SUFFIX.webm"
LOGIN_RAW="$RAW_DIR/login-flow$OUTPUT_SUFFIX.webm"

TEACHER_NORM="$OUT_DIR/teacher-flow$OUTPUT_SUFFIX.mp4"
STUDENT_NORM="$OUT_DIR/student-flow$OUTPUT_SUFFIX.mp4"
LOGIN_NORM="$OUT_DIR/login-flow$OUTPUT_SUFFIX.mp4"
SILENT_MASTER="$OUT_DIR/pika-walkthrough-60s$OUTPUT_SUFFIX-silent.mp4"
NARRATED_MASTER="$OUT_DIR/pika-walkthrough-60s$OUTPUT_SUFFIX.mp4"
WEBM_MASTER="$OUT_DIR/pika-walkthrough-60s$OUTPUT_SUFFIX.webm"
CAPTIONED_MASTER="$OUT_DIR/pika-walkthrough-60s$OUTPUT_SUFFIX-captioned.mp4"
POSTER="$OUT_DIR/pika-walkthrough$OUTPUT_SUFFIX-poster.png"
VERTICAL="$OUT_DIR/pika-walkthrough-60s$OUTPUT_SUFFIX-9x16.mp4"
SQUARE="$OUT_DIR/pika-walkthrough-60s$OUTPUT_SUFFIX-1x1.mp4"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found on PATH" >&2
  exit 1
fi

if [[ ! -f "$LOGIN_RAW" || ! -f "$TEACHER_RAW" || ! -f "$STUDENT_RAW" ]]; then
  echo "Raw walkthrough clips missing. Expected:" >&2
  echo "  $LOGIN_RAW" >&2
  echo "  $TEACHER_RAW" >&2
  echo "  $STUDENT_RAW" >&2
  echo "Run: pnpm walkthrough:marketing" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
echo "Rendering variant suffix: $OUTPUT_SUFFIX"

# Normalize clips to a deterministic render format.
ffmpeg -y -i "$LOGIN_RAW" \
  -vf "scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2,format=yuv420p" \
  -r 30 -an -c:v libx264 -preset veryfast -crf 22 "$LOGIN_NORM"

ffmpeg -y -i "$TEACHER_RAW" \
  -vf "scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2,format=yuv420p" \
  -r 30 -an -c:v libx264 -preset veryfast -crf 22 "$TEACHER_NORM"

ffmpeg -y -i "$STUDENT_RAW" \
  -vf "scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2,format=yuv420p" \
  -r 30 -an -c:v libx264 -preset veryfast -crf 22 "$STUDENT_NORM"

# Build silent master.
ffmpeg -y -i "$LOGIN_NORM" -i "$TEACHER_NORM" -i "$STUDENT_NORM" \
  -filter_complex "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]" \
  -map "[v]" -c:v libx264 -preset veryfast -crf 22 "$SILENT_MASTER"

if [[ -f "$AUDIO_FILE" ]]; then
  ffmpeg -y -i "$SILENT_MASTER" -i "$AUDIO_FILE" \
    -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -shortest "$NARRATED_MASTER"
else
  cp "$SILENT_MASTER" "$NARRATED_MASTER"
fi

# Web delivery variant + poster image.
ffmpeg -y -i "$NARRATED_MASTER" -c:v libvpx-vp9 -b:v 0 -crf 33 -row-mt 1 -threads 4 -c:a libopus "$WEBM_MASTER"
ffmpeg -y -ss 00:00:05 -i "$NARRATED_MASTER" -vframes 1 "$POSTER"

# Add soft subtitle track if captions exist.
if [[ -f "$SRT_FILE" ]]; then
  ffmpeg -y -i "$NARRATED_MASTER" -i "$SRT_FILE" \
    -c:v copy -c:a copy -c:s mov_text -metadata:s:s:0 language=eng "$CAPTIONED_MASTER"
fi

# Channel variants.
ffmpeg -y -i "$NARRATED_MASTER" \
  -vf "crop=506:900:(in_w-506)/2:0,scale=1080:1920,format=yuv420p" \
  -c:v libx264 -preset veryfast -crf 23 -c:a aac -shortest "$VERTICAL"

ffmpeg -y -i "$NARRATED_MASTER" \
  -vf "crop=900:900:(in_w-900)/2:0,scale=1080:1080,format=yuv420p" \
  -c:v libx264 -preset veryfast -crf 23 -c:a aac -shortest "$SQUARE"

echo "Rendered video assets in: $OUT_DIR"
