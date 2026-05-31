#!/usr/bin/env bash
# Pika pre-commit audit script
# Scans changed TypeScript files for common violations.
# Exit 0 = clean. Exit 1 = violations found.
set -euo pipefail

if WORKTREE="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  :
else
  echo "Pika Audit must be run from inside a git checkout." >&2
  exit 1
fi
WORKTREE="$(cd "$WORKTREE" && pwd)"
VIOLATIONS=0
PASS="\033[0;32m✅\033[0m"
FAIL="\033[0;31m❌\033[0m"
WARN="\033[0;33m⚠️\033[0m"
RISKY_BEHAVIOR_CHANGED=0
COMPOSITE_WIDGET_CHANGED=0
declare -a RISKY_FILES=()
declare -a COMPOSITE_FILES=()
# Bash 3.2 with `set -u` treats empty array iteration as an unbound
# variable. Keep a sentinel so no-test changes report audit violations.
declare -a TEST_FILES=("__pika_no_changed_tests__")

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

test_file_matches_any() {
  local test_file="$1"
  shift
  local prefix
  for prefix in "$@"; do
    if [[ "$test_file" == "$prefix"* ]]; then
      return 0
    fi
  done
  return 1
}

has_relevant_test_for_risky_file() {
  local file="$1"
  local test_file

  for test_file in "${TEST_FILES[@]}"; do
    if [[ "$file" == src/app/api/* ]]; then
      if test_file_matches_any "$test_file" "tests/api/" "tests/integration/"; then
        return 0
      fi
    elif [[ "$file" == src/lib/server/* ]]; then
      if test_file_matches_any "$test_file" "tests/api/" "tests/integration/" "tests/lib/" "tests/unit/"; then
        return 0
      fi
    fi
  done

  return 1
}

missing_risk_test_message() {
  local file="$1"
  if [[ "$file" == src/app/api/* ]]; then
    printf '%s' 'risky API behavior changed without a relevant changed test under tests/api or tests/integration'
    return
  fi

  if [[ "$file" == src/lib/server/* ]]; then
    printf '%s' 'risky server behavior changed without a relevant changed test under tests/api, tests/integration, tests/lib, or tests/unit'
    return
  fi

  printf '%s' 'risky server/runtime behavior changed without a relevant changed test'
}

has_relevant_test_for_composite_file() {
  local file="$1"
  local source_base source_stem source_stem_lower
  local test_file
  local test_base test_stem test_stem_lower test_full

  source_base="$(basename "$file")"
  source_stem="${source_base%.*}"
  source_stem_lower="$(printf '%s' "$source_stem" | tr '[:upper:]' '[:lower:]')"

  for test_file in "${TEST_FILES[@]}"; do
    if ! test_file_matches_any "$test_file" "tests/components/" "tests/ui/" "tests/integration/"; then
      continue
    fi

    test_base="$(basename "$test_file")"
    test_stem="${test_base%%.test.*}"
    test_stem="${test_stem%%.spec.*}"
    test_stem_lower="$(printf '%s' "$test_stem" | tr '[:upper:]' '[:lower:]')"
    test_full="$WORKTREE/$test_file"

    if is_generic_composite_stem "$source_stem"; then
      if [[ "$test_stem_lower" == "$source_stem_lower" ]]; then
        return 0
      fi
      continue
    fi

    if [[ "$test_stem_lower" == "$source_stem_lower"* || "$source_stem_lower" == "$test_stem_lower"* ]]; then
      return 0
    fi

    if [[ -f "$test_full" ]] && grep -Fq "$source_stem" "$test_full" 2>/dev/null; then
      return 0
    fi
  done

  return 1
}

is_generic_composite_stem() {
  local stem="$1"
  case "$stem" in
    button|Button|index|Index|page|Page|menu|Menu|tab|Tab|tabs|Tabs|panel|Panel|dialog|Dialog|drawer|Drawer|popover|Popover|input|Input|select|Select|list|List|item|Item|row|Row|cell|Cell|table|Table|card|Card|form|Form|layout|Layout|shell|Shell)
      return 0
      ;;
  esac
  return 1
}

while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  FULL="$WORKTREE/$file"
  [[ ! -f "$FULL" ]] && continue

  if [[ "$file" == *.test.ts || "$file" == *.spec.ts || "$file" == *.test.tsx || "$file" == *.spec.tsx ]]; then
    TEST_FILES+=("$file")
  fi

  if [[ "$file" == src/app/api/* || "$file" == src/lib/server/* ]]; then
    if [[ "$file" == *grade* || "$file" == *grading* || "$file" == *return* || "$file" == *auto-grade* || "$file" == *tick* || "$file" == *attempt* || "$file" == *respond* || "$file" == *session-status* || "$file" == *focus-events* || "$file" == *cron* ]]; then
      RISKY_BEHAVIOR_CHANGED=1
      RISKY_FILES+=("$file")
    fi
  fi

  if [[ "$file" == src/components/* || "$file" == src/ui/* || "$file" == src/app/classrooms/* || "$file" == src/app/*/*.tsx || "$file" == src/app/*/*/*.tsx ]]; then
    if grep -Eq 'role=|aria-|tabpanel|dialog|menu|listbox|combobox|separator|ariaLabel|aria-labelledby|aria-controls' "$FULL" 2>/dev/null; then
      COMPOSITE_WIDGET_CHANGED=1
      COMPOSITE_FILES+=("$file")
    fi
  fi

  # a) API routes: manual catch + missing withErrorHandler
  if [[ "$file" == src/app/api/* ]]; then
    HAS_WRAPPER=0
    if grep -q 'withErrorHandler' "$FULL" 2>/dev/null; then
      HAS_WRAPPER=1
    fi

    # Exported handler without withErrorHandler
    if grep -qE 'export async function (GET|POST|PATCH|PUT|DELETE)' "$FULL" 2>/dev/null; then
      if [[ "$HAS_WRAPPER" -eq 0 ]]; then
        report_violation "no-withErrorHandler" "$file" "run /migrate-error-handler to wrap handlers"
      fi
    fi

    # Manual catch blocks are only flagged for unwrapped route files.
    if [[ "$HAS_WRAPPER" -eq 0 ]]; then
      while IFS=: read -r lineno _; do
        report_violation "manual-catch" "$file:$lineno" "use withErrorHandler instead of manual try/catch"
      done < <(grep -n 'catch (error' "$FULL" 2>/dev/null || true)
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
      if sed -n "$((lineno - 4 < 1 ? 1 : lineno - 4)),$((lineno - 1))p" "$FULL" | grep -Eq 'fetchJSONWithCache|prefetchJSON'; then
        continue
      fi
      # Raw fetch is allowed for one-off mutations; cache guidance targets repeated reads.
      if sed -n "${lineno},$((lineno + 6))p" "$FULL" | grep -q 'method:'; then
        continue
      fi
      report_violation "uncached-fetch" "$file:$lineno" "consider fetchJSONWithCache from @/lib/request-cache for repeated reads"
    done < <(grep -n "fetch('" "$FULL" 2>/dev/null || true; grep -n 'fetch(`' "$FULL" 2>/dev/null || true)
  fi

done <<< "$ALL_FILES"

if [[ "$RISKY_BEHAVIOR_CHANGED" -eq 1 ]]; then
  for file in "${RISKY_FILES[@]}"; do
    if ! has_relevant_test_for_risky_file "$file"; then
      report_violation \
        "missing-risk-tests" \
        "$file" \
        "$(missing_risk_test_message "$file")"
      break
    fi
  done
fi

if [[ "$COMPOSITE_WIDGET_CHANGED" -eq 1 ]]; then
  for file in "${COMPOSITE_FILES[@]}"; do
    if ! has_relevant_test_for_composite_file "$file"; then
      report_violation \
        "missing-a11y-tests" \
        "$file" \
        "composite widget semantics changed without a relevant changed test under tests/components, tests/ui, or tests/integration matching or referencing the changed component"
      break
    fi
  done
fi

echo "============================================================"
if [[ "$VIOLATIONS" -eq 0 ]]; then
  echo -e "${PASS} Audit passed — no violations found."
  if [[ "$RISKY_BEHAVIOR_CHANGED" -eq 1 ]]; then
    echo -e "${WARN} Risk profile reminder — changed files suggest non-trivial behavioral risk. Report focused tests and full validation status."
  fi
  if [[ "$COMPOSITE_WIDGET_CHANGED" -eq 1 ]]; then
    echo -e "${WARN} Accessibility reminder — composite widget checklist applies: docs/guidance/ui/composite-widget-accessibility.md"
  fi
  exit 0
else
  echo -e "${FAIL} Audit failed — ${VIOLATIONS} violation(s) found. Fix before committing."
  exit 1
fi
