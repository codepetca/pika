#!/usr/bin/env bash
# Pika pre-commit audit script
# Scans changed TypeScript files for common violations.
# Exit 0 = clean. Exit 1 = violations found.
set -euo pipefail

WORKTREE="${PIKA_WORKTREE:-$PWD}"
VIOLATIONS=0
PASS="\033[0;32m✅\033[0m"
FAIL="\033[0;31m❌\033[0m"

# Collect changed .ts/.tsx files
CHANGED=$(git -C "$WORKTREE" diff --name-only HEAD 2>/dev/null || true)
STAGED=$(git -C "$WORKTREE" diff --name-only --cached 2>/dev/null || true)
ALL_FILES=$(printf '%s\n%s\n' "$CHANGED" "$STAGED" | sort -u | grep -E '\.(ts|tsx)$' || true)

if [[ -z "$ALL_FILES" ]]; then
  echo -e "${PASS} No TypeScript files changed. Audit skipped."
  exit 0
fi

echo "Pika Audit — scanning $(echo "$ALL_FILES" | wc -l | tr -d ' ') changed file(s)"
echo "============================================================"

report_violation() {
  local category="$1"
  local location="$2"
  local message="$3"
  echo -e "  ${FAIL} [${category}] ${location} — ${message}"
  VIOLATIONS=$((VIOLATIONS + 1))
}

while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  FULL="$WORKTREE/$file"
  [[ ! -f "$FULL" ]] && continue

  # a) API routes: manual catch + missing withErrorHandler
  if [[ "$file" == src/app/api/* ]]; then
    # Manual catch blocks
    while IFS=: read -r lineno _; do
      report_violation "manual-catch" "$file:$lineno" "use withErrorHandler instead of manual try/catch"
    done < <(grep -n 'catch (error' "$FULL" 2>/dev/null || true)

    # Exported handler without withErrorHandler
    if grep -qE 'export async function (GET|POST|PATCH|PUT|DELETE)' "$FULL" 2>/dev/null; then
      if ! grep -q 'withErrorHandler' "$FULL" 2>/dev/null; then
        report_violation "no-withErrorHandler" "$file" "run /migrate-error-handler to wrap handlers"
      fi
    fi
  fi

  # b) dark: classes outside src/ui/
  if [[ "$file" != src/ui/* ]]; then
    while IFS=: read -r lineno _; do
      report_violation "dark-class" "$file:$lineno" "use semantic tokens (bg-surface, text-text-default, etc.) not dark: classes"
    done < <(grep -nE '(className|class)=.*dark:' "$FULL" 2>/dev/null || true)
  fi

  # c) Duplicated parseContentField function
  while IFS=: read -r lineno _; do
    report_violation "duplicate-parseContentField" "$file:$lineno" "import parseContentField from @/lib/tiptap-content instead"
  done < <(grep -nE '(function|const) parseContentField' "$FULL" 2>/dev/null || true)

  # d) console.log in production code (not tests)
  if [[ "$file" != *.test.ts && "$file" != *.spec.ts && "$file" != *.test.tsx && "$file" != *.spec.tsx ]]; then
    while IFS=: read -r lineno _; do
      report_violation "console-log" "$file:$lineno" "use console.error/warn or structured logging"
    done < <(grep -n 'console\.log(' "$FULL" 2>/dev/null || true)
  fi

  # e) fetchJSON without cache in client components
  if [[ "$file" == src/components/* || "$file" == src/app/classrooms/* ]]; then
    while IFS=: read -r lineno _; do
      report_violation "uncached-fetch" "$file:$lineno" "consider fetchJSONWithCache from @/lib/request-cache for repeated fetches"
    done < <(grep -n "fetch('" "$FULL" 2>/dev/null || grep -n 'fetch(`' "$FULL" 2>/dev/null || true)
  fi

done <<< "$ALL_FILES"

echo "============================================================"
if [[ "$VIOLATIONS" -eq 0 ]]; then
  echo -e "${PASS} Audit passed — no violations found."
  exit 0
else
  echo -e "${FAIL} Audit failed — ${VIOLATIONS} violation(s) found. Fix before committing."
  exit 1
fi
