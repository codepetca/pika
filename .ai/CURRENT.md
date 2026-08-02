Focus: draft PR #963 uses explicit, single-scope managed-file ownership for hot
archived classroom deletion. Confirmation is revision/inventory-bound; readiness
uses the complete database inventory; and PostgreSQL enforces an exact canary
teacher/classroom. Migration 117 has changed since its last authorized local
replay and has not been replayed again. All gates remain off, the PR remains
draft, and production remains through 116.

## Current Context

- `DESIGN.md` is canonical; product status: `.ai/features.json`.
- Pal remains disabled; its widget package is an external dependency.
- Worktrees: `$HOME/.codex/worktrees/pika/` or
  `$HOME/.codex/worktrees/<id>/pika`; maintainer env:
  `$HOME/Repos/.env/pika/.env.local`; collaborators may copy `.env.example`.
- Toronto deadlines, server logic, `withErrorHandler`, semantic tokens, and
  human-controlled migrations are invariants. Workflow: `docs/dev-workflow.md`.
- Trim session logs after updates. `production` uses the protected PR flow.
