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

## Agent ownership and context

- One active writer owns a branch and its PR. Before continuing existing work,
  inspect active tasks and worktrees and identify the owner; use an explicit
  handoff rather than launching a second writer. Record the task and branch in
  the task's progress or handoff note, not a new shared registry.
- Before committing or pushing, check for unexpected working-tree or remote-head
  changes. Stop mutations and reconcile ownership if another task has changed
  the branch. Do not repeatedly revert or reapply another active task's edits.
- Reviewers inspect a fixed commit in a separate detached worktree. They do not
  edit the implementation checkout, commit, push, or change PR state. A detached
  checkout prevents accidental shared edits; it does not revoke filesystem or
  GitHub permissions. The implementation owner remains the only writer.
- Give reviewers the requirements, repository, base/head commits, relevant
  invariants, and verification results. Prefer a clean context over a copy of
  the entire implementation conversation. Keep the independent review and
  remediation requirements below; role labels are not extra review rounds.
- Read required guidance once. The startup script renders the default documents;
  do not also read them manually. If they are already loaded and unchanged in
  the current conversation, use `session_start.sh --context-loaded` to retain
  fresh environment/git/current-state checks without repeating their text.
  Read changed guidance after a rebase or handoff, and load task-specific
  sections as needed. This does not waive any startup or safety requirement.
- Keep large command logs on disk. Report counts, timings, failures, and the log
  location instead of repeatedly pasting successful output. Keep routine session
  entries brief (outcome, evidence, next step); append and trim as required.

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

For every AI-authored development PR, agents also record lifecycle evidence with
`pnpm record:ai-pr-lifecycle`. The recorder writes append-only local metadata at
`~/.codex/metrics/pika-pr-lifecycle.jsonl` (never into the product, database,
or Git history). Record a tracking-start event once the PR number is known, then
record draft creation, independent review,
each remediation batch, ready-for-CI, CI result, and merge. Provide active time
and token components only when directly attributable; leave them unknown rather
than estimating from PR wall time. Record CI queue/run duration separately and
record correction/sync pushes without asserting they were avoidable. The tool
records only PR number, timestamps, numeric metrics, stages, and quality outcome
— never prompts, source content, secrets, identities, or environment values.

1. Run risk-matched local checks before publishing:
   ```bash
   pnpm check:focused -- --base origin/main
   ```
   The command uses the same fail-closed change classifier as CI. Agents still run
   any feature-specific database harness, browser scenario, or visual verification
   required by the routed repository guidance.
   The focused runner executes the union of the canonical `check:workflow`
   tests, changed tests, and tests related to changed source in one Vitest run.
   Success output contains summaries and timings; full logs are retained in the
   printed temporary directory, and failures print their complete check log.
   `--dry-run` prints classification and commands without executing checks.
   `check:workflow` remains the canonical explicit test-path list in
   `package.json`; unsupported changes to that command fail closed.
   During iteration, run the affected tests. Reuse a successful local check only
   when its source tree, dependencies, configuration, environment, and relevant
   base are unchanged, and record the checked commit/tree and command. Do not
   rerun solely for a newer timestamp. New commits still require their own
   required CI gate; local evidence never substitutes for it.
   Start local tracking with `pnpm record:ai-pr-lifecycle event --pr <PR>
   --event started` as soon as the PR number is known. This timestamp is only
   the start of tracking, not a proxy for active development time. After implementation,
   record `implementation` with attributable active/tokens when available.
2. Commit and push the implementation, then create the PR as a draft with
    `gh pr create --draft`. If an existing PR is ready while implementation or
    review remains, return it to draft with `gh pr ready --undo` before pushing.
   Record `draft-created` once the draft exists.
3. Run the smallest risk-appropriate independent review wave against the complete
   diff. Wait for the wave, validate its findings, and batch accepted fixes into
   one remediation pass. Do not push one commit per finding.
   Record `independent-review`, then one `remediation` event per batched pass
   (with attributable active/tokens and correction/sync-push count if available).
4. Run affected local checks, push the batch while the PR remains draft, and use
   targeted re-review rather than repeating the broad review. Complete the final
   cumulative review before requesting CI.
5. When the reviewed head commit is stable and no blocker remains, record that SHA
   in the PR and run `gh pr ready`. The `ready_for_review` event starts the
   risk-matched CI lanes exactly once for that candidate.
   A push to a ready PR is rejected by the lightweight `PR Gate` without
   launching heavy lanes; return the PR to draft before changing it, then mark
   the new reviewed SHA ready again.
   Do not start `workflow_dispatch` while an eligible, non-skipped pull-request
   CI run for the exact reviewed SHA is queued, in progress, or completed. A
   completed draft-skipped run does not count. If the ready event appears not to
   have started CI, inspect the exact-head runs and allow GitHub event processing
   to settle before rechecking. Rerun a failed eligible pull-request run through
   GitHub instead of dispatching a parallel full suite. Use the manual dispatch
   escape hatch only when no eligible, non-skipped exact-head pull-request run
   exists or for a deliberate diagnostic rerun; never launch it concurrently
   with the ready-event run.
   Use one watcher per candidate with bounded waits/backoff, and summarize only
   changed status. Do not start multiple watchers or repeatedly dump full job
   logs while the same run is pending.
   Record `ready-for-ci`; once the exact-head run resolves, record `ci-passed` or
   `ci-failed` with observed queue/run seconds and quality. After a successful
   merge, record `merged` and use `pnpm record:ai-pr-lifecycle summary --pr
   <PR>` in the concise handoff.
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
git -C "$HUB" worktree add --detach "$PROMO_WT" origin/main
```

### 2) Verify the promotion head is exactly current main

```bash
test "$(git -C "$PROMO_WT" rev-parse HEAD)" = "$(git -C "$HUB" rev-parse origin/main)"
```

GitHub combines this exact reviewed main SHA with production when the PR merges.
The promotion branch therefore receives abbreviated CI regardless of the prior
production merge strategy; divergent or otherwise unproven heads fail closed to
full CI.

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
