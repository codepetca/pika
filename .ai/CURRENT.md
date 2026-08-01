Focus: draft PR #963 redesigns hot archived classroom deletion around explicit,
single-scope managed-file ownership. The consolidated migration 117 source has
changed since the last local replay and therefore still requires fresh, exact
authorization before its readiness/backfill and destructive fixtures can be
rerun. Static migration contracts and the full application test/UI matrix pass.
Every persistent rollout gate remains disabled, and production remains through
116.

## Current Context

- `DESIGN.md` is canonical; product status: `.ai/features.json`.
- Pal remains disabled; its widget package is an external dependency.
- Worktrees: `$HOME/.codex/worktrees/pika/` or
  `$HOME/.codex/worktrees/<id>/pika`; maintainer env:
  `$HOME/Repos/.env/pika/.env.local`; collaborators may copy `.env.example`.
- Toronto deadlines, server logic, `withErrorHandler`, semantic tokens, and
  human-controlled migrations are invariants. Workflow: `docs/dev-workflow.md`.
- Trim session logs after updates. `production` uses the protected PR flow.
