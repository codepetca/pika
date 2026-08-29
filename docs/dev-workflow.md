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

> **Collaborators:** the shared canonical env file below is the maintainer's
> machine-specific convention. If you don't have `$HOME/Repos/.env/pika/`,
> just keep your own `.env.local` (copied from `.env.example` — see the
> README) in each checkout and skip the symlink steps.

On the maintainer's setup, all worktrees share a single canonical `.env.local` file:

```
$HOME/Repos/.env/pika/.env.local
```

Each worktree must symlink `.env.local` to that canonical path to avoid drift:

```bash
WORKTREE="$(git rev-parse --show-toplevel)"
ENV_CANONICAL="$HOME/Repos/.env/pika/.env.local"
[ -e "$WORKTREE/.env.local" ] || ln -s "$ENV_CANONICAL" "$WORKTREE/.env.local"
```

The hub checkout may also expose `.env.local`, but worktrees should point to the
canonical shared file directly. Do not copy the env file into a worktree.
Codex/Claude startup should repair a missing symlink before running the app or
`verify-env.sh`.

---

## The `pika` command

`pika` is the teacher CLI: it drives Pika's teacher API headlessly so
curriculum can be authored as versioned markdown instead of clicked through the
UI. See [`scripts/pika-cli-README.md`](../scripts/pika-cli-README.md) for
commands and setup.

```bash
pnpm pika help          # from any checkout of this repo
pika help               # if the global launcher is installed
```

A worktree-router script previously owned this name. It was retired once the
worktree rules below became the canonical workflow; create and open worktrees
with `git worktree` directly, as described above.

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

## Automatic AI pull-request lifecycle

AI-authored work uses a draft-first, stable-SHA lifecycle. Agents execute this
automatically; it is not a checklist the maintainer must remember.

1. Run risk-matched local checks before publishing:
   ```bash
   pnpm check:focused -- --base origin/main
   ```
   The command uses the same fail-closed change classifier as CI. Agents still run
   any feature-specific database harness, browser scenario, or visual verification
   required by the routed repository guidance.
2. Commit and push the implementation, then create the PR as a draft with
   `gh pr create --draft`. If an existing PR is ready while implementation or
   review remains, return it to draft with `gh pr ready --undo` before pushing.
3. Run the smallest risk-appropriate independent review wave against the complete
   diff. Wait for the wave, validate its findings, and batch accepted fixes into
   one remediation pass. Do not push one commit per finding.
4. Run affected local checks, push the batch while the PR remains draft, and use
   targeted re-review rather than repeating the broad review. Complete the final
   cumulative review before requesting CI.
5. When the reviewed head commit is stable and no blocker remains, record that SHA
   in the PR and run `gh pr ready`. The `ready_for_review` event starts the
   risk-matched CI lanes exactly once for that candidate.
6. Merge only when `PR Gate` passes on that same reviewed SHA and the normal review
   authority gate is satisfied. If CI exposes a defect, return the PR to draft
   before changing it, batch the correction, target the re-review, and mark it
   ready again only after the new SHA is stable.

CI classifies changes conservatively:

- Documentation and AI-guidance-only diffs run fast workflow contracts in the
  transition-safe `Test & Build` job.
- Application diffs always run Test & Build; rendered UI paths add the browser
  matrix, while database/server-contract paths add ephemeral database contracts.
- CI configuration, dependency/runtime configuration, manual dispatches, empty
  change evidence, and unknown paths fail closed to the full suite.
- Same-repository production promotion PRs whose head exactly matches current
  `main` validate with Test & Build; divergent or unproven promotion heads run
  full CI. Risk-matched database and browser contracts already ran against the
  exact `main` SHA.
- `workflow_dispatch` remains the full-suite escape hatch.

`Test & Build` remains compatible with the existing branch rules during rollout.
After an owner verifies `PR Gate`, repository rules should require `PR Gate` on
both `main` and `production`. Never weaken or bypass a required check during the
transition.

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

### Periodic hygiene check

Merged PR branches are deleted automatically on GitHub, but local branches,
worktrees, and idle PRs still accumulate. Run the read-only report at any time:

```bash
bash scripts/repo-tidy.sh
```

It lists remote branches whose PR is merged/closed, local branches with deleted
upstreams, clean vs dirty worktrees, and open PRs idle for more than 30 days
(override with `IDLE_DAYS`). It deletes nothing — it prints the command for each
finding. `/repo-tidy` runs the report and walks through the cleanup with you.

---

## Merging `main` into `production` (PR-required)

`production` is branch-protected and rejects direct pushes. Always merge through a PR.
Prefer the helper script in `.codex/skills/pika-main-to-production-merge`; the
manual flow below documents the same behavior.

Agents do not start a production promotion after every main merge. When a
promotion is explicitly authorized, the helper creates one draft batch PR or
updates the existing open promotion PR. Complete cumulative review once, mark
the stable SHA ready, and merge only after `PR Gate` passes.

### 1) Prepare an ephemeral detached promotion worktree

```bash
HUB="$HOME/Repos/pika"
WT_ROOT="$HOME/.codex/worktrees/pika"
git -C "$HUB" fetch origin
git -C "$HUB" worktree prune
mkdir -p "$WT_ROOT"
PROMO_TMP="$(mktemp -d "$WT_ROOT/.production-promotion.XXXXXX")"
PROMO_WT="$PROMO_TMP/worktree"
git -C "$HUB" worktree add --detach "$PROMO_WT" origin/production
```

### 2) Merge current main without advancing local production

```bash
git -C "$PROMO_WT" merge --no-edit origin/main
```

If production is an ancestor of main this fast-forwards to the exact reviewed
main SHA and receives abbreviated promotion CI. Divergent or otherwise unproven
merge results fail closed to full CI.

### 3) Open PR to production

```bash
MERGE_BRANCH="codex/merge-main-into-production-$(date +%Y%m%d)"
git -C "$PROMO_WT" push origin HEAD:"refs/heads/$MERGE_BRANCH"

gh pr create --draft \
  --repo codepetca/pika \
  --base production \
  --head "$MERGE_BRANCH" \
  --title 'Merge main into production (YYYY-MM-DD)' \
  --body 'Merge latest main into production.'
```

### 4) Merge PR and remove the ephemeral worktree

```bash
gh pr merge <pr-number> --repo codepetca/pika --merge
git -C "$HUB" worktree remove "$PROMO_WT"
rmdir "$PROMO_TMP"
```

### Known pitfalls (and fixes)

- A failed merge leaves the ephemeral worktree dirty:
  - Preserve and report its exact path for conflict resolution; do not reset a
    persistent local `production` branch.
- Push rejected with `GH013`:
  - Expected; open/merge PR instead of direct push.
- `gh pr create` body errors due to backticks:
  - Use single-quoted body text (or escape backticks).
