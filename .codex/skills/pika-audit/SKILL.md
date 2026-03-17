---
name: pika-audit
description: Pre-commit code audit for the Pika repository. Scans staged/changed TypeScript files for common violations including missing withErrorHandler, illegal dark: classes, duplicated utilities, and console.log statements. Run before committing to catch drift early.
---

# Pika Audit

## Overview

Scan changed TypeScript files for codebase violations before committing. Catches the most common sources of technical debt before they land in `main`.

## Workflow

1. Confirm you are in the Pika repo (`$PIKA_WORKTREE` is set).
2. Run the audit script:
   ```bash
   bash "$PIKA_WORKTREE/.codex/skills/pika-audit/scripts/audit.sh"
   ```
3. Review any violations reported.
4. Fix violations before committing (use `/migrate-error-handler` for withErrorHandler issues).
5. Re-run audit to confirm clean.

## Violations Detected

| Category | Pattern | Fix |
|---|---|---|
| `manual-catch` | `catch (error` in API routes without `withErrorHandler` | Run `/migrate-error-handler` |
| `no-withErrorHandler` | Route exports handler without wrapper | Run `/migrate-error-handler` |
| `dark-class` | `dark:` class outside `src/ui/` | Use semantic tokens from `docs/core/design.md` |
| `duplicate-parseContentField` | Local `parseContentField` function | Import from `@/lib/tiptap-content` |
| `console-log` | `console.log(` in non-test production code | Use `console.error`/`warn` or structured logging |

## Script

- Main: `scripts/audit.sh`
- Dry run (always non-destructive): `bash scripts/audit.sh`
