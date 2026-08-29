---
name: pika-main-to-production-merge
description: Safely merge `main` into `production` for the Pika repository using the required PR-based flow. Use when asked to run a release sync from `main` to `production`, especially when branch protection blocks direct pushes or when `production` worktree metadata may be stale.
---

# Pika Main To Production Merge

## Overview

Execute a deterministic `main` -> `production` merge flow that respects Pika worktree rules and GitHub branch protection.

## Workflow

1. Confirm the task is specifically to merge `main` into `production` in Pika.
2. Run the preflight and merge helper script. It reuses the single open promotion
   PR when one exists, returns it to draft before updating, and batches newer main
   commits into that same branch:
   - `bash .codex/skills/pika-main-to-production-merge/scripts/merge_main_into_production.sh`
3. Complete one cumulative independent review on the draft promotion diff, record
   the reviewed SHA, mark the PR ready, and wait for `PR Gate`.
4. If the script reports a created or updated PR URL, share it. Do not create a
   second promotion PR while the batch is open.
5. Merge the PR (manually or with `gh pr merge`). The helper uses and removes an
   ephemeral detached worktree at the exact current `origin/main` SHA, so it
   never advances a persistent local `production` branch and remains safe after
   merge, squash, or rebase outcomes.
6. Report final `origin/production` commit SHA.

## Conflict Handling

1. If `git merge origin/main` conflicts, stop and list conflicted files.
2. Resolve conflicts only in the ephemeral promotion worktree path reported by
   the helper.
3. Complete the merge commit and continue PR flow.

## Guardrails

- Use worktree-safe git commands (`git -C <path>`).
- Expect `production` direct pushes to fail with `GH013`; use PR flow.
- The helper prunes stale metadata and creates a fresh detached promotion
  worktree from `origin/main` on every run; GitHub computes the merge with
  production.
- Use single-quoted PR body text when calling `gh pr create` to avoid shell interpolation.
- Do not promote automatically after every main PR. Start a promotion only when
  explicitly authorized, and batch additional reviewed main commits into the one
  open draft promotion PR.

## Script

- Main helper:
  - `scripts/merge_main_into_production.sh`
- Dry run:
  - `bash scripts/merge_main_into_production.sh --dry-run`
