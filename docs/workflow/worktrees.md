# Git Worktrees (MANDATORY)

This repo uses **git worktrees** to avoid branch/terminal confusion (especially with multiple terminals and/or multiple AIs).

**NOTE:** `docs/ai-instructions.md` is the authoritative source for repository layout and worktree usage. If this document conflicts with ai-instructions.md, follow ai-instructions.md.

## Hard Rules

1) Never work directly on a branch in the main working directory (`pika/`).

2) Any branch work must happen inside a dedicated worktree.

3) Each worktree must:
- live under `$HOME/repos/.worktrees/pika/`
- check out **exactly one branch**
- be used by **only one agent/task**

4) Do not switch branches in an existing working tree. Create a new worktree instead.

5) Cleanup after merge: remove the worktree when the work is complete and merged.

## Directory Convention

- `$HOME/repos/pika/` = "hub" checkout (stays on `main`, stays clean)
- `$HOME/repos/.worktrees/pika/<branch-name>/` = one worktree per branch/PR

Example:

$HOME/repos/.worktrees/pika/feat-classroom-calendar-editing

## Environment Files (.env.local)

All worktrees share a single canonical `.env.local`:
- **Canonical location:** `$HOME/repos/.env/pika/.env.local`
- **Symlink setup:** Each worktree symlinks to the canonical file
- **Helper script handles this automatically:** `bash scripts/wt-add.sh <branch-name>`

**Manual symlink creation:**
```bash
ln -sf $HOME/repos/.env/pika/.env.local <worktree>/.env.local
```

**Exceptions (branch-specific envs allowed only for):**
- Running multiple Supabase/backend instances in parallel
- Destructive DB schema or migration experiments
- Different external API keys, models, or cost profiles

## Pre-flight Checks (run often)

pwd
git rev-parse --abbrev-ref HEAD
git status --porcelain=v1

If `pwd` or `git rev-parse` is not what you expect, stop and fix it before editing files.

## Quick Setup (Recommended)

Use the helper script that creates the worktree and sets up .env.local symlink:

```bash
bash scripts/wt-add.sh <branch-name>
cd $HOME/repos/.worktrees/pika/<branch-name>
```

## Create a New Branch Worktree (Manual)

From the hub checkout (`$HOME/repos/pika/`):

```bash
git fetch
git worktree add -b feat/<slug> $HOME/repos/.worktrees/pika/feat-<slug> origin/main
ln -sf $HOME/repos/.env/pika/.env.local $HOME/repos/.worktrees/pika/feat-<slug>/.env.local
cd $HOME/repos/.worktrees/pika/feat-<slug>
```

## Work on an Existing Branch (Manual)

From the hub checkout (`$HOME/repos/pika/`):

```bash
git fetch
git worktree add $HOME/repos/.worktrees/pika/<branch-name> <branch-name>
ln -sf $HOME/repos/.env/pika/.env.local $HOME/repos/.worktrees/pika/<branch-name>/.env.local
cd $HOME/repos/.worktrees/pika/<branch-name>
```

## Work on an Existing PR (Manual)

From the hub checkout (`$HOME/repos/pika/`):

```bash
gh pr checkout <PR_NUMBER> --branch pr/<PR_NUMBER>
git worktree add $HOME/repos/.worktrees/pika/pr-<PR_NUMBER> pr/<PR_NUMBER>
ln -sf $HOME/repos/.env/pika/.env.local $HOME/repos/.worktrees/pika/pr-<PR_NUMBER>/.env.local
cd $HOME/repos/.worktrees/pika/pr-<PR_NUMBER>
```

## Cleanup After Merge

From the hub checkout (`$HOME/repos/pika/`):

```bash
git worktree remove $HOME/repos/.worktrees/pika/<branch-name>
git branch -D <branch-name>
```

Both steps are **mandatory** after merge to keep the repository clean.

## Supabase Local Dev Note

Avoid running `supabase start` concurrently from multiple worktrees.
Pick one “primary” worktree for Supabase commands.

