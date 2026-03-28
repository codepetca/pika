# Pika Development Workflow (Humans + AI)

This document describes the internal development workflow for the Pika project,
with a focus on agentic (Claude / Codex) development using git worktrees.

This is **developer infrastructure**, not a product feature.

---

## Why this exists

Pika is developed using:
- git worktrees
- multiple parallel feature branches
- AI agents (Claude, Codex)

Relying on shell cwd, terminal tabs, or human memory does not scale.

This workflow exists to ensure:
- correctness
- parallelism
- reproducibility
- safety when using AI agents

This workflow is part of the project’s development infrastructure,
similar to build tooling or CI conventions.

---

## Core concepts

### Hub repo

The main repo checkout:

```
$HOME/Repos/pika
```

Used for:
- managing worktrees
- viewing shared files
- **NOT** for feature development

---

### Worktrees

Each feature branch lives in its own worktree:

```
$HOME/Repos/.worktrees/pika/<worktree-name>
```

Rules:
- One worktree per feature branch
- Agents operate on exactly one worktree

---

### Environment files

All worktrees share a single canonical `.env.local` file:

```
$HOME/Repos/.env/pika/.env.local
```

Each worktree must symlink `.env.local` to that canonical path to avoid drift.

---

## The `pika` command

The `pika` script is a thin router that:
- binds commands to a specific worktree
- removes reliance on shell cwd
- provides a stable contract for AI agents

### Quick start

```bash
pika ls
pika claude <worktree>
# or
pika codex <worktree>
```

### Available commands

- `pika ls`
  Lists available worktrees.

- `pika claude <worktree> [-- <args...>]`
  Launches Claude bound to the given worktree.
  Exports:
  - `PIKA_PROJECT`
  - `PIKA_WORKTREE`
  - `PIKA_WORKTREE_NAME`

  Alias: `pika ai <worktree>` (legacy)

- `pika codex <worktree> [-- <args...>]`
  Launches Codex bound to the given worktree.
  Exports:
  - `PIKA_PROJECT`
  - `PIKA_WORKTREE`
  - `PIKA_WORKTREE_NAME`

- `pika git <worktree> <git args...>`
  Runs git safely using:
  ```bash
  git -C "$PIKA_WORKTREE" <git args...>
  ```

Use `--` to pass through engine flags, for example:
```bash
pika claude my-worktree -- --model sonnet
pika codex my-worktree -- --max-output-tokens 1200
```

---

## Mandatory agent rules

See `.ai/START-HERE.md` → "Worktree Rules" for the full list. Key rule: all git commands use `git -C "$PIKA_WORKTREE"` and all paths are absolute or `$PIKA_WORKTREE`-prefixed.

---

## Scope and evolution

This workflow is intentionally minimal (v1).

It may evolve as:
- friction appears
- parallel agent usage increases
- new projects adopt similar patterns

Any changes should prioritize:
- clarity
- correctness
- minimal surface area (few commands, explicit behavior)

---

## Landing changes to `main` (No merge commits)

`main` is configured to reject merge commits. Use linear history only.

Preferred:
- Open a PR and use **Squash and merge**.

If landing from local CLI:
```bash
cd "$HOME/Repos/pika"
git fetch origin
git checkout main
git pull --ff-only origin main

# Option A: squash feature branch into one commit
git merge --squash origin/<feature-branch>
git commit -m "<summary>"
git push origin main

# Option B: cherry-pick specific commits (also linear)
git cherry-pick <sha> [<sha>...]
git push origin main
```

Avoid:
```bash
git merge --no-ff <branch>   # creates merge commit (rejected on main)
```

---

## Merging `main` into `production` (PR-required)

`production` is branch-protected and rejects direct pushes. Always merge through a PR.

### 1) Prepare hub + production worktree

```bash
export PIKA_WORKTREE="$HOME/Repos/pika"   # hub checkout
git -C "$PIKA_WORKTREE" fetch origin
git -C "$PIKA_WORKTREE" worktree prune

if [ ! -d "$HOME/Repos/.worktrees/pika/production" ]; then
  git -C "$PIKA_WORKTREE" worktree add "$HOME/Repos/.worktrees/pika/production" production
fi
```

### 2) Merge latest remote branches in production worktree

```bash
export PROD_WT="$HOME/Repos/.worktrees/pika/production"
git -C "$PROD_WT" fetch origin main production
git -C "$PROD_WT" merge --ff-only origin/production
git -C "$PROD_WT" merge origin/main
```

### 3) Open PR to production

```bash
MERGE_BRANCH="codex/merge-main-into-production-$(date +%Y%m%d)"
git -C "$PROD_WT" push origin HEAD:"refs/heads/$MERGE_BRANCH"

gh pr create \
  --repo codepetca/pika \
  --base production \
  --head "$MERGE_BRANCH" \
  --title 'Merge main into production (YYYY-MM-DD)' \
  --body 'Merge latest main into production.'
```

### 4) Merge PR and sync local production

```bash
gh pr merge <pr-number> --repo codepetca/pika --merge
git -C "$PROD_WT" fetch origin production
git -C "$PROD_WT" merge --ff-only origin/production
```

### Known pitfalls (and fixes)

- `production` worktree path missing but listed in metadata:
  - Run `git -C "$HOME/Repos/pika" worktree prune` then re-add.
- Push rejected with `GH013`:
  - Expected; open/merge PR instead of direct push.
- `gh pr create` body errors due to backticks:
  - Use single-quoted body text (or escape backticks).
