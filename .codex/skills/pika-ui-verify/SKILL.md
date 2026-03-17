---
name: pika-ui-verify
description: Visual verification of Pika UI changes using Playwright screenshots. Captures teacher and student views of any page. Use after any UI/UX change — this is mandatory before committing visual changes.
---

# Pika UI Verify

## Overview

Takes Playwright screenshots of a given Pika page from both teacher and student perspectives, then prompts visual review.

## Workflow

1. Ensure the dev server is running (`pnpm dev`).
2. Run the UI verify script with the page path:
   ```bash
   bash "$PIKA_WORKTREE/.codex/skills/pika-ui-verify/scripts/ui_verify.sh" "classrooms/abc123"
   ```
3. Review screenshots in `/tmp/pika-*.png`.
4. If issues found: fix code and re-run.
5. Report "Visual verification passed" when all views look correct.

## What Gets Checked

- Desktop teacher view (1440×900)
- Mobile student view (390×844)
- No layout overflow or broken elements
- Text legibility
- Dark mode (if applicable — semantic tokens only)

## Guardrails

- Run BOTH roles — never skip student or teacher.
- Iterate until verified — don't commit unverified UI changes.
- See `docs/guides/ai-ui-testing.md` for detailed patterns.

## Script

- Main: `scripts/ui_verify.sh <page-path>`
