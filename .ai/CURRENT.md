Focus: PR #952 on `codex/versioned-course-blueprints` implements lineage and
live-safe classroom updates. Shared local is through migration 111; the first
review remediation is awaiting targeted re-review and exact-head
CI.

Environment rules: `docs/dev-workflow.md`.
- Worktrees: `$HOME/.codex/worktrees/pika/` or
  `$HOME/.codex/worktrees/<id>/pika`.
- Env: `$HOME/Repos/.env/pika/.env.local`; collaborators may copy
  `.env.example`.

## Current Focus

- Design consolidation and portable foundations through PR 950 are on `main`;
  root `DESIGN.md` is canonical.
- The Pal pilot remains disabled; migration 111 is human-applied and the native
  widget package is an external release dependency.
- Product status: `.ai/features.json`; mobile is deferred and Gradex is owned
  by a separate session.

## Environment

- Hub: `$HOME/Repos/pika`.
- Worktrees: `$HOME/.codex/worktrees/pika/` (named), `$HOME/.codex/worktrees/<id>/pika` (app-managed).
- Maintainer env: `$HOME/Repos/.env/pika/.env.local`; collaborators use local `.env.example` copies.
- Worktree/env rules: `docs/dev-workflow.md`.

## Invariants And Hazards

- Deadlines/attendance use `America/Toronto`; business logic belongs in `src/lib/*` or server modules.
- API routes use `withErrorHandler`; UI uses semantic tokens and `@/ui`.
- Migrations need one-time target/migration permission; never infer reset, repair, rollback, seed, or cleanup permission.
- Use dedicated worktrees. After session-log updates, run `node scripts/trim-session-log.mjs`.
- `main` accepts linear history; `production` uses the protected PR flow.
