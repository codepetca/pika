# Pika Current Context

Default handoff. Epic status: `.ai/features.json`; recent detail: `.ai/SESSION-LOG.md`.

## Current Focus

- Legacy Quiz retirement is complete on `main` through migration 108.
- PR 920 is rebased onto that work. Its test-preview and document-snapshot
  hardening now uses migrations 109-110 and is awaiting final independent
  review and exact-head CI.
- The shared local database was reset and seeded through migration 104 before
  the Quiz-removal merge. Migrations 105-110 are unapplied there; 109-110 have
  not been applied to any hosted target.
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
