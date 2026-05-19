# Pika Development Workflow (Humans + AI)

This document describes the internal development workflow for the Pika project,
with a focus on agentic (Claude / Codex) development using git worktrees.

This is the canonical source for worktree usage and shared `.env.local` setup.
Other AI guidance docs should point here instead of restating the same setup steps.

This is **developer infrastructure**, not a product feature.

---

## Why this exists

Pika is developed using:
- git worktrees
- multiple parallel feature branches
- AI agents (Claude, Codex)

Relying on shell cwd, terminal tabs, or human memory does not scale.
Codex can use its current checkout/worktree directly; no project-specific
environment variable is required for it to know where it is working.

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

### Worktree locations

New named Pika feature worktrees live under:

```
$HOME/.codex/worktrees/pika/<worktree-name>
```

Codex Desktop may also create app-managed Pika worktrees under:

```
$HOME/.codex/worktrees/<id>/pika
```

Both are valid Codex-native worktrees. Agents should discover the current
checkout with `git rev-parse --show-toplevel` and then operate from that root.

Rules:
- One worktree per feature branch
- Agents operate on exactly one worktree
- Older worktrees may still exist under `$HOME/Repos/.worktrees/pika`; leave them in place, but create new named worktrees under `$HOME/.codex/worktrees/pika`.

Do not depend on project-specific worktree environment variables. If an
external script needs a path, pass it explicitly or run it from inside the
intended worktree.

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
- launches commands in a specific worktree
- helps humans avoid opening agents in the hub by mistake
- keeps human-launched AI sessions on a named worktree

It is a convenience wrapper, not a requirement for Codex. Codex should create or
open a git worktree natively and then operate from that worktree root.

### Quick start

```bash
pika ls
pika claude <worktree>
```

### Available commands

- `pika ls`
  Lists available worktrees.

- `pika claude <worktree> [-- <args...>]`
  Launches Claude in the given worktree.

  Alias: `pika ai <worktree>` (legacy)

- `pika codex <worktree> [-- <args...>]`
  Optional compatibility helper for launching Codex in the given named worktree.
  Codex Desktop sessions do not need this.

- `pika git <worktree> <git args...>`
  Runs git in the resolved named worktree. Resolution checks
  `$HOME/.codex/worktrees/pika` first, then the legacy
  `$HOME/Repos/.worktrees/pika` path while old worktrees exist.

Use `--` to pass through engine flags, for example:
```bash
pika claude my-worktree -- --model sonnet
```

---

## Mandatory agent rules

Agents **must** follow these rules:

- Resolve the current repo root with `git rev-parse --show-toplevel`.
- Treat that resolved root as the only checkout for the task.
- Use absolute paths or paths relative to that root.
- Do not do feature or branch work in `$HOME/Repos/pika` (the hub).
- For non-trivial edits started from the hub, create a dedicated worktree first.

If unsure which worktree to use:
- Run `git worktree list` from the hub or ask the user which worktree to use.

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

## Post-merge cleanup

After a feature PR is merged to `main`, clean up from the hub checkout:

```bash
HUB="$HOME/Repos/pika"
BRANCH="<branch-name>"
git -C "$HUB" fetch origin
git -C "$HUB" merge --ff-only origin/main
WT_PATH="$(git -C "$HUB" worktree list --porcelain \
  | awk -v branch="$BRANCH" '
      /^worktree / { path=substr($0, 10) }
      /^branch refs\/heads\// {
        ref=substr($0, 19)
        if (ref == branch) { print path; exit }
      }')"
if [ -n "$WT_PATH" ]; then
  git -C "$HUB" worktree remove "$WT_PATH"
fi
git -C "$HUB" branch -D "$BRANCH"
```

This keeps the hub checkout fast-forwarded to the merged `main` before removing
the finished worktree and branch. Resolving the path from Git metadata lets
cleanup handle both new Codex worktrees and older legacy worktrees.

---

## Merging `main` into `production` (PR-required)

`production` is branch-protected and rejects direct pushes. Always merge through a PR.
Prefer the helper script in `.codex/skills/pika-main-to-production-merge`; the
manual flow below documents the same behavior.

### 1) Prepare hub + production worktree

```bash
HUB="$HOME/Repos/pika"
WT_ROOT="$HOME/.codex/worktrees/pika"
git -C "$HUB" fetch origin
git -C "$HUB" worktree prune

PROD_WT="$(git -C "$HUB" worktree list --porcelain \
  | awk '/^worktree / { path=$2 } /^branch refs\/heads\/production$/ { print path; exit }')"

if [ -z "$PROD_WT" ]; then
  PROD_WT="$WT_ROOT/production"
  mkdir -p "$(dirname "$PROD_WT")"
  git -C "$HUB" worktree add "$PROD_WT" production
fi
```

### 2) Merge latest remote branches in production worktree

```bash
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
