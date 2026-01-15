#!/usr/bin/env bash
# e2e-mcp.sh - Start Playwright MCP server for AI-assisted UI testing
#
# Usage:
#   pnpm e2e:mcp [--teacher|--student] [extra-args...]
#
# Examples:
#   pnpm e2e:mcp --teacher           # Start with teacher auth
#   pnpm e2e:mcp --student           # Start with student auth
#   pnpm e2e:mcp                     # Start unauthenticated
#   pnpm e2e:mcp --teacher --headless # Headless mode

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Defaults matching playwright.config.ts
VIEWPORT="1440x900"
BROWSER="chromium"
OUTPUT_DIR="${PROJECT_ROOT}/playwright-report"

# Parse auth role argument
AUTH_STATE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --teacher)
      AUTH_STATE="${PROJECT_ROOT}/.auth/teacher.json"
      shift
      ;;
    --student)
      AUTH_STATE="${PROJECT_ROOT}/.auth/student.json"
      shift
      ;;
    *)
      break
      ;;
  esac
done

# Build command
CMD=(npx @playwright/mcp
  --browser "$BROWSER"
  --viewport-size "$VIEWPORT"
  --output-dir "$OUTPUT_DIR"
)

# Add auth state if specified
if [[ -n "$AUTH_STATE" ]]; then
  if [[ ! -f "$AUTH_STATE" ]]; then
    echo "Error: Auth state not found: $AUTH_STATE"
    echo "Run 'pnpm e2e:auth' first to generate auth states."
    exit 1
  fi
  CMD+=(--storage-state "$AUTH_STATE")
fi

# Add remaining arguments
CMD+=("$@")

echo "Starting Playwright MCP server..."
echo "  Browser: $BROWSER"
echo "  Viewport: $VIEWPORT"
echo "  Output: $OUTPUT_DIR"
[[ -n "$AUTH_STATE" ]] && echo "  Auth: $AUTH_STATE"
echo ""
echo "MCP server will be available for Claude Code."
echo "Make sure dev server is running: pnpm dev"
echo ""

exec "${CMD[@]}"
