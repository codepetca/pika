# Development speed and CI rollout

This is the measurement and rollout contract for Pika's automatic draft-first
development workflow. Correctness, privacy, tenancy, migration, and rendered
experience checks remain authoritative; speed comes from running them once on a
stable SHA and only when the changed surface can affect them.

## Baseline — 2026-08-28

The pre-change GitHub Actions sample showed:

- Latest clean workflow: Test & Build 4m41s, Architecture Database Contracts
  7m32s, Browser Experience Matrix 9m08s.
- 30 successful runs: median execution 543s, median wall time 563s, average wall
  time 609s, and maximum wall time 953s.
- Queue time: median 0s, average 76s, maximum 605s.
- Latest 30 workflow attempts: 18 successful, 8 cancelled, 3 failed, and one
  incomplete/other result. Cancelled workflows had already consumed 41 minutes
  of elapsed execution time.

Reproduce the rolling measurement with:

```bash
pnpm measure:ci -- --limit 50
```

## Setup-cache evidence

The database and browser lanes cache only immutable dependency inputs: the pnpm
store and, for the browser lane, Playwright's downloaded browser files. Every
run still installs from the lockfile, verifies Chromium system dependencies, and
starts a new ephemeral Supabase stack with a complete migration replay. Each
job summary exposes exact-key cache results. A pnpm result of `false` can mean a
useful prefix restore or a miss, while the Playwright cache uses an exact key;
compare those labels and the native GitHub Actions step durations against the
rolling PR Gate timing.

The report loads each successful `PR Gate`, reads its emitted classifier mode,
and reports time-to-gate-start, gate duration, and time-to-gate-pass separately
for docs-only, full, promotion, and application modes. Runs whose retained logs
cannot prove a mode are counted explicitly and do not satisfy per-mode targets.

## Acceptance targets

- Draft review pushes launch no heavy jobs.
- Documentation/AI-guidance PRs reach `PR Gate` in under two minutes at p50.
- Full risk-matched PRs reach `PR Gate` in under eight minutes at p50.
- Browser contracts retain all existing specs and artifacts while their test
  phase uses two stable workers and one shared setup invocation.
- Cancelled workflow rate falls below 10% after at least 20 post-rollout runs.
- No database or browser lane selected by the classifier may be skipped by the
  aggregate gate, and unknown paths must select full CI.
- Canonical production promotions reuse one draft batch PR and run Test & Build
  when the same-repository head is exactly the current reviewed `main` commit;
  any divergent, forked, or otherwise unproven production PR fails closed to
  full CI.

## Branch-ruleset checkpoint

The workflow keeps `Test & Build` successful for docs-only changes during the
transition because both `main` and `production` currently require that context.
After the workflow PR is merged:

1. Obtain explicit owner approval to change repository enforcement.
2. Add `PR Gate` as required on `main` and `production` while retaining
   `Test & Build` temporarily.
3. Open one docs-only test PR and one full-classification test PR. Confirm the
   aggregate gate passes only after every selected dependency succeeds.
4. Remove `Test & Build` from the required contexts only after both proofs pass;
   `PR Gate` remains required.

Rollback: restore `Test & Build` as required before removing `PR Gate`, then use
`workflow_dispatch` for full CI while correcting the classifier or aggregate
workflow. Never leave either protected branch without a required validation
context.

## Post-rollout audit

After at least 20 completed attempts, save the measurement output in the session
log, compare every acceptance target above, inspect any skipped or cancelled
jobs, and adjust classification only toward stronger evidence. A faster result
does not count if a relevant safety lane was omitted.
