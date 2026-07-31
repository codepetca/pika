Focus: draft PR #963 redesigns hot archived classroom deletion around explicit,
single-scope managed-file ownership. Migration 117 is installed on local Supabase,
the local readiness/backfill flow is clean, and the guarded destructive fixture
proves exact database and Storage deletion while preserving Blueprint files and
user accounts. Generated types match the local 001–117 schema. Every persistent
rollout gate remains disabled, and production remains through 116.

## Current Context

- `DESIGN.md` is canonical; product status: `.ai/features.json`.
- Pal remains disabled; its widget package is an external dependency.
- Worktrees: `$HOME/.codex/worktrees/pika/` or
  `$HOME/.codex/worktrees/<id>/pika`; maintainer env:
  `$HOME/Repos/.env/pika/.env.local`; collaborators may copy `.env.example`.
- Toronto deadlines, server logic, `withErrorHandler`, semantic tokens, and
  human-controlled migrations are invariants. Workflow: `docs/dev-workflow.md`.
- Trim session logs after updates. `production` uses the protected PR flow.
