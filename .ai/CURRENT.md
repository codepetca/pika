# Pika Current Context

Default handoff. Epic status: `.ai/features.json`; recent detail: `.ai/SESSION-LOG.md`.

## Current Focus

- Legacy Quiz removal is complete through migration 108.
- PR 920 test-preview/document-snapshot hardening uses migrations 109-110;
  review remediation is complete and exact-head CI is next.
- Shared local is reset and seeded through 104; migrations 105-110 are
  unapplied there, and 109-110 are unapplied on hosted targets.
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
