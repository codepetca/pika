# Pika Current Context

Default handoff. Epic status: `.ai/features.json`; recent detail: `.ai/SESSION-LOG.md`.

## Current Focus

- Migrations 001-104 and the archive canary are verified; classroom hot-restored; source/Gradex cleanup disabled.
- Product experience: `.ai/features.json`; audit: `docs/guidance/ui/product-experience-audit-2026-07.md`. Safety Wave and Phase 2 are complete. Phase 3 assignment, Daily/Attendance desktop/accessibility, and Tests list reliability work is complete; mobile UX is deferred, Gradex is owned by a separate session, and Tests authoring/grading separation is next.

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
