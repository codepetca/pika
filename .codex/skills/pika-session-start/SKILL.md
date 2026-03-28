---
name: pika-session-start
description: Start a new Pika AI session. Validates worktree environment, runs verify-env.sh, loads recent session log and git context, checks feature inventory, and identifies the next task. Run at the beginning of every coding session.
---

# Pika Session Start

## Overview

Automates the `.ai/START-HERE.md` ritual to ensure every AI session begins with validated environment and correct context.

## Workflow

1. Run the session start script from the worktree root:
   ```bash
   bash .codex/skills/pika-session-start/scripts/session_start.sh
   ```
2. Review the output — confirm worktree path contains `.claude/worktrees/`, check branch and task.
3. If an issue number is provided, load it with `gh issue view <number>`.
4. Propose implementation plan before writing any code.

## Guardrails

- STOP if `git rev-parse --show-toplevel` does not contain `.claude/worktrees/` (wrong directory).
- STOP if the worktree root equals `$HOME/Repos/pika` (the hub — never work there).
- STOP if `verify-env.sh` fails.
- Do NOT write any code until a plan is approved.
- Use plain `git` commands without `-C` flags (CWD is the worktree).

## Script

- Main: `scripts/session_start.sh`
