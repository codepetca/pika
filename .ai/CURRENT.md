Focus: draft PR #963 redesigns hot archived classroom deletion around explicit,
single-scope managed-file ownership. The current stabilization binds the typed
confirmation to the exact classroom revision and managed-file digest, restores
purpose-aware student upload authorization, counts all affected student actors,
authorizes ownership before reading purge fences, derives readiness from the
complete database-owned file inventory, and enforces a named purge canary by
exact teacher and classroom in PostgreSQL. Migration 117's source has changed
since the last authorized local replay and has not been replayed again.
Every persistent rollout gate remains disabled, PR #963 remains draft, and
production remains through 116.

## Current Context

- `DESIGN.md` is canonical; product status: `.ai/features.json`.
- Pal remains disabled; its widget package is an external dependency.
- Worktrees: `$HOME/.codex/worktrees/pika/` or
  `$HOME/.codex/worktrees/<id>/pika`; maintainer env:
  `$HOME/Repos/.env/pika/.env.local`; collaborators may copy `.env.example`.
- Toronto deadlines, server logic, `withErrorHandler`, semantic tokens, and
  human-controlled migrations are invariants. Workflow: `docs/dev-workflow.md`.
- Trim session logs after updates. `production` uses the protected PR flow.
