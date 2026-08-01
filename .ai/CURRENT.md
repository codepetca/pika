Focus: draft PR #963 redesigns hot archived classroom deletion around explicit
managed-file ownership. Migration 117 now uses immutable UUID generations,
write-once ready objects, database-derived legacy targets, terminal recovery, and
durable adoption receipts. Local DB still has the prior 117; replay and database
verification require fresh named authorization. Rollout is disabled; prod is at 116.

## Current Context

- `DESIGN.md` is canonical; product status: `.ai/features.json`.
- Pal remains disabled; its widget package is an external dependency.
- Worktrees: `$HOME/.codex/worktrees/pika/` or
  `$HOME/.codex/worktrees/<id>/pika`; maintainer env:
  `$HOME/Repos/.env/pika/.env.local`; collaborators may copy `.env.example`.
- Toronto deadlines, server logic, `withErrorHandler`, semantic tokens, and
  human-controlled migrations are invariants. Workflow: `docs/dev-workflow.md`.
- Trim session logs after updates. `production` uses the protected PR flow.
