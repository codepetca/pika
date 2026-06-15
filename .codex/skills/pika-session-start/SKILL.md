---
name: pika-session-start
description: Start a new Pika AI session. Validates worktree environment, runs verify-env.sh, loads compact current context and git state, checks feature inventory, and identifies the next task. Run at the beginning of every coding session.
---

# Pika Session Start

## Overview

Automates the `.ai/START-HERE.md` ritual to ensure every AI session begins with validated environment and compact current context.

## Workflow

1. Run the session start script:
   ```bash
   bash .codex/skills/pika-session-start/scripts/session_start.sh
   ```
   For report-only, docs-only, or review work, use:
   ```bash
   bash .codex/skills/pika-session-start/scripts/session_start.sh --orient-only
   ```
2. Review the output — confirm worktree, branch, `.ai/CURRENT.md`, and feature status.
3. If an issue number is provided, load it with `gh issue view <number>`.
4. Propose implementation plan before writing any code.

## Guardrails

- Run from the current Pika worktree root, not the hub checkout.
- STOP if the resolved repo root equals `$HOME/Repos/pika` (the hub).
- The default script path creates a missing `.env.local` symlink to `$HOME/Repos/.env/pika/.env.local` before verification.
- `--orient-only` / `--read-only` keeps startup non-mutating and skips `verify-env.sh`; use it only for report-only, docs-only, or review work.
- STOP if `verify-env.sh` fails.
- Do NOT write any code until a plan is approved.
- Use the resolved repo root consistently for git commands and file paths.

## Script

- Main: `scripts/session_start.sh`
