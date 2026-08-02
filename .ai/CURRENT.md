Focus: draft PR #963 redesigns hot archived classroom deletion around explicit,
single-scope managed-file ownership. An authorized local reset successfully
replayed migrations 001–117, regenerated the database contract, reseeded Pika,
and passed managed-storage readiness plus the destructive purge fixture across
all five buckets. Static contracts and the full application test/UI matrix also
pass. Every persistent rollout gate remains disabled, PR #963 remains draft,
and production remains through 116.

## Current Context

- `DESIGN.md` is canonical; product status: `.ai/features.json`.
- Pal remains disabled; its widget package is an external dependency.
- Worktrees: `$HOME/.codex/worktrees/pika/` or
  `$HOME/.codex/worktrees/<id>/pika`; maintainer env:
  `$HOME/Repos/.env/pika/.env.local`; collaborators may copy `.env.example`.
- Toronto deadlines, server logic, `withErrorHandler`, semantic tokens, and
  human-controlled migrations are invariants. Workflow: `docs/dev-workflow.md`.
- Trim session logs after updates. `production` uses the protected PR flow.
