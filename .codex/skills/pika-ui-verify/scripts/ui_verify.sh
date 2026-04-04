#!/usr/bin/env bash
# Pika UI verification — captures Playwright screenshots for visual review
set -euo pipefail

PAGE="${1:-}"
WORKTREE="$PWD"
BASE_URL="http://localhost:3000"
AUTH_DIR="$WORKTREE/.auth"
OUT_DIR="/tmp"

PASS="\033[0;32m✅\033[0m"
FAIL="\033[0;31m❌\033[0m"
INFO="\033[0;34mℹ️ \033[0m"

if [[ -z "$PAGE" ]]; then
  echo "Usage: $0 <page-path>  (e.g. classrooms/abc123)"
  exit 1
fi

URL="$BASE_URL/$PAGE"

echo "Pika UI Verify — $URL"
echo "=========================="

# Check dev server
if ! curl -sf "$BASE_URL/api/auth/me" > /dev/null 2>&1; then
  echo -e "${FAIL} Dev server not running at $BASE_URL"
  echo "   Run: pnpm -C \"$WORKTREE\" dev"
  exit 1
fi
echo -e "${PASS} Dev server is running"

# Check auth files
for role in teacher student; do
  AUTH_FILE="$AUTH_DIR/${role}.json"
  if [[ ! -f "$AUTH_FILE" ]]; then
    echo -e "${INFO} Auth state missing for $role — running e2e:auth"
    pnpm -C "$WORKTREE" e2e:auth
    break
  fi
done

# Teacher desktop
echo -e "${INFO} Capturing teacher view (1440×900)..."
npx playwright screenshot "$URL" \
  "$OUT_DIR/pika-teacher.png" \
  --load-storage "$AUTH_DIR/teacher.json" \
  --viewport-size "1440,900" \
  --wait-for-timeout 2000
echo -e "${PASS} Teacher: $OUT_DIR/pika-teacher.png"

# Student mobile
echo -e "${INFO} Capturing student view (390×844)..."
npx playwright screenshot "$URL" \
  "$OUT_DIR/pika-student.png" \
  --load-storage "$AUTH_DIR/student.json" \
  --viewport-size "390,844" \
  --wait-for-timeout 2000
echo -e "${PASS} Student: $OUT_DIR/pika-student.png"

# Teacher mobile
echo -e "${INFO} Capturing teacher mobile view (390×844)..."
npx playwright screenshot "$URL" \
  "$OUT_DIR/pika-teacher-mobile.png" \
  --load-storage "$AUTH_DIR/teacher.json" \
  --viewport-size "390,844" \
  --wait-for-timeout 2000
echo -e "${PASS} Teacher mobile: $OUT_DIR/pika-teacher-mobile.png"

echo ""
echo "=========================="
echo "Screenshots saved to /tmp/pika-*.png"
echo "Review each screenshot and verify:"
echo "  - No layout overflow or broken elements"
echo "  - Text is legible"
echo "  - Interactive elements are accessible"
echo "  - No missing/unstyled content"
