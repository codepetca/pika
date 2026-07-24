# Pika Current Context

Default handoff. Epic status: `.ai/features.json`; recent detail: `.ai/SESSION-LOG.md`.

## Current Focus

- Legacy Quiz retirement: migration 107 and strict archive-v2 runtime are in
  PR 930 review. Existing Quiz rows and Quiz-format payloads are explicitly
  disposable; the next pass is migration 108 hard schema removal.
- Shared local schema: 001-105. Migrations 106-107 have passed disposable
  replay only. None of 105-107 is hosted.
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
