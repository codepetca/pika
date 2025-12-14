# Git Worktrees (MANDATORY)

This repo uses **git worktrees** to avoid branch/terminal confusion (especially with multiple terminals and/or multiple AIs).

## Hard Rules

1) Never work directly on a branch in the main working directory (`pika/`).

2) Any branch work must happen inside a dedicated worktree.

3) Each worktree must:
- live in a **sibling directory** under `../worktrees/pika/`
- check out **exactly one branch**
- be used by **only one agent/task**

4) Do not switch branches in an existing working tree. Create a new worktree instead.

5) Cleanup after merge: remove the worktree when the work is complete and merged.

## Directory Convention

- `pika/` = “hub” checkout (stays on `main`, stays clean)
- `../worktrees/pika/<branch-name>/` = one worktree per branch/PR

Example:

../worktrees/pika/feat-classroom-calendar-editing

## Pre-flight Checks (run often)

pwd
git rev-parse --abbrev-ref HEAD
git status --porcelain=v1

If `pwd` or `git rev-parse` is not what you expect, stop and fix it before editing files.

## Create a New Branch Worktree

From the hub checkout (`pika/`):

git fetch origin
git worktree add -b feat/<slug> ../worktrees/pika/feat-<slug> origin/main
cd ../worktrees/pika/feat-<slug>

## Work on an Existing Branch

From the hub checkout (`pika/`):

git fetch origin
git worktree add ../worktrees/pika/<branch-name> <branch-name>
cd ../worktrees/pika/<branch-name>

## Work on an Existing PR

From the hub checkout (`pika/`):

gh pr checkout <PR_NUMBER> --branch pr/<PR_NUMBER>
git worktree add ../worktrees/pika/pr-<PR_NUMBER> pr/<PR_NUMBER>
cd ../worktrees/pika/pr-<PR_NUMBER>

## Cleanup After Merge

From the hub checkout (`pika/`):

git worktree remove ../worktrees/pika/<branch-name>

Optionally delete the local branch:

git branch -D <branch-name>

## Supabase Local Dev Note

Avoid running `supabase start` concurrently from multiple worktrees.
Pick one “primary” worktree for Supabase commands.

