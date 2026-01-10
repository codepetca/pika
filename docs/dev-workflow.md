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

Agents **must** follow these rules:

- NEVER assume the shell cwd
- ALL git commands MUST use:
  ```bash
  git -C "$PIKA_WORKTREE"
  ```
- ALL file paths must be absolute or prefixed with:
  ```bash
  $PIKA_WORKTREE
  ```

If unsure which worktree to use:
- Ask the user to run `pika ls`

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
