---
name: pika-audit
description: Pre-commit code audit for the Pika repository. Scans staged/changed TypeScript files for common violations including missing withErrorHandler, illegal dark: classes, duplicated utilities, and console.log statements. Run before committing to catch drift early.
---

# Pika Audit

## Overview

Scan changed TypeScript files for codebase violations before committing. Catches the most common sources of technical debt before they land in `main`.

The changed-test checks are a path-aware guardrail, not a proof system. They should be:

- cheap
- explainable
- usually correct

Use the audit to catch common drift early, then use human review for edge cases the heuristic cannot classify cleanly.

## Workflow

1. Confirm you are in the Pika repo with `git rev-parse --show-toplevel`.
2. Run the audit script:
   ```bash
   bash .codex/skills/pika-audit/scripts/audit.sh
   ```
3. Review any violations reported.
4. Fix violations before committing (use `/migrate-error-handler` for withErrorHandler issues).
5. Re-run audit to confirm clean.
6. If the audit flags composite-widget or risky-behavior follow-up, include the required checklist/validation status in your final note.
7. If a legitimate edge case does not fit the heuristic, do not weaken the rule broadly. Prefer a narrow exception only after the pattern recurs.

## Violations Detected

| Category | Pattern | Fix |
|---|---|---|
| `manual-catch` | `catch (error` in API routes without `withErrorHandler` | Run `/migrate-error-handler` |
| `no-withErrorHandler` | Route exports handler without wrapper | Run `/migrate-error-handler` |
| `dark-class` | `dark:` class outside `src/ui/` | Use semantic tokens from `docs/core/design.md` |
| `duplicate-parseContentField` | Local `parseContentField` function | Import from `@/lib/tiptap-content` |
| `console-log` | `console.log(` in non-test production code | Use `console.error`/`warn` or structured logging |
| `uncached-fetch` | Raw read `fetch()` in classroom/client components | Use `fetchJSONWithCache`; raw mutation fetches are allowed |
| `missing-risk-tests` | Risky API/server behavior changed without a relevant changed test | For `src/app/api/*`, add changed coverage in `tests/api` or `tests/integration`; for `src/lib/server/*`, add changed coverage in `tests/api`, `tests/integration`, `tests/lib`, or `tests/unit` |
| `missing-a11y-tests` | Composite widget behavior changed without a relevant changed test | Add semantic/keyboard regression coverage in `tests/components`, `tests/ui`, or `tests/integration` |

## Script

- Main: `scripts/audit.sh`
- Dry run (always non-destructive): `bash scripts/audit.sh`
