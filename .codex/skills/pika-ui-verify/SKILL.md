---
name: pika-ui-verify
description: Visual verification of Pika UI changes using Playwright screenshots. Captures teacher and student views of any page. Use after any UI/UX change — this is mandatory before committing visual changes.
---

# Pika UI Verify

## Overview

Takes Playwright screenshots of a given Pika page from both teacher and student perspectives, then prompts visual review against an explicit role, viewport, theme, and state matrix.

## Workflow

1. Ensure the dev server is running (`pnpm dev`).
2. Run the UI verify script with the page path:
   ```bash
   bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh "classrooms/abc123"
   ```
3. Review screenshots in `/tmp/pika-*.png`.
4. Verify the relevant matrix entries:
   - teacher and student, or declare one `n/a`
   - desktop and mobile
   - light and dark when supported
   - affected states such as hover, open, selected, loading, empty, drag, or edit
5. If issues found: fix code and re-run.
6. Report "Visual verification passed" only after the matrix is covered.

## What Gets Checked

- Desktop teacher view (1440×900)
- Mobile teacher view (390×844) when the change affects teacher mobile layouts
- Desktop student view when the change affects student desktop layouts
- Mobile student view (390×844)
- No layout overflow or broken elements
- Text legibility
- Dark mode (if applicable — semantic tokens only)
- The intended visual signal without extra decorative treatments

## Guardrails

- Run BOTH roles — never skip student or teacher.
- Cover the affected states intentionally — do not assume the default screen proves hover/open/selected behavior.
- Iterate until verified — don't commit unverified UI changes.
- See `docs/guides/ai-ui-testing.md` for detailed patterns.

## Script

- Main: `scripts/ui_verify.sh <page-path>`
