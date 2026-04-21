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
   bash "$PIKA_WORKTREE/.codex/skills/pika-session-start/scripts/session_start.sh"
   ```
2. Review the output — confirm worktree, branch, `.ai/CURRENT.md`, and feature status.
3. If an issue number is provided, load it with `gh issue view <number>`.
4. Propose implementation plan before writing any code.

## Guardrails

- STOP if `$PIKA_WORKTREE` is unset or equals `$HOME/Repos/pika` (the hub).
- STOP if `verify-env.sh` fails.
- Do NOT write any code until a plan is approved.
- ALL git commands must use `git -C "$PIKA_WORKTREE"`.

## Script

- Main: `scripts/session_start.sh`
