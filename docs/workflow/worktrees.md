# DEPRECATED - Use docs/dev-workflow.md

**This document is outdated and should NOT be followed.**

The Pika project now uses the `pika` command for worktree management.

**See**: **[docs/dev-workflow.md](../dev-workflow.md)** for the current, correct workflow.

---

# [OLD CONTENT BELOW — FOR REFERENCE ONLY]

---

# Git Worktrees (MANDATORY)

This repo uses **git worktrees** to avoid branch/terminal confusion (especially with multiple terminals and/or multiple AIs).

**NOTE:** `docs/dev-workflow.md` is the authoritative source for repository layout and worktree usage. If this document conflicts with dev-workflow.md, follow dev-workflow.md.

## Hard Rules

1) Never work directly on a branch in the main working directory (`pika/`).

2) Any branch work must happen inside a dedicated worktree.

3) Each worktree must:
- live under `$HOME/Repos/.worktrees/pika/`
- check out **exactly one branch**
- be used by **only one agent/task**

4) Do not switch branches in an existing working tree. Create a new worktree instead.

5) Cleanup after merge: remove the worktree when the work is complete and merged.

Legacy note: to keep git usage explicit in the examples below, bind:
```bash
export PIKA_WORKTREE="$HOME/Repos/pika"
```

## Directory Convention

- `$HOME/Repos/pika/` = "hub" checkout (stays on `main`, stays clean)
- `$HOME/Repos/.worktrees/pika/<branch-name>/` = one worktree per branch/PR

Example:

$HOME/Repos/.worktrees/pika/feat-classroom-calendar-editing

## Environment Files (.env.local)

All worktrees share a single canonical `.env.local`:
- **Canonical location:** `$HOME/Repos/.env/pika/.env.local`
- **Symlink setup:** Each worktree symlinks to the canonical file
- **Legacy helper script handles this automatically (see docs/dev-workflow.md instead):** `bash scripts/wt-add.sh <branch-name>`

**Manual symlink creation:**
```bash
ln -sf $HOME/Repos/.env/pika/.env.local <worktree>/.env.local
```

**Exceptions (branch-specific envs allowed only for):**
- Running multiple Supabase/backend instances in parallel
- Destructive DB schema or migration experiments
- Different external API keys, models, or cost profiles

## Pre-flight Checks (run often)

pwd
git -C "$PIKA_WORKTREE" rev-parse --abbrev-ref HEAD
git -C "$PIKA_WORKTREE" status --porcelain=v1

If `pwd` or `git rev-parse` is not what you expect, stop and fix it before editing files.

## Quick Setup (Recommended)

Legacy helper script that creates the worktree and sets up the .env.local symlink
(human-only; it runs git without `-C` internally):

```bash
cd "$PIKA_WORKTREE"
bash "$PIKA_WORKTREE/scripts/wt-add.sh" <branch-name>
cd $HOME/Repos/.worktrees/pika/<branch-name>
```

## Create a New Branch Worktree (Manual)

From the hub checkout (`$HOME/Repos/pika/`):

```bash
git -C "$PIKA_WORKTREE" fetch
git -C "$PIKA_WORKTREE" worktree add -b feat/<slug> $HOME/Repos/.worktrees/pika/feat-<slug> origin/main
ln -sf $HOME/Repos/.env/pika/.env.local $HOME/Repos/.worktrees/pika/feat-<slug>/.env.local
cd $HOME/Repos/.worktrees/pika/feat-<slug>
```

## Work on an Existing Branch (Manual)

From the hub checkout (`$HOME/Repos/pika/`):

```bash
git -C "$PIKA_WORKTREE" fetch
git -C "$PIKA_WORKTREE" worktree add $HOME/Repos/.worktrees/pika/<branch-name> <branch-name>
ln -sf $HOME/Repos/.env/pika/.env.local $HOME/Repos/.worktrees/pika/<branch-name>/.env.local
cd $HOME/Repos/.worktrees/pika/<branch-name>
```

## Work on an Existing PR (Manual)

From the hub checkout (`$HOME/Repos/pika/`):

```bash
gh pr checkout <PR_NUMBER> --branch pr/<PR_NUMBER>
git -C "$PIKA_WORKTREE" worktree add $HOME/Repos/.worktrees/pika/pr-<PR_NUMBER> pr/<PR_NUMBER>
ln -sf $HOME/Repos/.env/pika/.env.local $HOME/Repos/.worktrees/pika/pr-<PR_NUMBER>/.env.local
cd $HOME/Repos/.worktrees/pika/pr-<PR_NUMBER>
```

## Cleanup After Merge

From the hub checkout (`$HOME/Repos/pika/`):

```bash
git -C "$PIKA_WORKTREE" worktree remove $HOME/Repos/.worktrees/pika/<branch-name>
git -C "$PIKA_WORKTREE" branch -D <branch-name>
```

Both steps are **mandatory** after merge to keep the repository clean.

## Supabase Local Dev Note

Avoid running `supabase start` concurrently from multiple worktrees.
Pick one “primary” worktree for Supabase commands.
